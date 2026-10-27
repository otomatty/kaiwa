import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Bootstrap, Message, SavedItem } from "../../src/shared/types";
import { deliverReminders } from "../../src/worker/lib/reminders";
import { signup, workspaceWith } from "./helpers";

const rt = { env, waitUntil: () => undefined };

describe("saved item reminders", () => {
  it("sets, fires, counts and clears reminders", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const general = await owner.channel(wid, "general");
    const posted = await bob.post<{ message: Message }>(`/channels/${general.id}/messages`, {
      text: "金曜までに見積もりをください",
    });
    const mid = posted.body.message.id;
    const remindAt = Date.now() + 60 * 60 * 1000;

    // Validation: past times and garbage are rejected
    expect((await owner.post(`/messages/${mid}/save`, { remindAt: Date.now() - 3_600_000 })).status).toBe(
      422,
    );
    expect((await owner.post(`/messages/${mid}/save`, { remindAt: "tomorrow" })).status).toBe(422);

    const saved = await owner.post<{ remindAt: number; remindersDue: number }>(`/messages/${mid}/save`, {
      remindAt,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.remindAt).toBe(remindAt);
    expect(saved.body.remindersDue).toBe(0);

    const list = await owner.get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved`);
    expect(list.body.items[0]?.remindAt).toBe(remindAt);

    // Not due yet
    expect(await deliverReminders(rt)).toBe(0);
    // Due: fires exactly once
    expect(await deliverReminders(rt, remindAt + 1)).toBe(1);
    expect(await deliverReminders(rt, remindAt + 120_000)).toBe(0);
    const boot = await owner.get<Bootstrap>(`/workspaces/${wid}/bootstrap`);
    expect(boot.body.remindersDue).toBe(1);
    // Other people's counts are unaffected
    expect((await bob.get<Bootstrap>(`/workspaces/${wid}/bootstrap`)).body.remindersDue).toBe(0);

    // Completing the item clears the badge
    const done = await owner.post<{ remindersDue: number }>(`/messages/${mid}/save`, { completed: true });
    expect(done.body.remindersDue).toBe(0);

    // Re-scheduling re-opens the item and re-arms the reminder
    const again = await owner.post<{ remindersDue: number }>(`/messages/${mid}/save`, {
      remindAt: remindAt + 7_200_000,
    });
    expect(again.body.remindersDue).toBe(0);
    const open = await owner.get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved`);
    expect(open.body.items.map((i) => i.message.id)).toEqual([mid]);
    expect(await deliverReminders(rt, remindAt + 7_200_001)).toBe(1);

    // Removing the reminder keeps the item saved
    const cleared = await owner.post<{ remindAt: number | null }>(`/messages/${mid}/save`, {
      remindAt: null,
    });
    expect(cleared.body.remindAt).toBeNull();
    const unsave = await owner.del<{ remindersDue: number }>(`/messages/${mid}/save`);
    expect(unsave.body.remindersDue).toBe(0);
  });

  it("does not deliver reminders for messages the user can no longer read", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const ch = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, {
      name: "secret",
      kind: "private",
      memberIds: [bob.user.id],
    });
    const cid = ch.body.channel.id;
    const posted = await owner.post<{ message: Message }>(`/channels/${cid}/messages`, { text: "内密の話" });
    const remindAt = Date.now() + 120_000;
    await bob.post(`/messages/${posted.body.message.id}/save`, { remindAt });
    await bob.post(`/channels/${cid}/leave`);
    expect(await deliverReminders(rt, remindAt + 1)).toBe(0);
    expect((await bob.get<Bootstrap>(`/workspaces/${wid}/bootstrap`)).body.remindersDue).toBe(0);
  });
});
