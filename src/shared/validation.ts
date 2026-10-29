import { z } from "zod";
import { LIMITS, normalizeChannelName } from "./limits";

export { channelNameError, LIMITS, normalizeChannelName } from "./limits";

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

const MAX_SCHEDULE_AHEAD = 120 * 24 * 60 * 60 * 1000;

export const scheduleMessageSchema = z.object({
  text: z.string().trim().min(1, "メッセージが空です").max(LIMITS.messageLength),
  threadRootId: z.string().nullable().optional(),
  broadcast: z.boolean().optional(),
  sendAt: z
    .number()
    .int()
    .refine((t) => t > Date.now() + 30_000, "送信日時は少し先の時刻を指定してください")
    .refine((t) => t < Date.now() + MAX_SCHEDULE_AHEAD, "送信日時は120日以内にしてください"),
});

export const updateScheduledSchema = z
  .object({
    text: z.string().trim().min(1).max(LIMITS.messageLength),
    sendAt: z
      .number()
      .int()
      .refine((t) => t > Date.now() + 30_000, "送信日時は少し先の時刻を指定してください")
      .refine((t) => t < Date.now() + MAX_SCHEDULE_AHEAD, "送信日時は120日以内にしてください"),
  })
  .partial();

const MAX_REMIND_AHEAD = 366 * 24 * 60 * 60 * 1000;

export const saveItemSchema = z.object({
  completed: z.boolean().optional(),
  remindAt: z
    .number()
    .int()
    .refine((t) => t > Date.now() - 60_000, "リマインダーは現在より後の時刻を指定してください")
    .refine((t) => t < Date.now() + MAX_REMIND_AHEAD, "リマインダーは1年以内にしてください")
    .nullable()
    .optional(),
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

export const customEmojiSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_-]{1,40}$/,
      "名前に使えるのは半角英小文字・数字・ハイフン・アンダースコアです（40文字まで）",
    ),
  fileId: z.string().max(64),
});

export const roleSchema = z.object({ role: z.enum(["admin", "member"]) });
