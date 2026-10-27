import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { MessagePage, ScheduledMessage } from "../../src/shared/types";
import { deliverDue } from "../../src/worker/routes/scheduled";
import { signup, workspaceWith } from "./helpers";

const rt = { env, waitUntil: () => undefined };

describe("scheduled messages", () => {
  it("schedules, lists, edits and delivers messages when due", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const general = await owner.channel(wid, "general");
    const sendAt = Date.now() + 60 * 60 * 1000;

    const r = await owner.post<{ scheduled: ScheduledMessage }>(`/scheduled/channels/${general.id}`, {
      text: "明日の朝会のリマインドです",
      sendAt,
    });
    expect(r.status).toBe(201);
    expect(
      (await owner.post(`/scheduled/channels/${general.id}`, { text: "x", sendAt: Date.now() })).status,
    ).toBe(422);

    const list = await owner.get<{ scheduled: ScheduledMessage[] }>(`/scheduled/workspaces/${wid}`);
    expect(list.body.scheduled.map((s) => s.text)).toEqual(["明日の朝会のリマインドです"]);
    // Other people cannot see or touch it
    expect(
      (await bob.get<{ scheduled: ScheduledMessage[] }>(`/scheduled/workspaces/${wid}`)).body.scheduled,
    ).toEqual([]);
    expect((await bob.del(`/scheduled/${r.body.scheduled.id}`)).status).toBe(404);

    await owner.patch(`/scheduled/${r.body.scheduled.id}`, { text: "朝会は9:30からです" });

    // Not yet due
    expect(await deliverDue(rt)).toBe(0);
    // Due: delivered as the author and removed from the list
    expect(await deliverDue(rt, sendAt + 1)).toBe(1);
    const page = await bob.get<MessagePage>(`/channels/${general.id}/messages`);
    const last = page.body.messages.at(-1);
    expect(last?.text).toBe("朝会は9:30からです");
    expect(last?.userId).toBe(owner.user.id);
    expect(
      (await owner.get<{ scheduled: ScheduledMessage[] }>(`/scheduled/workspaces/${wid}`)).body.scheduled,
    ).toEqual([]);
  });

  it("records a failure when the author can no longer post, and supports send-now", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const ch = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, { name: "temp" });
    const s = await owner.post<{ scheduled: ScheduledMessage }>(`/scheduled/channels/${ch.body.channel.id}`, {
      text: "あとで",
      sendAt: Date.now() + 120_000,
    });
    await owner.post(`/channels/${ch.body.channel.id}/archive`);
    expect(await deliverDue(rt, Date.now() + 200_000)).toBe(0);
    const list = await owner.get<{ scheduled: ScheduledMessage[] }>(`/scheduled/workspaces/${wid}`);
    expect(list.body.scheduled[0]?.error).toContain("アーカイブ");

    await owner.post(`/channels/${ch.body.channel.id}/unarchive`);
    expect((await owner.post(`/scheduled/${s.body.scheduled.id}/send`)).status).toBe(200);
    const page = await owner.get<MessagePage>(`/channels/${ch.body.channel.id}/messages`);
    expect(page.body.messages.some((m) => m.text === "あとで")).toBe(true);
  });
});
