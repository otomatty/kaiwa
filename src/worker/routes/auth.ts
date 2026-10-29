import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { updateProfileSchema } from "../../shared/validation";
import { createSession, destroySession, loadSessionUser, requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { randomToken, sha256B64Url } from "../lib/crypto";
import {
  authorizationUrl,
  exchangeCode,
  GoogleAuthError,
  type GoogleProfile,
  googleConfigured,
} from "../lib/google";
import { badRequest, parseJson } from "../lib/http";
import { newId, pickColor } from "../lib/ids";
import { hub, publish } from "../lib/realtime";
import { toMember, toUser, type UserRow } from "../lib/rows";
import { sniffStoredImage } from "../lib/sniff";
import { listMyWorkspaces } from "./workspaces";

export const authRoutes = new Hono<AppEnv>();

// Short-lived cookie that ties Google's redirect back to the browser that started the sign-in.
const OAUTH_COOKIE = "kaiwa_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/google";
const OAUTH_TTL_SECONDS = 10 * 60;

interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
  next: string | null;
}

/** Same-origin path to return to after signing in, or null. */
function safeNext(next: string | undefined | null): string | null {
  if (!next?.startsWith("/")) return null;
  const base = "https://kaiwa.invalid";
  try {
    // Resolve like a browser would so "//host", "/\host" and tab/newline tricks cannot leave the origin.
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

function signInPage(error: string, next: string | null): string {
  const q = new URLSearchParams({ error });
  if (next) q.set("next", next);
  return `/login?${q}`;
}

function readOAuthState(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OAuthState>;
    if (typeof v.state !== "string" || typeof v.nonce !== "string" || typeof v.verifier !== "string") {
      return null;
    }
    return { state: v.state, nonce: v.nonce, verifier: v.verifier, next: safeNext(v.next) };
  } catch {
    return null;
  }
}

function callbackUrl(requestUrl: string): string {
  return new URL("/api/auth/google/callback", requestUrl).toString();
}

/**
 * Finds the account for a Google profile, linking or creating it. Fails when the email address
 * belongs to another account that this Google account cannot take over.
 */
async function upsertGoogleUser(
  db: D1Database,
  p: GoogleProfile,
): Promise<{ id: string; linked?: true } | { error: "account_conflict" | "link_unavailable" }> {
  const bySub = await db
    .prepare("SELECT id, email FROM users WHERE google_sub = ?1")
    .bind(p.sub)
    .first<{ id: string; email: string }>();
  if (bySub) {
    // Follow email changes on the Google side unless another account already uses the address.
    if (bySub.email.toLowerCase() !== p.email) {
      await db
        .prepare(
          "UPDATE users SET email = ?2 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?2)",
        )
        .bind(bySub.id, p.email)
        .run();
    }
    return { id: bySub.id };
  }
  // Accounts created before Google sign-in are linked by email address, but only when Google vouches
  // for the address's current owner.
  if (p.emailAuthoritative) {
    // Those accounts were created without proving the address, so whoever registered it loses their
    // sessions in the same transaction as the link.
    const [linked] = await db.batch<{ id: string }>([
      db
        .prepare("UPDATE users SET google_sub = ?2 WHERE email = ?1 AND google_sub IS NULL RETURNING id")
        .bind(p.email, p.sub),
      db
        .prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE google_sub = ?1)")
        .bind(p.sub),
    ]);
    const linkedId = linked?.results[0]?.id;
    if (linkedId) return { id: linkedId, linked: true };
  }

  const id = newId("U");
  await db
    .prepare(
      `INSERT INTO users (id, email, google_sub, display_name, full_name, avatar_color, created_at)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6) ON CONFLICT DO NOTHING`,
    )
    .bind(id, p.email, p.sub, p.name, pickColor(id), Date.now())
    .run();
  // Nothing is inserted if another account has the email (or a concurrent sign-in won).
  const row = await db
    .prepare("SELECT id FROM users WHERE google_sub = ?1")
    .bind(p.sub)
    .first<{ id: string }>();
  if (row) return { id: row.id };
  const taken = await db
    .prepare("SELECT google_sub FROM users WHERE email = ?1")
    .bind(p.email)
    .first<{ google_sub: string | null }>();
  return { error: taken && taken.google_sub === null ? "link_unavailable" : "account_conflict" };
}

/** Closes the user's open WebSockets in every workspace, e.g. after their sessions were revoked. */
async function disconnectEverywhere(env: Env, userId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT workspace_id FROM workspace_members WHERE user_id = ?1")
    .bind(userId)
    .all<{ workspace_id: string }>();
  await Promise.all(results.map((r) => hub(env, r.workspace_id).disconnectUser(userId, "signed_out")));
}

