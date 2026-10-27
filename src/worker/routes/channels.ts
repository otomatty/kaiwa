import { Hono } from "hono";
import type { Member, MessagePage, Role, ServerEvent } from "../../shared/types";
import {
  addMembersSchema,
  bookmarkSchema,
  channelNameError,
  channelPrefsSchema,
  createChannelSchema,
  LIMITS,
  markReadSchema,
  openDmSchema,
  updateChannelSchema,
} from "../../shared/validation";
import { channelMemberIds, isAdmin, requireChannel, requireWorkspace } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { addMemberStmt, getChannel, getMyChannel, previewChannel, systemMessage } from "../lib/channels";
import type { AppEnv } from "../lib/context";
import { badRequest, conflict, forbidden, notFound, parseJson, placeholders } from "../lib/http";
import { newId } from "../lib/ids";
import { publish } from "../lib/realtime";
import {
  type FileRow,
  hydrateMessages,
  type MessageRow,
  toBookmark,
  toFile,
  toMember,
  type UserRow,
} from "../lib/rows";

export const channelRoutes = new Hono<AppEnv>();
channelRoutes.use("*", requireAuth);

// ---------- Workspace-scoped channel endpoints (mounted under /api/workspaces) ----------

export const workspaceChannelRoutes = new Hono<AppEnv>();
workspaceChannelRoutes.use("*", requireAuth);

workspaceChannelRoutes.get("/:wid/channels/browse", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id = c.id) AS member_count,
       EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?2) AS is_member
     FROM channels c
     WHERE c.workspace_id = ?1 AND (c.kind = 'public'
       OR (c.kind = 'private' AND EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?2)))
     ORDER BY c.archived_at IS NOT NULL, c.name`,
  )
    .bind(wid, me.id)
    .all<Record<string, unknown>>();
  return c.json({
    channels: results.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      topic: r.topic,
      description: r.description,
      memberCount: r.member_count,
      isMember: r.is_member === 1,
      archivedAt: r.archived_at,
      createdAt: r.created_at,
    })),
  });
});

workspaceChannelRoutes.post("/:wid/channels", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const body = await parseJson(c, createChannelSchema);
  const err = channelNameError(body.name);
  if (err) throw badRequest(err, "invalid_name");
  const db = c.env.DB;
  const dupe = await db
    .prepare("SELECT 1 FROM channels WHERE workspace_id = ?1 AND name = ?2 AND kind IN ('public','private')")
    .bind(wid, body.name)
    .first();
  if (dupe) throw conflict("同じ名前のチャンネルが既にあります", "name_taken");

  const now = Date.now();
  const channel = { id: newId("C", now), workspace_id: wid };
  const invitees = await validMembers(
    db,
    wid,
    body.memberIds.filter((id) => id !== me.id),
  );
  const join = systemMessage(db, channel, me.id, "channel_join", "", now);
  const stmts = [
    db
      .prepare(
        `INSERT INTO channels (id, workspace_id, kind, name, description, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(channel.id, wid, body.kind, body.name, body.description, me.id, now),
    addMemberStmt(db, channel.id, me.id, now),
    join.stmt,
    ...invitees.map((uid) => addMemberStmt(db, channel.id, uid, now)),
  ];
  const added = invitees.map((uid, i) =>
    systemMessage(db, channel, uid, "channel_join", `<@${me.id}>`, now + i + 1),
  );
  stmts.push(...added.map((a) => a.stmt));
  await db.batch(stmts);

  const dto = await getChannel(db, channel.id);
  if (!dto) throw notFound();
  const members = [me.id, ...invitees];
  publish(c, wid, { type: "channel.upserted", channel: dto }, body.kind === "public" ? "all" : members);
  const created = await hydrateMessages(db, [join.row, ...added.map((a) => a.row)], "");
  publish(
    c,
    wid,
    created.map((message) => ({ type: "message.created", message }) as ServerEvent),
    members,
  );
  return c.json({ channel: await getMyChannel(db, channel.id, me.id) }, 201);
});

