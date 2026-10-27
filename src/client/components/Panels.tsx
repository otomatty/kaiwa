import { Bell, BellOff, Clock, Mail, MessageCircle, Pin, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../../shared/types";
import { api } from "../lib/api";
import { localTime } from "../lib/format";
import { loadThread, markThreadRead, openDm, reportError } from "../store/actions";
import { channelLabel, get, set, useStore } from "../store/store";
import { Composer } from "./Composer";
import { isGrouped, MessageItem, MessagePreview } from "./Message";
import { Emoji } from "./MessageText";
import { Avatar, Button, DndIcon, IconButton, PresenceDot, Spinner, usePresence } from "./ui";

function PanelShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col border-line border-l bg-bg md:w-[400px] md:min-w-[340px] lg:w-[440px]"
      aria-label={typeof title === "string" ? title : "パネル"}
    >
      <header className="flex h-[49px] shrink-0 items-center justify-between gap-2 border-line border-b px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 font-bold text-[18px]">{title}</h2>
          {subtitle && <span className="truncate text-[13px] text-fg-muted">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {actions}
          <IconButton label="閉じる" onClick={() => set({ panel: null })}>
            <X size={18} />
          </IconButton>
        </div>
      </header>
      {children}
    </aside>
  );
}

export function ThreadPanel({ rootId }: { rootId: string }) {
  const root = useStore((s) => s.messages[rootId]);
  const thread = useStore((s) => s.threads[rootId]);
  const channel = useStore((s) =>
    root ? (s.channels[root.channelId] ?? s.directory[root.channelId]) : undefined,
  );
  const isMember = useStore((s) => (root ? !!s.channels[root.channelId] : false));
  const meId = useStore((s) => s.me?.id);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    setError(null);
    atBottom.current = true;
    loadThread(rootId).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "読み込みに失敗しました"),
    );
  }, [rootId]);

  const replies = thread?.replyIds ?? [];

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });

  // Mark read while open.
  useEffect(() => {
    if (!thread?.loaded) return;
    const last = replies[replies.length - 1];
    const m = last ? get().messages[last] : undefined;
    if (m && !m.pending && m.createdAt > thread.lastReadAt && document.hasFocus())
      markThreadRead(rootId, m.createdAt);
  });

  const toggleFollow = async () => {
    const next = !thread?.subscribed;
    try {
      await api.follow(rootId, next);
      set((s) => {
        const t = s.threads[rootId];
        return t ? { threads: { ...s.threads, [rootId]: { ...t, subscribed: next } } } : {};
      });
    } catch (err) {
      reportError(err);
    }
  };

  const messages = get().messages;
  return (
    <PanelShell
      title="スレッド"
      subtitle={
        channel
          ? channel.kind === "dm" || channel.kind === "group"
            ? channelLabel(channel, meId)
            : `#${channel.name}`
          : undefined
      }
      actions={
        thread?.loaded && (
          <IconButton
            label={thread.subscribed ? "スレッドのフォローをやめる" : "スレッドをフォローする"}
            onClick={() => void toggleFollow()}
          >
            {thread.subscribed ? <Bell size={17} /> : <BellOff size={17} />}
          </IconButton>
        )
      }
    >
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-2 pb-2"
        data-testid="thread-panel"
      >
        {error ? (
          <p className="p-6 text-center text-fg-muted">{error}</p>
        ) : !root ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : (
          <>
            <MessageItem id={rootId} context="thread-root" />
            <div className="my-2 flex items-center gap-3 px-5 text-[13px] text-fg-muted">
              <span>{root.replyCount > 0 ? `${root.replyCount}件の返信` : "返信はまだありません"}</span>
              <div className="h-px flex-1 bg-line" />
            </div>
            {!thread?.loaded && (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            )}
            {replies.map((id, i) => {
              const m = messages[id];
              const prev = i > 0 ? messages[replies[i - 1] as string] : undefined;
              return m ? (
                <MessageItem key={id} id={id} context="thread" grouped={isGrouped(m, prev)} />
              ) : null;
            })}
          </>
        )}
      </div>
      {root && isMember && !root.deletedAt && !channel?.archivedAt && (
        <Composer channelId={root.channelId} threadRootId={rootId} placeholder="返信する…" />
      )}
    </PanelShell>
  );
}

