import { toPlainText } from "../../shared/mrkdwn";
import type { ClientEvent, Message, ServerEvent } from "../../shared/types";
import { emojify } from "../lib/emoji";
import { navigate } from "../lib/router";
import {
  currentChannelId,
  dropChannel,
  logout,
  patchMessage,
  refreshChannel,
  refreshUnreadThreads,
  removeMessage,
  resync,
  updateChannel,
  upsertMessages,
} from "./actions";
import { channelLabel, displayName, get, mentionsMe, set, toast } from "./store";

let socket: WebSocket | null = null;
let currentWid: string | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let everConnected = false;

export function connect(wid: string) {
  disconnect();
  currentWid = wid;
  everConnected = false;
  open();
}

export function disconnect() {
  currentWid = null;
  if (retryTimer) clearTimeout(retryTimer);
  if (heartbeat) clearInterval(heartbeat);
  retryTimer = null;
  heartbeat = null;
  if (socket) {
    socket.onclose = null;
    socket.close(1000);
    socket = null;
  }
}

function open() {
  const wid = currentWid;
  if (!wid) return;
  set({ connection: "connecting" });
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/api/workspaces/${wid}/ws`);
  socket = ws;

  ws.onopen = () => {
    retry = 0;
    set({ connection: "online" });
    if (everConnected) void resync();
    everConnected = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 30_000);
    sendIdleState(true);
  };
  ws.onmessage = (ev) => {
    if (ev.data === "pong") return;
    try {
      handle(JSON.parse(ev.data as string) as ServerEvent);
    } catch (err) {
      console.error("bad event", err);
    }
  };
  ws.onclose = (ev) => {
    if (heartbeat) clearInterval(heartbeat);
    if (socket !== ws) return;
    socket = null;
    set({ connection: "offline" });
    if (ev.code === 4003) {
      toast("このワークスペースから削除されました", "error");
      navigate("/");
      return;
    }
    if (!currentWid) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
    retry++;
    retryTimer = setTimeout(open, delay);
  };
}

export function sendEvent(e: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e));
}

// ---------- idle detection (auto-away after 10 minutes) ----------

const IDLE_MS = 10 * 60 * 1000;
let lastActivity = Date.now();
let idle = false;

function sendIdleState(force = false) {
  const nowIdle = Date.now() - lastActivity > IDLE_MS;
  if (force || nowIdle !== idle) {
    idle = nowIdle;
    sendEvent({ type: "presence", away: idle });
  }
}

if (typeof window !== "undefined") {
  const touch = () => {
    lastActivity = Date.now();
    if (idle) sendIdleState();
  };
  for (const evt of ["mousemove", "keydown", "pointerdown", "focus"]) {
    window.addEventListener(evt, touch, { passive: true });
  }
  setInterval(() => sendIdleState(), 60_000);
}

// ---------- notifications ----------

function notify(m: Message) {
  const s = get();
  const me = s.me;
  if (!me || m.userId === me.id || m.subtype) return;
  if (me.dndUntil && me.dndUntil > Date.now()) return;
  const ch = s.channels[m.channelId];
  const isDm = ch?.kind === "dm" || ch?.kind === "group";
  const isMention = mentionsMe(m, me.id);
  const threadFollowed = !!m.threadRootId && (s.threads[m.threadRootId]?.subscribed ?? false);
  if (!isDm && !isMention && !threadFollowed) return;
  if (ch?.muted && !isMention) return;
  const viewing =
    document.visibilityState === "visible" && document.hasFocus() && currentChannelId() === m.channelId;
  if (viewing) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (localStorage.getItem("kaiwa:notifications") === "off") return;
  const title = isDm ? displayName(m.userId) : `#${ch ? channelLabel(ch, me.id) : ""}`;
  const body = emojify(
    toPlainText(m.text, {
      user: displayName,
      channel: (id) => s.directory[id]?.name ?? "channel",
    }),
  );
  const n = new Notification(title, {
    body: isDm ? body : `${displayName(m.userId)}: ${body}`,
    tag: m.id,
    icon: "/favicon.svg",
  });
  n.onclick = () => {
    window.focus();
    const wid = get().wid;
    if (wid) navigate(`/w/${wid}/c/${m.channelId}?msg=${m.id}`);
    n.close();
  };
}

// ---------- event handling ----------