workspaceChannelRoutes.post("/:wid/dms", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const body = await parseJson(c, openDmSchema);
  const db = c.env.DB;
  const others = await validMembers(
    db,
    wid,
    [...new Set(body.userIds)].filter((id) => id !== me.id),
  );
  if (others.length !== new Set(body.userIds.filter((id) => id !== me.id)).size) {
    throw badRequest("ワークスペースのメンバーではないユーザーが含まれています");
  }
  const memberIds = [me.id, ...others].sort();
  const dmKey = memberIds.join(",");
  const existing = await db
    .prepare("SELECT id FROM channels WHERE workspace_id = ?1 AND dm_key = ?2")
    .bind(wid, dmKey)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE channel_members SET hidden = 0 WHERE channel_id = ?1 AND user_id = ?2")
      .bind(existing.id, me.id)
      .run();
    return c.json({ channel: await getMyChannel(db, existing.id, me.id) });
  }
  const now = Date.now();
  const kind = others.length >= 2 ? "group" : "dm";
  const id = newId(kind === "group" ? "G" : "D", now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO channels (id, workspace_id, kind, name, dm_key, created_by, created_at)
         VALUES (?1, ?2, ?3, '', ?4, ?5, ?6)`,
      )
      .bind(id, wid, kind, dmKey, me.id, now),
    // Recipients only see the conversation once the first message arrives.
    ...memberIds.map((uid) => addMemberStmt(db, id, uid, now, { hidden: uid !== me.id, lastReadAt: 0 })),
  ]);
  const dto = await getChannel(db, id);
  if (dto) publish(c, wid, { type: "channel.upserted", channel: dto }, memberIds);
  return c.json({ channel: await getMyChannel(db, id, me.id) }, 201);
});

async function validMembers(db: D1Database, wid: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT user_id FROM workspace_members WHERE workspace_id = ?1 AND user_id IN (${placeholders(ids.length, 2)})`,
    )
    .bind(wid, ...ids)
    .all<{ user_id: string }>();
  const ok = new Set(results.map((r) => r.user_id));
  return ids.filter((id) => ok.has(id));
}

// ---------- Channel endpoints (/api/channels/:cid) ----------

channelRoutes.get("/:cid", async (c) => {
  const me = c.get("user");
  const access = await requireChannel(c.env.DB, c.req.param("cid"), me.id);
  const db = c.env.DB;
  const channel = access.isMember
    ? await getMyChannel(db, access.channel.id, me.id)
    : previewChannel(
        (await getChannel(db, access.channel.id)) as NonNullable<Awaited<ReturnType<typeof getChannel>>>,
      );
  const { results } = await db
    .prepare(
      `SELECT u.*, wm.role, wm.joined_at FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
       JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ?2
       WHERE cm.channel_id = ?1 ORDER BY u.display_name`,
    )
    .bind(access.channel.id, access.channel.workspace_id)
    .all<UserRow & { role: Role; joined_at: number }>();
  const members: Member[] = results.map(toMember);
  return c.json({ channel, members });
});

