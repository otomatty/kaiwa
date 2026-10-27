import {
  AtSign,
  Bell,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileText,
  Hash,
  House,
  Inbox,
  Lock,
  MessageSquareText,
  MessagesSquare,
  Pencil,
  Plus,
  SquarePen,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toPlainText } from "../../shared/mrkdwn";
import type { MyChannel } from "../../shared/types";
import { api } from "../lib/api";
import { emojify } from "../lib/emoji";
import { formatRelative } from "../lib/format";
import { navigate, routes, usePath } from "../lib/router";
import { leaveChannel, logout, markChannelRead, reportError, setChannelPrefs } from "../store/actions";
import {
  channelLabel,
  displayName,
  get,
  openModal,
  type SidebarTab,
  set,
  toast,
  useStore,
} from "../store/store";
import { ActivityList, SavedList } from "./Lists";
import { Emoji } from "./MessageText";
import { Avatar, cx, DndIcon, MenuItem, MenuSeparator, Popover, PresenceDot, usePresence } from "./ui";

function useDrafts(): Set<string> {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const read = () => {
      const s = new Set<string>();
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith("kaiwa:draft:")) s.add(k.slice("kaiwa:draft:".length).split(":")[0] as string);
        }
      } catch {
        // ignore
      }
      setKeys(s);
    };
    read();
    window.addEventListener("kaiwa:drafts", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("kaiwa:drafts", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return keys;
}

export function WorkspaceRail() {
  const workspaces = useStore((s) => s.workspaces);
  const wid = useStore((s) => s.wid);
  const tab = useStore((s) => s.sidebarTab);
  const me = useStore((s) => s.me);
  const channels = useStore((s) => s.channels);
  const unreadThreads = useStore((s) => s.unreadThreads);
  const presence = usePresence(me?.id);
  const [menu, setMenu] = useState(false);
  const meRef = useRef<HTMLButtonElement>(null);

  const dmBadge = Object.values(channels).filter(
    (c) => (c.kind === "dm" || c.kind === "group") && !c.hidden && c.unreadCount > 0 && !c.muted,
  ).length;
  const homeUnread = Object.values(channels).some(
    (c) => (c.kind === "public" || c.kind === "private") && c.unreadCount > 0 && !c.muted,
  );
  const mentions = Object.values(channels)
    .filter((c) => c.kind === "public" || c.kind === "private")
    .reduce((n, c) => n + c.mentionCount, 0);

  const tabs: { id: SidebarTab; label: string; icon: React.ReactNode; badge?: number; dot?: boolean }[] = [
    { id: "home", label: "ホーム", icon: <House size={20} />, badge: mentions || undefined, dot: homeUnread },
    { id: "dms", label: "DM", icon: <MessagesSquare size={20} />, badge: dmBadge || undefined },
    { id: "activity", label: "アクティビティ", icon: <Bell size={20} />, dot: unreadThreads > 0 },
    { id: "later", label: "後で", icon: <Bookmark size={20} /> },
  ];

  return (
    <nav
      aria-label="ワークスペース"
      className="flex w-[78px] shrink-0 flex-col items-center gap-3 bg-rail py-3 text-sidebar-fg"
    >
      <div className="flex flex-col items-center gap-2">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            title={w.name}
            aria-label={`${w.name} に切り替え`}
            onClick={() => navigate(`/w/${w.id}`)}
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-lg font-bold text-[16px] text-white transition",
              w.id === wid
                ? "ring-2 ring-white ring-offset-2 ring-offset-rail"
                : "opacity-70 hover:opacity-100",
            )}
            style={{ background: w.iconColor }}
          >
            {[...w.name][0]?.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          title="ワークスペースを追加"
          aria-label="ワークスペースを追加"
          onClick={() => openModal({ kind: "createWorkspace" })}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="mt-2 flex flex-col items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => set({ sidebarTab: t.id, mobileSidebar: true })}
            aria-label={
              t.badge ? `${t.label}（未読 ${t.badge}件）` : t.dot ? `${t.label}（新着あり）` : t.label
            }
            className="group flex w-[76px] flex-col items-center gap-0.5 py-1 text-[10px] tracking-tight whitespace-nowrap"
            aria-current={tab === t.id ? "page" : undefined}
          >
            <span
              className={cx(
                "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                tab === t.id ? "bg-white/20 text-white" : "group-hover:bg-white/10",
              )}
            >
              {t.icon}
              {t.badge ? (
                <span className="absolute -top-1 -right-1.5 min-w-[18px] rounded-full bg-badge px-1 text-center font-bold text-[11px] text-white leading-[18px] ring-2 ring-rail">
                  {t.badge}
                </span>
              ) : t.dot ? (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-white ring-2 ring-rail" />
              ) : null}
            </span>
            <span className={cx(tab === t.id ? "font-bold text-white" : "")}>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-auto">
        <button
          ref={meRef}
          type="button"
          aria-label="自分のメニュー"
          onClick={() => setMenu(true)}
          className="relative"
        >
          <Avatar user={me ?? undefined} size={36} presence={presence} ring="var(--rail)" />
        </button>
        {menu && me && (
          <Popover
            anchor={meRef}
            onClose={() => setMenu(false)}
            placement="right-start"
            className="w-72 py-2"
          >
            <UserMenu onClose={() => setMenu(false)} />
          </Popover>
        )}
      </div>
    </nav>
  );
}