function handle(e: ServerEvent) {
  const s = get();
  const meId = s.me?.id;
  switch (e.type) {
    case "hello":
      set({ presence: e.online });
      return;
    case "presence":
      set((st) => ({ presence: { ...st.presence, [e.userId]: e.presence } }));
      return;
    case "typing": {
      const key = e.threadRootId ? `${e.channelId}:${e.threadRootId}` : e.channelId;
      set((st) => ({
        typing: { ...st.typing, [key]: { ...(st.typing[key] ?? {}), [e.userId]: Date.now() + 6000 } },
      }));
      return;
    }
    case "message.created": {
      const m = e.message;
      // Typing indicator ends when the person posts.
      const key = m.threadRootId ? `${m.channelId}:${m.threadRootId}` : m.channelId;
      if (s.typing[key]?.[m.userId]) {
        set((st) => {
          const t = { ...(st.typing[key] ?? {}) };
          delete t[m.userId];
          return { typing: { ...st.typing, [key]: t } };
        });
      }
      upsertMessages([m]);
      const ch = get().channels[m.channelId];
      if (ch && m.userId !== meId) {
        const inChannel = !m.threadRootId || m.broadcast;
        const patch: Partial<typeof ch> = { hidden: false };
        if (inChannel) {
          patch.latestAt = m.createdAt;
          if (ch.kind === "dm" || ch.kind === "group") {
            patch.latestPreview = { userId: m.userId, text: m.text.slice(0, 200), files: m.files.length };
          }
          if (m.createdAt > ch.lastReadAt && !m.deletedAt && (!m.subtype || m.subtype === "me")) {
            patch.unreadCount = ch.unreadCount + 1;
            if (meId && (mentionsMe(m, meId) || ch.kind === "dm" || ch.kind === "group") && !m.subtype) {
              patch.mentionCount = ch.mentionCount + 1;
            }
          }
        }
        updateChannel(m.channelId, patch);
      } else if (ch && m.userId === meId && (!m.threadRootId || m.broadcast)) {
        updateChannel(m.channelId, {
          latestAt: m.createdAt,
          lastReadAt: Math.max(ch.lastReadAt, m.createdAt),
          latestPreview: { userId: m.userId, text: m.text.slice(0, 200), files: m.files.length },
        });
      } else if (!ch && m.userId !== meId) {
        // A DM/group we haven't loaded yet (e.g. someone just messaged us).
        void refreshChannel(m.channelId);
      }
      if (m.threadRootId && m.userId !== meId) {
        refreshUnreadThreads();
        set((st) => ({ activityVersion: st.activityVersion + 1 }));
      } else if (meId && m.userId !== meId && mentionsMe(m, meId)) {
        set((st) => ({ activityVersion: st.activityVersion + 1 }));
      }
      notify(m);
      return;
    }
    case "message.updated":
      upsertMessages([e.message]);
      return;
    case "message.deleted":
      removeMessage(e.messageId);
      return;
    case "reactions.updated":
      patchMessage(e.messageId, { reactions: e.reactions });
      if (meId && s.messages[e.messageId]?.userId === meId)
        set((st) => ({ activityVersion: st.activityVersion + 1 }));
      return;
    case "pin.updated":
      patchMessage(e.messageId, { pinned: e.pinned });
      return;
    case "channel.upserted": {
      const existing = s.channels[e.channel.id];
      if (existing) {
        updateChannel(e.channel.id, { ...e.channel });
      } else {
        set((st) => ({ directory: { ...st.directory, [e.channel.id]: e.channel } }));
        if (e.channel.kind !== "public" || e.channel.createdBy === meId) void refreshChannel(e.channel.id);
      }
      return;
    }
    case "channel.removed":
      set((st) => {
        const directory = { ...st.directory };
        delete directory[e.channelId];
        return { directory };
      });
      dropChannel(e.channelId);
      return;
    case "channel.member_joined": {
      if (e.userId === meId && !s.channels[e.channelId]) {
        void refreshChannel(e.channelId);
        return;
      }
      const ch = s.channels[e.channelId];
      if (ch) updateChannel(e.channelId, { memberCount: ch.memberCount + 1 });
      return;
    }
    case "channel.member_left": {
      const ch = s.channels[e.channelId];
      if (e.userId === meId) {
        if (ch) {
          set((st) => {
            const channels = { ...st.channels };
            delete channels[e.channelId];
            return { channels };
          });
        }
        return;
      }
      if (ch) updateChannel(e.channelId, { memberCount: Math.max(0, ch.memberCount - 1) });
      return;
    }
    case "channel.read": {
      const ch = s.channels[e.channelId];
      if (!ch) return;
      if (e.lastReadAt >= (ch.latestAt ?? 0))
        updateChannel(e.channelId, { lastReadAt: e.lastReadAt, unreadCount: 0, mentionCount: 0 });
      else void refreshChannel(e.channelId);
      return;
    }
    case "channel.prefs":
      updateChannel(e.channelId, { starred: e.starred, muted: e.muted, hidden: e.hidden });
      return;
    case "thread.read":
      set((st) => {
        const t = st.threads[e.rootId];
        return t ? { threads: { ...st.threads, [e.rootId]: { ...t, lastReadAt: e.lastReadAt } } } : {};
      });
      refreshUnreadThreads();
      return;
    case "bookmarks.updated":
      set((st) => ({
        bookmarkVersion: { ...st.bookmarkVersion, [e.channelId]: (st.bookmarkVersion[e.channelId] ?? 0) + 1 },
      }));
      return;
    case "member.upserted":
      set((st) => ({
        members: { ...st.members, [e.member.id]: e.member },
        me: st.me && st.me.id === e.member.id ? { ...st.me, ...e.member } : st.me,
      }));
      if (e.member.id === meId) set((st) => ({ role: e.member.role, workspaces: st.workspaces }));
      return;
    case "member.removed":
      if (e.userId === meId) {
        toast("このワークスペースから削除されました", "error");
        void logoutIfNoWorkspace();
        return;
      }
      set((st) => {
        const members = { ...st.members };
        delete members[e.userId];
        return { members };
      });
      return;
    case "workspace.updated":
      set((st) => ({
        workspace: e.workspace,
        workspaces: st.workspaces.map((w) =>
          w.id === e.workspace.id ? { ...w, name: e.workspace.name } : w,
        ),
      }));
      return;
  }
}

async function logoutIfNoWorkspace() {
  const s = get();
  const rest = s.workspaces.filter((w) => w.id !== s.wid);
  set({ workspaces: rest });
  if (rest[0]) navigate(`/w/${rest[0].id}`);
  else if (s.me) navigate("/new");
  else await logout();
}

// Expire typing indicators.
if (typeof window !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    const typing = get().typing;
    let changed = false;
    const next: typeof typing = {};
    for (const [key, users] of Object.entries(typing)) {
      const alive = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now));
      if (Object.keys(alive).length !== Object.keys(users).length) changed = true;
      if (Object.keys(alive).length > 0) next[key] = alive;
    }
    if (changed) set({ typing: next });
  }, 1500);
}
