import type { Channel, Message, MyChannel, Reaction } from "../../shared/types";
import { ApiError, api } from "../lib/api";
import { encodeLinks, encodeMentions } from "../lib/compose";
import { navigate, routes } from "../lib/router";
import {
  type ChannelMessages,
  compareMessages,
  get,
  initialWorkspaceState,
  type LocalMessage,
  set,
  toast,
} from "./store";

export function reportError(err: unknown, fallback = "エラーが発生しました") {
  const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
  toast(msg || fallback, "error");
}

// ---------- session ----------

export async function loadSession() {
  try {
    const r = await api.me();
    set({ me: r.user, workspaces: r.workspaces, authReady: true });
  } catch {
    set({ authReady: true });
  }
}

export async function logout() {
  await api.logout().catch(() => undefined);
  set({ me: null, workspaces: [], ...initialWorkspaceState });
  navigate("/login");
}

// ---------- workspace ----------

export async function bootWorkspace(wid: string) {
  set({ ...initialWorkspaceState, wid });
  try {
    const b = await api.bootstrap(wid);
    if (get().wid !== wid) return;
    const channels: Record<string, MyChannel> = {};
    const directory: Record<string, Channel> = {};
    for (const c of b.channels) {
      channels[c.id] = c;
      directory[c.id] = c;
    }
    set({
      workspace: b.workspace,
      role: b.role,
      members: Object.fromEntries(b.members.map((m) => [m.id, m])),
      channels,
      directory,
      presence: b.online,
      unreadThreads: b.unreadThreads,
    });
    // Learn names of public channels we're not in (for #channel links).
    api
      .browseChannels(wid)
      .then((r) => {
        set((s) => {
          const dir = { ...s.directory };
          for (const c of r.channels) {
            if (!dir[c.id]) {
              dir[c.id] = {
                id: c.id,
                workspaceId: wid,
                kind: c.kind,
                name: c.name,
                topic: c.topic,
                description: c.description,
                isDefault: false,
                createdBy: "",
                createdAt: c.createdAt,
                archivedAt: c.archivedAt,
                memberCount: c.memberCount,
                memberIds: [],
              };
            }
          }
          return { directory: dir };
        });
      })
      .catch(() => undefined);
  } catch (err) {
    set({ bootError: err instanceof ApiError ? err.message : "読み込みに失敗しました" });
  }
}

/** Re-sync after a dropped connection: refresh sidebar state and fill message gaps. */
export async function resync() {
  const wid = get().wid;
  if (!wid) return;
  try {
    const b = await api.bootstrap(wid);
    if (get().wid !== wid) return;
    set((s) => {
      const channels: Record<string, MyChannel> = {};
      for (const c of b.channels) channels[c.id] = c;
      return {
        channels,
        members: Object.fromEntries(b.members.map((m) => [m.id, m])),
        presence: b.online,
        unreadThreads: b.unreadThreads,
        workspace: b.workspace,
        role: b.role,
        directory: { ...s.directory, ...channels },
      };
    });
    // Loaded channels may have missed messages; drop their caches so they reload on view.
    const active = currentChannelId();
    set((s) => {
      const channelMsgs: Record<string, ChannelMessages> = {};
      if (active && s.channelMsgs[active]) channelMsgs[active] = s.channelMsgs[active];
      return { channelMsgs, threads: {} };
    });
    if (active) await catchUp(active);
  } catch {
    // will retry on next reconnect
  }
}

export function currentChannelId(): string | null {
  const m = /^\/w\/[^/]+\/c\/([^/?]+)/.exec(window.location.pathname);
  return m?.[1] ?? null;
}

// ---------- messages ----------

function sortIds(ids: string[], messages: Record<string, LocalMessage>): string[] {
  return [...new Set(ids)]
    .filter((id) => messages[id])
    .sort((a, b) => compareMessages(messages[a] as Message, messages[b] as Message));
}

function mergeMessage(existing: LocalMessage | undefined, incoming: Message): LocalMessage {
  if (!existing) return incoming;
  // `saved` is per-viewer; broadcasts always carry false.
  return { ...existing, ...incoming, saved: incoming.saved || existing.saved, pending: undefined };
}

