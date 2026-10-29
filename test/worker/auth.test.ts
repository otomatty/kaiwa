import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, googleSignIn, insertUser, legacySession, signup, stubGoogleToken } from "./helpers";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function signInError(r: { status: number; headers: Headers }): string | null {
  expect(r.status).toBe(302);
  return new URL(r.headers.get("Location") ?? "", "http://kaiwa.test").searchParams.get("error");
}

describe("auth", () => {
  it("redirects to Google with state, nonce and PKCE", async () => {
    const c = new Client();
    const r = await c.get("/auth/google?next=%2Finvite%2Fabc");
    expect(r.status).toBe(302);
    const url = new URL(r.headers.get("Location") ?? "");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "test-client-id.apps.googleusercontent.com",
      redirect_uri: "http://kaiwa.test/api/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    for (const key of ["state", "nonce", "code_challenge"]) {
      expect(url.searchParams.get(key)).toMatch(/^[\w-]{43}$/);
    }
    const cookie = r.headers.getSetCookie().find((v) => v.startsWith("kaiwa_oauth="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
  });

  it("creates an account on first sign-in, reads /me, logs out and signs back in", async () => {
    const id = uniq();
    const account = { sub: `sub-${id}`, email: `Taro-${id}@Example.com`, name: "山田 太郎" };
    const c = new Client();
    const r = await googleSignIn(c, account);
    expect(r.headers.get("Location")).toBe("/");
    expect(r.headers.getSetCookie().find((v) => v.startsWith("kaiwa_session="))).toMatch(/HttpOnly/i);

    const me = await c.get<{ user: { id: string; email: string; displayName: string; fullName: string } }>(
      "/me",
    );
    expect(me.body.user).toMatchObject({
      email: `taro-${id}@example.com`,
      displayName: "山田 太郎",
      fullName: "山田 太郎",
    });

    await c.post("/auth/logout");
    expect((await c.get<{ user: null }>("/me")).body.user).toBeNull();

    await googleSignIn(c, { ...account, name: "Renamed on Google" });
    const again = await c.get<{ user: { id: string; displayName: string } }>("/me");
    expect(again.body.user.id).toBe(me.body.user.id);
    // The profile is the user's own once created.
    expect(again.body.user.displayName).toBe("山田 太郎");
  });

  it("links accounts created before Google sign-in by a Workspace or Gmail address", async () => {
    const id = uniq();
    const existing = await insertUser(`old-${id}@example.com`);
    // Whoever registered the address back then (proven or not) loses their sessions and sockets.
    const before = await legacySession(existing);
    const ws = await before.post<{ workspace: { id: string } }>("/workspaces", { name: "Legacy" });
    const res = await exports.default.fetch(
      new Request(`http://kaiwa.test/api/workspaces/${ws.body.workspace.id}/ws`, {
        headers: { Upgrade: "websocket", Cookie: before.cookie },
      }),
    );
    expect(res.status).toBe(101);
    const socket = res.webSocket as WebSocket;
    socket.accept();
    const closed = new Promise<number>((resolve) => socket.addEventListener("close", (e) => resolve(e.code)));

    const c = new Client();
    const account = { sub: `sub-${id}`, email: `old-${id}@example.com`, name: "Old" };
    await googleSignIn(c, account, { claims: { hd: "example.com" } });
    expect((await c.get<{ user: { id: string } }>("/me")).body.user.id).toBe(existing);
    expect((await before.get<{ user: null }>("/me")).body.user).toBeNull();
    expect(await closed).toBe(4001);

    // Later email changes on the Google side are followed.
    await googleSignIn(c, { ...account, email: `new-${id}@example.com` });
    const me = await c.get<{ user: { id: string; email: string } }>("/me");
    expect(me.body.user).toEqual(expect.objectContaining({ id: existing, email: `new-${id}@example.com` }));

    const gmail = await insertUser(`kaiwa.${id}@gmail.com`);
    await googleSignIn(c, { sub: `sub-gmail-${id}`, email: `kaiwa.${id}@gmail.com`, name: "G" });
    expect((await c.get<{ user: { id: string } }>("/me")).body.user.id).toBe(gmail);
  });

  it("does not link by an address Google cannot vouch for the current owner of", async () => {
    const id = uniq();
    await insertUser(`legacy-${id}@example.com`);
    const c = new Client();
    for (const claims of [{}, { hd: "other.example" }]) {
      const r = await googleSignIn(
        c,
        { sub: `sub-${id}`, email: `legacy-${id}@example.com`, name: "L" },
        { claims },
      );
      expect(signInError(r), JSON.stringify(claims)).toBe("link_unavailable");
      expect((await c.get<{ user: null }>("/me")).body.user).toBeNull();
    }
  });

  it("refuses an email that belongs to a different Google account", async () => {
    const id = uniq();
    await insertUser(`taken-${id}@example.com`, `sub-a-${id}`);
    const c = new Client();
    const r = await googleSignIn(c, { sub: `sub-b-${id}`, email: `taken-${id}@example.com`, name: "B" });
    expect(signInError(r)).toBe("account_conflict");
    expect((await c.get<{ user: null }>("/me")).body.user).toBeNull();
  });

  it("rejects unverified emails and invalid ID tokens", async () => {
    const account = () => ({ sub: `sub-${uniq()}`, email: `x-${uniq()}@example.com`, name: "X" });
    const cases: [Record<string, unknown>, string][] = [
      [{ email_verified: false }, "email_unverified"],
      [{ nonce: "replayed" }, "google_failed"],
      [{ aud: "someone-else.apps.googleusercontent.com" }, "google_failed"],
      [{ iss: "https://evil.example" }, "google_failed"],
      [{ exp: Math.floor(Date.now() / 1000) - 10 }, "google_failed"],
    ];
    for (const [claims, error] of cases) {
      const c = new Client();
      expect(signInError(await googleSignIn(c, account(), { claims })), JSON.stringify(claims)).toBe(error);
      expect((await c.get<{ user: null }>("/me")).body.user).toBeNull();
    }
  });

  it("fails safely when Google refuses the code", async () => {
    const c = new Client();
    const start = await c.get("/auth/google");
    const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
    const restore = stubGoogleToken(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
    try {
      expect(signInError(await c.get(`/auth/google/callback?code=bad&state=${state}`))).toBe("google_failed");
    } finally {
      restore();
    }
  });

  it("rejects callbacks without the matching state cookie (login CSRF)", async () => {
    const victim = new Client();
    expect(signInError(await victim.get("/auth/google/callback?code=x&state=y"))).toBe("invalid_state");

    const stateOf = async (c: Client) =>
      new URL((await c.get("/auth/google")).headers.get("Location") ?? "").searchParams.get("state");
    const attackerState = await stateOf(new Client());
    const victimState = await stateOf(victim);
    expect(signInError(await victim.get(`/auth/google/callback?code=x&state=${attackerState}`))).toBe(
      "invalid_state",
    );
    // The state cookie is single-use, so a rejected callback also ends the victim's own attempt.
    expect(signInError(await victim.get(`/auth/google/callback?code=x&state=${victimState}`))).toBe(
      "invalid_state",
    );
  });

  it("reports cancellation on Google's side", async () => {
    const c = new Client();
    const start = await c.get("/auth/google?next=%2Fw%2FT1");
    const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
    const r = await c.get(`/auth/google/callback?error=access_denied&state=${state}`);
    expect(r.headers.get("Location")).toBe("/login?error=access_denied&next=%2Fw%2FT1");
  });

  it("only returns to same-origin paths after sign-in", async () => {
    const account = () => ({ sub: `sub-${uniq()}`, email: `n-${uniq()}@example.com`, name: "N" });
    const ok = await googleSignIn(new Client(), account(), { next: "/invite/abc?x=1" });
    expect(ok.headers.get("Location")).toBe("/invite/abc?x=1");
    for (const next of ["//evil.example/", "/\\evil.example/", "/\t/evil.example", "https://evil.example/"]) {
      const r = await googleSignIn(new Client(), account(), { next });
      expect(r.headers.get("Location"), next).toBe("/");
    }
  });

  it("requires auth for protected routes", async () => {
    const r = await new Client().post("/workspaces", { name: "x" });
    expect(r.status).toBe(401);
  });

  it("rejects cross-origin mutations (CSRF)", async () => {
    const c = await signup("csrf");
    const r = await c.req("POST", "/workspaces", { name: "Evil" }, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const same = await c.req("POST", "/workspaces", { name: "Good" }, { Origin: "http://kaiwa.test" });
    expect(same.status).toBe(201);
  });

  it("updates the profile and status", async () => {
    const c = await signup("profile");
    const r = await c.patch<{
      user: { displayName: string; statusEmoji: string; statusText: string; title: string };
    }>("/me", {
      displayName: "新しい名前",
      statusEmoji: "palm_tree",
      statusText: "休暇中",
      title: "Engineer",
    });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({
      displayName: "新しい名前",
      statusEmoji: "palm_tree",
      statusText: "休暇中",
    });
    const expired = await c.patch<{ user: { statusText: string } }>("/me", {
      statusText: "old",
      statusExpiresAt: Date.now() - 1000,
    });
    expect(expired.body.user.statusText).toBe("");
  });
});

describe("do not disturb", () => {
  it("stores a pause-notifications deadline and expires it", async () => {
    const c = await signup("dnd");
    const until = Date.now() + 60_000;
    const r = await c.patch<{ user: { dndUntil: number | null } }>("/me", { dndUntil: until });
    expect(r.body.user.dndUntil).toBe(until);
    const past = await c.patch<{ user: { dndUntil: number | null } }>("/me", { dndUntil: Date.now() - 1 });
    expect(past.body.user.dndUntil).toBeNull();
  });
});