function UserMenu({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const presence = usePresence(me?.id);
  if (!me) return null;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div role="menu">
      <div className="flex items-center gap-3 px-5 pt-2 pb-3">
        <Avatar user={me} size={36} />
        <div className="min-w-0">
          <p className="truncate font-bold">{me.displayName}</p>
          <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
            <PresenceDot presence={presence} size={9} /> {presence === "active" ? "アクティブ" : "離席中"}
          </p>
        </div>
      </div>
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={run(() => openModal({ kind: "setStatus" }))}
          className="flex w-full items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-left text-[14px] text-fg-muted hover:border-fg-subtle"
        >
          {me.statusEmoji ? <Emoji name={me.statusEmoji} size={16} /> : <span>🙂</span>}
          <span className="truncate">{me.statusText || "ステータスを更新する"}</span>
        </button>
      </div>
      <MenuItem
        onClick={run(async () => {
          try {
            await api.updateMe({ away: !me.away });
            set((s) => ({ me: s.me ? { ...s.me, away: !me.away } : s.me }));
          } catch (err) {
            reportError(err);
          }
        })}
      >
        {me.away ? "自分をアクティブに設定する" : "自分を離席中に設定する"}
      </MenuItem>
      <DndMenu onDone={onClose} />
      <MenuSeparator />
      <MenuItem onClick={run(() => set({ panel: { kind: "profile", userId: me.id } }))}>
        プロフィール
      </MenuItem>
      <MenuItem onClick={run(() => openModal({ kind: "preferences" }))}>環境設定</MenuItem>
      <MenuItem onClick={run(() => openModal({ kind: "shortcuts" }))} hint="Ctrl+/">
        キーボードショートカット
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run(() => void logout())}>サインアウト</MenuItem>
    </div>
  );
}

