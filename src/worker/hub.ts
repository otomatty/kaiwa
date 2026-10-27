import { DurableObject } from "cloudflare:workers";
import type { ClientEvent, Presence, ServerEvent } from "../shared/types";

interface Attachment {
  userId: string;
  manualAway: boolean;
  idle: boolean;
}

const TYPING_CACHE_MS = 30_000;

/**
 * One instance per workspace. Holds every WebSocket connected to that workspace
 * (using the hibernation API so idle connections cost nothing), tracks presence
 * and fans out events published by the API Worker.
 */
export class WorkspaceHub extends DurableObject<Env> {
  private memberCache = new Map<string, { at: number; ids: Set<string> }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer heartbeats without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Missing user", { status: 400 });
    const manualAway = request.headers.get("X-User-Away") === "1";

    const before = this.presenceOf(userId);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, manualAway, idle: false } satisfies Attachment);

    server.send(JSON.stringify({ type: "hello", userId, online: this.onlineMap() } satisfies ServerEvent));
    const after = this.presenceOf(userId);
    if (after !== before) this.broadcast([{ type: "presence", userId, presence: after }], null, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: ClientEvent;
    try {
      msg = JSON.parse(raw) as ClientEvent;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    if (msg.type === "typing" && typeof msg.channelId === "string") {
      const members = await this.channelMembers(msg.channelId);
      if (!members.has(att.userId)) return;
      const audience = [...members].filter((id) => id !== att.userId);
      this.broadcast(
        [
          {
            type: "typing",
            channelId: msg.channelId,
            threadRootId: msg.threadRootId ?? null,
            userId: att.userId,
          },
        ],
        audience,
      );
      return;
    }

    if (msg.type === "presence") {
      const before = this.presenceOf(att.userId);
      ws.serializeAttachment({ ...att, idle: !!msg.away } satisfies Attachment);
      const after = this.presenceOf(att.userId);
      if (before !== after) this.broadcast([{ type: "presence", userId: att.userId, presence: after }], null);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.handleGone(ws, code);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.handleGone(ws, 1011);
  }

  private handleGone(ws: WebSocket, code: number) {
    const att = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closing");
    } catch {
      // already closed
    }
    if (!att) return;
    const presence = this.presenceOf(att.userId, ws);
    if (presence === "offline" || presence !== this.presenceOf(att.userId)) {
      this.broadcast([{ type: "presence", userId: att.userId, presence }], null, ws);
    }
  }

  // ---------- RPC (called by the API Worker) ----------

  async publish(events: ServerEvent[], audience: string[] | null): Promise<number> {
    // Membership may have changed; drop cached typing audiences for touched channels.
    for (const e of events) {
      if (
        e.type === "channel.member_joined" ||
        e.type === "channel.member_left" ||
        e.type === "channel.removed" ||
        e.type === "channel.upserted"
      ) {
        this.memberCache.delete("channelId" in e ? e.channelId : e.channel.id);
      }
    }
    return this.broadcast(events, audience);
  }

  async setManualAway(userId: string, away: boolean): Promise<void> {
    const before = this.presenceOf(userId);
    for (const ws of this.ctx.getWebSockets(userId)) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) ws.serializeAttachment({ ...att, manualAway: away } satisfies Attachment);
    }
    const after = this.presenceOf(userId);
    if (before !== after) this.broadcast([{ type: "presence", userId, presence: after }], null);
  }

  async disconnectUser(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) {
      try {
        ws.close(4003, "removed");
      } catch {
        // ignore
      }
    }
    this.broadcast([{ type: "presence", userId, presence: "offline" }], null);
  }

  async online(): Promise<Record<string, Presence>> {
    return this.onlineMap();
  }

  // ---------- helpers ----------

  private broadcast(events: ServerEvent[], audience: string[] | null, exclude?: WebSocket): number {
    const allowed = audience ? new Set(audience) : null;
    const payloads = events.map((e) => JSON.stringify(e));
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att || (allowed && !allowed.has(att.userId))) continue;
      for (const p of payloads) {
        try {
          ws.send(p);
          sent++;
        } catch {
          // socket is closing
        }
      }
    }
    return sent;
  }

  private presenceOf(userId: string, excluding?: WebSocket): Presence {
    const sockets = this.ctx.getWebSockets(userId).filter((ws) => ws !== excluding);
    if (sockets.length === 0) return "offline";
    let manualAway = false;
    let allIdle = true;
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      if (att.manualAway) manualAway = true;
      if (!att.idle) allIdle = false;
    }
    return manualAway || allIdle ? "away" : "active";
  }

  private onlineMap(): Record<string, Presence> {
    const out: Record<string, Presence> = {};
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att || seen.has(att.userId)) continue;
      seen.add(att.userId);
      out[att.userId] = this.presenceOf(att.userId);
    }
    return out;
  }

  private async channelMembers(channelId: string): Promise<Set<string>> {
    const cached = this.memberCache.get(channelId);
    if (cached && Date.now() - cached.at < TYPING_CACHE_MS) return cached.ids;
    const { results } = await this.env.DB.prepare("SELECT user_id FROM channel_members WHERE channel_id = ?1")
      .bind(channelId)
      .all<{ user_id: string }>();
    const ids = new Set(results.map((r) => r.user_id));
    this.memberCache.set(channelId, { at: Date.now(), ids });
    return ids;
  }
}
