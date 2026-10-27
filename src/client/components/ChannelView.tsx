import { Archive, BellOff, ChevronDown, Hash, Link2, Lock, Pin, Plus, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Bookmark, MyChannel } from "../../shared/types";
import { api } from "../lib/api";
import { joinChannel, reportError, setChannelPrefs } from "../store/actions";
import { channelLabel, openModal, set, useStore } from "../store/store";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { Emoji, MessageText } from "./MessageText";
import { Avatar, Button, cx, IconButton, Popover, PresenceDot, Spinner, usePresence } from "./ui";

export function ChannelView({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.channels[channelId]);
  const [preview, setPreview] = useState<MyChannel | null>(null);
  const [missing, setMissing] = useState(false);
  const meId = useStore((s) => s.me?.id);

  // Non-member preview of a public channel.
  useEffect(() => {
    setMissing(false);
    setPreview(null);
    if (channel) return;
    let cancelled = false;
    api
      .channel(channelId)
      .then((r) => {
        if (cancelled) return;
        if (r.channel.isMember) set((s) => ({ channels: { ...s.channels, [channelId]: r.channel } }));
        else setPreview(r.channel);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [channelId, channel]);

  const ch = channel ?? preview;
  useEffect(() => {
    if (!ch) return;
    const label = ch.kind === "dm" || ch.kind === "group" ? channelLabel(ch, meId) : `#${ch.name}`;
    document.title = label;
  }, [ch, meId]);

  if (missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <p className="font-bold text-[18px] text-fg">チャンネルが見つかりません</p>
        <p>削除されたか、アクセス権がない可能性があります。</p>
      </div>
    );
  }
  if (!ch) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChannelHeader channel={ch} />
      {ch.isMember && ch.kind !== "dm" && ch.kind !== "group" && <BookmarksBar channelId={ch.id} />}
      <MessageList key={ch.id} channel={ch} />
      {ch.archivedAt ? (
        <div className="mx-5 mb-4 flex items-center gap-3 rounded-lg border border-line bg-bg-soft px-4 py-3 text-[14px]">
          <Archive size={18} className="text-fg-muted" />
          <span className="flex-1">
            このチャンネルはアーカイブされています。閲覧はできますが、投稿はできません。
          </span>
        </div>
      ) : ch.isMember ? (
        <Composer
          channelId={ch.id}
          placeholder={
            ch.kind === "dm" || ch.kind === "group"
              ? `${channelLabel(ch, meId)} へのメッセージ`
              : `#${ch.name} へのメッセージ`
          }
        />
      ) : (
        <JoinBar channel={ch} />
      )}
    </div>
  );
}

function JoinBar({ channel }: { channel: MyChannel }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-5 mb-4 flex flex-col items-center gap-3 rounded-lg border border-line bg-bg-soft px-4 py-5 text-center">
      <p className="text-[15px]">
        <b className="inline-flex items-center gap-0.5">
          <Hash size={15} />
          {channel.name}
        </b>{" "}
        をプレビュー中です
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await joinChannel(channel.id);
            setBusy(false);
          }}
        >
          チャンネルに参加する
        </Button>
        <Button onClick={() => openModal({ kind: "channelDetails", channelId: channel.id })}>
          詳細を見る
        </Button>
      </div>
    </div>
  );
}

