import { Hono } from "hono";
// Names that already exist as standard emoji cannot be reused.
import emojiData from "../../shared/emoji-data.json";
import type { CustomEmoji } from "../../shared/types";
import { customEmojiSchema } from "../../shared/validation";
import { isAdmin, requireWorkspace } from "../lib/access";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { badRequest, conflict, forbidden, notFound, parseJson } from "../lib/http";
import { publish } from "../lib/realtime";
import { fileUrl } from "../lib/rows";

const STANDARD = new Set((emojiData as [string, string[], number, string][]).flatMap((r) => r[1]));

export async function listCustomEmoji(db: D1Database, workspaceId: string): Promise<CustomEmoji[]> {
  const { results } = await db
    .prepare("SELECT name, file_id, created_by FROM custom_emoji WHERE workspace_id = ?1 ORDER BY name")
    .bind(workspaceId)
    .all<{ name: string; file_id: string; created_by: string }>();
  return results.map((r) => ({ name: r.name, url: fileUrl(r.file_id), createdBy: r.created_by }));
}

export const emojiRoutes = new Hono<AppEnv>();
emojiRoutes.use("*", requireAuth);

emojiRoutes.get("/:wid/emoji", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  return c.json({ emoji: await listCustomEmoji(c.env.DB, wid) });
});

emojiRoutes.post("/:wid/emoji", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  await requireWorkspace(db, wid, me.id);
  const body = await parseJson(c, customEmojiSchema);
  if (STANDARD.has(body.name))
    throw conflict(`:${body.name}: は標準の絵文字として使われています`, "name_taken");
  const file = await db
    .prepare(
      "SELECT mime, size FROM files WHERE id = ?1 AND user_id = ?2 AND workspace_id = ?3 AND message_id IS NULL",
    )
    .bind(body.fileId, me.id, wid)
    .first<{ mime: string; size: number }>();
  if (!file || !/^image\/(png|gif|jpeg|webp)$/.test(file.mime))
    throw badRequest("PNG / GIF / JPEG / WebP の画像を選んでください");
  if (file.size > 1024 * 1024) throw badRequest("絵文字の画像は1MBまでです");
  const dupe = await db
    .prepare("SELECT 1 FROM custom_emoji WHERE workspace_id = ?1 AND name = ?2")
    .bind(wid, body.name)
    .first();
  if (dupe) throw conflict(`:${body.name}: は既に登録されています`, "name_taken");
  await db
    .prepare(
      "INSERT INTO custom_emoji (workspace_id, name, file_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(wid, body.name, body.fileId, me.id, Date.now())
    .run();
  const emoji = await listCustomEmoji(db, wid);
  publish(c, wid, { type: "emoji.updated", emoji }, "all");
  return c.json({ emoji }, 201);
});

emojiRoutes.delete("/:wid/emoji/:name", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  const db = c.env.DB;
  const role = await requireWorkspace(db, wid, me.id);
  const row = await db
    .prepare("SELECT created_by FROM custom_emoji WHERE workspace_id = ?1 AND name = ?2")
    .bind(wid, c.req.param("name"))
    .first<{ created_by: string }>();
  if (!row) throw notFound("絵文字が見つかりません");
  if (row.created_by !== me.id && !isAdmin(role)) throw forbidden("登録した本人か管理者のみ削除できます");
  await db
    .prepare("DELETE FROM custom_emoji WHERE workspace_id = ?1 AND name = ?2")
    .bind(wid, c.req.param("name"))
    .run();
  const emoji = await listCustomEmoji(db, wid);
  publish(c, wid, { type: "emoji.updated", emoji }, "all");
  return c.json({ emoji });
});
