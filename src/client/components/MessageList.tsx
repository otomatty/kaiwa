import { ArrowDown, Hash, Lock, UserPlus } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MyChannel } from "../../shared/types";
import { formatDay, formatTime, startOfDay } from "../lib/format";
import {
  clearAutoReadSuppression,
  isAutoReadSuppressed,
  loadAround,
  loadLatest,
  loadNewer,
  loadOlder,
  markChannelRead,
  markUnread,
  reportError,
} from "../store/actions";
import { channelLabel, get, openModal, set, useStore } from "../store/store";
import { isGrouped, MessageItem } from "./Message";
import { Avatar, Button, Spinner } from "./ui";

export function MessageList({ channel }: { channel: MyChannel }) {
  const cid = channel.id;
  const st = useStore((s) => s.channelMsgs[cid]);
  const jumpTo = useStore((s) => s.jumpTo);
  const meId = useStore((s) => s.me?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Snapshot the read marker when the channel is opened so the "new" line stays put.
  const [readMarker, setReadMarker] = useState(channel.lastReadAt);
  const prevFirst = useRef<{ id: string | undefined; height: number }>({ id: undefined, height: 0 });
  const initialScrollDone = useRef(false);

  useEffect(() => {
    setReadMarker(get().channels[cid]?.lastReadAt ?? Date.now());
    initialScrollDone.current = false;
    atBottom.current = true;
    setError(null);
    const target = get().jumpTo;
    const load = target
      ? loadAround(cid, target)
      : get().channelMsgs[cid]?.loaded
        ? Promise.resolve()
        : loadLatest(cid);
    load
      .then(() => {
        if (target) {
          setHighlight(target);
          set({ jumpTo: null });
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
        if (target) set({ jumpTo: null });
      });
  }, [cid]);

  // "Mark unread" moves the marker backwards: show the divider at the new spot.
  useEffect(() => {
    if (channel.lastReadAt < readMarker) setReadMarker(channel.lastReadAt);
  }, [channel.lastReadAt, readMarker]);

  // Jump requests while already in the channel (e.g. from search).
  useEffect(() => {
    if (!jumpTo || !initialScrollDone.current) return;
    const target = jumpTo;
    set({ jumpTo: null });
    if (get().channelMsgs[cid]?.ids.includes(target)) {
      setHighlight(null);
      requestAnimationFrame(() => setHighlight(target));
    } else {
      loadAround(cid, target)
        .then(() => setHighlight(target))
        .catch(reportError);
    }
  }, [jumpTo, cid]);

  const ids = st?.ids ?? [];

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Keep position when older messages are prepended; stick to bottom for new ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !st?.loaded) return;
    const first = ids[0];
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      if (highlight || get().jumpTo) {
        // MessageItem scrolls itself into view.
      } else {
        const firstUnread = ids.find((id) => {
          const m = get().messages[id];
          return m && m.createdAt > readMarker && m.userId !== meId && (!m.subtype || m.subtype === "me");
        });
        const node = firstUnread ? el.querySelector(`[data-message-id="${firstUnread}"]`) : null;
        if (node instanceof HTMLElement && node.offsetTop > el.clientHeight / 2) {
          el.scrollTop = node.offsetTop - 80;
          atBottom.current = false;
        } else scrollToBottom();
      }
    } else if (prevFirst.current.id && first !== prevFirst.current.id && ids.includes(prevFirst.current.id)) {
      el.scrollTop += el.scrollHeight - prevFirst.current.height;
    } else if (atBottom.current && !st.hasMoreAfter) {
      scrollToBottom();
    }
    prevFirst.current = { id: first, height: el.scrollHeight };
  });

  // Images and embeds change height after load: keep pinned to the bottom.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current && !get().channelMsgs[cid]?.hasMoreAfter) scrollToBottom();
      const el = scrollRef.current;
      if (el) prevFirst.current.height = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [cid, scrollToBottom]);

  // Mark as read while the bottom of the conversation is visible.
  const tryMarkRead = useCallback(() => {
    const s = get();
    const cm = s.channelMsgs[cid];
    if (!cm?.loaded || cm.hasMoreAfter || !atBottom.current) return;
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    if (isAutoReadSuppressed(cid)) return;
    const lastId = [...cm.ids].reverse().find((id) => !id.startsWith("tmp-"));
    const last = lastId ? s.messages[lastId] : undefined;
    if (last) markChannelRead(cid, last.createdAt);
  }, [cid]);

  useEffect(() => {
    tryMarkRead();
  });
  useEffect(() => {
    const onFocus = () => tryMarkRead();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearAutoReadSuppression(cid);
    };
  }, [tryMarkRead, cid]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasAtBottom = atBottom.current;
    atBottom.current = distance < 40;
    if (atBottom.current && !wasAtBottom) clearAutoReadSuppression(cid);
    setShowJump(distance > 600 || !!st?.hasMoreAfter);
    if (el.scrollTop < 300 && st?.hasMoreBefore && !st.loading) void loadOlder(cid);
    if (distance < 300 && st?.hasMoreAfter && !st.loading) void loadNewer(cid);
    if (atBottom.current) tryMarkRead();
  };

  const jumpToRecent = async () => {
    if (st?.hasMoreAfter) await loadLatest(cid);
    atBottom.current = true;
    scrollToBottom();
    setShowJump(false);
  };

  const unreadCount = channel.unreadCount;
  const messages = get().messages;
  let unreadShown = false;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {unreadCount > 0 && !atBottom.current && (
        <div className="absolute top-2 right-5 left-5 z-10 flex items-center justify-between rounded-lg bg-link px-4 py-1.5 text-[13px] text-white shadow-md">
          <span>
            {formatTime(readMarker || Date.now())} 以降の新着メッセージ {unreadCount}件
          </span>
          <button
            type="button"
            className="font-bold hover:underline"
            onClick={() => {
              const last = ids[ids.length - 1];
              const m = last ? get().messages[last] : undefined;
              if (m) markChannelRead(cid, m.createdAt);
              clearAutoReadSuppression(cid);
            }}
          >
            既読にする
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        data-testid="message-list"
      >
        <div ref={innerRef} className="flex min-h-full flex-col justify-end pb-3">
          {st?.loaded && !st.hasMoreBefore && <ChannelIntro channel={channel} />}
          {(!st?.loaded || (st.loading && st.hasMoreBefore)) && !error && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center gap-3 py-10 text-fg-muted">
              <p>{error}</p>
              <Button onClick={() => loadLatest(cid).then(() => setError(null), reportError)}>
                再読み込み
              </Button>
            </div>
          )}
          {ids.map((id, i) => {
            const m = messages[id];
            if (!m) return null;
            const prev = i > 0 ? messages[ids[i - 1] as string] : undefined;
            const newDay = !prev || startOfDay(prev.createdAt) !== startOfDay(m.createdAt);
            const isFirstUnread =
              !unreadShown &&
              m.createdAt > readMarker &&
              m.userId !== meId &&
              !m.pending &&
              (!m.subtype || m.subtype === "me") &&
              readMarker > 0;
            if (isFirstUnread) unreadShown = true;
            return (
              <Fragment key={id}>
                {newDay && <DateDivider ts={m.createdAt} />}
                {isFirstUnread && <UnreadDivider />}
                <div
                  onClickCapture={(e) => {
                    if (e.altKey && !id.startsWith("tmp-")) {
                      e.preventDefault();
                      e.stopPropagation();
                      void markUnread(id).then(() => setReadMarker(m.createdAt - 1));
                    }
                  }}
                >
                  <MessageItem
                    id={id}
                    grouped={!newDay && !isFirstUnread && isGrouped(m, prev)}
                    highlight={highlight === id}
                  />
                </div>
              </Fragment>
            );
          })}
          {st?.hasMoreAfter && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => void jumpToRecent()}
          className="absolute right-6 bottom-3 z-10 flex items-center gap-1.5 rounded-full bg-link px-3.5 py-1.5 font-bold text-[13px] text-white shadow-md hover:opacity-90"
        >
          <ArrowDown size={15} /> 最新のメッセージへ
        </button>
      )}
    </div>
  );
}

