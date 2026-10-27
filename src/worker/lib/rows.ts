import type {
  Bookmark,
  Channel,
  ChannelKind,
  FileInfo,
  Member,
  Message,
  MessageSubtype,
  MyChannel,
  Role,
  User,
  Workspace,
} from "../../shared/types";
import { chunk, placeholders } from "./http";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  full_name: string;
  title: string;
  avatar_color: string;
  avatar_file_id: string | null;
  status_emoji: string;
  status_text: string;
  status_expires_at: number | null;
  away: number;
  dnd_until: number | null;
  timezone: string;
  created_at: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  icon_color: string;
  created_by: string;
  created_at: number;
}

export interface ChannelRow {
  id: string;
  workspace_id: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  description: string;
  is_default: number;
  dm_key: string | null;
  created_by: string;
  created_at: number;
  archived_at: number | null;
}

export interface MessageRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  user_id: string;
  text: string;
  subtype: string | null;
  thread_root_id: string | null;
  broadcast: number;
  reply_count: number;
  last_reply_at: number | null;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

export interface FileRow {
  id: string;
  workspace_id: string;
  user_id: string;
  message_id: string | null;
  channel_id: string | null;
  name: string;
  mime: string;
  size: number;
  r2_key: string;
  created_at: number;
}

export const fileUrl = (id: string) => `/api/files/${id}`;

export function toUser(r: UserRow): User {
  const statusExpired = r.status_expires_at !== null && r.status_expires_at < Date.now();
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    fullName: r.full_name,
    title: r.title,
    avatarColor: r.avatar_color,
    avatarUrl: r.avatar_file_id ? fileUrl(r.avatar_file_id) : null,
    statusEmoji: statusExpired ? "" : r.status_emoji,
    statusText: statusExpired ? "" : r.status_text,
    statusExpiresAt: statusExpired ? null : r.status_expires_at,
    away: r.away === 1,
    dndUntil: r.dnd_until && r.dnd_until > Date.now() ? r.dnd_until : null,
    timezone: r.timezone,
    createdAt: r.created_at,
  };
}

export function toMember(r: UserRow & { role: Role; joined_at: number }): Member {
  return { ...toUser(r), role: r.role, joinedAt: r.joined_at };
}

export function toWorkspace(r: WorkspaceRow): Workspace {
  return { id: r.id, name: r.name, iconColor: r.icon_color, createdAt: r.created_at };
}

export function toChannel(r: ChannelRow & { member_count?: number }, memberIds: string[] = []): Channel {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    description: r.description,
    isDefault: r.is_default === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    memberCount: r.member_count ?? memberIds.length,
    memberIds: r.kind === "dm" || r.kind === "group" ? memberIds : [],
  };
}

export interface MyChannelRow extends ChannelRow {
  member_count: number;
  last_read_at: number;
  unread_count: number;
  mention_count: number;
  latest_at: number | null;
  latest_preview?: string | null;
  starred: number;
  muted: number;
  hidden: number;
}

export function toMyChannel(r: MyChannelRow, memberIds: string[]): MyChannel {
  return {
    ...toChannel(r, memberIds),
    isMember: true,
    lastReadAt: r.last_read_at,
    unreadCount: r.unread_count,
    mentionCount: r.mention_count,
    latestAt: r.latest_at,
    latestPreview: r.latest_preview ? (JSON.parse(r.latest_preview) as MyChannel["latestPreview"]) : null,
    starred: r.starred === 1,
    muted: r.muted === 1,
    hidden: r.hidden === 1,
  };
}

export function toFile(r: FileRow): FileInfo {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    url: fileUrl(r.id),
    userId: r.user_id,
    channelId: r.channel_id,
    messageId: r.message_id,
    createdAt: r.created_at,
  };
}

