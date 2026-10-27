import type { Channel, MessageSubtype, MyChannel } from "../../shared/types";
import { chunk, placeholders } from "./http";
import { newId } from "./ids";
import { type ChannelRow, type MessageRow, type MyChannelRow, toChannel, toMyChannel } from "./rows";

const MY_CHANNELS_SQL = `
SELECT c.*, cm.last_read_at, cm.starred, cm.muted, cm.hidden,
  (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id = c.id) AS member_count,
  (SELECT COUNT(*) FROM messages m
     WHERE m.channel_id = c.id AND (m.thread_root_id IS NULL OR m.broadcast = 1)
       AND m.created_at > cm.last_read_at AND m.user_id != ?1 AND m.deleted_at IS NULL
       AND (m.subtype IS NULL OR m.subtype = 'me')) AS unread_count,
  (SELECT COUNT(*) FROM mentions mn JOIN messages m ON m.id = mn.message_id
     WHERE mn.channel_id = c.id AND mn.user_id = ?1 AND mn.created_at > cm.last_read_at
       AND (m.thread_root_id IS NULL OR m.broadcast = 1)) AS mention_count,
  (SELECT MAX(m.created_at) FROM messages m
     WHERE m.channel_id = c.id AND (m.thread_root_id IS NULL OR m.broadcast = 1) AND m.deleted_at IS NULL) AS latest_at,
  CASE WHEN c.kind IN ('dm', 'group') THEN (SELECT json_object('userId', m.user_id, 'text', substr(m.text, 1, 200), 'files', (SELECT COUNT(*) FROM files f WHERE f.message_id = m.id))
     FROM messages m WHERE m.channel_id = c.id AND (m.thread_root_id IS NULL OR m.broadcast = 1) AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1) END AS latest_preview
FROM channel_members cm JOIN channels c ON c.id = cm.channel_id
WHERE cm.user_id = ?1`;

async function dmMemberIds(db: D1Database, channelIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const ids of chunk(channelIds)) {
    const { results } = await db
      .prepare(
        `SELECT channel_id, user_id FROM channel_members WHERE channel_id IN (${placeholders(ids.length)}) ORDER BY joined_at`,
      )
      .bind(...ids)
      .all<{ channel_id: string; user_id: string }>();
    for (const r of results) {
      const list = map.get(r.channel_id) ?? [];
      list.push(r.user_id);
      map.set(r.channel_id, list);
    }
  }
  return map;
}

export async function listMyChannels(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<MyChannel[]> {
  const { results } = await db
    .prepare(`${MY_CHANNELS_SQL} AND c.workspace_id = ?2 ORDER BY c.name`)
    .bind(userId, workspaceId)
    .all<MyChannelRow>();
  const dmIds = results.filter((r) => r.kind === "dm" || r.kind === "group").map((r) => r.id);
  const members = await dmMemberIds(db, dmIds);
  return results.map((r) => toMyChannel(r, members.get(r.id) ?? []));
}

export async function getMyChannel(
  db: D1Database,
  channelId: string,
  userId: string,
): Promise<MyChannel | null> {
  const row = await db
    .prepare(`${MY_CHANNELS_SQL} AND c.id = ?2`)
    .bind(userId, channelId)
    .first<MyChannelRow>();
  if (!row) return null;
  const members = row.kind === "dm" || row.kind === "group" ? await dmMemberIds(db, [row.id]) : new Map();
  return toMyChannel(row, members.get(row.id) ?? []);
}

/** Channel DTO without per-viewer state (used for broadcasts and previews). */
export async function getChannel(db: D1Database, channelId: string): Promise<Channel | null> {
  const row = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id = c.id) AS member_count
       FROM channels c WHERE c.id = ?1`,
    )
    .bind(channelId)
    .first<ChannelRow & { member_count: number }>();
  if (!row) return null;
  const members = row.kind === "dm" || row.kind === "group" ? await dmMemberIds(db, [row.id]) : new Map();
  return toChannel(row, members.get(row.id) ?? []);
}

/** Preview of a channel for a non-member (public channels only). */
export function previewChannel(channel: Channel): MyChannel {
  return {
    ...channel,
    isMember: false,
    lastReadAt: Date.now(),
    unreadCount: 0,
    mentionCount: 0,
    latestAt: null,
    starred: false,
    muted: false,
    hidden: false,
  };
}

export function systemMessage(
  db: D1Database,
  channel: { id: string; workspace_id: string },
  userId: string,
  subtype: MessageSubtype,
  text = "",
  now = Date.now(),
): { stmt: D1PreparedStatement; row: MessageRow } {
  const row: MessageRow = {
    id: newId("M", now),
    workspace_id: channel.workspace_id,
    channel_id: channel.id,
    user_id: userId,
    text,
    subtype,
    thread_root_id: null,
    broadcast: 0,
    reply_count: 0,
    last_reply_at: null,
    created_at: now,
    edited_at: null,
    deleted_at: null,
  };
  const stmt = db
    .prepare(
      `INSERT INTO messages (id, workspace_id, channel_id, user_id, text, subtype, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(row.id, row.workspace_id, row.channel_id, row.user_id, row.text, row.subtype, row.created_at);
  return { stmt, row };
}

export function addMemberStmt(
  db: D1Database,
  channelId: string,
  userId: string,
  now: number,
  opts: { hidden?: boolean; lastReadAt?: number } = {},
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at, last_read_at, hidden)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(channelId, userId, now, opts.lastReadAt ?? now, opts.hidden ? 1 : 0);
}