export function upsertMessages(list: Message[], opts: { intoChannel?: boolean } = {}) {
  if (list.length === 0) return;
  set((s) => {
    const messages = { ...s.messages };
    const channelMsgs = { ...s.channelMsgs };
    const threads = { ...s.threads };
    for (const m of list) {
      // Replace an optimistic copy if this is the server echo.
      if (m.clientMsgId) {
        const tmpId = `tmp-${m.clientMsgId}`;
        if (messages[tmpId]) {
          delete messages[tmpId];
          for (const [cid, st] of Object.entries(channelMsgs)) {
            if (st.ids.includes(tmpId)) channelMsgs[cid] = { ...st, ids: st.ids.filter((x) => x !== tmpId) };
          }
          for (const [rid, st] of Object.entries(threads)) {
            if (st.replyIds.includes(tmpId))
              threads[rid] = { ...st, replyIds: st.replyIds.filter((x) => x !== tmpId) };
          }
        }
      }
      messages[m.id] = mergeMessage(messages[m.id], m);
      const inChannel = !m.threadRootId || m.broadcast;
      const cm = channelMsgs[m.channelId];
      if (inChannel && cm?.loaded && (opts.intoChannel || !cm.hasMoreAfter)) {
        if (!cm.ids.includes(m.id)) channelMsgs[m.channelId] = { ...cm, ids: [...cm.ids, m.id] };
      }
      if (m.threadRootId) {
        const t = threads[m.threadRootId];
        if (t?.loaded && !t.replyIds.includes(m.id))
          threads[m.threadRootId] = { ...t, replyIds: [...t.replyIds, m.id] };
      }
    }
    for (const [cid, st] of Object.entries(channelMsgs)) {
      if (st !== s.channelMsgs[cid]) channelMsgs[cid] = { ...st, ids: sortIds(st.ids, messages) };
    }
    for (const [rid, st] of Object.entries(threads)) {
      if (st !== s.threads[rid]) threads[rid] = { ...st, replyIds: sortIds(st.replyIds, messages) };
    }
    return { messages, channelMsgs, threads };
  });
}

export function removeMessage(id: string) {
  set((s) => {
    const messages = { ...s.messages };
    delete messages[id];
    const channelMsgs = { ...s.channelMsgs };
    for (const [cid, st] of Object.entries(channelMsgs)) {
      if (st.ids.includes(id)) channelMsgs[cid] = { ...st, ids: st.ids.filter((x) => x !== id) };
    }
    const threads = { ...s.threads };
    for (const [rid, st] of Object.entries(threads)) {
      if (st.replyIds.includes(id)) threads[rid] = { ...st, replyIds: st.replyIds.filter((x) => x !== id) };
    }
    const panel = s.panel?.kind === "thread" && s.panel.rootId === id ? null : s.panel;
    return { messages, channelMsgs, threads, panel };
  });
}

export function patchMessage(id: string, patch: Partial<LocalMessage>) {
  set((s) => {
    const m = s.messages[id];
    if (!m) return {};
    return { messages: { ...s.messages, [id]: { ...m, ...patch } } };
  });
}

const emptyChannel: ChannelMessages = {
  ids: [],
  hasMoreBefore: true,
  hasMoreAfter: false,
  loading: false,
  loaded: false,
};

function setChannelMsgs(cid: string, patch: Partial<ChannelMessages>) {
  set((s) => ({
    channelMsgs: { ...s.channelMsgs, [cid]: { ...(s.channelMsgs[cid] ?? emptyChannel), ...patch } },
  }));
}

export async function loadLatest(cid: string) {
  const st = get().channelMsgs[cid];
  if (st?.loading) return;
  setChannelMsgs(cid, { loading: true });
  try {
    const page = await api.messages(cid, { limit: 50 });
    upsertMessages(page.messages);
    setChannelMsgs(cid, {
      ids: sortIds(
        page.messages.map((m) => m.id),
        get().messages,
      ),
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: false,
      loaded: true,
      loading: false,
    });
  } catch (err) {
    setChannelMsgs(cid, { loading: false });
    throw err;
  }
}

export async function loadAround(cid: string, messageId: string) {
  setChannelMsgs(cid, { loading: true });
  try {
    const page = await api.messages(cid, { around: messageId, limit: 50 });
    upsertMessages(page.messages);
    setChannelMsgs(cid, {
      ids: sortIds(
        page.messages.map((m) => m.id),
        get().messages,
      ),
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: page.hasMoreAfter,
      loaded: true,
      loading: false,
    });
  } catch (err) {
    setChannelMsgs(cid, { loading: false });
    throw err;
  }
}

export async function loadOlder(cid: string) {
  const st = get().channelMsgs[cid];
  if (!st || st.loading || !st.hasMoreBefore) return;
  const first = st.ids.find((id) => !id.startsWith("tmp-"));
  if (!first) return;
  setChannelMsgs(cid, { loading: true });
  try {
    const page = await api.messages(cid, { before: first, limit: 50 });
    upsertMessages(page.messages);
    const cur = get().channelMsgs[cid] ?? emptyChannel;
    setChannelMsgs(cid, {
      ids: sortIds([...page.messages.map((m) => m.id), ...cur.ids], get().messages),
      hasMoreBefore: page.hasMoreBefore,
      loading: false,
    });
  } catch (err) {
    setChannelMsgs(cid, { loading: false });
    reportError(err);
  }
}

