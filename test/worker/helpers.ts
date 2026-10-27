import { exports } from "cloudflare:workers";
import type { Bootstrap, MyChannel } from "../../src/shared/types";

const ORIGIN = "http://kaiwa.test";
let seq = 0;

export interface Res<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

/** A tiny API client that keeps the session cookie like a browser would. */
export class Client {
  cookie = "";
  user!: { id: string; displayName: string; email: string };

  async req<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/api${path}`, { method, headers, body: payload }),
    );
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) {
      const m = /kaiwa_session=([^;]*)/.exec(setCookie);
      if (m) this.cookie = m[1] ? `kaiwa_session=${m[1]}` : "";
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

export async function signup(name = "user"): Promise<Client> {
  const client = new Client();
  seq++;
  const email = `${name}-${seq}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const r = await client.post<{ user: Client["user"] }>("/auth/signup", {
    email,
    password: "password123",
    displayName: name,
  });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  client.user = r.body.user;
  return client;
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