function DndMenu({ onDone }: { onDone: () => void }) {
  const me = useStore((s) => s.me);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const active = !!me.dndUntil && me.dndUntil > Date.now();
  const setDnd = async (until: number | null) => {
    onDone();
    try {
      const r = await api.updateMe({ dndUntil: until });
      set({ me: r.user });
      toast(until ? "通知を一時停止しました" : "通知を再開しました");
    } catch (err) {
      reportError(err);
    }
  };
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };
  if (active) {
    return (
      <>
        <p className="px-5 pt-1 text-[12px] text-fg-muted">
          通知を一時停止中（
          {new Date(me.dndUntil as number).toLocaleString("ja-JP", {
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          まで）
        </p>
        <MenuItem onClick={() => void setDnd(null)}>通知を再開する</MenuItem>
      </>
    );
  }
  return open ? (
    <>
      <p className="px-5 pt-1 pb-0.5 text-[12px] text-fg-muted">通知を一時停止する</p>
      {(
        [
          ["30分", 30],
          ["1時間", 60],
          ["2時間", 120],
        ] as const
      ).map(([label, min]) => (
        <MenuItem key={label} onClick={() => void setDnd(Date.now() + min * 60_000)}>
          <span className="pl-3">{label}</span>
        </MenuItem>
      ))}
      <MenuItem onClick={() => void setDnd(tomorrow())}>
        <span className="pl-3">明日まで</span>
      </MenuItem>
    </>
  ) : (
    <MenuItem onClick={() => setOpen(true)}>通知を一時停止する…</MenuItem>
  );
}

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const workspace = useStore((s) => s.workspace);
  const [menu, setMenu] = useState(false);
  const headerRef = useRef<HTMLButtonElement>(null);
  const role = useStore((s) => s.role);
  const title =
    tab === "home"
      ? workspace?.name
      : tab === "dms"
        ? "ダイレクトメッセージ"
        : tab === "activity"
          ? "アクティビティ"
          : "後で";
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-fg md:w-[264px]">
      <div className="flex h-[49px] shrink-0 items-center justify-between gap-2 border-white/10 border-b px-3">
        {tab === "home" ? (
          <button
            ref={headerRef}
            type="button"
            onClick={() => setMenu(true)}
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 font-bold text-[17px] text-sidebar-strong hover:bg-sidebar-hover"
          >
            <span className="truncate">{title}</span>
            <ChevronDown size={16} className="shrink-0" />
          </button>
        ) : (
          <h2 className="px-1.5 font-bold text-[17px] text-sidebar-strong">{title}</h2>
        )}
        <button
          type="button"
          title="新規メッセージ"
          aria-label="新規メッセージ"
          onClick={() => openModal({ kind: "newMessage" })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sidebar hover:bg-white/90"
        >
          <SquarePen size={16} />
        </button>
        {menu && (
          <Popover anchor={headerRef} onClose={() => setMenu(false)} className="w-72 py-2">
            <div role="menu">
              <div className="px-5 pt-1 pb-2">
                <p className="font-bold">{workspace?.name}</p>
              </div>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  openModal({ kind: "invite" });
                }}
              >
                {workspace?.name} にメンバーを招待する
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  openModal({ kind: "createChannel" });
                }}
              >
                チャンネルを作成する
              </MenuItem>
              {(role === "owner" || role === "admin") && (
                <MenuItem
                  onClick={() => {
                    setMenu(false);
                    openModal({ kind: "workspaceSettings" });
                  }}
                >
                  ワークスペースの設定
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  openModal({ kind: "preferences" });
                }}
              >
                環境設定
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  openModal({ kind: "createWorkspace" });
                }}
              >
                ワークスペースを新規作成する
              </MenuItem>
            </div>
          </Popover>
        )}
      </div>
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === "home" && <HomeList />}
        {tab === "dms" && <DmList />}
        {tab === "activity" && <ActivityList dark />}
        {tab === "later" && <SavedList dark />}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  bold,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  bold?: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md px-2.5 text-left text-[15px]",
        active ? "bg-sidebar-active text-sidebar-active-fg" : "hover:bg-sidebar-hover",
        bold && !active && "font-bold text-sidebar-strong",
      )}
    >
      <span className="flex w-5 shrink-0 justify-center opacity-90">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-badge px-1.5 font-bold text-[12px] text-white leading-[18px]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function HomeList() {
  const channels = useStore((s) => s.channels);
  const wid = useStore((s) => s.wid) as string;
  const unreadThreads = useStore((s) => s.unreadThreads);
  const path = usePath();
  const drafts = useDrafts();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("kaiwa:collapsed") ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggle = (k: string) =>
    setCollapsed((c) => {
      const next = { ...c, [k]: !c[k] };
      try {
        localStorage.setItem("kaiwa:collapsed", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  const meId = useStore((s) => s.me?.id);

  const all = Object.values(channels);
  const totalUnread = all.filter((c) => c.unreadCount > 0 && !c.muted && !c.hidden).length;
  const starred = all.filter((c) => c.starred && !c.hidden).sort(byLabel(meId));
  const chans = all
    .filter((c) => !c.starred && (c.kind === "public" || c.kind === "private"))
    .sort(byLabel(meId));
  const dms = all
    .filter((c) => !c.starred && (c.kind === "dm" || c.kind === "group") && !c.hidden)
    .sort((a, b) => (b.latestAt ?? b.createdAt) - (a.latestAt ?? a.createdAt));

  const go = (view: string) => {
    navigate(routes.view(wid, view));
    set({ mobileSidebar: false });
  };

  return (
    <div className="py-3">
      <NavItem
        icon={<Inbox size={16} />}
        label="すべての未読"
        bold={totalUnread > 0}
        badge={undefined}
        active={path.endsWith("/unreads")}
        onClick={() => go("unreads")}
      />
      <NavItem
        icon={<MessageSquareText size={16} />}
        label="スレッド"
        bold={unreadThreads > 0}
        active={path.endsWith("/threads")}
        onClick={() => go("threads")}
      />
      <NavItem
        icon={<AtSign size={16} />}
        label="メンションとリアクション"
        active={path.endsWith("/activity")}
        onClick={() => go("activity")}
      />
      <NavItem
        icon={<Pencil size={16} />}
        label="下書き"
        active={path.endsWith("/drafts")}
        onClick={() => go("drafts")}
        bold={drafts.size > 0}
      />
      <NavItem
        icon={<FileText size={16} />}
        label="ファイル"
        active={path.endsWith("/files")}
        onClick={() => go("files")}
      />
      <NavItem
        icon={<Users size={16} />}
        label="メンバー"
        active={path.endsWith("/people")}
        onClick={() => go("people")}
      />

      {starred.length > 0 && (
        <Section title="スター付き" collapsed={!!collapsed.starred} onToggle={() => toggle("starred")}>
          {starred.map((c) => (
            <ChannelRow key={c.id} channel={c} hasDraft={drafts.has(c.id)} collapsed={!!collapsed.starred} />
          ))}
        </Section>
      )}

      <Section
        title="チャンネル"
        collapsed={!!collapsed.channels}
        onToggle={() => toggle("channels")}
        action={<AddChannelMenu />}
      >
        {chans.map((c) => (
          <ChannelRow key={c.id} channel={c} hasDraft={drafts.has(c.id)} collapsed={!!collapsed.channels} />
        ))}
        {!collapsed.channels && (
          <NavItem
            icon={<Plus size={14} />}
            label="チャンネルを追加する"
            onClick={() => openModal({ kind: "browseChannels" })}
          />
        )}
      </Section>

      <Section
        title="ダイレクトメッセージ"
        collapsed={!!collapsed.dms}
        onToggle={() => toggle("dms")}
        action={
          <SectionAction label="新規メッセージ" onClick={() => openModal({ kind: "newMessage" })}>
            <Plus size={15} />
          </SectionAction>
        }
      >
        {dms.map((c) => (
          <ChannelRow key={c.id} channel={c} hasDraft={drafts.has(c.id)} collapsed={!!collapsed.dms} />
        ))}
        {!collapsed.dms && (
          <NavItem
            icon={<UserPlus size={14} />}
            label="メンバーを招待する"
            onClick={() => openModal({ kind: "invite" })}
          />
        )}
      </Section>
    </div>
  );
}

const byLabel = (meId: string | undefined) => (a: MyChannel, b: MyChannel) =>
  channelLabel(a, meId).localeCompare(channelLabel(b, meId), "ja");

function Section({
  title,
  children,
  collapsed,
  onToggle,
  action,
}: {
  title: string;
  children: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="group/sec mx-2 flex h-7 items-center justify-between rounded-md pr-1 pl-1 hover:bg-sidebar-hover">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1 text-left text-[15px]"
        >
          <span className="flex w-5 justify-center">
            {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </span>
          {title}
        </button>
        <span className="opacity-0 group-hover/sec:opacity-100 focus-within:opacity-100">{action}</span>
      </div>
      <div className="mt-0.5 space-y-px">{children}</div>
    </div>
  );
}

function SectionAction({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function AddChannelMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SectionAction ref={ref} label="チャンネルを追加する" onClick={() => setOpen(true)}>
        <Plus size={15} />
      </SectionAction>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="w-64 py-2">
          <MenuItem
            onClick={() => {
              setOpen(false);
              openModal({ kind: "createChannel" });
            }}
          >
            新しいチャンネルを作成する
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              openModal({ kind: "browseChannels" });
            }}
          >
            チャンネル一覧
          </MenuItem>
        </Popover>
      )}
    </>
  );
}

function ChannelRow({
  channel,
  hasDraft,
  collapsed,
}: {
  channel: MyChannel;
  hasDraft: boolean;
  collapsed: boolean;
}) {
  const path = usePath();
  const wid = useStore((s) => s.wid) as string;
  const meId = useStore((s) => s.me?.id);
  const active = path === routes.channel(wid, channel.id);
  const unread = channel.unreadCount > 0 && !channel.muted;
  const otherId = channel.kind === "dm" ? (channel.memberIds.find((id) => id !== meId) ?? meId) : undefined;
  const other = useStore((s) => (otherId ? s.members[otherId] : undefined));
  const presence = usePresence(otherId);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const isDm = channel.kind === "dm" || channel.kind === "group";

  // Collapsed sections keep showing unread + active conversations.
  if (collapsed && !active && !unread && channel.mentionCount === 0) return null;

  return (
    <div className="group/row relative mx-2">
      <button
        type="button"
        onClick={() => {
          navigate(routes.channel(wid, channel.id));
          set({ mobileSidebar: false });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
        }}
        className={cx(
          "flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-[15px]",
          active ? "bg-sidebar-active text-sidebar-active-fg" : "hover:bg-sidebar-hover",
          unread && !active && "font-bold text-sidebar-strong",
          channel.muted && !active && "opacity-60",
        )}
        aria-current={active ? "page" : undefined}
        data-testid={`sidebar-channel-${isDm ? "dm" : channel.name}`}
      >
        <span className="flex w-5 shrink-0 justify-center">
          {channel.kind === "dm" ? (
            <Avatar
              user={other}
              size={20}
              presence={presence}
              ring={active ? "var(--sidebar-active)" : "var(--sidebar)"}
            />
          ) : channel.kind === "group" ? (
            <span
              className={cx(
                "flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold",
                active ? "bg-sidebar-active-fg/15" : "bg-white/15",
              )}
            >
              {channel.memberIds.length - 1}
            </span>
          ) : channel.kind === "private" ? (
            <Lock size={14} />
          ) : (
            <Hash size={15} />
          )}
        </span>
        <span className="flex-1 truncate">{channelLabel(channel, meId)}</span>
        {other?.statusEmoji && channel.kind === "dm" && <Emoji name={other.statusEmoji} size={13} />}
        {channel.kind === "dm" && other?.dndUntil ? <DndIcon until={other.dndUntil} size={12} /> : null}
        {hasDraft && !active && <Pencil size={13} className="shrink-0 opacity-70" />}
        {channel.mentionCount > 0 && !active ? (
          <span className="rounded-full bg-badge px-1.5 font-bold text-[12px] text-white leading-[18px]">
            {channel.mentionCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label="チャンネルのオプション"
        onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())}
        className={cx(
          "absolute top-0.5 right-1 hidden h-6 w-6 items-center justify-center rounded group-hover/row:flex",
          active ? "hover:bg-black/10" : "hover:bg-white/15",
          channel.mentionCount > 0 && "group-hover/row:hidden",
        )}
      >
        <Ellipsis size={15} />
      </button>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} className="w-60 py-2">
          <div role="menu">
            <MenuItem
              onClick={() => {
                setMenu(null);
                void setChannelPrefs(channel.id, { starred: !channel.starred });
              }}
            >
              {channel.starred ? "スターを外す" : "スターを付ける"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null);
                void setChannelPrefs(channel.id, { muted: !channel.muted });
              }}
            >
              {channel.muted ? "ミュートを解除する" : "ミュートする"}
            </MenuItem>
            {channel.unreadCount > 0 && (
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  markChannelRead(channel.id, Math.max(Date.now(), channel.latestAt ?? 0));
                }}
              >
                既読にする
              </MenuItem>
            )}
            <MenuSeparator />
            {isDm ? (
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  void setChannelPrefs(channel.id, { hidden: true });
                  if (active) navigate(routes.view(wid, "dms"));
                }}
              >
                ダイレクトメッセージを閉じる
              </MenuItem>
            ) : (
              <>
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    openModal({ kind: "channelDetails", channelId: channel.id });
                  }}
                >
                  チャンネル詳細を開く
                </MenuItem>
                {!channel.isDefault && (
                  <MenuItem
                    danger
                    onClick={() => {
                      setMenu(null);
                      void leaveChannel(channel.id);
                    }}
                  >
                    チャンネルから退出する
                  </MenuItem>
                )}
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

