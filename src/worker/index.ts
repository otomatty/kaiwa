import { Hono } from "hono";

export { WorkspaceHub } from "./hub";

const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
