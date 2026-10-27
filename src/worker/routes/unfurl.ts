import { Hono } from "hono";
import type { Unfurl } from "../../shared/types";
import { requireAuth } from "../lib/auth";
import type { AppEnv } from "../lib/context";
import { badRequest } from "../lib/http";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/;
const UA = "Mozilla/5.0 (compatible; KaiwaBot/1.0; +link-preview)";

/** Only public http(s) URLs; refuse obvious local/private targets. */
export function safeUrl(raw: string | undefined): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return null;
    }
  }
  if (host.startsWith("[")) return null; // IPv6 literals
  return u;
}

function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (seen >= max) return;
        const room = max - seen;
        seen += chunk.byteLength;
        controller.enqueue(chunk.byteLength > room ? chunk.slice(0, room) : chunk);
        if (seen >= max) controller.terminate();
      },
    }),
  );
}

/** Extracts OpenGraph / Twitter / <title> metadata from an HTML response. */
export async function extractMeta(res: Response, base: URL): Promise<Omit<Unfurl, "url">> {
  const meta: Record<string, string> = {};
  let title = "";
  let inTitle = false;
  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !(key in meta)) meta[key] = content;
      },
    })
    .on("title", {
      element() {
        inTitle = true;
      },
      text(t) {
        if (inTitle) title += t.text;
        if (t.lastInTextNode) inTitle = false;
      },
    });
  await rewriter.transform(res).arrayBuffer();
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = meta[k]?.trim();
      if (v) return v;
    }
    return null;
  };
  const decode = (s: string | null) =>
    s
      ?.replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .slice(0, 300) ?? null;
  let image = pick("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src");
  if (image) {
    try {
      image = new URL(image, base).toString();
    } catch {
      image = null;
    }
  }
  return {
    title: decode(pick("og:title", "twitter:title") ?? (title.trim() || null)),
    description: decode(pick("og:description", "twitter:description", "description")),
    siteName: decode(pick("og:site_name", "application-name") ?? base.hostname),
    image,
  };
}

export const unfurlRoutes = new Hono<AppEnv>();
unfurlRoutes.use("*", requireAuth);

unfurlRoutes.get("/", async (c) => {
  const target = safeUrl(c.req.query("url"));
  if (!target) throw badRequest("URL が正しくありません");
  const cacheKey = new Request(`https://unfurl.kaiwa.internal/v1?u=${encodeURIComponent(target.toString())}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = await cache?.match(cacheKey);
  if (hit)
    return new Response(hit.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
    });

  let data: Unfurl = {
    url: target.toString(),
    title: null,
    description: null,
    siteName: target.hostname,
    image: null,
  };
  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,image/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    const type = (res.headers.get("Content-Type") ?? "").toLowerCase();
    const finalUrl = safeUrl(res.url) ?? target;
    if (res.ok && res.body && type.includes("text/html")) {
      const meta = await extractMeta(
        new Response(capped(res.body, MAX_HTML_BYTES), { headers: res.headers }),
        finalUrl,
      );
      data = { url: target.toString(), ...meta };
    } else if (res.ok && IMAGE_TYPES.test(type.split(";")[0] ?? "")) {
      data = { ...data, title: null, image: target.toString() };
      await res.body?.cancel();
    } else {
      await res.body?.cancel();
    }
  } catch {
    // Unreachable site: return an empty preview (cached briefly below).
  }
  if (data.image) data.image = `/api/unfurl/image?url=${encodeURIComponent(data.image)}`;
  const body = JSON.stringify(data);
  const ttl = data.title || data.image ? 6 * 3600 : 600;
  try {
    await cache?.put(
      cacheKey,
      new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
      }),
    );
  } catch {
    // cache unavailable
  }
  return c.json(data, 200, { "Cache-Control": "private, max-age=3600" });
});

/** Image proxy so viewers' browsers never contact third-party hosts directly. */
unfurlRoutes.get("/image", async (c) => {
  const target = safeUrl(c.req.query("url"));
  if (!target) throw badRequest("URL が正しくありません");
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
  } catch {
    return c.body(null, 404);
  }
  const type = (res.headers.get("Content-Type") ?? "").toLowerCase().split(";")[0] ?? "";
  const length = Number(res.headers.get("Content-Length") ?? 0);
  if (!res.ok || !res.body || !IMAGE_TYPES.test(type) || length > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    return c.body(null, 404);
  }
  return new Response(capped(res.body, MAX_IMAGE_BYTES), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
});
