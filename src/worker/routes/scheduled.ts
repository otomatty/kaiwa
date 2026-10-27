import { Hono } from "hono";
import type { ScheduledMessage } from "../../shared/types";
import { scheduleMessageSchema, updateScheduledSchema } from "../../shared/validation";
import { requireChannel, requireWorkspace } from "../lib/access";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { HttpError, notFound, parseJson } from "../lib/http";
import { newId } from "../lib/ids";
import { publish, type Runtime, runtime } from "../lib/realtime";
import { createMessage } from "./messages";

interface ScheduledRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  user_id: string;
  text: string;
  thread_root_id: string | null;
  broadcast: number;
  send_at: number;
  created_at: number;
  error: string | null;
}

const toScheduled = (r: ScheduledRow): ScheduledMessage => ({
  id: r.id,
  workspaceId: r.workspace_id,
  channelId: r.channel_id,
  text: r.text,
  threadRootId: r.thread_root_id,
  broadcast: r.broadcast === 1,
  sendAt: r.send_at,
  createdAt: r.created_at,
  error: r.error,
});

/** Sends one scheduled message now. Failures are recorded on the row so the author can see them. */
async function deliver(rt: Runtime, row: ScheduledRow): Promise<boolean> {
  const db = rt.env.DB;
  try {
    await createMessage(rt, row.user_id, row.channel_id, {
      text: row.text,
      threadRootId: row.thread_root_id,
      broadcast: row.broadcast === 1,
      fileIds: [],
    });
    await db.prepare("DELETE FROM scheduled_messages WHERE id = ?1").bind(row.id).run();
    return true;
  } catch (err) {
    const reason = err instanceof HttpError ? err.message : "送信できませんでした";
    await db.prepare("UPDATE scheduled_messages SET error = ?2 WHERE id = ?1").bind(row.id, reason).run();
    return false;
  } finally {
    publish(rt, row.workspace_id, { type: "scheduled.updated" }, [row.user_id]);
  }
}

/** Cron entry point: deliver everything that is due. */
export async function deliverDue(rt: Runtime, now = Date.now()): Promise<number> {
  const { results } = await rt.env.DB.prepare(
    "SELECT * FROM scheduled_messages WHERE send_at <= ?1 AND error IS NULL ORDER BY send_at LIMIT 200",
  )
    .bind(now)
    .all<ScheduledRow>();
  let sent = 0;
  for (const row of results) if (await deliver(rt, row)) sent++;
  return sent;
}

export const scheduledRoutes = new Hono<AppEnv>();
scheduledRoutes.use("*", requireAuth);

// POST /api/scheduled/channels/:cid
scheduledRoutes.post("/channels/:cid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const access = await requireChannel(db, c.req.param("cid"), me.id, { write: true });
  const body = await parseJson(c, scheduleMessageSchema);
  const id = newId("M");
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO scheduled_messages (id, workspace_id, channel_id, user_id, text, thread_root_id, broadcast, send_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      id,
      access.channel.workspace_id,
      access.channel.id,
      me.id,
      body.text,
      body.threadRootId ?? null,
      body.broadcast ? 1 : 0,
      body.sendAt,
      now,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM scheduled_messages WHERE id = ?1")
    .bind(id)
    .first<ScheduledRow>();
  publish(c, access.channel.workspace_id, { type: "scheduled.updated" }, [me.id]);
  return c.json({ scheduled: toScheduled(row as ScheduledRow) }, 201);
});

scheduledRoutes.get("/workspaces/:wid", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM scheduled_messages WHERE user_id = ?1 AND workspace_id = ?2 ORDER BY send_at",
  )
    .bind(me.id, wid)
    .all<ScheduledRow>();
  return c.json({ scheduled: results.map(toScheduled) });
});

async function ownRow(db: D1Database, id: string, userId: string): Promise<ScheduledRow> {
  const row = await db
    .prepare("SELECT * FROM scheduled_messages WHERE id = ?1 AND user_id = ?2")
    .bind(id, userId)
    .first<ScheduledRow>();
  if (!row) throw notFound("予約メッセージが見つかりません");
  return row;
}

scheduledRoutes.patch("/:id", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const row = await ownRow(db, c.req.param("id"), me.id);
  const body = await parseJson(c, updateScheduledSchema);
  await db
    .prepare("UPDATE scheduled_messages SET text = ?2, send_at = ?3, error = NULL WHERE id = ?1")
    .bind(row.id, body.text ?? row.text, body.sendAt ?? row.send_at)
    .run();
  const next = await db
    .prepare("SELECT * FROM scheduled_messages WHERE id = ?1")
    .bind(row.id)
    .first<ScheduledRow>();
  publish(c, row.workspace_id, { type: "scheduled.updated" }, [me.id]);
  return c.json({ scheduled: toScheduled(next as ScheduledRow) });
});

scheduledRoutes.delete("/:id", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const row = await ownRow(db, c.req.param("id"), me.id);
  await db.prepare("DELETE FROM scheduled_messages WHERE id = ?1").bind(row.id).run();
  publish(c, row.workspace_id, { type: "scheduled.updated" }, [me.id]);
  return c.json({ ok: true });
});

scheduledRoutes.post("/:id/send", async (c) => {
  const me = c.get("user");
  const row = await ownRow(c.env.DB, c.req.param("id"), me.id);
  const ok = await deliver(runtime(c), row);
  if (!ok) {
    const failed = await ownRow(c.env.DB, row.id, me.id);
    throw new HttpError(422, "send_failed", failed.error ?? "送信できませんでした");
  }
  return c.json({ ok: true });
});
