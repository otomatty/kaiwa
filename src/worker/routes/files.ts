import { Hono } from "hono";
import { LIMITS } from "../../shared/validation";
import { requireChannel, requireWorkspace } from "../lib/access";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { badRequest, HttpError, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { type FileRow, toFile } from "../lib/rows";

// Types a browser may render inline. Everything else is served as a download,
// which (together with nosniff + CSP sandbox) prevents stored-XSS via uploads.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
]);

function safeName(name: string): string {
  const cleaned = [...name]
    .map((ch) => ((ch.codePointAt(0) ?? 0) < 0x20 || ch === "/" || ch === "\\" ? "_" : ch))
    .join("")
    .trim();
  return (cleaned || "file").slice(0, 200);
}

export const fileUploadRoutes = new Hono<AppEnv>();
fileUploadRoutes.use("*", requireAuth);

fileUploadRoutes.post("/:wid/files", async (c) => {
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const length = Number(c.req.header("Content-Length") ?? 0);
  if (length > LIMITS.fileSize + 64 * 1024)
    throw new HttpError(413, "too_large", "ファイルサイズは25MBまでです");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw badRequest("ファイルが選択されていません");
  if (file.size > LIMITS.fileSize) throw new HttpError(413, "too_large", "ファイルサイズは25MBまでです");
  if (file.size === 0) throw badRequest("空のファイルはアップロードできません");

  const id = newId("F");
  const name = safeName(file.name);
  const mime = (file.type || "application/octet-stream").toLowerCase().split(";")[0] as string;
  const key = `${wid}/${id}`;
  await c.env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: mime },
    customMetadata: { name, uploader: me.id },
  });
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO files (id, workspace_id, user_id, name, mime, size, r2_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(id, wid, me.id, name, mime, file.size, key, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?1").bind(id).first<FileRow>();
  return c.json({ file: toFile(row as FileRow) }, 201);
});

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use("*", requireAuth);

fileRoutes.get("/:fid", async (c) => {
  const me = c.get("user");
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM files WHERE id = ?1").bind(c.req.param("fid")).first<FileRow>();
  if (!row) throw notFound("ファイルが見つかりません");

  if (row.channel_id) {
    const direct = await requireChannel(db, row.channel_id, me.id).then(
      () => true,
      () => false,
    );
    // A file in a channel you can't read is still visible through a forward you can read.
    const viaForward =
      !direct && row.message_id
        ? await db
            .prepare(
              `SELECT 1 FROM messages s JOIN channels c ON c.id = s.channel_id
               WHERE s.shared_from = ?1 AND s.deleted_at IS NULL
                 AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?2))
               LIMIT 1`,
            )
            .bind(row.message_id, me.id)
            .first()
        : null;
    if (!direct && !viaForward) throw notFound("ファイルが見つかりません");
  } else if (row.user_id !== me.id) {
    // Unattached files are private to the uploader, except avatars which any
    // member of a shared workspace may load.
    const avatar = await db
      .prepare(
        `SELECT 1 FROM users u WHERE u.avatar_file_id = ?1 AND EXISTS (
           SELECT 1 FROM workspace_members a JOIN workspace_members b ON a.workspace_id = b.workspace_id
           WHERE a.user_id = u.id AND b.user_id = ?2)`,
      )
      .bind(row.id, me.id)
      .first();
    const emoji = avatar
      ? null
      : await db
          .prepare(
            `SELECT 1 FROM custom_emoji ce JOIN workspace_members wm ON wm.workspace_id = ce.workspace_id
             WHERE ce.file_id = ?1 AND wm.user_id = ?2`,
          )
          .bind(row.id, me.id)
          .first();
    if (!avatar && !emoji) throw notFound("ファイルが見つかりません");
  }

  const obj = await c.env.FILES.get(row.r2_key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) throw notFound("ファイルが見つかりません");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
  const inline = INLINE_TYPES.has(row.mime) && c.req.query("download") === undefined;
  headers.set("Content-Type", INLINE_TYPES.has(row.mime) ? row.mime : "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  );
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  if (c.req.header("Range") && obj.range && "offset" in obj.range) {
    const offset = obj.range.offset ?? 0;
    const length = obj.range.length ?? row.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${row.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
});
