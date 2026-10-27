import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../../src/shared/types";
import { type Client, signup, workspaceWith } from "./helpers";

async function connect(client: Client, wid: string) {
  const res = await exports.default.fetch(
    new Request(`http://kaiwa.test/api/workspaces/${wid}/ws`, {
      headers: { Upgrade: "websocket", Cookie: client.cookie },
    }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no websocket");
  const events: ServerEvent[] = [];
  const waiters: { pred: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];
  ws.accept();
  ws.addEventListener("message", (m) => {
    const e = JSON.parse(m.data as string) as ServerEvent;
    events.push(e);
    for (const w of [...waiters]) {
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  });
  const next = <T extends ServerEvent["type"]>(
    type: T,
    pred: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true,
  ) =>
    new Promise<Extract<ServerEvent, { type: T }>>((resolve, reject) => {
      const found = events.find((e) => e.type === type && pred(e as Extract<ServerEvent, { type: T }>));
      if (found) return resolve(found as Extract<ServerEvent, { type: T }>);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000);
      waiters.push({
        pred: (e) => e.type === type && pred(e as Extract<ServerEvent, { type: T }>),
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e as Extract<ServerEvent, { type: T }>);
        },
      });
    });
  return { ws, events, next };
}

describe("realtime", () => {
  it("rejects unauthenticated and non-member sockets", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const anon = await exports.default.fetch(
      new Request(`http://kaiwa.test/api/workspaces/${wid}/ws`, { headers: { Upgrade: "websocket" } }),
    );
    expect(anon.status).toBe(401);
    const stranger = await signup("stranger");
    const r = await exports.default.fetch(
      new Request(`http://kaiwa.test/api/workspaces/${wid}/ws`, {
        headers: { Upgrade: "websocket", Cookie: stranger.cookie },
      }),
    );
    expect(r.status).toBe(404);
  });

  it("delivers presence, messages, reactions and typing to channel members only", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const general = await owner.channel(wid, "general");

    const a = await connect(owner, wid);
    const hello = await a.next("hello");
    expect(hello.online[owner.user.id]).toBe("active");

    const b = await connect(bob, wid);
    await b.next("hello");
    const presence = await a.next("presence", (e) => e.userId === bob.user.id);
    expect(presence.presence).toBe("active");

    const posted = await owner.post<{ message: { id: string } }>(`/channels/${general.id}/messages`, {
      text: "realtime!",
      clientMsgId: "c1",
    });
    const created = await b.next("message.created", (e) => e.message.id === posted.body.message.id);
    expect(created.message.text).toBe("realtime!");
    // Sender's own sockets receive it too (for multi-tab sync), with the client id for reconciliation.
    expect(
      (await a.next("message.created", (e) => e.message.id === posted.body.message.id)).message.clientMsgId,
    ).toBe("c1");

    await bob.post(`/messages/${posted.body.message.id}/reactions`, { emoji: "eyes" });
    const reacted = await a.next("reactions.updated");
    expect(reacted.reactions).toEqual([{ emoji: "eyes", userIds: [bob.user.id] }]);

    b.ws.send(JSON.stringify({ type: "typing", channelId: general.id }));
    const typing = await a.next("typing");
    expect(typing).toMatchObject({ channelId: general.id, userId: bob.user.id });

    // Private channel events do not leak
    const priv = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, {
      name: "owners-only",
      kind: "private",
    });
    const secret = await owner.post<{ message: { id: string } }>(
      `/channels/${priv.body.channel.id}/messages`,
      {
        text: "secret",
      },
    );
    await a.next("message.created", (e) => e.message.id === secret.body.message.id);
    expect(
      b.events.some((e) => e.type === "message.created" && e.message.id === secret.body.message.id),
    ).toBe(false);
    expect(b.events.some((e) => e.type === "channel.upserted" && e.channel.id === priv.body.channel.id)).toBe(
      false,
    );

    // Manual away is broadcast
    await bob.patch("/me", { away: true });
    const away = await a.next("presence", (e) => e.userId === bob.user.id && e.presence === "away");
    expect(away.presence).toBe("away");

    b.ws.close(1000, "bye");
    const off = await a.next("presence", (e) => e.userId === bob.user.id && e.presence === "offline");
    expect(off.presence).toBe("offline");
    a.ws.close(1000, "bye");
  });
});
