import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import type { Bootstrap, MyChannel } from "../../src/shared/types";
import { newId } from "../../src/worker/lib/ids";

const ORIGIN = "http://kaiwa.test";
let seq = 0;

export interface Res<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

/** A tiny API client that keeps cookies like a browser would. */
export class Client {
  cookies = new Map<string, string>();
  user!: { id: string; displayName: string; email: string };

  /** The Cookie request header. */
  get cookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async req<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookies.size > 0) headers.Cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/api${path}`, { method, headers, body: payload, redirect: "manual" }),
    );
    for (const cookie of res.headers.getSetCookie()) {
      const m = /^([^=]+)=([^;]*)/.exec(cookie);
      if (!m?.[1]) continue;
      if (m[2] && !/max-age=0/i.test(cookie)) this.cookies.set(m[1], m[2]);
      else this.cookies.delete(m[1]);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // non-JSON body
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get = <T = Record<string, unknown>>(p: string) => this.req<T>("GET", p);
  post = <T = Record<string, unknown>>(p: string, b?: unknown) => this.req<T>("POST", p, b ?? {});
  patch = <T = Record<string, unknown>>(p: string, b?: unknown) => this.req<T>("PATCH", p, b ?? {});
  del = <T = Record<string, unknown>>(p: string) => this.req<T>("DELETE", p);

  async bootstrap(wid: string): Promise<Bootstrap> {
    const r = await this.get<Bootstrap>(`/workspaces/${wid}/bootstrap`);
    if (r.status !== 200) throw new Error(`bootstrap failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async channel(wid: string, name: string): Promise<MyChannel> {
    const b = await this.bootstrap(wid);
    const ch = b.channels.find((c) => c.name === name);
    if (!ch) throw new Error(`channel ${name} not found`);
    return ch;
  }
}

export interface GoogleAccount {
  sub: string;
  email: string;
  name: string;
}

/** An unsigned ID token as Google's token endpoint would return it (the API checks claims, not signatures). */
export function idToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature`;
}

/** Answers requests to Google's token endpoint with `respond` until the returned function is called. */
export function stubGoogleToken(respond: (form: FormData) => Response | Promise<Response>): () => void {
  const realFetch = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.url !== "https://oauth2.googleapis.com/token") return realFetch(input, init);
    return respond(await req.formData());
  });
  return () => spy.mockRestore();
}

/**
 * Runs the Google sign-in flow (start → Google → callback) with Google's token endpoint stubbed.
 * `claims` overrides the ID token Google would issue. Returns the callback response.
 */
export async function googleSignIn(
  client: Client,
  account: GoogleAccount,
  opts: { next?: string; claims?: Record<string, unknown> } = {},
): Promise<Res> {
  const start = await client.get(`/auth/google${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`);
  if (start.status !== 302) throw new Error(`sign-in start failed: ${start.status}`);
  const authorize = new URL(start.headers.get("Location") ?? "");
  const restore = stubGoogleToken(
    (form) =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3599,
          id_token: idToken({
            iss: "https://accounts.google.com",
            aud: form.get("client_id"),
            sub: account.sub,
            email: account.email,
            email_verified: true,
            name: account.name,
            nonce: authorize.searchParams.get("nonce"),
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...opts.claims,
          }),
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  try {
    const state = authorize.searchParams.get("state") ?? "";
    return await client.get(`/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`);
  } finally {
    restore();
  }
}

/** Creates a new account by signing in with a fresh Google account. */
export async function signup(name = "user"): Promise<Client> {
  const client = new Client();
  seq++;
  const id = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await googleSignIn(client, { sub: `google-${id}`, email: `${name}-${id}@example.com`, name });
  if (r.status !== 302 || r.headers.get("Location") !== "/") {
    throw new Error(`sign-in failed: ${r.status} ${r.headers.get("Location")}`);
  }
  const me = await client.get<{ user: Client["user"] }>("/me");
  client.user = me.body.user;
  return client;
}

/** Inserts an account directly, e.g. one created before sign-in was Google-only. */
export async function insertUser(email: string, googleSub: string | null = null): Promise<string> {
  const id = newId("U");
  await env.DB.prepare(
    "INSERT INTO users (id, email, google_sub, display_name, avatar_color, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(id, email, googleSub, "Existing", "#4a154b", Date.now())
    .run();
  return id;
}

/** Creates a workspace owned by `owner` and joins every other client via an invite link. */
export async function workspaceWith(owner: Client, ...others: Client[]): Promise<string> {
  const r = await owner.post<{ workspace: { id: string } }>("/workspaces", { name: "Acme" });
  if (r.status !== 201) throw new Error(`workspace failed: ${r.status}`);
  const wid = r.body.workspace.id;
  const inv = await owner.post<{ code: string }>(`/workspaces/${wid}/invites`);
  for (const o of others) {
    const a = await o.post(`/invites/${inv.body.code}/accept`);
    if (a.status !== 200) throw new Error(`accept failed: ${a.status} ${JSON.stringify(a.body)}`);
  }
  return wid;
}