export function toBookmark(r: {
  id: string;
  channel_id: string;
  title: string;
  url: string;
  created_by: string;
  created_at: number;
}): Bookmark {
  return {
    id: r.id,
    channelId: r.channel_id,
    title: r.title,
    url: r.url,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function baseMessage(r: MessageRow): Message {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    channelId: r.channel_id,
    userId: r.user_id,
    text: r.deleted_at ? "" : r.text,
    subtype: (r.subtype as MessageSubtype | null) ?? null,
    threadRootId: r.thread_root_id,
    broadcast: r.broadcast === 1,
    replyCount: r.reply_count,
    lastReplyAt: r.last_reply_at,
    replyUserIds: [],
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    reactions: [],
    files: [],
    pinned: false,
    saved: false,
  };
}

/**
 * Converts message rows into DTOs, loading reactions, files, pins, saved state
 * and recent thread participants in a single D1 batch per chunk of ids.
 */
export async function hydrateMessages(
  db: D1Database,
  rows: MessageRow[],
  viewerId: string,
): Promise<Message[]> {
  const messages = rows.map(baseMessage);
  if (messages.length === 0) return messages;
  const byId = new Map(messages.map((m) => [m.id, m]));

  for (const ids of chunk(
    messages.map((m) => m.id),
    80,
  )) {
    const ph = placeholders(ids.length, 2);
    const roots = ids.filter((id) => (byId.get(id)?.replyCount ?? 0) > 0);
    const stmts = [
      db
        .prepare(
          `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders(ids.length)}) ORDER BY created_at`,
        )
        .bind(...ids),
      db
        .prepare(`SELECT * FROM files WHERE message_id IN (${placeholders(ids.length)}) ORDER BY created_at`)
        .bind(...ids),
      db
        .prepare(`SELECT message_id FROM pins WHERE message_id IN (${placeholders(ids.length)})`)
        .bind(...ids),
      db
        .prepare(`SELECT message_id FROM saved_items WHERE user_id = ?1 AND message_id IN (${ph})`)
        .bind(viewerId, ...ids),
    ];
    if (roots.length > 0) {
      stmts.push(
        db
          .prepare(
            `SELECT thread_root_id, user_id, MAX(created_at) AS t FROM messages
             WHERE thread_root_id IN (${placeholders(roots.length)}) AND deleted_at IS NULL
             GROUP BY thread_root_id, user_id ORDER BY t DESC`,
          )
          .bind(...roots),
      );
    }
    const [reactions, files, pins, saved, replyUsers] = await db.batch(stmts);

    for (const r of (reactions?.results ?? []) as { message_id: string; emoji: string; user_id: string }[]) {
      const m = byId.get(r.message_id);
      if (!m) continue;
      let entry = m.reactions.find((x) => x.emoji === r.emoji);
      if (!entry) {
        entry = { emoji: r.emoji, userIds: [] };
        m.reactions.push(entry);
      }
      entry.userIds.push(r.user_id);
    }
    for (const f of (files?.results ?? []) as unknown as FileRow[]) {
      if (f.message_id) byId.get(f.message_id)?.files.push(toFile(f));
    }
    for (const p of (pins?.results ?? []) as { message_id: string }[]) {
      const m = byId.get(p.message_id);
      if (m) m.pinned = true;
    }
    for (const s of (saved?.results ?? []) as { message_id: string }[]) {
      const m = byId.get(s.message_id);
      if (m) m.saved = true;
    }
    for (const u of (replyUsers?.results ?? []) as { thread_root_id: string; user_id: string }[]) {
      const m = byId.get(u.thread_root_id);
      if (m && m.replyUserIds.length < 5) m.replyUserIds.push(u.user_id);
    }
  }
  return messages;
}

export async function hydrateOne(db: D1Database, row: MessageRow, viewerId: string): Promise<Message> {
  const [m] = await hydrateMessages(db, [row], viewerId);
  return m as Message;
}

/** Same message as seen by "anyone" (saved=false); used for realtime broadcasts. */
export async function publicMessage(db: D1Database, id: string): Promise<Message | null> {
  const row = await db.prepare("SELECT * FROM messages WHERE id = ?1").bind(id).first<MessageRow>();
  if (!row) return null;
  return hydrateOne(db, row, "");
}