function DateDivider({ ts }: { ts: number }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: visual divider with a label
    <div className="sticky top-0 z-[5] my-2 flex items-center px-5" role="separator">
      <div className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line bg-bg px-3.5 py-0.5 font-bold text-[13px] text-fg">
        {formatDay(ts)}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="relative my-1 flex items-center px-5" data-testid="unread-divider">
      <div className="h-px flex-1 bg-badge" />
      <span className="ml-1 rounded bg-bg px-1 font-bold text-[12px] text-badge">新着</span>
    </div>
  );
}

function ChannelIntro({ channel }: { channel: MyChannel }) {
  const meId = useStore((s) => s.me?.id);
  const members = useStore((s) => s.members);
  const creator = members[channel.createdBy];
  if (channel.kind === "dm" || channel.kind === "group") {
    const others = channel.memberIds.filter((id) => id !== meId);
    const self = others.length === 0;
    const first = members[others[0] ?? meId ?? ""];
    return (
      <div className="px-5 pt-10 pb-4">
        <div className="mb-3 flex -space-x-2">
          {(self ? [meId ?? ""] : others.slice(0, 4)).map((id) => (
            <Avatar key={id} user={members[id]} size={72} className="ring-4 ring-bg" />
          ))}
        </div>
        <h2 className="font-bold text-[22px]">{channelLabel(channel, meId)}</h2>
        <p className="mt-1 max-w-[640px] text-[15px] text-fg-muted">
          {self ? (
            <>
              ここはあなた専用のスペースです。メッセージの下書きやToDo、リンクやファイルの保存場所として使えます。
            </>
          ) : others.length === 1 ? (
            <>
              これは <b className="text-fg">@{first?.displayName}</b>{" "}
              さんとのダイレクトメッセージの始まりです。この会話は二人だけに表示されます。
            </>
          ) : (
            <>これはこのグループとのダイレクトメッセージの始まりです。</>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="px-5 pt-10 pb-4">
      <h2 className="flex items-center gap-1 font-bold text-[24px]">
        {channel.kind === "private" ? <Lock size={22} /> : <Hash size={24} />}
        {channel.name}
      </h2>
      <p className="mt-1 max-w-[640px] text-[15px] text-fg-muted">
        {creator ? <b className="text-fg">@{creator.displayName}</b> : "誰か"} さんが{" "}
        {new Date(channel.createdAt).toLocaleDateString("ja-JP", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}{" "}
        にこのチャンネルを作成しました。これは <b className="text-fg">#{channel.name}</b>{" "}
        チャンネルの始まりです。
        {channel.description && <> {channel.description}</>}
      </p>
      {channel.isMember && (
        <div className="mt-4 flex gap-2">
          <Button
            className="h-8 text-[13px]"
            onClick={() => openModal({ kind: "channelDetails", channelId: channel.id, tab: "members" })}
          >
            <UserPlus size={15} /> メンバーを追加
          </Button>
        </div>
      )}
    </div>
  );
}