channelRoutes.patch("/:cid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  const ch = access.channel;
  const body = await parseJson(c, updateChannelSchema);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const sys: MessageRow[] = [];

  if (body.name !== undefined && body.name !== ch.name) {
    if (ch.kind === "dm" || ch.kind === "group") throw badRequest("DM の名前は変更できません");
    if (ch.is_default && !isAdmin(access.role)) throw forbidden();
    const err = channelNameError(body.name);
    if (err) throw badRequest(err, "invalid_name");
    const dupe = await db
      .prepare(
        "SELECT 1 FROM channels WHERE workspace_id = ?1 AND name = ?2 AND id != ?3 AND kind IN ('public','private')",
      )
      .bind(ch.workspace_id, body.name, ch.id)
      .first();
    if (dupe) throw conflict("同じ名前のチャンネルが既にあります", "name_taken");
    stmts.push(db.prepare("UPDATE channels SET name = ?2 WHERE id = ?1").bind(ch.id, body.name));
    const m = systemMessage(db, ch, me.id, "channel_name", body.name, now);
    stmts.push(m.stmt);
    sys.push(m.row);
  }
  if (body.topic !== undefined && body.topic !== ch.topic) {
    stmts.push(db.prepare("UPDATE channels SET topic = ?2 WHERE id = ?1").bind(ch.id, body.topic));
    const m = systemMessage(db, ch, me.id, "channel_topic", body.topic, now + 1);
    stmts.push(m.stmt);
    sys.push(m.row);
  }
  if (body.description !== undefined && body.description !== ch.description) {
    stmts.push(
      db.prepare("UPDATE channels SET description = ?2 WHERE id = ?1").bind(ch.id, body.description),
    );
    const m = systemMessage(db, ch, me.id, "channel_purpose", body.description, now + 2);
    stmts.push(m.stmt);
    sys.push(m.row);
  }
  if (stmts.length > 0) await db.batch(stmts);
  await broadcastChannel(c, ch.id, sys);
  return c.json({ channel: await getMyChannel(db, ch.id, me.id) });
});

async function broadcastChannel(c: Parameters<typeof publish>[0], channelId: string, sys: MessageRow[] = []) {
  const db = c.env.DB;
  const dto = await getChannel(db, channelId);
  if (!dto) return;
  const members = await channelMemberIds(db, channelId);
  publish(
    c,
    dto.workspaceId,
    { type: "channel.upserted", channel: dto },
    dto.kind === "public" ? "all" : members,
  );
  if (sys.length > 0) {
    const msgs = await hydrateMessages(db, sys, "");
    publish(
      c,
      dto.workspaceId,
      msgs.map((message) => ({ type: "message.created", message }) as ServerEvent),
      members,
    );
  }
}

channelRoutes.post("/:cid/join", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const ch = access.channel;
  if (access.isMember) return c.json({ channel: await getMyChannel(db, ch.id, me.id) });
  if (ch.kind !== "public") throw forbidden();
  if (ch.archived_at) throw forbidden("アーカイブされたチャンネルには参加できません");
  const now = Date.now();
  const m = systemMessage(db, ch, me.id, "channel_join", "", now);
  await db.batch([addMemberStmt(db, ch.id, me.id, now), m.stmt]);
  publish(c, ch.workspace_id, { type: "channel.member_joined", channelId: ch.id, userId: me.id }, "all");
  await broadcastChannel(c, ch.id, [m.row]);
  return c.json({ channel: await getMyChannel(db, ch.id, me.id) });
});

channelRoutes.post("/:cid/leave", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const ch = access.channel;
  if (!access.isMember) return c.json({ ok: true });
  if (ch.kind === "dm" || ch.kind === "group")
    throw badRequest("DM からは退出できません。サイドバーから閉じてください");
  if (ch.is_default) throw forbidden("このチャンネルからは退出できません");
  const now = Date.now();
  const m = systemMessage(db, ch, me.id, "channel_leave", "", now);
  await db.batch([
    db.prepare("DELETE FROM channel_members WHERE channel_id = ?1 AND user_id = ?2").bind(ch.id, me.id),
    m.stmt,
  ]);
  publish(c, ch.workspace_id, { type: "channel.member_left", channelId: ch.id, userId: me.id }, "all");
  if (ch.kind === "private")
    publish(c, ch.workspace_id, { type: "channel.removed", channelId: ch.id }, [me.id]);
  await broadcastChannel(c, ch.id, [m.row]);
  return c.json({ ok: true });
});

