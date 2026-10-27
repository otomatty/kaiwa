import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, MessagePage } from "../../shared/types";

const pending: { resolve: (p: MessagePage) => void }[] = [];
vi.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  api: {
    messages: () =>
      new Promise<MessagePage>((resolve) => {
        pending.push({ resolve });
      }),
  },
}));

const { loadLatest, upsertMessages } = await import("./actions");
const { useStore, initialWorkspaceState } = await import("./store");

function msg(id: string, createdAt: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    workspaceId: "T1",
    channelId: "C1",
    userId: "U1",
    text: id,
    subtype: null,
    threadRootId: null,
    broadcast: false,
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    files: [],
    pinned: false,
    saved: false,
    shared: null,
    ...extra,
  };
}

describe("message store", () => {
  beforeEach(() => {
    useStore.setState({ ...initialWorkspaceState, wid: "T1" });
    pending.length = 0;
  });

  it("keeps messages that arrive over the socket while history is loading", async () => {
    const load = loadLatest("C1");
    // A realtime message arrives before the history request resolves.
    upsertMessages([msg("M3", 3000)]);
    pending[0]?.resolve({
      messages: [msg("M1", 1000), msg("M2", 2000)],
      hasMoreBefore: false,
      hasMoreAfter: false,
    });
    await load;
    expect(useStore.getState().channelMsgs.C1?.ids).toEqual(["M1", "M2", "M3"]);
  });

  it("inserts new messages in order and replaces optimistic copies", async () => {
    const load = loadLatest("C1");
    pending[0]?.resolve({ messages: [msg("M1", 1000)], hasMoreBefore: false, hasMoreAfter: false });
    await load;
    useStore.setState((s) => ({
      messages: { ...s.messages, "tmp-abc": { ...msg("tmp-abc", 5000), pending: "sending" } },
      channelMsgs: {
        ...s.channelMsgs,
        C1: { ...(s.channelMsgs.C1 as NonNullable<typeof s.channelMsgs.C1>), ids: ["M1", "tmp-abc"] },
      },
    }));
    upsertMessages([msg("M0", 500), msg("M5", 5000, { clientMsgId: "abc" })]);
    const st = useStore.getState();
    expect(st.channelMsgs.C1?.ids).toEqual(["M0", "M1", "M5"]);
    expect(st.messages["tmp-abc"]).toBeUndefined();
  });

  it("does not put thread replies into the channel list unless broadcast", async () => {
    const load = loadLatest("C1");
    pending[0]?.resolve({ messages: [msg("M1", 1000)], hasMoreBefore: false, hasMoreAfter: false });
    await load;
    upsertMessages([
      msg("R1", 2000, { threadRootId: "M1" }),
      msg("R2", 3000, { threadRootId: "M1", broadcast: true }),
    ]);
    expect(useStore.getState().channelMsgs.C1?.ids).toEqual(["M1", "R2"]);
  });
});