export async function loadNewer(cid: string) {
  const st = get().channelMsgs[cid];
  if (!st || st.loading || !st.hasMoreAfter) return;
  const last = [...st.ids].reverse().find((id) => !id.startsWith("tmp-"));
  if (!last) return;
  setChannelMsgs(cid, { loading: true });
  try {
    const page = await api.messages(cid, { after: last, limit: 50 });
    upsertMessages(page.messages);
    const cur = get().channelMsgs[cid] ?? emptyChannel;
    setChannelMsgs(cid, {
      ids: sortIds([...cur.ids, ...page.messages.map((m) => m.id)], get().messages),
      hasMoreAfter: page.hasMoreAfter,
      loading: false,
    });
  } catch (err) {
    setChannelMsgs(cid, { loading: false });
    reportError(err);
  }
}

/** After reconnecting, fetch anything newer than what we have. */
async function catchUp(cid: string) {
  const st = get().channelMsgs[cid];
  if (!st?.loaded) return;
  const last = [...st.ids].reverse().find((id) => !id.startsWith("tmp-"));
  if (!last) return loadLatest(cid);
  const page = await api.messages(cid, { after: last, limit: 100 });
  if (page.hasMoreAfter) return loadLatest(cid);
  upsertMessages(page.messages);
}

export async function loadThread(rootId: string) {
  const view = await api.thread(rootId);
  upsertMessages([view.root, ...view.replies]);
  set((s) => ({
    threads: {
      ...s.threads,
      [view.root.id]: {
        replyIds: view.replies.map((r) => r.id),
        loaded: true,
        subscribed: view.subscribed,
        lastReadAt: view.lastReadAt,
      },
    },
  }));
}

function memberRefs() {
  const s = get();
  const users = Object.values(s.members).map((m) => ({ id: m.id, name: m.displayName }));
  const channels = Object.values(s.directory)
    .filter((c) => c.kind === "public" || c.kind === "private")
    .map((c) => ({ id: c.id, name: c.name }));
  return { users, channels };
}

export function encodeOutgoing(text: string): string {
  const { users, channels } = memberRefs();
  return encodeMentions(encodeLinks(text), users, channels);
}

export async function sendMessage(
  cid: string,
  rawText: string,
  opts: {
    threadRootId?: string | null;
    broadcast?: boolean;
    fileIds?: string[];
    files?: Message["files"];
    subtype?: "me";
  } = {},
) {
  const s = get();
  const me = s.me;
  if (!me || !s.wid) return;
  const text = encodeOutgoing(rawText);
  const clientMsgId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const tmpId = `tmp-${clientMsgId}`;
  const now = Date.now();
  const optimistic: LocalMessage = {
    id: tmpId,
    workspaceId: s.wid,
    channelId: cid,
    userId: me.id,
    text,
    subtype: opts.subtype ?? null,
    threadRootId: opts.threadRootId ?? null,
    broadcast: !!opts.broadcast,
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    createdAt: now,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    files: opts.files ?? [],
    pinned: false,
    saved: false,
    clientMsgId,
    pending: "sending",
  };
  // Make sure we are looking at the latest page so the new message is visible.
  const cm = get().channelMsgs[cid];
  if (cm?.hasMoreAfter && (!opts.threadRootId || opts.broadcast)) await loadLatest(cid);
  set((st) => {
    const messages = { ...st.messages, [tmpId]: optimistic };
    const channelMsgs = { ...st.channelMsgs };
    const threads = { ...st.threads };
    const inChannel = !opts.threadRootId || opts.broadcast;
    const c = channelMsgs[cid];
    if (inChannel && c?.loaded) channelMsgs[cid] = { ...c, ids: [...c.ids, tmpId] };
    if (opts.threadRootId) {
      const t = threads[opts.threadRootId];
      if (t) threads[opts.threadRootId] = { ...t, replyIds: [...t.replyIds, tmpId], subscribed: true };
    }
    return { messages, channelMsgs, threads };
  });
  try {
    const r = await api.postMessage(cid, {
      text,
      threadRootId: opts.threadRootId ?? null,
      broadcast: opts.broadcast,
      fileIds: opts.fileIds,
      clientMsgId,
      subtype: opts.subtype,
    });
    upsertMessages([r.message], { intoChannel: true });
    if (!opts.threadRootId || opts.broadcast) {
      set((st) => {
        const ch = st.channels[cid];
        if (!ch) return {};
        return {
          channels: {
            ...st.channels,
            [cid]: {
              ...ch,
              lastReadAt: Math.max(ch.lastReadAt, r.message.createdAt),
              latestAt: r.message.createdAt,
              hidden: false,
            },
          },
        };
      });
    }
  } catch (err) {
    patchMessage(tmpId, { pending: "failed" });
    reportError(err, "メッセージを送信できませんでした");
  }
}

