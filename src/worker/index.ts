import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { requireWorkspace } from "./lib/access";
import { requireAuth, sameOrigin } from "./lib/auth";
import type { AppEnv } from "./lib/context";
import { HttpError } from "./lib/http";
import { hub } from "./lib/realtime";
import { authRoutes, meRoutes } from "./routes/auth";
import { channelRoutes, workspaceChannelRoutes } from "./routes/channels";
import { fileRoutes, fileUploadRoutes } from "./routes/files";
import { messageRoutes, postMessage, threadRoutes } from "./routes/messages";
import { unfurlRoutes } from "./routes/unfurl";
import { viewRoutes } from "./routes/views";
import { inviteRoutes, workspaceRoutes } from "./routes/workspaces";

export { WorkspaceHub } from "./hub";

const app = new Hono<AppEnv>().basePath("/api");

const security = secureHeaders({ crossOriginResourcePolicy: "same-origin", xFrameOptions: "DENY" });
// WebSocket upgrade responses have immutable headers, so skip header middleware for them.
app.use("*", (c, next) => (c.req.header("Upgrade") === "websocket" ? next() : security(c, next)));
app.use("*", sameOrigin);
app.use("*", async (c, next) => {
  await next();
  if (c.res.status === 101) return; // WebSocket upgrade responses are immutable
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/invites", inviteRoutes);

// Workspace-scoped routes
app.route("/workspaces", workspaceRoutes);
app.route("/workspaces", workspaceChannelRoutes);
app.route("/workspaces", viewRoutes);
app.route("/workspaces", fileUploadRoutes);

app.get("/workspaces/:wid/ws", requireAuth, async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket", 426);
  // Block cross-site WebSocket hijacking: browsers always send Origin on WS handshakes.
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text("Forbidden origin", 403);
  const me = c.get("user");
  const wid = c.req.param("wid");
  await requireWorkspace(c.env.DB, wid, me.id);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-User-Id", me.id);
  headers.set("X-User-Away", me.away ? "1" : "0");
  return hub(c.env, wid).fetch(new Request(c.req.raw.url, { headers }));
});

app.post("/channels/:cid/messages", requireAuth, postMessage);
app.route("/channels", channelRoutes);
app.route("/messages", messageRoutes);
app.route("/threads", threadRoutes);
app.route("/files", fileRoutes);
app.route("/unfurl", unfurlRoutes);

app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "internal", message: "サーバーでエラーが発生しました" }, 500);
});

export default app;
