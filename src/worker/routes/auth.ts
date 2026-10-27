import { type Context, Hono } from "hono";
import { loginSchema, signupSchema, updateProfileSchema } from "../../shared/validation";
import { createSession, destroySession, loadSessionUser, requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { badRequest, conflict, HttpError, parseJson } from "../lib/http";
import { newId, pickColor } from "../lib/ids";
import { hub, publish } from "../lib/realtime";
import { toMember, toUser, type UserRow } from "../lib/rows";
import { sniffStoredImage } from "../lib/sniff";
import { listMyWorkspaces } from "./workspaces";

export const authRoutes = new Hono<AppEnv>();

function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "local";
}

async function rateLimit(limiter: RateLimit | undefined, key: string) {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success)
    throw new HttpError(429, "rate_limited", "試行回数が多すぎます。しばらくしてからもう一度お試しください");
}

authRoutes.post("/signup", async (c) => {
  await rateLimit(c.env.SIGNUP_LIMITER, `signup:${clientIp(c)}`);
  const body = await parseJson(c, signupSchema);
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(body.email).first();
  if (existing) throw conflict("このメールアドレスは既に登録されています", "email_taken");
  const id = newId("U");
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, avatar_color, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, body.email, await hashPassword(body.password), body.displayName, pickColor(id), now)
    .run();
  await createSession(c, id);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first<UserRow>();
  return c.json({ user: toUser(user as UserRow), workspaces: [] }, 201);
});

authRoutes.post("/login", async (c) => {
  const body = await parseJson(c, loginSchema);
  await rateLimit(c.env.LOGIN_LIMITER, `login:${clientIp(c)}:${body.email}`);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?1")
    .bind(body.email)
    .first<UserRow>();
  // Always run a hash comparison to keep timing similar for unknown emails.
  const ok = user
    ? await verifyPassword(body.password, user.password_hash)
    : await verifyPassword(body.password, "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!user || !ok)
    throw new HttpError(401, "invalid_credentials", "メールアドレスまたはパスワードが違います");
  await createSession(c, user.id);
  return c.json({ user: toUser(user), workspaces: await listMyWorkspaces(c.env.DB, user.id) });
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