export async function retryMessage(tmpId: string) {
  const m = get().messages[tmpId];
  if (!m) return;
  removeMessage(tmpId);
  await sendMessage(m.channelId, m.text, {
    threadRootId: m.threadRootId,
    broadcast: m.broadcast,
    fileIds: m.files.map((f) => f.id),
    files: m.files,
    subtype: m.subtype === "me" ? "me" : undefined,
  });
}

export async function editMessage(id: string, rawText: string) {
  const text = encodeOutgoing(rawText);
  const prev = get().messages[id];
  if (!prev || prev.text === text) return;
  patchMessage(id, { text, editedAt: Date.now() });
  try {
    const r = await api.editMessage(id, text);
    upsertMessages([r.message]);
  } catch (err) {
    patchMessage(id, { text: prev.text, editedAt: prev.editedAt });
    reportError(err);
  }
}

export async function deleteMessage(id: string) {
  if (id.startsWith("tmp-")) return removeMessage(id);
  const prev = get().messages[id];
  try {
    await api.deleteMessage(id);
    if (prev && prev.replyCount > 0) patchMessage(id, { deletedAt: Date.now(), text: "" });
    else removeMessage(id);
  } catch (err) {
    reportError(err);
  }
}

export async function toggleReaction(id: string, emoji: string) {
  const s = get();
  const m = s.messages[id];
  const me = s.me;
  if (!m || !me) return;
  const has = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me.id) ?? false;
  const next: Reaction[] = has
    ? m.reactions
        .map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((u) => u !== me.id) } : r))
        .filter((r) => r.userIds.length > 0)
    : m.reactions.some((r) => r.emoji === emoji)
      ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, me.id] } : r))
      : [...m.reactions, { emoji, userIds: [me.id] }];
  patchMessage(id, { reactions: next });
  try {
    const r = has ? await api.unreact(id, emoji) : await api.react(id, emoji);
    patchMessage(id, { reactions: r.reactions });
  } catch (err) {
    patchMessage(id, { reactions: m.reactions });
    reportError(err);
  }
}

export async function togglePin(id: string) {
  const m = get().messages[id];
  if (!m) return;
  patchMessage(id, { pinned: !m.pinned });
  try {
    if (m.pinned) await api.unpin(id);
    else await api.pin(id);
    toast(m.pinned ? "ピン留めを外しました" : "チャンネルにピン留めしました");
  } catch (err) {
    patchMessage(id, { pinned: m.pinned });
    reportError(err);
  }
}

export async function toggleSaved(id: string) {
  const m = get().messages[id];
  if (!m) return;
  patchMessage(id, { saved: !m.saved });
  try {
    if (m.saved) await api.unsave(id);
    else await api.save(id);
    toast(m.saved ? "「後で」から削除しました" : "「後で」に保存しました");
    set((s) => ({ activityVersion: s.activityVersion + 1 }));
  } catch (err) {
    patchMessage(id, { saved: m.saved });
    reportError(err);
  }
}

// ---------- read state ----------

const readTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function markChannelRead(cid: string, ts: number) {
  const ch = get().channels[cid];
  if (!ch || ts <= ch.lastReadAt) {
    if (ch && (ch.unreadCount > 0 || ch.mentionCount > 0) && ts >= (ch.latestAt ?? 0)) {
      updateChannel(cid, { unreadCount: 0, mentionCount: 0 });
    }
    return;
  }
  updateChannel(cid, { lastReadAt: ts, unreadCount: 0, mentionCount: 0 });
  const prev = readTimers.get(cid);
  if (prev) clearTimeout(prev);
  readTimers.set(
    cid,
    setTimeout(() => {
      readTimers.delete(cid);
      api.markRead(cid, ts).catch(() => undefined);
    }, 400),
  );
}

export async function markUnread(id: string) {
  const m = get().messages[id];
  if (!m) return;
  try {
    await api.markUnread(id);
    if (m.threadRootId) {
      set((s) => {
        const t = s.threads[m.threadRootId as string];
        return t
          ? { threads: { ...s.threads, [m.threadRootId as string]: { ...t, lastReadAt: m.createdAt - 1 } } }
          : {};
      });
    } else {
      await refreshChannel(m.channelId);
      suppressAutoRead(m.channelId);
    }
    toast("未読にしました");
  } catch (err) {
    reportError(err);
  }
}

