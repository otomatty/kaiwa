import { describe, expect, it } from "vitest";
import type { Message, MessagePage, MyChannel } from "../../src/shared/types";
import { signup, workspaceWith } from "./helpers";

describe("channels", () => {
  it("creates, browses, joins and leaves public channels", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);

    const created = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/channels`, {
      name: "Design Team",
      description: "デザインの相談",
    });
    expect(created.status).toBe(201);
    expect(created.body.channel.name).toBe("design-team");

    const dup = await owner.post(`/workspaces/${wid}/channels`, { name: "design-team" });
    expect(dup.status).toBe(409);

    const browse = await bob.get<{ channels: { name: string; isMember: boolean }[] }>(
      `/workspaces/${wid}/channels/browse`,
    );
    expect(browse.body.channels.find((c) => c.name === "design-team")?.isMember).toBe(false);

    const cid = created.body.channel.id;
    // Preview is allowed, posting is not until joining
    expect((await bob.get(`/channels/${cid}/messages`)).status).toBe(200);
    expect((await bob.post(`/channels/${cid}/messages`, { text: "hi" })).status).toBe(403);

    expect((await bob.post(`/channels/${cid}/join`)).status).toBe(200);
    // Join notices are shown but never count as unread.
    expect((await owner.channel(wid, "design-team")).unreadCount).toBe(0);
    expect((await bob.post(`/channels/${cid}/messages`, { text: "hi" })).status).toBe(201);

    const page = await owner.get<MessagePage>(`/channels/${cid}/messages`);
    expect(page.body.messages.map((m) => m.subtype ?? m.text)).toEqual([
      "channel_join",
      "channel_join",
      "hi",
    ]);

    expect((await bob.post(`/channels/${cid}/leave`)).status).toBe(200);
    const general = await bob.channel(wid, "general");
    expect((await bob.post(`/channels/${general.id}/leave`)).status).toBe(403);
  });

  it("keeps private channels invisible to non-members", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const carol = await signup("carol");
    const wid = await workspaceWith(owner, bob, carol);
    const r = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/channels`, {
      name: "secret",
      kind: "private",
      memberIds: [bob.user.id],
    });
    const cid = r.body.channel.id;
    expect(r.body.channel.memberCount).toBe(2);
    expect((await bob.get(`/channels/${cid}`)).status).toBe(200);
    expect((await carol.get(`/channels/${cid}`)).status).toBe(404);
    expect((await carol.get(`/channels/${cid}/messages`)).status).toBe(404);
    expect((await carol.post(`/channels/${cid}/join`)).status).toBe(404);
    const browse = await carol.get<{ channels: { name: string }[] }>(`/workspaces/${wid}/channels/browse`);
    expect(browse.body.channels.map((c) => c.name)).not.toContain("secret");

    // Members can add people
    expect((await bob.post(`/channels/${cid}/members`, { userIds: [carol.user.id] })).status).toBe(200);
    expect((await carol.get(`/channels/${cid}`)).status).toBe(200);
  });

  it("tracks unread counts, mentions and read markers", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const general = await owner.channel(wid, "general");
    await bob.post(`/channels/${general.id}/read`, { ts: Date.now() });

    await owner.post(`/channels/${general.id}/messages`, { text: "one" });
    await owner.post(`/channels/${general.id}/messages`, { text: `hey <@${bob.user.id}>` });
    let ch = await bob.channel(wid, "general");
    expect(ch.unreadCount).toBe(2);
    expect(ch.mentionCount).toBe(1);

    const own = await owner.channel(wid, "general");
    expect(own.unreadCount).toBe(0); // own messages never count

    await bob.post(`/channels/${general.id}/read`, { ts: Date.now() });
    ch = await bob.channel(wid, "general");
    expect(ch.unreadCount).toBe(0);
    expect(ch.mentionCount).toBe(0);

    // mark unread from a specific message
    const page = await bob.get<MessagePage>(`/channels/${general.id}/messages`);
    const first = page.body.messages.find((m) => m.text === "one") as Message;
    await bob.post(`/messages/${first.id}/unread`);
    ch = await bob.channel(wid, "general");
    expect(ch.unreadCount).toBe(2);
  });

  it("opens DMs, reuses them and hides them from recipients until a message is sent", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const carol = await signup("carol");
    const wid = await workspaceWith(owner, bob, carol);
    const dm = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/dms`, { userIds: [bob.user.id] });
    expect(dm.status).toBe(201);
    expect(dm.body.channel.kind).toBe("dm");
    const again = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/dms`, {
      userIds: [bob.user.id],
    });
    expect(again.body.channel.id).toBe(dm.body.channel.id);

    let bobView = (await bob.bootstrap(wid)).channels.find((c) => c.id === dm.body.channel.id);
    expect(bobView?.hidden).toBe(true);
    await owner.post(`/channels/${dm.body.channel.id}/messages`, { text: "やあ" });
    bobView = (await bob.bootstrap(wid)).channels.find((c) => c.id === dm.body.channel.id);
    expect(bobView?.hidden).toBe(false);
    expect(bobView?.unreadCount).toBe(1);
    expect((await carol.get(`/channels/${dm.body.channel.id}/messages`)).status).toBe(404);

    const group = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/dms`, {
      userIds: [bob.user.id, carol.user.id],
    });
    expect(group.body.channel.kind).toBe("group");
    expect(group.body.channel.memberIds.sort()).toEqual([owner.user.id, bob.user.id, carol.user.id].sort());

    const self = await owner.post<{ channel: MyChannel }>(`/workspaces/${wid}/dms`, {
      userIds: [owner.user.id],
    });
    expect(self.body.channel.memberIds).toEqual([owner.user.id]);
  });

  it("updates topic/name, archives, and restricts deletion to admins", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const r = await bob.post<{ channel: MyChannel }>(`/workspaces/${wid}/channels`, { name: "proj" });
    const cid = r.body.channel.id;
    const up = await bob.patch<{ channel: MyChannel }>(`/channels/${cid}`, {
      topic: "締切は金曜",
      name: "proj-x",
    });
    expect(up.body.channel).toMatchObject({ topic: "締切は金曜", name: "proj-x" });
    const msgs = await bob.get<MessagePage>(`/channels/${cid}/messages`);
    expect(msgs.body.messages.map((m) => m.subtype)).toEqual([
      "channel_join",
      "channel_name",
      "channel_topic",
    ]);

    expect((await bob.post(`/channels/${cid}/archive`)).status).toBe(200);
    expect((await bob.post(`/channels/${cid}/messages`, { text: "x" })).status).toBe(403);
    expect((await bob.post(`/channels/${cid}/unarchive`)).status).toBe(200);

    expect((await bob.del(`/channels/${cid}`)).status).toBe(403);
    expect((await owner.del(`/channels/${cid}`)).status).toBe(200);
    expect((await bob.get(`/channels/${cid}`)).status).toBe(404);
  });

  it("stores per-member preferences and bookmarks", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const general = await owner.channel(wid, "general");
    const p = await owner.patch<{ channel: MyChannel }>(`/channels/${general.id}/prefs`, {
      starred: true,
      muted: true,
    });
    expect(p.body.channel).toMatchObject({ starred: true, muted: true });

    const bm = await owner.post(`/channels/${general.id}/bookmarks`, {
      title: "Docs",
      url: "https://example.com",
    });
    expect(bm.status).toBe(201);
    expect(
      (await owner.post(`/channels/${general.id}/bookmarks`, { title: "x", url: "javascript:alert(1)" }))
        .status,
    ).toBe(422);
    const list = await owner.get<{ bookmarks: { title: string }[] }>(`/channels/${general.id}/bookmarks`);
    expect(list.body.bookmarks.map((b) => b.title)).toEqual(["Docs"]);
  });
});