function ChannelHeader({ channel }: { channel: MyChannel }) {
  const meId = useStore((s) => s.me?.id);
  const members = useStore((s) => s.members);
  const isDm = channel.kind === "dm" || channel.kind === "group";
  const otherId = channel.kind === "dm" ? (channel.memberIds.find((id) => id !== meId) ?? meId) : undefined;
  const other = otherId ? members[otherId] : undefined;
  const presence = usePresence(otherId);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the member count changes
  useEffect(() => {
    if (isDm) {
      setMemberIds(channel.memberIds);
      return;
    }
    let cancelled = false;
    api
      .channel(channel.id)
      .then((r) => !cancelled && setMemberIds(r.members.map((m) => m.id)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channel.id, channel.memberCount, isDm, channel.memberIds]);

  const openDetails = (tab?: "about" | "members" | "settings") =>
    openModal({ kind: "channelDetails", channelId: channel.id, tab });

  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between gap-3 border-line border-b px-4">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => openDetails()}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-bold text-[18px] hover:bg-bg-muted"
          data-testid="channel-title"
        >
          {channel.kind === "dm" ? (
            <>
              <Avatar user={other} size={24} />
              <span className="truncate">{channelLabel(channel, meId)}</span>
              <PresenceDot presence={presence} size={10} />
              {other?.statusEmoji && <Emoji name={other.statusEmoji} size={16} />}
            </>
          ) : channel.kind === "group" ? (
            <span className="truncate">{channelLabel(channel, meId)}</span>
          ) : (
            <>
              {channel.kind === "private" ? <Lock size={17} /> : <Hash size={19} />}
              <span className="truncate">{channel.name}</span>
            </>
          )}
          <ChevronDown size={16} className="shrink-0 text-fg-muted" />
        </button>
        {channel.isMember && (
          <IconButton
            label={channel.starred ? "スターを外す" : "スターを付ける"}
            onClick={() => setChannelPrefs(channel.id, { starred: !channel.starred })}
          >
            <Star size={16} className={channel.starred ? "fill-[#e8a600] text-[#e8a600]" : ""} />
          </IconButton>
        )}
        {channel.muted && (
          <span title="ミュート中" className="text-fg-subtle">
            <BellOff size={15} />
          </span>
        )}
        {channel.topic && !isDm && (
          <button
            type="button"
            onClick={() => openDetails("about")}
            className="ml-2 hidden min-w-0 truncate text-[13px] text-fg-muted hover:text-fg md:block"
            title={channel.topic}
          >
            <MessageText text={channel.topic} className="truncate [&>p]:truncate" />
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isDm && (
          <button
            type="button"
            onClick={() => openDetails("members")}
            className="flex items-center gap-1.5 rounded-md border border-line px-1.5 py-1 hover:bg-bg-soft"
            aria-label={`メンバー ${channel.memberCount}人`}
          >
            <span className="flex -space-x-1.5">
              {memberIds.slice(0, 3).map((id) => (
                <Avatar key={id} user={members[id]} size={20} className="ring-2 ring-bg" />
              ))}
            </span>
            <span className="pr-0.5 font-bold text-[13px] text-fg-muted">{channel.memberCount}</span>
          </button>
        )}
        <IconButton
          label="ピン留めアイテム"
          onClick={() =>
            set((s) => ({ panel: s.panel?.kind === "pins" ? null : { kind: "pins", channelId: channel.id } }))
          }
        >
          <Pin size={17} />
        </IconButton>
      </div>
    </header>
  );
}

function BookmarksBar({ channelId }: { channelId: string }) {
  const version = useStore((s) => s.bookmarkVersion[channelId] ?? 0);
  const [items, setItems] = useState<Bookmark[]>([]);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on version bump
  useEffect(() => {
    let cancelled = false;
    api
      .bookmarks(channelId)
      .then((r) => !cancelled && setItems(r.bookmarks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelId, version]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-line border-b px-4 text-[13px]">
      {items.map((b) => (
        <span key={b.id} className="group/bm flex shrink-0 items-center rounded-md hover:bg-bg-muted">
          <a
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1 text-fg-muted hover:text-fg"
            title={b.url}
          >
            <Link2 size={13} className="shrink-0" />
            {b.title}
          </a>
          <button
            type="button"
            aria-label={`${b.title} を削除`}
            className="mr-1 hidden rounded p-0.5 text-fg-subtle hover:text-fg group-hover/bm:block"
            onClick={() =>
              api
                .deleteBookmark(channelId, b.id)
                .then(() => setItems((x) => x.filter((i) => i.id !== b.id)), reportError)
            }
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        ref={addRef}
        type="button"
        onClick={() => setAdding(true)}
        className={cx(
          "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-bg-muted hover:text-fg",
        )}
      >
        <Plus size={14} /> {items.length === 0 ? "ブックマークを追加" : ""}
      </button>
      {adding && (
        <Popover anchor={addRef} onClose={() => setAdding(false)} className="w-80 p-4">
          <AddBookmark
            onAdd={async (title, url) => {
              try {
                const r = await api.addBookmark(channelId, { title, url });
                setItems((x) => [...x, r.bookmark]);
                setAdding(false);
              } catch (err) {
                reportError(err);
              }
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function AddBookmark({ onAdd }: { onAdd: (title: string, url: string) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const u = /^https?:\/\//.test(url) ? url : `https://${url}`;
        let fallback = u;
        try {
          fallback = new URL(u).hostname;
        } catch {
          // keep url
        }
        onAdd(title.trim() || fallback, u);
      }}
      className="space-y-3"
    >
      <p className="flex items-center gap-1.5 font-bold">
        <Link2 size={16} /> ブックマークを追加
      </p>
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com"
        className="h-9 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[14px] outline-none focus:border-link"
        aria-label="リンク"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="名前（任意）"
        className="h-9 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[14px] outline-none focus:border-link"
        aria-label="名前"
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" className="h-8" disabled={!url.trim()}>
          追加
        </Button>
      </div>
    </form>
  );
}
