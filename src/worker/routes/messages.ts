import { type Context, Hono } from "hono";
import type { z } from "zod";
import { extractMentions } from "../../shared/mrkdwn";
import type { Message, ServerEvent, ThreadView } from "../../shared/types";
import {
  editMessageSchema,
  markReadSchema,
  postMessageSchema,
  reactionSchema,
  saveItemSchema,
} from "../../shared/validation";
import { channelMemberIds, isAdmin, requireChannel, requireMessage } from "../lib/access";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { badRequest, forbidden, HttpError, notFound, parseJson, placeholders } from "../lib/http";
import { newId } from "../lib/ids";
import { publish, type Runtime, runtime } from "../lib/realtime";
import { publishSavedUpdated } from "../lib/reminders";
import { hydrateMessages, hydrateOne, type MessageRow, publicMessage } from "../lib/rows";

/** Users who should get a mention record for this text in this channel. */
async function mentionTargets(
  db: D1Database,
  text: string,
  channelId: string,
  authorId: string,
  members?: string[],
): Promise<string[]> {
  const { userIds, specials } = extractMentions(text);
  const memberList = members ?? (await channelMemberIds(db, channelId));
  const memberSet = new Set(memberList);
  const out = new Set<string>();
  if (specials.size > 0) for (const id of memberList) out.add(id);
  for (const id of userIds) if (memberSet.has(id)) out.add(id);
  out.delete(authorId);
  return [...out];
}

export async function postMessage(c: Context<AppEnv>): Promise<Response> {
  const body = await parseJson(c, postMessageSchema);
  const message = await createMessage(runtime(c), c.get("user").id, c.req.param("cid") as string, body);
  return c.json({ message }, 201);
}

export type PostMessageInput = z.output<typeof postMessageSchema>;

