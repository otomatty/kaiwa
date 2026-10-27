import { describe, expect, it } from "vitest";
import { Client, signup } from "./helpers";

describe("auth", () => {
  it("signs up, reads /me, logs out and back in", async () => {
    const c = new Client();
    const email = `taro-${Date.now()}@example.com`;
    const s = await c.post<{ user: { id: string; displayName: string } }>("/auth/signup", {
      email,
      password: "password123",
      displayName: "Taro",
    });
    expect(s.status).toBe(201);
    expect(s.body.user.displayName).toBe("Taro");
    expect(s.headers.get("Set-Cookie")).toMatch(/HttpOnly/i);

    const me = await c.get<{ user: { id: string } | null }>("/me");
    expect(me.body.user?.id).toBe(s.body.user.id);

    await c.post("/auth/logout");
    const after = await c.get<{ user: null }>("/me");
    expect(after.body.user).toBeNull();

    const bad = await c.post("/auth/login", { email, password: "wrong-password" });
    expect(bad.status).toBe(401);

    const ok = await c.post<{ user: { id: string } }>("/auth/login", {
      email: email.toUpperCase(),
      password: "password123",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(s.body.user.id);
  });

  it("rejects duplicate emails and invalid input", async () => {
    const c = new Client();
    const email = `dup-${Date.now()}@example.com`;
    expect((await c.post("/auth/signup", { email, password: "password123", displayName: "A" })).status).toBe(
      201,
    );
    const dup = await new Client().post("/auth/signup", { email, password: "password123", displayName: "B" });
    expect(dup.status).toBe(409);
    const short = await new Client().post("/auth/signup", {
      email: "x@example.com",
      password: "123",
      displayName: "C",
    });
    expect(short.status).toBe(422);
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

describe("rate limiting", () => {
  it("throttles repeated failed sign-ins for the same account", async () => {
    const c = await signup("victim");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await new Client().req(
        "POST",
        "/auth/login",
        { email: c.user.email, password: "nope-nope" },
        {
          "CF-Connecting-IP": "203.0.113.9",
        },
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
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