channelRoutes.post("/:cid/members", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  const ch = access.channel;
  if (ch.kind === "dm" || ch.kind === "group") throw badRequest("DM にはメンバーを追加できません");
  const body = await parseJson(c, addMembersSchema);
  const current = new Set(await channelMemberIds(db, ch.id));
  const toAdd = (await validMembers(db, ch.workspace_id, [...new Set(body.userIds)])).filter(
    (id) => !current.has(id),
  );
  if (toAdd.length === 0) return c.json({ added: [] });
  const now = Date.now();
  const sys = toAdd.map((uid, i) => systemMessage(db, ch, uid, "channel_join", `<@${me.id}>`, now + i));
  await db.batch([...toAdd.map((uid) => addMemberStmt(db, ch.id, uid, now)), ...sys.map((s) => s.stmt)]);
  publish(
    c,
    ch.workspace_id,
    toAdd.map((userId) => ({ type: "channel.member_joined", channelId: ch.id, userId }) as ServerEvent),
    "all",
  );
  await broadcastChannel(
    c,
    ch.id,
    sys.map((s) => s.row),
  );
  return c.json({ added: toAdd });
});

channelRoutes.delete("/:cid/members/:uid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const uid = c.req.param("uid");
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  const ch = access.channel;
  if (ch.kind === "dm" || ch.kind === "group") throw badRequest("DM のメンバーは変更できません");
  if (ch.is_default) throw forbidden("このチャンネルからメンバーを外すことはできません");
  if (!isAdmin(access.role) && ch.created_by !== me.id) throw forbidden();
  const now = Date.now();
  const m = systemMessage(db, ch, uid, "channel_leave", `<@${me.id}>`, now);
  await db.batch([
    db.prepare("DELETE FROM channel_members WHERE channel_id = ?1 AND user_id = ?2").bind(ch.id, uid),
    m.stmt,
  ]);
  publish(c, ch.workspace_id, { type: "channel.member_left", channelId: ch.id, userId: uid }, "all");
  publish(c, ch.workspace_id, { type: "channel.removed", channelId: ch.id }, [uid]);
  await broadcastChannel(c, ch.id, [m.row]);
  return c.json({ ok: true });
});

for (const action of ["archive", "unarchive"] as const) {
  channelRoutes.post(`/:cid/${action}`, async (c) => {
    const me = c.get("user");
    const db = c.env.DB;
    const access = await requireChannel(db, c.req.param("cid"), me.id);
    const ch = access.channel;
    if (!access.isMember) throw forbidden();
    if (ch.kind === "dm" || ch.kind === "group") throw badRequest("DM はアーカイブできません");
    if (ch.is_default) throw forbidden("このチャンネルはアーカイブできません");
    if (!isAdmin(access.role) && ch.created_by !== me.id) throw forbidden();
    const now = Date.now();
    const m = systemMessage(
      db,
      ch,
      me.id,
      action === "archive" ? "channel_archive" : "channel_unarchive",
      "",
      now,
    );
    await db.batch([
      db
        .prepare("UPDATE channels SET archived_at = ?2 WHERE id = ?1")
        .bind(ch.id, action === "archive" ? now : null),
      m.stmt,
    ]);
    await broadcastChannel(c, ch.id, [m.row]);
    return c.json({ channel: await getMyChannel(db, ch.id, me.id) });
  });
}

channelRoutes.delete("/:cid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const ch = access.channel;
  if (ch.kind === "dm" || ch.kind === "group") throw badRequest("DM は削除できません");
  if (ch.is_default) throw forbidden("このチャンネルは削除できません");
  if (!isAdmin(access.role)) throw forbidden("チャンネルを削除できるのは管理者のみです");
  const members = await channelMemberIds(db, ch.id);
  const { results: files } = await db
    .prepare("SELECT r2_key FROM files WHERE channel_id = ?1")
    .bind(ch.id)
    .all<{ r2_key: string }>();
  await db.batch([
    db.prepare("DELETE FROM mentions WHERE channel_id = ?1").bind(ch.id),
    db.prepare("DELETE FROM files WHERE channel_id = ?1").bind(ch.id),
    db.prepare("DELETE FROM messages WHERE channel_id = ?1 AND thread_root_id IS NOT NULL").bind(ch.id),
    db.prepare("DELETE FROM messages WHERE channel_id = ?1").bind(ch.id),
    db.prepare("DELETE FROM channels WHERE id = ?1").bind(ch.id),
  ]);
  if (files.length > 0) {
    const task = c.env.FILES.delete(files.map((f) => f.r2_key));
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      await task;
    }
  }
  publish(
    c,
    ch.workspace_id,
    { type: "channel.removed", channelId: ch.id },
    ch.kind === "public" ? "all" : members,
  );
  return c.json({ ok: true });
});