/** Creates a message as `userId` (checks access), updates threads/mentions/read state and publishes it. */
export async function createMessage(
  rt: Runtime,
  userId: string,
  cid: string,
  body: PostMessageInput,
): Promise<Message> {
  const me = { id: userId };
  const db = rt.env.DB;
  const access = await requireChannel(db, cid, me.id, { write: true });
  const ch = access.channel;
  const now = Date.now();
  const id = newId("M", now);

  let root: MessageRow | null = null;
  if (body.threadRootId) {
    root = await db
      .prepare("SELECT * FROM messages WHERE id = ?1 AND channel_id = ?2")
      .bind(body.threadRootId, ch.id)
      .first<MessageRow>();
    if (!root || root.thread_root_id) throw badRequest("スレッドが見つかりません");
    if (root.deleted_at) throw badRequest("削除されたメッセージには返信できません");
  }

  // Files must be uploaded by the poster and not yet attached.
  if (body.fileIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id FROM files WHERE id IN (${placeholders(body.fileIds.length, 3)})
         AND user_id = ?1 AND workspace_id = ?2 AND message_id IS NULL`,
      )
      .bind(me.id, ch.workspace_id, ...body.fileIds)
      .all<{ id: string }>();
    if (results.length !== body.fileIds.length) throw badRequest("添付ファイルが無効です");
  }

  // Forwarding: the sender must be able to read the original.
  let sharedFrom: string | null = null;
  if (body.sharedMessageId) {
    const orig = await requireMessage(db, body.sharedMessageId, me.id);
    if (orig.message.deleted_at || (orig.message.subtype && orig.message.subtype !== "me")) {
      throw badRequest("このメッセージは転送できません");
    }
    sharedFrom = orig.message.id;
  }

  const members = await channelMemberIds(db, ch.id);
  const mentioned = await mentionTargets(db, body.text, ch.id, me.id, members);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO messages (id, workspace_id, channel_id, user_id, text, subtype, thread_root_id, broadcast, created_at, shared_from)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        id,
        ch.workspace_id,
        ch.id,
        me.id,
        body.text,
        body.subtype ?? null,
        root?.id ?? null,
        root && body.broadcast ? 1 : 0,
        now,
        sharedFrom,
      ),
  ];
  if (body.fileIds.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE files SET message_id = ?1, channel_id = ?2 WHERE id IN (${placeholders(body.fileIds.length, 3)})`,
        )
        .bind(id, ch.id, ...body.fileIds),
    );
  }
  for (const uid of mentioned) {
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO mentions (message_id, user_id, channel_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(id, uid, ch.id, now),
    );
  }
  if (root) {
    stmts.push(
      db
        .prepare(
          `UPDATE messages SET reply_count = (SELECT COUNT(*) FROM messages WHERE thread_root_id = ?1 AND deleted_at IS NULL),
           last_reply_at = ?2 WHERE id = ?1`,
        )
        .bind(root.id, now),
    );
    // Root author, replier and anyone mentioned follow the thread.
    for (const uid of new Set([root.user_id, me.id, ...mentioned])) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO thread_subscriptions (root_id, user_id, last_read_at, subscribed) VALUES (?1, ?2, ?3, 1)
             ON CONFLICT (root_id, user_id) DO UPDATE SET subscribed = CASE WHEN ?2 = ?4 THEN 1 ELSE subscribed END,
               last_read_at = CASE WHEN ?2 = ?4 THEN ?3 ELSE last_read_at END`,
          )
          .bind(root.id, uid, uid === me.id ? now : 0, me.id),
      );
    }
  }
  // Posting marks the conversation as read for the author and re-opens closed DMs.
  if (!root || body.broadcast) {
    stmts.push(
      db
        .prepare(
          "UPDATE channel_members SET last_read_at = MAX(last_read_at, ?3) WHERE channel_id = ?1 AND user_id = ?2",
        )
        .bind(ch.id, me.id, now),
    );
  }
  stmts.push(
    db.prepare("UPDATE channel_members SET hidden = 0 WHERE channel_id = ?1 AND hidden = 1").bind(ch.id),
  );
  await db.batch(stmts);

  const row = (await db
    .prepare("SELECT * FROM messages WHERE id = ?1")
    .bind(id)
    .first<MessageRow>()) as MessageRow;
  const [message] = await hydrateMessages(db, [row], "");
  const dto = { ...(message as Message), clientMsgId: body.clientMsgId };
  const events: ServerEvent[] = [{ type: "message.created", message: dto }];
  if (root) {
    const rootDto = await publicMessage(db, root.id);
    if (rootDto) events.push({ type: "message.updated", message: rootDto });
  }
  publish(rt, ch.workspace_id, events, members);
  return dto;
}

export const messageRoutes = new Hono<AppEnv>();
messageRoutes.use("*", requireAuth);

messageRoutes.patch("/:mid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel } = await requireMessage(db, c.req.param("mid"), me.id);
  if (message.user_id !== me.id || (message.subtype && message.subtype !== "me"))
    throw forbidden("自分のメッセージのみ編集できます");
  if (message.deleted_at) throw notFound();
  if (channel.archived_at) throw forbidden("アーカイブされたチャンネルです");
  const { text } = await parseJson(c, editMessageSchema);
  const now = Date.now();
  const members = await channelMemberIds(db, channel.id);
  const mentioned = await mentionTargets(db, text, channel.id, me.id, members);
  await db.batch([
    db.prepare("UPDATE messages SET text = ?2, edited_at = ?3 WHERE id = ?1").bind(message.id, text, now),
    db.prepare("DELETE FROM mentions WHERE message_id = ?1").bind(message.id),
    ...mentioned.map((uid) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO mentions (message_id, user_id, channel_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(message.id, uid, channel.id, message.created_at),
    ),
  ]);
  const dto = await publicMessage(db, message.id);
  if (dto) publish(c, channel.workspace_id, { type: "message.updated", message: dto }, members);
  const mine = await hydrateOne(db, { ...message, text, edited_at: now }, me.id);
  return c.json({ message: mine });
});

messageRoutes.delete("/:mid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel, role } = await requireMessage(db, c.req.param("mid"), me.id);
  if (message.user_id !== me.id && !isAdmin(role)) throw forbidden("このメッセージは削除できません");
  const members = await channelMemberIds(db, channel.id);
  const events: ServerEvent[] = [];
  const { results: files } = await db
    .prepare("SELECT r2_key FROM files WHERE message_id = ?1")
    .bind(message.id)
    .all<{ r2_key: string }>();

  if (message.reply_count > 0) {
    // Keep the root as a tombstone so the thread stays reachable.
    await db.batch([
      db.prepare("UPDATE messages SET text = '', deleted_at = ?2 WHERE id = ?1").bind(message.id, Date.now()),
      db.prepare("DELETE FROM mentions WHERE message_id = ?1").bind(message.id),
      db.prepare("DELETE FROM reactions WHERE message_id = ?1").bind(message.id),
      db.prepare("DELETE FROM pins WHERE message_id = ?1").bind(message.id),
      db.prepare("DELETE FROM files WHERE message_id = ?1").bind(message.id),
    ]);
    const dto = await publicMessage(db, message.id);
    if (dto) events.push({ type: "message.updated", message: dto });
  } else {
    const stmts = [
      db.prepare("DELETE FROM files WHERE message_id = ?1").bind(message.id),
      db.prepare("DELETE FROM messages WHERE id = ?1").bind(message.id),
    ];
    if (message.thread_root_id) {
      stmts.push(
        db
          .prepare(
            `UPDATE messages SET
               reply_count = (SELECT COUNT(*) FROM messages WHERE thread_root_id = ?1 AND deleted_at IS NULL),
               last_reply_at = (SELECT MAX(created_at) FROM messages WHERE thread_root_id = ?1 AND deleted_at IS NULL)
             WHERE id = ?1`,
          )
          .bind(message.thread_root_id),
      );
    }
    await db.batch(stmts);
    events.push({
      type: "message.deleted",
      messageId: message.id,
      channelId: channel.id,
      threadRootId: message.thread_root_id,
    });
    if (message.thread_root_id) {
      const root = await db
        .prepare("SELECT * FROM messages WHERE id = ?1")
        .bind(message.thread_root_id)
        .first<MessageRow>();
      if (root?.deleted_at && root.reply_count === 0) {
        // The last reply of a deleted root is gone: remove the tombstone too.
        await db.prepare("DELETE FROM messages WHERE id = ?1").bind(root.id).run();
        events.push({
          type: "message.deleted",
          messageId: root.id,
          channelId: channel.id,
          threadRootId: null,
        });
      } else if (root) {
        events.push({ type: "message.updated", message: await hydrateOne(db, root, "") });
      }
    }
  }
  if (files.length > 0) {
    const task = c.env.FILES.delete(files.map((f) => f.r2_key));
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      await task;
    }
  }
  publish(c, channel.workspace_id, events, members);
  return c.json({ ok: true });
});

messageRoutes.get("/:mid/thread", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message } = await requireMessage(db, c.req.param("mid"), me.id);
  const rootId = message.thread_root_id ?? message.id;
  const [rootRes, repliesRes, subRes] = await db.batch([
    db.prepare("SELECT * FROM messages WHERE id = ?1").bind(rootId),
    db
      .prepare(
        "SELECT * FROM messages WHERE thread_root_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1000",
      )
      .bind(rootId),
    db.prepare("SELECT * FROM thread_subscriptions WHERE root_id = ?1 AND user_id = ?2").bind(rootId, me.id),
  ]);
  const rootRow = rootRes?.results[0] as MessageRow | undefined;
  if (!rootRow) throw notFound();
  const [root, ...replies] = await hydrateMessages(
    db,
    [rootRow, ...((repliesRes?.results ?? []) as unknown as MessageRow[])],
    me.id,
  );
  const sub = subRes?.results[0] as { subscribed: number; last_read_at: number } | undefined;
  const view: ThreadView = {
    root: root as Message,
    replies,
    subscribed: sub ? sub.subscribed === 1 : false,
    lastReadAt: sub?.last_read_at ?? 0,
  };
  return c.json(view);
});

messageRoutes.post("/:mid/reactions", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel, isMember } = await requireMessage(db, c.req.param("mid"), me.id);
  if (!isMember) throw forbidden("チャンネルに参加するとリアクションできます");
  if (message.deleted_at) throw notFound();
  const { emoji } = await parseJson(c, reactionSchema);
  const existing = await db
    .prepare("SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?1")
    .bind(message.id)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) >= 50) throw badRequest("リアクションの種類が上限に達しています");
  await db
    .prepare(
      "INSERT OR IGNORE INTO reactions (message_id, emoji, user_id, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(message.id, emoji, me.id, Date.now())
    .run();
  return reactionsChanged(c, message, channel.workspace_id);
});

messageRoutes.delete("/:mid/reactions/:emoji", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel } = await requireMessage(db, c.req.param("mid"), me.id);
  await db
    .prepare("DELETE FROM reactions WHERE message_id = ?1 AND emoji = ?2 AND user_id = ?3")
    .bind(message.id, c.req.param("emoji"), me.id)
    .run();
  return reactionsChanged(c, message, channel.workspace_id);
});

async function reactionsChanged(c: Context<AppEnv>, message: MessageRow, workspaceId: string) {
  const db = c.env.DB;
  const dto = await hydrateOne(db, message, c.get("user").id);
  const members = await channelMemberIds(db, message.channel_id);
  publish(
    c,
    workspaceId,
    {
      type: "reactions.updated",
      messageId: message.id,
      channelId: message.channel_id,
      reactions: dto.reactions,
    },
    members,
  );
  return c.json({ reactions: dto.reactions });
}

for (const method of ["post", "delete"] as const) {
  messageRoutes[method]("/:mid/pin", async (c) => {
    const me = c.get("user");
    const db = c.env.DB;
    const { message, channel, isMember } = await requireMessage(db, c.req.param("mid"), me.id);
    if (!isMember) throw forbidden();
    if (message.deleted_at || (message.subtype && message.subtype !== "me"))
      throw badRequest("このメッセージはピン留めできません");
    if (method === "post") {
      await db
        .prepare(
          "INSERT OR IGNORE INTO pins (channel_id, message_id, pinned_by, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(channel.id, message.id, me.id, Date.now())
        .run();
    } else {
      await db.prepare("DELETE FROM pins WHERE message_id = ?1").bind(message.id).run();
    }
    const members = await channelMemberIds(db, channel.id);
    publish(
      c,
      channel.workspace_id,
      { type: "pin.updated", messageId: message.id, channelId: channel.id, pinned: method === "post" },
      members,
    );
    return c.json({ pinned: method === "post" });
  });
}

messageRoutes.post("/:mid/save", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message } = await requireMessage(db, c.req.param("mid"), me.id);
  // The body is optional: an empty POST just saves the message.
  const raw = await c.req.text();
  let body: unknown = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw badRequest("JSON の形式が正しくありません", "invalid_json");
    }
  }
  const parsed = saveItemSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(
      422,
      "validation_error",
      parsed.error.issues[0]?.message ?? "入力内容が正しくありません",
    );
  const { completed, remindAt } = parsed.data;
  const now = Date.now();
  const stmts = [
    db
      .prepare(
        `INSERT INTO saved_items (user_id, message_id, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id, message_id) DO NOTHING`,
      )
      .bind(me.id, message.id, now),
  ];
  if (completed !== undefined) {
    stmts.push(
      db
        .prepare("UPDATE saved_items SET completed_at = ?3 WHERE user_id = ?1 AND message_id = ?2")
        .bind(me.id, message.id, completed ? now : null),
    );
  }
  if (remindAt !== undefined) {
    // Setting a reminder re-opens a completed item, like moving it back to "in progress".
    stmts.push(
      db
        .prepare(
          `UPDATE saved_items SET remind_at = ?3, reminded_at = NULL,
             completed_at = CASE WHEN ?3 IS NOT NULL AND ?4 = 0 THEN NULL ELSE completed_at END
           WHERE user_id = ?1 AND message_id = ?2`,
        )
        .bind(me.id, message.id, remindAt, completed === true ? 1 : 0),
    );
  }
  await db.batch(stmts);
  const remindersDue = await publishSavedUpdated(runtime(c), me.id, message.workspace_id);
  const row = await db
    .prepare("SELECT remind_at FROM saved_items WHERE user_id = ?1 AND message_id = ?2")
    .bind(me.id, message.id)
    .first<{ remind_at: number | null }>();
  return c.json({ saved: true, remindAt: row?.remind_at ?? null, remindersDue });
});

messageRoutes.delete("/:mid/save", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const mid = c.req.param("mid");
  const msg = await db
    .prepare("SELECT workspace_id FROM messages WHERE id = ?1")
    .bind(mid)
    .first<{ workspace_id: string }>();
  await db.prepare("DELETE FROM saved_items WHERE user_id = ?1 AND message_id = ?2").bind(me.id, mid).run();
  const remindersDue = msg ? await publishSavedUpdated(runtime(c), me.id, msg.workspace_id) : 0;
  return c.json({ saved: false, remindersDue });
});

/** "Mark unread": move the read marker to just before this message. */
messageRoutes.post("/:mid/unread", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel, isMember } = await requireMessage(db, c.req.param("mid"), me.id);
  if (!isMember) throw forbidden();
  const lastReadAt = message.created_at - 1;
  if (message.thread_root_id) {
    await db
      .prepare(
        `INSERT INTO thread_subscriptions (root_id, user_id, last_read_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (root_id, user_id) DO UPDATE SET last_read_at = ?3`,
      )
      .bind(message.thread_root_id, me.id, lastReadAt)
      .run();
    publish(c, channel.workspace_id, { type: "thread.read", rootId: message.thread_root_id, lastReadAt }, [
      me.id,
    ]);
  } else {
    await db
      .prepare("UPDATE channel_members SET last_read_at = ?3 WHERE channel_id = ?1 AND user_id = ?2")
      .bind(channel.id, me.id, lastReadAt)
      .run();
    publish(c, channel.workspace_id, { type: "channel.read", channelId: channel.id, lastReadAt }, [me.id]);
  }
  return c.json({ lastReadAt });
});

export const threadRoutes = new Hono<AppEnv>();
threadRoutes.use("*", requireAuth);

threadRoutes.post("/:rid/read", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const { message, channel } = await requireMessage(db, c.req.param("rid"), me.id);
  const { ts } = await parseJson(c, markReadSchema);
  await db
    .prepare(
      `INSERT INTO thread_subscriptions (root_id, user_id, last_read_at, subscribed) VALUES (?1, ?2, ?3, 0)
       ON CONFLICT (root_id, user_id) DO UPDATE SET last_read_at = MAX(last_read_at, ?3)`,
    )
    .bind(message.id, me.id, ts)
    .run();
  publish(c, channel.workspace_id, { type: "thread.read", rootId: message.id, lastReadAt: ts }, [me.id]);
  return c.json({ ok: true });
});

for (const method of ["post", "delete"] as const) {
  threadRoutes[method]("/:rid/follow", async (c) => {
    const me = c.get("user");
    const db = c.env.DB;
    const { message } = await requireMessage(db, c.req.param("rid"), me.id);
    if (message.thread_root_id) throw badRequest("スレッドの親メッセージを指定してください");
    const subscribed = method === "post" ? 1 : 0;
    await db
      .prepare(
        `INSERT INTO thread_subscriptions (root_id, user_id, last_read_at, subscribed) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (root_id, user_id) DO UPDATE SET subscribed = ?4`,
      )
      .bind(message.id, me.id, Date.now(), subscribed)
      .run();
    return c.json({ subscribed: subscribed === 1 });
  });
}
