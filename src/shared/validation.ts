import { z } from "zod";

export const LIMITS = {
  messageLength: 40_000,
  channelName: 80,
  topic: 250,
  description: 250,
  displayName: 80,
  statusText: 100,
  workspaceName: 50,
  fileSize: 25 * 1024 * 1024,
  filesPerMessage: 10,
  groupDmMembers: 8,
  pageSize: 50,
} as const;

/**
 * Normalises a channel name the way team chat apps do: lowercase, spaces → "-",
 * strips characters that are not allowed. Non-Latin letters (日本語 etc.) are kept.
 */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .slice(0, LIMITS.channelName);
}

export function channelNameError(name: string): string | null {
  if (name.length === 0) return "チャンネル名を入力してください";
  if (name.length > LIMITS.channelName) return `チャンネル名は${LIMITS.channelName}文字以内にしてください`;
  if (!/^[\p{L}\p{N}_-]+$/u.test(name))
    return "チャンネル名に使えるのは文字・数字・ハイフン・アンダースコアのみです";
  return null;
}

const email = z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません").max(254);
const password = z.string().min(8, "パスワードは8文字以上にしてください").max(200);

export const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1, "表示名を入力してください").max(LIMITS.displayName),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(LIMITS.displayName),
    fullName: z.string().trim().max(LIMITS.displayName),
    title: z.string().trim().max(100),
    statusEmoji: z.string().max(64),
    statusText: z.string().max(LIMITS.statusText),
    statusExpiresAt: z.number().int().positive().nullable(),
    away: z.boolean(),
    dndUntil: z.number().int().positive().nullable(),
    timezone: z.string().max(64),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    avatarFileId: z.string().max(64).nullable(),
  })
  .partial();

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "ワークスペース名を入力してください").max(LIMITS.workspaceName),
});

export const updateWorkspaceSchema = createWorkspaceSchema;

export const createChannelSchema = z.object({
  name: z.string().transform(normalizeChannelName),
  kind: z.enum(["public", "private"]).default("public"),
  description: z.string().trim().max(LIMITS.description).default(""),
  memberIds: z.array(z.string()).max(500).default([]),
});

export const updateChannelSchema = z
  .object({
    name: z.string().transform(normalizeChannelName),
    topic: z.string().trim().max(LIMITS.topic),
    description: z.string().trim().max(LIMITS.description),
  })
  .partial();

export const openDmSchema = z.object({
  userIds: z
    .array(z.string())
    .min(1)
    .max(LIMITS.groupDmMembers - 1),
});

export const addMembersSchema = z.object({
  userIds: z.array(z.string()).min(1).max(500),
});

export const channelPrefsSchema = z
  .object({ starred: z.boolean(), muted: z.boolean(), hidden: z.boolean() })
  .partial();

export const postMessageSchema = z
  .object({
    text: z.string().max(LIMITS.messageLength).default(""),
    threadRootId: z.string().nullable().optional(),
    broadcast: z.boolean().optional(),
    fileIds: z.array(z.string()).max(LIMITS.filesPerMessage).default([]),
    clientMsgId: z.string().max(64).optional(),
    subtype: z.enum(["me"]).optional(),
    sharedMessageId: z.string().max(64).optional(),
  })
  .refine((v) => v.text.trim().length > 0 || v.fileIds.length > 0 || !!v.sharedMessageId, {
    message: "メッセージが空です",
  });

export const editMessageSchema = z.object({
  text: z.string().min(1).max(LIMITS.messageLength),
});

export const reactionSchema = z.object({
  emoji: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_+\-']+$/i),
});

export const markReadSchema = z.object({
  ts: z.number().int().nonnegative(),
});

export const bookmarkSchema = z.object({
  title: z.string().trim().min(1).max(100),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), "http(s) のURLを入力してください"),
});

export const roleSchema = z.object({ role: z.enum(["admin", "member"]) });
