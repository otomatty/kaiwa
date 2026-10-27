import { Hono } from "hono";
import type { Bootstrap, InviteInfo, Role, ServerEvent, WorkspaceSummary } from "../../shared/types";
import { createWorkspaceSchema, roleSchema, updateWorkspaceSchema } from "../../shared/validation";
import { isAdmin, requireWorkspace } from "../lib/access";
import { loadSessionUser, requireAuth } from "../lib/auth";
import { addMemberStmt, getChannel, listMyChannels, systemMessage } from "../lib/channels";
import type { AppEnv } from "../lib/context";
import { badRequest, forbidden, notFound, parseJson } from "../lib/http";
import { newId, pickColor, randomCode } from "../lib/ids";
import { hub, publish } from "../lib/realtime";
import { hydrateOne, toMember, toWorkspace, type UserRow, type WorkspaceRow } from "../lib/rows";

export async function listMyWorkspaces(db: D1Database, userId: string): Promise<WorkspaceSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.icon_color, wm.role FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = ?1 ORDER BY wm.joined_at`,
    )
    .bind(userId)
    .all<{ id: string; name: string; icon_color: string; role: Role }>();
  return results.map((r) => ({ id: r.id, name: r.name, iconColor: r.icon_color, role: r.role }));
}

async function memberRow(db: D1Database, workspaceId: string, userId: string) {
  return db
    .prepare(
      `SELECT u.*, wm.role, wm.joined_at FROM workspace_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?1 AND wm.user_id = ?2`,
    )
    .bind(workspaceId, userId)
    .first<UserRow & { role: Role; joined_at: number }>();
}

/**
 * Adds a user to a workspace and its default channels, publishing the
 * resulting membership + join messages to everyone connected.
 */
async function joinWorkspace(
  c: Parameters<typeof publish>[0],
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const db = c.env.DB;
  const now = Date.now();
  const { results: defaults } = await db
    .prepare("SELECT * FROM channels WHERE workspace_id = ?1 AND is_default = 1 AND archived_at IS NULL")
    .bind(workspaceId)
    .all<{ id: string; workspace_id: string }>();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(workspaceId, userId, role, now),
  ];
  const joins = defaults.map((ch, i) => systemMessage(db, ch, userId, "channel_join", "", now + i));
  for (const ch of defaults) stmts.push(addMemberStmt(db, ch.id, userId, now));
  for (const j of joins) stmts.push(j.stmt);
  await db.batch(stmts);

  const member = await memberRow(db, workspaceId, userId);
  const events: ServerEvent[] = [];
  if (member) events.push({ type: "member.upserted", member: toMember(member) });
  publish(c, workspaceId, events, "all");
  for (const j of joins) {
    const ch = await getChannel(db, j.row.channel_id);
    if (!ch) continue;
    publish(
      c,
      workspaceId,
      [
        { type: "channel.member_joined", channelId: ch.id, userId },
        { type: "channel.upserted", channel: ch },
        { type: "message.created", message: await hydrateOne(db, j.row, "") },
      ],
      "all",
    );
  }
}

export const workspaceRoutes = new Hono<AppEnv>();
workspaceRoutes.use("*", requireAuth);

workspaceRoutes.post("/", async (c) => {
  const me = c.get("user");
  const body = await parseJson(c, createWorkspaceSchema);
  const db = c.env.DB;
  const now = Date.now();
  const wid = newId("T", now);
  const general = { id: newId("C", now), workspace_id: wid };
  const random = { id: newId("C", now), workspace_id: wid };
  const welcome = systemMessage(db, general, me.id, "channel_join", "", now);
  await db.batch([
    db
      .prepare(
        "INSERT INTO workspaces (id, name, icon_color, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(wid, body.name, pickColor(wid), me.id, now),
    db
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)",
      )
      .bind(wid, me.id, now),
    db
      .prepare(
        `INSERT INTO channels (id, workspace_id, kind, name, description, is_default, created_by, created_at)
         VALUES (?1, ?2, 'public', 'general', ?3, 1, ?4, ?5)`,
      )
      .bind(
        general.id,
        wid,
        "全員が参加するチャンネルです。お知らせや全体の連絡に使いましょう。",
        me.id,
        now,
      ),
    db
      .prepare(
        `INSERT INTO channels (id, workspace_id, kind, name, description, is_default, created_by, created_at)
         VALUES (?1, ?2, 'public', 'random', ?3, 1, ?4, ?5)`,
      )
      .bind(random.id, wid, "雑談や仕事以外の話題はこちらへ。", me.id, now),
    addMemberStmt(db, general.id, me.id, now),
    addMemberStmt(db, random.id, me.id, now),
    welcome.stmt,
  ]);
  const ws = await db.prepare("SELECT * FROM workspaces WHERE id = ?1").bind(wid).first<WorkspaceRow>();
  return c.json(
    {
      workspace: toWorkspace(ws as WorkspaceRow),
      summary: {
        id: wid,
        name: body.name,
        iconColor: pickColor(wid),
        role: "owner",
      } satisfies WorkspaceSummary,
      defaultChannelId: general.id,
    },
    201,
  );
});

workspaceRoutes.get("/:wid/bootstrap", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const role = await requireWorkspace(c.env.DB, wid, me.id);
  const db = c.env.DB;
  const [ws, members, unread] = await db.batch([
    db.prepare("SELECT * FROM workspaces WHERE id = ?1").bind(wid),
    db
      .prepare(
        `SELECT u.*, wm.role, wm.joined_at FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = ?1 ORDER BY u.display_name`,
      )
      .bind(wid),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM thread_subscriptions ts JOIN messages r ON r.id = ts.root_id
         WHERE ts.user_id = ?1 AND ts.subscribed = 1 AND r.workspace_id = ?2
           AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_root_id = ts.root_id
             AND m.created_at > ts.last_read_at AND m.user_id != ?1 AND m.deleted_at IS NULL)`,
      )
      .bind(me.id, wid),
  ]);
  const channels = await listMyChannels(db, wid, me.id);
  let online = {};
  try {
    online = await hub(c.env, wid).online();
  } catch (err) {
    console.error("presence unavailable", err);
  }
  const body: Bootstrap = {
    workspace: toWorkspace(ws?.results[0] as WorkspaceRow),
    role,
    members: ((members?.results ?? []) as (UserRow & { role: Role; joined_at: number })[]).map(toMember),
    channels,
    online,
    unreadThreads: (unread?.results[0] as { n: number } | undefined)?.n ?? 0,
  };
  return c.json(body);
});