/** After "mark unread" we must not immediately re-mark the channel as read. */
const autoReadSuppressed = new Set<string>();
export function suppressAutoRead(cid: string) {
  autoReadSuppressed.add(cid);
}
export function isAutoReadSuppressed(cid: string) {
  return autoReadSuppressed.has(cid);
}
export function clearAutoReadSuppression(cid: string) {
  autoReadSuppressed.delete(cid);
}

export function markThreadRead(rootId: string, ts: number) {
  set((s) => {
    const t = s.threads[rootId];
    if (!t || ts <= t.lastReadAt) return {};
    return { threads: { ...s.threads, [rootId]: { ...t, lastReadAt: ts } } };
  });
  api
    .threadRead(rootId, ts)
    .then(() => refreshUnreadThreads())
    .catch(() => undefined);
}

let unreadThreadsTimer: ReturnType<typeof setTimeout> | null = null;
export function refreshUnreadThreads() {
  if (unreadThreadsTimer) clearTimeout(unreadThreadsTimer);
  unreadThreadsTimer = setTimeout(async () => {
    const wid = get().wid;
    if (!wid) return;
    try {
      const r = await api.threads(wid);
      set({ unreadThreads: r.threads.filter((t) => t.unreadCount > 0).length });
    } catch {
      // ignore
    }
  }, 600);
}

// ---------- channels ----------

export function updateChannel(cid: string, patch: Partial<MyChannel>) {
  set((s) => {
    const ch = s.channels[cid];
    if (!ch) return {};
    const next = { ...ch, ...patch };
    return { channels: { ...s.channels, [cid]: next }, directory: { ...s.directory, [cid]: next } };
  });
}

export function addChannel(ch: MyChannel) {
  set((s) => ({ channels: { ...s.channels, [ch.id]: ch }, directory: { ...s.directory, [ch.id]: ch } }));
}

export function dropChannel(cid: string) {
  set((s) => {
    const channels = { ...s.channels };
    delete channels[cid];
    const channelMsgs = { ...s.channelMsgs };
    delete channelMsgs[cid];
    return { channels, channelMsgs };
  });
  if (currentChannelId() === cid) goToDefaultChannel();
}

export async function refreshChannel(cid: string) {
  try {
    const r = await api.channel(cid);
    if (r.channel.isMember) addChannel(r.channel);
    else set((s) => ({ directory: { ...s.directory, [cid]: r.channel } }));
    return r;
  } catch {
    return null;
  }
}

export function goToDefaultChannel() {
  const s = get();
  if (!s.wid) return;
  const chans = Object.values(s.channels);
  const general =
    chans.find((c) => c.isDefault && c.name === "general") ?? chans.find((c) => c.kind === "public");
  if (general) navigate(routes.channel(s.wid, general.id), { replace: true });
}

export async function openDm(userIds: string[]) {
  const wid = get().wid;
  if (!wid) return;
  try {
    const r = await api.openDm(wid, userIds);
    addChannel({ ...r.channel, hidden: false });
    set({ sidebarTab: get().sidebarTab === "dms" ? "dms" : "home", panel: null, mobileSidebar: false });
    navigate(routes.channel(wid, r.channel.id));
  } catch (err) {
    reportError(err);
  }
}

export async function joinChannel(cid: string) {
  try {
    const r = await api.joinChannel(cid);
    addChannel(r.channel);
    return r.channel;
  } catch (err) {
    reportError(err);
    return null;
  }
}

export async function leaveChannel(cid: string) {
  const ch = get().channels[cid];
  try {
    await api.leaveChannel(cid);
    if (ch?.kind === "private") dropChannel(cid);
    else {
      set((s) => {
        const channels = { ...s.channels };
        delete channels[cid];
        return { channels };
      });
      if (currentChannelId() === cid) goToDefaultChannel();
    }
    toast(`#${ch?.name ?? ""} から退出しました`);
  } catch (err) {
    reportError(err);
  }
}

export async function setChannelPrefs(
  cid: string,
  prefs: { starred?: boolean; muted?: boolean; hidden?: boolean },
) {
  updateChannel(cid, prefs);
  try {
    await api.channelPrefs(cid, prefs);
  } catch (err) {
    reportError(err);
  }
}

export function openThread(rootId: string) {
  set({ panel: { kind: "thread", rootId } });
}

export function openProfile(userId: string) {
  set({ panel: { kind: "profile", userId } });
}