channelRoutes.post("/:cid/read", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  if (!access.isMember) return c.json({ ok: true });
  const { ts } = await parseJson(c, markReadSchema);
  await db
    .prepare(
      "UPDATE channel_members SET last_read_at = MAX(last_read_at, ?3) WHERE channel_id = ?1 AND user_id = ?2",
    )
    .bind(access.channel.id, me.id, ts)
    .run();
  const row = await db
    .prepare("SELECT last_read_at FROM channel_members WHERE channel_id = ?1 AND user_id = ?2")
    .bind(access.channel.id, me.id)
    .first<{ last_read_at: number }>();
  const lastReadAt = row?.last_read_at ?? ts;
  publish(
    c,
    access.channel.workspace_id,
    { type: "channel.read", channelId: access.channel.id, lastReadAt },
    [me.id],
  );
  return c.json({ lastReadAt });
});

channelRoutes.patch("/:cid/prefs", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  if (!access.isMember) throw forbidden();
  const body = await parseJson(c, channelPrefsSchema);
  const sets: string[] = [];
  const vals: number[] = [];
  for (const k of ["starred", "muted", "hidden"] as const) {
    if (body[k] !== undefined) {
      sets.push(`${k} = ?${vals.length + 3}`);
      vals.push(body[k] ? 1 : 0);
    }
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE channel_members SET ${sets.join(", ")} WHERE channel_id = ?1 AND user_id = ?2`)
      .bind(access.channel.id, me.id, ...vals)
      .run();
  }
  const ch = await getMyChannel(db, access.channel.id, me.id);
  if (ch) {
    publish(
      c,
      access.channel.workspace_id,
      { type: "channel.prefs", channelId: ch.id, starred: ch.starred, muted: ch.muted, hidden: ch.hidden },
      [me.id],
    );
  }
  return c.json({ channel: ch });
});

// ---------- Messages in a channel ----------

const VISIBLE = "(thread_root_id IS NULL OR broadcast = 1) AND (deleted_at IS NULL OR reply_count > 0)";

channelRoutes.get("/:cid/messages", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const cid = access.channel.id;
  const limit = Math.min(Number(c.req.query("limit") ?? LIMITS.pageSize) || LIMITS.pageSize, 100);
  const before = c.req.query("before");
  const after = c.req.query("after");
  const around = c.req.query("around");

  let rows: MessageRow[] = [];
  let hasMoreBefore = false;
  let hasMoreAfter = false;

  const older = async (anchor: string | null, inclusive: boolean, n: number) => {
    const cond = anchor
      ? `AND (created_at < (SELECT created_at FROM messages WHERE id = ?2)
           OR (created_at = (SELECT created_at FROM messages WHERE id = ?2) AND id ${inclusive ? "<=" : "<"} ?2))`
      : "";
    const stmt = db.prepare(
      `SELECT * FROM messages WHERE channel_id = ?1 AND ${VISIBLE} ${cond} ORDER BY created_at DESC, id DESC LIMIT ${n + 1}`,
    );
    const { results } = await (anchor ? stmt.bind(cid, anchor) : stmt.bind(cid)).all<MessageRow>();
    return { rows: results.slice(0, n).reverse(), more: results.length > n };
  };
  const newer = async (anchor: string, n: number) => {
    const { results } = await db
      .prepare(
        `SELECT * FROM messages WHERE channel_id = ?1 AND ${VISIBLE}
         AND (created_at > (SELECT created_at FROM messages WHERE id = ?2)
           OR (created_at = (SELECT created_at FROM messages WHERE id = ?2) AND id > ?2))
         ORDER BY created_at ASC, id ASC LIMIT ${n + 1}`,
      )
      .bind(cid, anchor)
      .all<MessageRow>();
    return { rows: results.slice(0, n), more: results.length > n };
  };

  if (around) {
    const target = await db
      .prepare("SELECT thread_root_id FROM messages WHERE id = ?1 AND channel_id = ?2")
      .bind(around, cid)
      .first<{ thread_root_id: string | null }>();
    if (!target) throw notFound("メッセージが見つかりません");
    const anchor = target.thread_root_id ?? around;
    const half = Math.floor(limit / 2);
    const a = await older(anchor, true, half);
    const b = await newer(anchor, half);
    rows = [...a.rows, ...b.rows];
    hasMoreBefore = a.more;
    hasMoreAfter = b.more;
  } else if (after) {
    const b = await newer(after, limit);
    rows = b.rows;
    hasMoreAfter = b.more;
    hasMoreBefore = true;
  } else {
    const a = await older(before ?? null, false, limit);
    rows = a.rows;
    hasMoreBefore = a.more;
  }
  const page: MessagePage = { messages: await hydrateMessages(db, rows, me.id), hasMoreBefore, hasMoreAfter };
  return c.json(page);
});

channelRoutes.get("/:cid/pins", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const { results } = await db
    .prepare(
      `SELECT m.* FROM pins p JOIN messages m ON m.id = p.message_id
       WHERE p.channel_id = ?1 AND m.deleted_at IS NULL ORDER BY p.created_at DESC`,
    )
    .bind(access.channel.id)
    .all<MessageRow>();
  return c.json({ messages: await hydrateMessages(db, results, me.id) });
});

channelRoutes.get("/:cid/files", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const { results } = await db
    .prepare(
      "SELECT * FROM files WHERE channel_id = ?1 AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT 200",
    )
    .bind(access.channel.id)
    .all<FileRow>();
  return c.json({ files: results.map(toFile) });
});

channelRoutes.get("/:cid/bookmarks", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id);
  const { results } = await db
    .prepare("SELECT * FROM channel_bookmarks WHERE channel_id = ?1 ORDER BY created_at")
    .bind(access.channel.id)
    .all<Parameters<typeof toBookmark>[0]>();
  return c.json({ bookmarks: results.map(toBookmark) });
});

channelRoutes.post("/:cid/bookmarks", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  const body = await parseJson(c, bookmarkSchema);
  const id = newId("B");
  await db
    .prepare(
      "INSERT INTO channel_bookmarks (id, channel_id, title, url, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(id, access.channel.id, body.title, body.url, me.id, Date.now())
    .run();
  const members = await channelMemberIds(db, access.channel.id);
  publish(
    c,
    access.channel.workspace_id,
    { type: "bookmarks.updated", channelId: access.channel.id },
    members,
  );
  const row = await db.prepare("SELECT * FROM channel_bookmarks WHERE id = ?1").bind(id).first();
  return c.json({ bookmark: toBookmark(row as Parameters<typeof toBookmark>[0]) }, 201);
});

channelRoutes.delete("/:cid/bookmarks/:bid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  await db
    .prepare("DELETE FROM channel_bookmarks WHERE id = ?1 AND channel_id = ?2")
    .bind(c.req.param("bid"), access.channel.id)
    .run();
  const members = await channelMemberIds(db, access.channel.id);
  publish(
    c,
    access.channel.workspace_id,
    { type: "bookmarks.updated", channelId: access.channel.id },
    members,
  );
  return c.json({ ok: true });
});
