import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./context";
import { randomToken, sha256Hex } from "./crypto";
import { forbidden, unauthorized } from "./http";
import type { UserRow } from "./rows";

export const SESSION_COOKIE = "kaiwa_session";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const RENEW_BEFORE = 15 * 24 * 60 * 60 * 1000;

function cookieOptions(c: Context<AppEnv>, expires: Date) {
  const secure = new URL(c.req.url).protocol === "https:";
  return { httpOnly: true, secure, sameSite: "Lax" as const, path: "/", expires };
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL;
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), userId, now, expiresAt)
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, new Date(expiresAt)));
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?1")
      .bind(await sha256Hex(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function loadSessionUser(
  c: Context<AppEnv>,
): Promise<{ user: UserRow; sessionId: string; expiresAt: number } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at AS session_expires_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1`,
  )
    .bind(id)
    .first<UserRow & { session_id: string; session_expires_at: number }>();
  if (!row) return null;
  const now = Date.now();
  if (row.session_expires_at < now) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
    return null;
  }
  // Sliding expiration.
  if (row.session_expires_at - now < RENEW_BEFORE) {
    const expiresAt = now + SESSION_TTL;
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ?2 WHERE id = ?1").bind(id, expiresAt).run();
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c, new Date(expiresAt)));
  }
  const { session_id, session_expires_at, ...user } = row;
  return { user: user as UserRow, sessionId: session_id, expiresAt: session_expires_at };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadSessionUser(c);
  if (!session) throw unauthorized();
  c.set("user", session.user);
  c.set("sessionId", session.sessionId);
  await next();
};

/**
 * Basic CSRF defence for cookie-authenticated mutations: cross-origin browser
 * requests carry an Origin header that must match the request host.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === new URL(c.req.url).host;
      } catch {
        ok = false;
      }
      if (!ok) throw forbidden("不正なリクエスト元です");
    }
  }
  await next();
};