workspaceRoutes.patch("/:wid", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const role = await requireWorkspace(c.env.DB, wid, me.id);
  if (!isAdmin(role)) throw forbidden();
  const body = await parseJson(c, updateWorkspaceSchema);
  await c.env.DB.prepare("UPDATE workspaces SET name = ?2 WHERE id = ?1").bind(wid, body.name).run();
  const ws = await c.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?1").bind(wid).first<WorkspaceRow>();
  const workspace = toWorkspace(ws as WorkspaceRow);
  publish(c, wid, { type: "workspace.updated", workspace }, "all");
  return c.json({ workspace });
});

workspaceRoutes.post("/:wid/invites", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const now = Date.now();
  // Reuse a live invite link if one exists (like a shareable "join" link).
  const existing = await c.env.DB.prepare(
    `SELECT code FROM invites WHERE workspace_id = ?1 AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?2)
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(wid, now + 24 * 60 * 60 * 1000)
    .first<{ code: string }>();
  let code = existing?.code;
  if (!code) {
    code = randomCode(16);
    await c.env.DB.prepare(
      "INSERT INTO invites (code, workspace_id, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
      .bind(code, wid, me.id, now, now + 30 * 24 * 60 * 60 * 1000)
      .run();
  }
  const origin = new URL(c.req.url).origin;
  return c.json({ code, url: `${origin}/invite/${code}` });
});

workspaceRoutes.post("/:wid/invites/reset", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const role = await requireWorkspace(c.env.DB, wid, me.id);
  if (!isAdmin(role)) throw forbidden();
  await c.env.DB.prepare("UPDATE invites SET revoked = 1 WHERE workspace_id = ?1").bind(wid).run();
  return c.json({ ok: true });
});

workspaceRoutes.patch("/:wid/members/:uid", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const uid = c.req.param("uid");
  const role = await requireWorkspace(c.env.DB, wid, me.id);
  if (!isAdmin(role)) throw forbidden();
  const body = await parseJson(c, roleSchema);
  const target = await memberRow(c.env.DB, wid, uid);
  if (!target) throw notFound("メンバーが見つかりません");
  if (target.role === "owner") throw forbidden("オーナーの権限は変更できません");
  await c.env.DB.prepare("UPDATE workspace_members SET role = ?3 WHERE workspace_id = ?1 AND user_id = ?2")
    .bind(wid, uid, body.role)
    .run();
  const member = toMember({ ...target, role: body.role });
  publish(c, wid, { type: "member.upserted", member }, "all");
  return c.json({ member });
});

async function removeFromWorkspace(c: Parameters<typeof publish>[0], wid: string, uid: string) {
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        "DELETE FROM channel_members WHERE user_id = ?2 AND channel_id IN (SELECT id FROM channels WHERE workspace_id = ?1 AND kind IN ('public','private'))",
      )
      .bind(wid, uid),
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2").bind(wid, uid),
  ]);
  publish(c, wid, { type: "member.removed", userId: uid }, "all");
  const task = hub(c.env, wid).disconnectUser(uid);
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    await task;
  }
}

workspaceRoutes.delete("/:wid/members/:uid", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const uid = c.req.param("uid");
  const role = await requireWorkspace(c.env.DB, wid, me.id);
  const isSelf = uid === me.id;
  if (!isSelf && !isAdmin(role)) throw forbidden();
  const target = await memberRow(c.env.DB, wid, uid);
  if (!target) throw notFound("メンバーが見つかりません");
  if (target.role === "owner") throw forbidden("オーナーはワークスペースから外せません");
  await removeFromWorkspace(c, wid, uid);
  return c.json({ ok: true });
});

// ---------- Invites (public lookup + accept) ----------

export const inviteRoutes = new Hono<AppEnv>();

inviteRoutes.get("/:code", async (c) => {
  const code = c.req.param("code");
  const row = await c.env.DB.prepare(
    `SELECT i.code, i.workspace_id, i.expires_at, i.revoked, w.name, w.icon_color, u.display_name AS inviter,
       (SELECT COUNT(*) FROM workspace_members x WHERE x.workspace_id = w.id) AS member_count
     FROM invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.code = ?1`,
  )
    .bind(code)
    .first<{
      code: string;
      workspace_id: string;
      expires_at: number | null;
      revoked: number;
      name: string;
      icon_color: string;
      inviter: string | null;
      member_count: number;
    }>();
  if (!row || row.revoked || (row.expires_at && row.expires_at < Date.now())) {
    throw notFound("この招待リンクは無効か、期限が切れています");
  }
  const session = await loadSessionUser(c);
  let alreadyMember = false;
  if (session) {
    const m = await c.env.DB.prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2",
    )
      .bind(row.workspace_id, session.user.id)
      .first();
    alreadyMember = !!m;
  }
  const info: InviteInfo = {
    code: row.code,
    workspace: {
      id: row.workspace_id,
      name: row.name,
      iconColor: row.icon_color,
      memberCount: row.member_count,
    },
    inviter: row.inviter ? { displayName: row.inviter } : null,
    alreadyMember,
  };
  return c.json(info);
});

inviteRoutes.post("/:code/accept", requireAuth, async (c) => {
  const me = c.get("user");
  const code = c.req.param("code");
  const inv = await c.env.DB.prepare("SELECT * FROM invites WHERE code = ?1").bind(code).first<{
    workspace_id: string;
    revoked: number;
    expires_at: number | null;
  }>();
  if (!inv || inv.revoked || (inv.expires_at && inv.expires_at < Date.now())) {
    throw notFound("この招待リンクは無効か、期限が切れています");
  }
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2",
  )
    .bind(inv.workspace_id, me.id)
    .first();
  if (!existing) await joinWorkspace(c, inv.workspace_id, me.id, "member");
  const summary = (await listMyWorkspaces(c.env.DB, me.id)).find((w) => w.id === inv.workspace_id);
  if (!summary) throw badRequest("参加に失敗しました");
  return c.json({ workspace: summary });
});