export function ProfilePanel({ userId }: { userId: string }) {
  const member = useStore((s) => s.members[userId]);
  const meId = useStore((s) => s.me?.id);
  const presence = usePresence(userId);
  if (!member) {
    return (
      <PanelShell title="プロフィール">
        <p className="p-6 text-fg-muted">このユーザーは見つかりません。</p>
      </PanelShell>
    );
  }
  const isMe = userId === meId;
  return (
    <PanelShell title="プロフィール">
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="flex justify-center p-6 pb-4">
          <Avatar user={member} size={240} className="max-w-full" />
        </div>
        <div className="px-6 pb-6">
          <h3 className="flex items-center gap-2 font-bold text-[22px]">
            {member.displayName}
            <PresenceDot presence={presence} size={12} />
            <DndIcon until={member.dndUntil} size={16} />
          </h3>
          {member.fullName && <p className="text-[15px] text-fg-muted">{member.fullName}</p>}
          {member.title && <p className="mt-0.5 text-[15px]">{member.title}</p>}
          {member.role !== "member" && (
            <p className="mt-1 inline-block rounded bg-bg-muted px-1.5 py-0.5 text-[12px] text-fg-muted">
              {member.role === "owner" ? "ワークスペースのオーナー" : "ワークスペースの管理者"}
            </p>
          )}
          {(member.statusEmoji || member.statusText) && (
            <p className="mt-3 flex items-center gap-2 text-[15px]">
              {member.statusEmoji && <Emoji name={member.statusEmoji} size={18} />}
              {member.statusText}
            </p>
          )}
          <p className="mt-3 flex items-center gap-2 text-[14px] text-fg-muted">
            <Clock size={15} /> 現地時間 {localTime(member.timezone)}
          </p>
          <div className="mt-5 flex gap-2">
            {isMe ? (
              <Button onClick={() => set({ modal: { kind: "editProfile" } })}>プロフィールを編集</Button>
            ) : (
              <Button onClick={() => void openDm([userId])}>
                <MessageCircle size={16} /> メッセージ
              </Button>
            )}
          </div>
          <div className="mt-6 border-line border-t pt-5">
            <h4 className="mb-2 font-bold text-[15px]">連絡先情報</h4>
            <p className="flex items-center gap-3 text-[14px]">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-muted">
                <Mail size={16} />
              </span>
              <span>
                <span className="block text-[12px] text-fg-muted">メールアドレス</span>
                <a href={`mailto:${member.email}`} className="text-link hover:underline">
                  {member.email}
                </a>
              </span>
            </p>
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

export function PinsPanel({ channelId }: { channelId: string }) {
  const [items, setItems] = useState<Message[] | null>(null);
  const pinnedVersion = useStore((s) =>
    Object.values(s.messages)
      .filter((m) => m.channelId === channelId && m.pinned)
      .map((m) => m.id)
      .join(","),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when pins change
  useEffect(() => {
    api
      .pins(channelId)
      .then((r) => setItems(r.messages))
      .catch(reportError);
  }, [channelId, pinnedVersion]);
  return (
    <PanelShell title="ピン留めアイテム">
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {!items ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-fg-muted">
            <Pin size={28} />
            <p className="font-bold text-fg">ピン留めされたアイテムはありません</p>
            <p className="text-[14px]">
              大切なメッセージは、メッセージにカーソルを合わせて「その他」から「チャンネルにピン留め」を選ぶと、ここにまとまります。
            </p>
          </div>
        ) : (
          items.map((m) => <MessagePreview key={m.id} m={m} />)
        )}
      </div>
    </PanelShell>
  );
}

export function RightPanel() {
  const panel = useStore((s) => s.panel);
  if (!panel) return null;
  if (panel.kind === "thread") return <ThreadPanel rootId={panel.rootId} />;
  if (panel.kind === "profile") return <ProfilePanel userId={panel.userId} />;
  return <PinsPanel channelId={panel.channelId} />;
}
