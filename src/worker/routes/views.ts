import { Hono } from "hono";
import type {
  ActivityItem,
  ChannelKind,
  Message,
  SavedItem,
  SearchResult,
  ThreadSummary,
} from "../../shared/types";
import { requireWorkspace } from "../lib/access";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { chunk, placeholders } from "../lib/http";
import { type FileRow, hydrateMessages, type MessageRow, toFile } from "../lib/rows";

export const viewRoutes = new Hono<AppEnv>();
viewRoutes.use("*", requireAuth);

/** Channels the viewer can read: public channels + anything they are a member of. */
const READABLE = `(c.kind = 'public' OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?1))`;

function ftsQuery(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

viewRoutes.get("/:wid/search", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const channelId = c.req.query("channel");
  const userId = c.req.query("user");
  const sort = c.req.query("sort") === "relevance" ? "relevance" : "recent";
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  const limit = 30;

  const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
  if (terms.length === 0 && !channelId && !userId) return c.json({ results: [], total: 0, hasMore: false });

  const where: string[] = [
    "m.workspace_id = ?2",
    "m.deleted_at IS NULL",
    "(m.subtype IS NULL OR m.subtype = 'me')",
    READABLE,
  ];
  const params: unknown[] = [me.id, wid];
  const longTerms = terms.filter((t) => [...t].length >= 3);
  const shortTerms = terms.filter((t) => [...t].length < 3);
  if (longTerms.length > 0) {
    params.push(ftsQuery(longTerms));
    where.push(`m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?${params.length})`);
  }
  for (const t of shortTerms) {
    params.push(`%${t.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where.push(`m.text LIKE ?${params.length} ESCAPE '\\'`);
  }
  if (channelId) {
    params.push(channelId);
    where.push(`m.channel_id = ?${params.length}`);
  }
  if (userId) {
    params.push(userId);
    where.push(`m.user_id = ?${params.length}`);
  }
  const order =
    sort === "relevance" && longTerms.length > 0
      ? "length(m.text) ASC, m.created_at DESC"
      : "m.created_at DESC";
  const { results } = await db
    .prepare(
      `SELECT m.*, c.name AS c_name, c.kind AS c_kind FROM messages m JOIN channels c ON c.id = m.channel_id
       WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    )
    .bind(...params)
    .all<MessageRow & { c_name: string; c_kind: ChannelKind }>();
  const page = results.slice(0, limit);
  const messages = await hydrateMessages(db, page, me.id);
  const dmIds = [
    ...new Set(page.filter((r) => r.c_kind === "dm" || r.c_kind === "group").map((r) => r.channel_id)),
  ];
  const dmMembers = new Map<string, string[]>();
  for (const ids of chunk(dmIds)) {
    const { results: rows } = await db
      .prepare(
        `SELECT channel_id, user_id FROM channel_members WHERE channel_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<{ channel_id: string; user_id: string }>();
    for (const r of rows) dmMembers.set(r.channel_id, [...(dmMembers.get(r.channel_id) ?? []), r.user_id]);
  }
  const out: SearchResult[] = page.map((r, i) => ({
    message: messages[i] as Message,
    channel: {
      id: r.channel_id,
      name: r.c_name,
      kind: r.c_kind,
      memberIds: dmMembers.get(r.channel_id) ?? [],
    },
  }));
  return c.json({ results: out, hasMore: results.length > limit });
});

viewRoutes.get("/:wid/threads", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const { results: roots } = await db
    .prepare(
      `SELECT m.*, ts.last_read_at AS ts_read FROM thread_subscriptions ts
       JOIN messages m ON m.id = ts.root_id JOIN channels c ON c.id = m.channel_id
       WHERE ts.user_id = ?1 AND ts.subscribed = 1 AND m.workspace_id = ?2 AND m.reply_count > 0 AND ${READABLE}
       ORDER BY m.last_reply_at DESC LIMIT 30`,
    )
    .bind(me.id, wid)
    .all<MessageRow & { ts_read: number }>();
  if (roots.length === 0) return c.json({ threads: [] });
  const replyRows: MessageRow[] = [];
  for (const ids of chunk(roots.map((r) => r.id))) {
    const { results } = await db
      .prepare(
        `SELECT * FROM messages WHERE thread_root_id IN (${placeholders(ids.length)}) AND deleted_at IS NULL
         ORDER BY created_at, id`,
      )
      .bind(...ids)
      .all<MessageRow>();
    replyRows.push(...results);
  }
  const byRoot = new Map<string, MessageRow[]>();
  for (const r of replyRows)
    byRoot.set(r.thread_root_id as string, [...(byRoot.get(r.thread_root_id as string) ?? []), r]);
  const shownReplies = roots.flatMap((r) => (byRoot.get(r.id) ?? []).slice(-3));
  const hydrated = await hydrateMessages(db, [...roots, ...shownReplies], me.id);
  const byId = new Map(hydrated.map((m) => [m.id, m]));
  const threads: ThreadSummary[] = roots.map((r) => {
    const all = byRoot.get(r.id) ?? [];
    return {
      root: byId.get(r.id) as Message,
      latestReplies: all.slice(-3).map((x) => byId.get(x.id) as Message),
      unreadCount: all.filter((x) => x.created_at > r.ts_read && x.user_id !== me.id).length,
      lastReadAt: r.ts_read,
    };
  });
  return c.json({ threads });
});

viewRoutes.get("/:wid/activity", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const [mentions, reactions, replies] = await db.batch([
    db
      .prepare(
        `SELECT m.*, mn.created_at AS at FROM mentions mn JOIN messages m ON m.id = mn.message_id
         WHERE mn.user_id = ?1 AND m.workspace_id = ?2 AND m.deleted_at IS NULL ORDER BY mn.created_at DESC LIMIT 50`,
      )
      .bind(me.id, wid),
    db
      .prepare(
        `SELECT m.*, r.created_at AS at, r.emoji AS r_emoji, r.user_id AS r_user FROM reactions r
         JOIN messages m ON m.id = r.message_id
         WHERE m.user_id = ?1 AND r.user_id != ?1 AND m.workspace_id = ?2 ORDER BY r.created_at DESC LIMIT 50`,
      )
      .bind(me.id, wid),
    db
      .prepare(
        `SELECT m.*, m.created_at AS at FROM thread_subscriptions ts JOIN messages m ON m.thread_root_id = ts.root_id
         WHERE ts.user_id = ?1 AND ts.subscribed = 1 AND m.workspace_id = ?2 AND m.user_id != ?1 AND m.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM mentions x WHERE x.message_id = m.id AND x.user_id = ?1)
         ORDER BY m.created_at DESC LIMIT 50`,
      )
      .bind(me.id, wid),
  ]);
  type Row = MessageRow & { at: number; r_emoji?: string; r_user?: string };
  const mRows = (mentions?.results ?? []) as unknown as Row[];
  const rRows = (reactions?.results ?? []) as unknown as Row[];
  const tRows = (replies?.results ?? []) as unknown as Row[];
  const uniq = new Map<string, MessageRow>();
  for (const r of [...mRows, ...rRows, ...tRows]) uniq.set(r.id, r);
  const hydrated = new Map((await hydrateMessages(db, [...uniq.values()], me.id)).map((m) => [m.id, m]));
  const items: ActivityItem[] = [
    ...mRows.map((r) => ({ kind: "mention" as const, at: r.at, message: hydrated.get(r.id) as Message })),
    ...tRows.map((r) => ({ kind: "reply" as const, at: r.at, message: hydrated.get(r.id) as Message })),
    ...rRows.map((r) => ({
      kind: "reaction" as const,
      at: r.at,
      message: hydrated.get(r.id) as Message,
      emoji: r.r_emoji as string,
      userId: r.r_user as string,
    })),
  ]
    .filter((i) => i.message)
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);
  return c.json({ items });
});

viewRoutes.get("/:wid/saved", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const completed = c.req.query("state") === "completed";
  const { results } = await db
    .prepare(
      `SELECT m.*, s.created_at AS saved_at, s.completed_at AS s_completed FROM saved_items s
       JOIN messages m ON m.id = s.message_id JOIN channels c ON c.id = m.channel_id
       WHERE s.user_id = ?1 AND m.workspace_id = ?2 AND m.deleted_at IS NULL AND ${READABLE}
         AND s.completed_at IS ${completed ? "NOT NULL" : "NULL"}
       ORDER BY s.created_at DESC LIMIT 100`,
    )
    .bind(me.id, wid)
    .all<MessageRow & { saved_at: number; s_completed: number | null }>();
  const messages = await hydrateMessages(db, results, me.id);
  const items: SavedItem[] = results.map((r, i) => ({
    message: messages[i] as Message,
    savedAt: r.saved_at,
    completedAt: r.s_completed,
  }));
  return c.json({ items });
});

viewRoutes.get("/:wid/files", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const { results } = await db
    .prepare(
      `SELECT f.* FROM files f JOIN channels c ON c.id = f.channel_id
       WHERE f.workspace_id = ?2 AND f.message_id IS NOT NULL AND ${READABLE}
       ORDER BY f.created_at DESC LIMIT 200`,
    )
    .bind(me.id, wid)
    .all<FileRow>();
  return c.json({ files: results.map(toFile) });
});
