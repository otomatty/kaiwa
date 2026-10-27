import { describe, expect, it } from "vitest";
import type {
  ActivityItem,
  Message,
  MessagePage,
  SavedItem,
  SearchResult,
  ThreadSummary,
  ThreadView,
} from "../../src/shared/types";
import { signup, workspaceWith } from "./helpers";

async function setup() {
  const owner = await signup("owner");
  const bob = await signup("bob");
  const wid = await workspaceWith(owner, bob);
  const general = await owner.channel(wid, "general");
  return { owner, bob, wid, cid: general.id };
}

describe("messages", () => {
  it("posts, edits and deletes messages with ownership checks", async () => {
    const { owner, bob, cid } = await setup();
    const r = await owner.post<{ message: Message }>(`/channels/${cid}/messages`, {
      text: "hello *world*",
      clientMsgId: "tmp-1",
    });
    expect(r.status).toBe(201);
    expect(r.body.message.clientMsgId).toBe("tmp-1");
    const id = r.body.message.id;

    expect((await bob.patch(`/messages/${id}`, { text: "hacked" })).status).toBe(403);
    const ed = await owner.patch<{ message: Message }>(`/messages/${id}`, { text: "hello again" });
    expect(ed.body.message.text).toBe("hello again");
    expect(ed.body.message.editedAt).not.toBeNull();

    expect((await bob.del(`/messages/${id}`)).status).toBe(403);
    expect((await owner.del(`/messages/${id}`)).status).toBe(200);
    const page = await owner.get<MessagePage>(`/channels/${cid}/messages`);
    expect(page.body.messages.find((m) => m.id === id)).toBeUndefined();

    expect((await owner.post(`/channels/${cid}/messages`, { text: "   " })).status).toBe(422);
  });

  it("supports threads, follow state and the Threads view", async () => {
    const { owner, bob, wid, cid } = await setup();
    const root = (await owner.post<{ message: Message }>(`/channels/${cid}/messages`, { text: "議題" })).body
      .message;
    await bob.post(`/channels/${cid}/messages`, { text: "返信1", threadRootId: root.id });
    await bob.post(`/channels/${cid}/messages`, {
      text: "返信2（チャンネルにも）",
      threadRootId: root.id,
      broadcast: true,
    });

    const thread = await owner.get<ThreadView>(`/messages/${root.id}/thread`);
    expect(thread.body.root.replyCount).toBe(2);
    expect(thread.body.root.replyUserIds).toEqual([bob.user.id]);
    expect(thread.body.replies.map((m) => m.text)).toEqual(["返信1", "返信2（チャンネルにも）"]);
    expect(thread.body.subscribed).toBe(true);

    // Broadcast replies appear in the channel, normal replies do not
    const page = await owner.get<MessagePage>(`/channels/${cid}/messages`);
    const texts = page.body.messages.map((m) => m.text);
    expect(texts).toContain("返信2（チャンネルにも）");
    expect(texts).not.toContain("返信1");

    const threads = await owner.get<{ threads: ThreadSummary[] }>(`/workspaces/${wid}/threads`);
    expect(threads.body.threads).toHaveLength(1);
    expect(threads.body.threads[0]?.unreadCount).toBe(2);
    expect((await owner.bootstrap(wid)).unreadThreads).toBe(1);

    await owner.post(`/threads/${root.id}/read`, { ts: Date.now() });
    expect((await owner.bootstrap(wid)).unreadThreads).toBe(0);

    await owner.del(`/threads/${root.id}/follow`);
    expect(
      (await owner.get<{ threads: ThreadSummary[] }>(`/workspaces/${wid}/threads`)).body.threads,
    ).toHaveLength(0);

    // Deleting a root that has replies leaves a tombstone
    await owner.del(`/messages/${root.id}`);
    const t2 = await bob.get<ThreadView>(`/messages/${root.id}/thread`);
    expect(t2.body.root.deletedAt).not.toBeNull();
    expect(t2.body.root.text).toBe("");
  });

  it("toggles reactions, pins and saved items", async () => {
    const { owner, bob, wid, cid } = await setup();
    const m = (await owner.post<{ message: Message }>(`/channels/${cid}/messages`, { text: "nice" })).body
      .message;
    await bob.post(`/messages/${m.id}/reactions`, { emoji: "thumbsup" });
    await owner.post(`/messages/${m.id}/reactions`, { emoji: "thumbsup" });
    const r = await bob.post<{ reactions: { emoji: string; userIds: string[] }[] }>(
      `/messages/${m.id}/reactions`,
      {
        emoji: "tada",
      },
    );
    expect(r.body.reactions).toEqual([
      { emoji: "thumbsup", userIds: [bob.user.id, owner.user.id] },
      { emoji: "tada", userIds: [bob.user.id] },
    ]);
    const del = await bob.del<{ reactions: { emoji: string }[] }>(`/messages/${m.id}/reactions/tada`);
    expect(del.body.reactions.map((x) => x.emoji)).toEqual(["thumbsup"]);
    expect((await bob.post(`/messages/${m.id}/reactions`, { emoji: "<script>" })).status).toBe(422);

    await bob.post(`/messages/${m.id}/pin`);
    const pins = await owner.get<{ messages: Message[] }>(`/channels/${cid}/pins`);
    expect(pins.body.messages.map((x) => x.id)).toEqual([m.id]);

    await bob.post(`/messages/${m.id}/save`);
    const saved = await bob.get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved`);
    expect(saved.body.items.map((x) => x.message.id)).toEqual([m.id]);
    expect(saved.body.items[0]?.message.saved).toBe(true);
    await bob.post(`/messages/${m.id}/save`, { completed: true });
    expect((await bob.get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved`)).body.items).toHaveLength(0);
    expect(
      (await bob.get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved?state=completed`)).body.items,
    ).toHaveLength(1);

    const activity = await owner.get<{ items: ActivityItem[] }>(`/workspaces/${wid}/activity`);
    expect(activity.body.items.some((i) => i.kind === "reaction" && i.emoji === "thumbsup")).toBe(true);
  });

  it("paginates with before/after/around cursors", async () => {
    const { owner, cid } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(
        (await owner.post<{ message: Message }>(`/channels/${cid}/messages`, { text: `m${i}` })).body.message
          .id,
      );
    }
    const latest = await owner.get<MessagePage>(`/channels/${cid}/messages?limit=5`);
    expect(latest.body.messages.map((m) => m.text)).toEqual(["m7", "m8", "m9", "m10", "m11"]);
    expect(latest.body.hasMoreBefore).toBe(true);

    const older = await owner.get<MessagePage>(`/channels/${cid}/messages?limit=5&before=${ids[7]}`);
    expect(older.body.messages.map((m) => m.text)).toEqual(["m2", "m3", "m4", "m5", "m6"]);

    const newer = await owner.get<MessagePage>(`/channels/${cid}/messages?limit=3&after=${ids[3]}`);
    expect(newer.body.messages.map((m) => m.text)).toEqual(["m4", "m5", "m6"]);
    expect(newer.body.hasMoreAfter).toBe(true);

    const around = await owner.get<MessagePage>(`/channels/${cid}/messages?limit=4&around=${ids[5]}`);
    expect(around.body.messages.map((m) => m.text)).toEqual(["m4", "m5", "m6", "m7"]);
  });

  it("records mentions in the activity feed, including @channel", async () => {
    const { owner, bob, wid, cid } = await setup();
    await owner.post(`/channels/${cid}/messages`, { text: "<!channel> 全員確認してください" });
    await owner.post(`/channels/${cid}/messages`, { text: `<@${bob.user.id}> お願いします` });
    const activity = await bob.get<{ items: ActivityItem[] }>(`/workspaces/${wid}/activity`);
    const mentions = activity.body.items.filter((i) => i.kind === "mention");
    expect(mentions.map((i) => i.message.text)).toEqual([
      `<@${bob.user.id}> お願いします`,
      "<!channel> 全員確認してください",
    ]);
  });
});

describe("search", () => {
  it("finds messages with full-text search (English and Japanese) and respects access", async () => {
    const { owner, bob, wid, cid } = await setup();
    await owner.post(`/channels/${cid}/messages`, { text: "The deployment pipeline is green" });
    await owner.post(`/channels/${cid}/messages`, { text: "明日の定例会議は10時からです" });
    await owner.post(`/channels/${cid}/messages`, { text: "会議室を予約しました" });
    const secret = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, {
      name: "secret",
      kind: "private",
    });
    await owner.post(`/channels/${secret.body.channel.id}/messages`, {
      text: "deployment secrets live here",
    });

    const en = await bob.get<{ results: SearchResult[] }>(`/workspaces/${wid}/search?q=deployment`);
    expect(en.body.results.map((r) => r.message.text)).toEqual(["The deployment pipeline is green"]);

    const ownerEn = await owner.get<{ results: SearchResult[] }>(`/workspaces/${wid}/search?q=deployment`);
    expect(ownerEn.body.results).toHaveLength(2);

    const ja = await bob.get<{ results: SearchResult[] }>(`/workspaces/${wid}/search?q=定例会議`);
    expect(ja.body.results.map((r) => r.message.text)).toEqual(["明日の定例会議は10時からです"]);

    // 2-character Japanese terms fall back to LIKE
    const short = await bob.get<{ results: SearchResult[] }>(`/workspaces/${wid}/search?q=会議`);
    expect(short.body.results).toHaveLength(2);

    const from = await bob.get<{ results: SearchResult[] }>(
      `/workspaces/${wid}/search?q=会議&user=${bob.user.id}`,
    );
    expect(from.body.results).toHaveLength(0);
  });
});

describe("forwarding", () => {
  it("shares a message into another conversation with a snapshot of the original", async () => {
    const { owner, bob, wid, cid } = await setup();
    const orig = (
      await owner.post<{ message: Message }>(`/channels/${cid}/messages`, { text: "共有したい内容" })
    ).body.message;
    const dm = await bob.post<{ channel: { id: string } }>(`/workspaces/${wid}/dms`, {
      userIds: [owner.user.id],
    });
    const fwd = await bob.post<{ message: Message }>(`/channels/${dm.body.channel.id}/messages`, {
      text: "これ見ました？",
      sharedMessageId: orig.id,
    });
    expect(fwd.status).toBe(201);
    expect(fwd.body.message.shared).toMatchObject({
      id: orig.id,
      text: "共有したい内容",
      channelName: "general",
    });
    const page = await owner.get<MessagePage>(`/channels/${dm.body.channel.id}/messages`);
    expect(page.body.messages.at(-1)?.shared?.id).toBe(orig.id);

    // Without a comment is fine too; but you cannot forward what you cannot read.
    const secret = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, {
      name: "owners",
      kind: "private",
    });
    const hidden = (
      await owner.post<{ message: Message }>(`/channels/${secret.body.channel.id}/messages`, { text: "秘密" })
    ).body.message;
    const denied = await bob.post(`/channels/${dm.body.channel.id}/messages`, {
      text: "",
      sharedMessageId: hidden.id,
    });
    expect(denied.status).toBe(404);
  });
});

describe("search phrases", () => {
  it("treats quoted text as a phrase", async () => {
    const { owner, wid, cid } = await setup();
    await owner.post(`/channels/${cid}/messages`, { text: "編集後の資料を共有します" });
    await owner.post(`/channels/${cid}/messages`, { text: "資料は編集中です" });
    const r = await owner.get<{ results: SearchResult[] }>(
      `/workspaces/${wid}/search?q=${encodeURIComponent('"編集後"')}`,
    );
    expect(r.body.results.map((x) => x.message.text)).toEqual(["編集後の資料を共有します"]);
  });
});