authRoutes.get("/google", async (c) => {
  const next = safeNext(c.req.query("next"));
  if (!googleConfigured(c.env)) return c.redirect(signInPage("not_configured", next));
  const saved: OAuthState = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), next };
  setCookie(c, OAUTH_COOKIE, JSON.stringify(saved), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    // Lax so the cookie comes back on Google's top-level redirect to the callback.
    sameSite: "Lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_TTL_SECONDS,
  });
  return c.redirect(
    authorizationUrl(c.env, {
      redirectUri: callbackUrl(c.req.url),
      state: saved.state,
      nonce: saved.nonce,
      codeChallenge: await sha256B64Url(saved.verifier),
    }),
  );
});

authRoutes.get("/google/callback", async (c) => {
  const saved = readOAuthState(getCookie(c, OAUTH_COOKIE));
  deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
  const next = saved?.next ?? null;
  const fail = (error: string) => c.redirect(signInPage(error, next));
  const { code, state, error } = c.req.query();
  if (error) return fail(error === "access_denied" ? "access_denied" : "google_failed");
  if (!saved || !code || !state || state !== saved.state) return fail("invalid_state");

  let profile: GoogleProfile;
  try {
    profile = await exchangeCode(c.env, {
      code,
      redirectUri: callbackUrl(c.req.url),
      codeVerifier: saved.verifier,
      nonce: saved.nonce,
    });
  } catch (err) {
    if (err instanceof GoogleAuthError) return fail(err.code);
    throw err;
  }
  const user = await upsertGoogleUser(c.env.DB, profile);
  if ("error" in user) return fail(user.error);
  // Linking revoked the account's earlier sessions; close the sockets they opened before the new
  // session exists, so none of the owner's own sockets get caught.
  if (user.linked) await disconnectEverywhere(c.env, user.id);
  await createSession(c, user.id);
  return c.redirect(next ?? "/");
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", async (c) => {
  const session = await loadSessionUser(c);
  if (!session) return c.json({ user: null, workspaces: [] });
  return c.json({
    user: toUser(session.user),
    workspaces: await listMyWorkspaces(c.env.DB, session.user.id),
  });
});

meRoutes.patch("/", requireAuth, async (c) => {
  const me = c.get("user");
  const body = await parseJson(c, updateProfileSchema);
  const sets: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    displayName: "display_name",
    fullName: "full_name",
    title: "title",
    statusEmoji: "status_emoji",
    statusText: "status_text",
    statusExpiresAt: "status_expires_at",
    timezone: "timezone",
    avatarColor: "avatar_color",
    avatarFileId: "avatar_file_id",
    dndUntil: "dnd_until",
  };
  for (const [key, col] of Object.entries(map)) {
    const v = (body as Record<string, unknown>)[key];
    if (v !== undefined) {
      sets.push(`${col} = ?${values.length + 2}`);
      values.push(v);
    }
  }
  if (body.away !== undefined) {
    sets.push(`away = ?${values.length + 2}`);
    values.push(body.away ? 1 : 0);
  }
  if (body.avatarFileId) {
    const f = await c.env.DB.prepare("SELECT r2_key FROM files WHERE id = ?1 AND user_id = ?2")
      .bind(body.avatarFileId, me.id)
      .first<{ r2_key: string }>();
    if (!f || !(await sniffStoredImage(c.env.FILES, f.r2_key)))
      throw badRequest("アイコンには画像ファイル（PNG・JPEG・GIF・WebP）を指定してください");
  }
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?1`)
      .bind(me.id, ...values)
      .run();
  }

  const { results } = await c.env.DB.prepare(
    `SELECT u.*, wm.role, wm.joined_at, wm.workspace_id FROM users u
     JOIN workspace_members wm ON wm.user_id = u.id WHERE u.id = ?1`,
  )
    .bind(me.id)
    .all<UserRow & { role: "owner" | "admin" | "member"; joined_at: number; workspace_id: string }>();
  for (const row of results) {
    publish(c, row.workspace_id, { type: "member.upserted", member: toMember(row) }, "all");
    if (body.away !== undefined) {
      const task = hub(c.env, row.workspace_id).setManualAway(me.id, body.away);
      try {
        c.executionCtx.waitUntil(task);
      } catch {
        await task;
      }
    }
  }
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(me.id).first<UserRow>();
  return c.json({ user: toUser(user as UserRow) });
});
