import type { Message, SavedItem } from "../../shared/types";
import { publish, type Runtime } from "./realtime";
import { hydrateMessages, type MessageRow } from "./rows";

/** Saved items the user can still read whose reminder has fired and that are not completed. */
export async function countDueReminders(
  db: D1Database,
  userId: string,
  workspaceId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM saved_items s
       JOIN messages m ON m.id = s.message_id JOIN channels c ON c.id = m.channel_id
       WHERE s.user_id = ?1 AND m.workspace_id = ?2 AND s.completed_at IS NULL
         AND s.reminded_at IS NOT NULL AND m.deleted_at IS NULL
         AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?1))`,
    )
    .bind(userId, workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Tells every open tab of the user that their saved items changed. */
export async function publishSavedUpdated(rt: Runtime, userId: string, workspaceId: string): Promise<number> {
  const remindersDue = await countDueReminders(rt.env.DB, userId, workspaceId);
  publish(rt, workspaceId, { type: "saved.updated", remindersDue }, [userId]);
  return remindersDue;
}

type DueRow = MessageRow & { saver_id: string; saved_at: number; s_remind_at: number };

/** Cron entry point: fire every reminder that is due. Returns how many were delivered. */
export async function deliverReminders(rt: Runtime, now = Date.now()): Promise<number> {
  const db = rt.env.DB;
  const { results } = await db
    .prepare(
      `SELECT m.*, s.user_id AS saver_id, s.created_at AS saved_at, s.remind_at AS s_remind_at
       FROM saved_items s JOIN messages m ON m.id = s.message_id
       WHERE s.remind_at IS NOT NULL AND s.remind_at <= ?1 AND s.reminded_at IS NULL AND s.completed_at IS NULL
       ORDER BY s.remind_at LIMIT 200`,
    )
    .bind(now)
    .all<DueRow>();
  let delivered = 0;
  for (const row of results) {
    // Claim the reminder first so overlapping cron runs never fire it twice.
    const claim = await db
      .prepare(
        "UPDATE saved_items SET reminded_at = ?3 WHERE user_id = ?1 AND message_id = ?2 AND reminded_at IS NULL",
      )
      .bind(row.saver_id, row.id, now)
      .run();
    if (!claim.meta.changes || row.deleted_at) continue;
    const readable = await db
      .prepare(
        `SELECT 1 FROM channels c WHERE c.id = ?1
           AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?2))`,
      )
      .bind(row.channel_id, row.saver_id)
      .first();
    if (!readable) continue;
    const [message] = await hydrateMessages(db, [row], row.saver_id);
    const item: SavedItem = {
      message: message as Message,
      savedAt: row.saved_at,
      completedAt: null,
      remindAt: row.s_remind_at,
    };
    const remindersDue = await countDueReminders(db, row.saver_id, row.workspace_id);
    publish(rt, row.workspace_id, { type: "reminder.due", item, remindersDue }, [row.saver_id]);
    delivered++;
  }
  return delivered;
}
