// Shared DTOs between the Worker API and the client.

export type Role = "owner" | "admin" | "member";
export type ChannelKind = "public" | "private" | "dm" | "group";
export type Presence = "active" | "away" | "offline";

export interface User {
  id: string;
  email: string;
  displayName: string;
  fullName: string;
  title: string;
  avatarColor: string;
  avatarUrl: string | null;
  statusEmoji: string;
  statusText: string;
  statusExpiresAt: number | null;
  away: boolean;
  /** Notifications paused until this time (do not disturb). */
  dndUntil: number | null;
  timezone: string;
  createdAt: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  iconColor: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
  iconColor: string;
  createdAt: number;
}

export interface Member extends User {
  role: Role;
  joinedAt: number;
}

export interface Channel {
  id: string;
  workspaceId: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  description: string;
  isDefault: boolean;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
  memberCount: number;
  /** Only populated for dm / group channels. */
  memberIds: string[];
}

/** A channel as seen by a member (sidebar state). */
export interface MyChannel extends Channel {
  isMember: boolean;
  lastReadAt: number;
  unreadCount: number;
  mentionCount: number;
  latestAt: number | null;
  /** Latest message preview (DMs only). */
  latestPreview?: { userId: string; text: string; files: number } | null;
  starred: boolean;
  muted: boolean;
  hidden: boolean;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  userId: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

export type MessageSubtype =
  | "channel_join"
  | "channel_leave"
  | "channel_topic"
  | "channel_purpose"
  | "channel_name"
  | "channel_archive"
  | "channel_unarchive"
  | "me";

/** Snapshot of a forwarded message shown inside the message that shares it. */
export interface SharedMessage {
  id: string;
  channelId: string;
  channelName: string;
  channelKind: ChannelKind;
  userId: string;
  text: string;
  createdAt: number;
  files: FileInfo[];
}

export interface Message {
  id: string;
  workspaceId: string;
  channelId: string;
  userId: string;
  text: string;
  subtype: MessageSubtype | null;
  threadRootId: string | null;
  broadcast: boolean;
  replyCount: number;
  lastReplyAt: number | null;
  replyUserIds: string[];
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
  reactions: Reaction[];
  files: FileInfo[];
  pinned: boolean;
  saved: boolean;
  /** Forwarded message, if this message shares another one. */
  shared: SharedMessage | null;
  /** Echoed back to the sender so optimistic messages can be reconciled. */
  clientMsgId?: string;
}

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
}

export interface Bookmark {
  id: string;
  channelId: string;
  title: string;
  url: string;
  createdBy: string;
  createdAt: number;
}

export interface MessagePage {
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface ThreadView {
  root: Message;
  replies: Message[];
  subscribed: boolean;
  lastReadAt: number;
}

export interface ThreadSummary {
  root: Message;
  latestReplies: Message[];
  unreadCount: number;
  lastReadAt: number;
}

export type ActivityItem =
  | { kind: "mention"; at: number; message: Message }
  | { kind: "reply"; at: number; message: Message }
  | { kind: "reaction"; at: number; message: Message; emoji: string; userId: string };

export interface SavedItem {
  message: Message;
  savedAt: number;
  completedAt: number | null;
}

export interface SearchResult {
  message: Message;
  channel: { id: string; name: string; kind: ChannelKind; memberIds: string[] };
}

export interface CustomEmoji {
  name: string;
  url: string;
  createdBy: string;
}

export interface Bootstrap {
  workspace: Workspace;
  customEmoji: CustomEmoji[];
  role: Role;
  members: Member[];
  channels: MyChannel[];
  online: Record<string, Presence>;
  unreadThreads: number;
}

export interface Me {
  user: User;
  workspaces: WorkspaceSummary[];
}

export interface InviteInfo {
  code: string;
  workspace: { id: string; name: string; iconColor: string; memberCount: number };
  inviter: { displayName: string } | null;
  alreadyMember: boolean;
}

// ---------- Realtime ----------

export type ServerEvent =
  | { type: "hello"; userId: string; online: Record<string, Presence> }
  | { type: "message.created"; message: Message }
  | { type: "message.updated"; message: Message }
  | { type: "message.deleted"; messageId: string; channelId: string; threadRootId: string | null }
  | { type: "reactions.updated"; messageId: string; channelId: string; reactions: Reaction[] }
  | { type: "pin.updated"; messageId: string; channelId: string; pinned: boolean }
  | { type: "channel.upserted"; channel: Channel }
  | { type: "channel.removed"; channelId: string }
  | { type: "channel.member_joined"; channelId: string; userId: string }
  | { type: "channel.member_left"; channelId: string; userId: string }
  | { type: "channel.read"; channelId: string; lastReadAt: number }
  | { type: "channel.prefs"; channelId: string; starred: boolean; muted: boolean; hidden: boolean }
  | { type: "thread.read"; rootId: string; lastReadAt: number }
  | { type: "bookmarks.updated"; channelId: string }
  | { type: "member.upserted"; member: Member }
  | { type: "member.removed"; userId: string }
  | { type: "workspace.updated"; workspace: Workspace }
  | { type: "emoji.updated"; emoji: CustomEmoji[] }
  | { type: "presence"; userId: string; presence: Presence }
  | { type: "typing"; channelId: string; threadRootId: string | null; userId: string };

export type ClientEvent =
  | { type: "typing"; channelId: string; threadRootId?: string | null }
  | { type: "presence"; away: boolean };

export interface ApiError {
  error: string;
  message: string;
}
