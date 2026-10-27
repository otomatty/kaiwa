import { create } from "zustand";
import type {
  Channel,
  Member,
  Message,
  MyChannel,
  Presence,
  Role,
  ScheduledMessage,
  User,
  Workspace,
  WorkspaceSummary,
} from "../../shared/types";

export type Panel =
  | { kind: "thread"; rootId: string }
  | { kind: "profile"; userId: string }
  | { kind: "pins"; channelId: string }
  | null;

export type Modal =
  | { kind: "createChannel"; initialName?: string }
  | { kind: "browseChannels" }
  | { kind: "newMessage" }
  | { kind: "invite" }
  | { kind: "channelDetails"; channelId: string; tab?: "about" | "members" | "settings" }
  | { kind: "editProfile" }
  | { kind: "setStatus" }
  | { kind: "preferences" }
  | { kind: "workspaceSettings" }
  | { kind: "quickSwitcher" }
  | { kind: "shortcuts" }
  | { kind: "createWorkspace" }
  | { kind: "imagePreview"; url: string; name: string }
  | { kind: "forward"; messageId: string }
  | { kind: "customEmoji" }
  | {
      kind: "confirm";
      title: string;
      body: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    };

export type SidebarTab = "home" | "dms" | "activity" | "later";

export interface ChannelMessages {
  ids: string[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface ThreadState {
  replyIds: string[];
  loaded: boolean;
  subscribed: boolean;
  lastReadAt: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

export type LocalMessage = Message & { pending?: "sending" | "failed" };

export interface State {
  authReady: boolean;
  me: User | null;
  workspaces: WorkspaceSummary[];

  wid: string | null;
  workspace: Workspace | null;
  role: Role;
  bootError: string | null;
  members: Record<string, Member>;
  channels: Record<string, MyChannel>;
  /** All channels we know about (including public ones we are not in), for #links. */
  directory: Record<string, Channel>;
  presence: Record<string, Presence>;
  unreadThreads: number;
  /** Workspace custom emoji: name → image URL. */
  customEmoji: Record<string, string>;
  /** My scheduled (send-later) messages in this workspace. */
  scheduled: ScheduledMessage[];

  messages: Record<string, LocalMessage>;
  channelMsgs: Record<string, ChannelMessages>;
  threads: Record<string, ThreadState>;
  typing: Record<string, Record<string, number>>;
  bookmarkVersion: Record<string, number>;
  activityVersion: number;

  panel: Panel;
  modal: Modal | null;
  sidebarTab: SidebarTab;
  mobileSidebar: boolean;
  connection: "connecting" | "online" | "offline";
  toasts: Toast[];
}

export const initialWorkspaceState = {
  wid: null,
  workspace: null,
  role: "member" as Role,
  bootError: null,
  members: {},
  channels: {},
  directory: {},
  presence: {},
  unreadThreads: 0,
  customEmoji: {} as Record<string, string>,
  scheduled: [] as ScheduledMessage[],
  messages: {},
  channelMsgs: {},
  threads: {},
  typing: {},
  bookmarkVersion: {},
  activityVersion: 0,
  panel: null as Panel,
};

export const useStore = create<State>(() => ({
  authReady: false,
  me: null,
  workspaces: [],
  ...initialWorkspaceState,
  modal: null,
  sidebarTab: "home",
  mobileSidebar: false,
  connection: "connecting",
  toasts: [],
}));

export const get = () => useStore.getState();
export const set = useStore.setState;

let toastSeq = 0;
export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(
    () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    tone === "error" ? 6000 : 3500,
  );
}

export function openModal(modal: Modal) {
  set({ modal });
}

export function closeModal() {
  set({ modal: null });
}

// ---------- selectors ----------

export function displayName(userId: string): string {
  const m = get().members[userId];
  if (m) return m.displayName;
  if (get().me?.id === userId) return get().me?.displayName ?? "";
  return "不明なユーザー";
}

/** Name to show for a channel: "#name" for channels, member names for DMs. */
export function channelLabel(
  ch: Pick<Channel, "kind" | "name" | "memberIds">,
  meId: string | undefined,
): string {
  if (ch.kind === "dm" || ch.kind === "group") {
    const others = ch.memberIds.filter((id) => id !== meId);
    if (others.length === 0) return meId ? `${displayName(meId)}（自分）` : "自分";
    return others.map(displayName).join("、");
  }
  return ch.name;
}

export function compareMessages(
  a: Pick<Message, "createdAt" | "id">,
  b: Pick<Message, "createdAt" | "id">,
): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function mentionsMe(m: Message, meId: string): boolean {
  return m.text.includes(`<@${meId}>`) || /<!(here|channel|everyone)>/.test(m.text);
}
