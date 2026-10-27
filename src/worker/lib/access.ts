import type { Role } from "../../shared/types";
import { forbidden, notFound } from "./http";
import type { ChannelRow, MessageRow } from "./rows";

export async function workspaceRole(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const row = await db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2")
    .bind(workspaceId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

export async function requireWorkspace(db: D1Database, workspaceId: string, userId: string): Promise<Role> {
  const role = await workspaceRole(db, workspaceId, userId);
  if (!role) throw notFound("ワークスペースが見つかりません");
  return role;
}

export const isAdmin = (role: Role) => role === "owner" || role === "admin";

export interface ChannelAccess {
  channel: ChannelRow;
  role: Role;
  isMember: boolean;
}

/**
 * Loads a channel and checks the viewer can see it. Public channels are readable
 * by every workspace member (preview before joining); everything else requires membership.
 */
export async function requireChannel(
  db: D1Database,
  channelId: string,
  userId: string,
  opts: { write?: boolean } = {},
): Promise<ChannelAccess> {
  const row = await db
    .prepare(
      `SELECT c.*, wm.role AS viewer_role,
        EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?2) AS is_member
       FROM channels c
       LEFT JOIN workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = ?2
       WHERE c.id = ?1`,
    )
    .bind(channelId, userId)
    .first<ChannelRow & { viewer_role: Role | null; is_member: number }>();
  if (!row?.viewer_role) throw notFound("チャンネルが見つかりません");
  const isMember = row.is_member === 1;
  if (!isMember && row.kind !== "public") throw notFound("チャンネルが見つかりません");
  if (opts.write) {
    if (!isMember) throw forbidden("チャンネルに参加すると投稿できます");
    if (row.archived_at) throw forbidden("アーカイブされたチャンネルには投稿できません");
  }
  const { viewer_role, is_member, ...channel } = row;
  return { channel: channel as ChannelRow, role: viewer_role, isMember };
}

export async function requireMessage(
  db: D1Database,
  messageId: string,
  userId: string,
  opts: { write?: boolean } = {},
): Promise<ChannelAccess & { message: MessageRow }> {
  const message = await db
    .prepare("SELECT * FROM messages WHERE id = ?1")
    .bind(messageId)
    .first<MessageRow>();
  if (!message) throw notFound("メッセージが見つかりません");
  const access = await requireChannel(db, message.channel_id, userId, opts);
  return { ...access, message };
}

export async function channelMemberIds(db: D1Database, channelId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT user_id FROM channel_members WHERE channel_id = ?1")
    .bind(channelId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}