function DmList() {
  const channels = useStore((s) => s.channels);
  const meId = useStore((s) => s.me?.id);
  const wid = useStore((s) => s.wid) as string;
  const members = useStore((s) => s.members);
  const path = usePath();
  const [query, setQuery] = useState("");
  const dms = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => (c.kind === "dm" || c.kind === "group") && (!c.hidden || c.latestAt))
        .filter((c) => !query || channelLabel(c, meId).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.latestAt ?? b.createdAt) - (a.latestAt ?? a.createdAt)),
    [channels, meId, query],
  );
  return (
    <div className="pb-3">
      <div className="p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="DM を検索"
          aria-label="DM を検索"
          className="h-8 w-full rounded-md border border-white/20 bg-white/10 px-2.5 text-[14px] text-sidebar-strong outline-none placeholder:text-sidebar-fg/70 focus:border-white/50"
        />
      </div>
      {dms.length === 0 && (
        <p className="px-4 py-6 text-center text-[14px]">
          まだダイレクトメッセージはありません。
          <button
            type="button"
            className="mt-2 block w-full font-bold text-sidebar-strong underline"
            onClick={() => openModal({ kind: "newMessage" })}
          >
            新しいメッセージを送る
          </button>
        </p>
      )}
      {dms.map((c) => {
        const otherIds = c.memberIds.filter((id) => id !== meId);
        const first = members[otherIds[0] ?? meId ?? ""];
        const active = path === routes.channel(wid, c.id);
        const unread = c.unreadCount > 0;
        const preview = c.latestPreview;
        const previewText = preview
          ? `${preview.userId === meId ? "あなた: " : c.kind === "group" ? `${displayName(preview.userId)}: ` : ""}${
              emojify(
                toPlainText(preview.text, {
                  user: displayName,
                  channel: (id) => get().directory[id]?.name ?? "channel",
                }),
              ) || (preview.files ? "ファイルを送信しました" : "")
            }`
          : "まだメッセージはありません";
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              navigate(routes.channel(wid, c.id));
              set({ mobileSidebar: false });
            }}
            className={cx(
              "flex w-full items-start gap-2.5 border-white/10 border-b px-4 py-2.5 text-left",
              active ? "bg-sidebar-active text-sidebar-active-fg" : "hover:bg-sidebar-hover",
            )}
          >
            <Avatar user={first} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={cx(
                    "truncate text-[15px]",
                    unread ? "font-bold" : "",
                    !active && unread && "text-sidebar-strong",
                  )}
                >
                  {channelLabel(c, meId)}
                </span>
                {c.latestAt && (
                  <span className="shrink-0 text-[12px] opacity-75">{formatRelative(c.latestAt)}</span>
                )}
              </span>
              <span className={cx("line-clamp-2 text-[13px]", active ? "opacity-80" : "opacity-75")}>
                {previewText}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
