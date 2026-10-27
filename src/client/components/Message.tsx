import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Download,
  EllipsisVertical,
  FileText,
  MessageSquareText,
  Pin,
  SmilePlus,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { FileInfo, Message as Msg } from "../../shared/types";
import { decodeMentions } from "../lib/compose";
import { formatBytes, formatFull, formatRelative, formatTime } from "../lib/format";
import { navigate } from "../lib/router";
import {
  deleteMessage,
  editMessage,
  markUnread,
  openProfile,
  openThread,
  retryMessage,
  togglePin,
  toggleReaction,
  toggleSaved,
} from "../store/actions";
import { displayName, get, type LocalMessage, openModal, toast, useStore } from "../store/store";
import { EmojiPicker, QuickReactions } from "./EmojiPicker";
import { LinkPreview, linksIn } from "./LinkPreview";
import { Emoji, MessageText } from "./MessageText";
import { Avatar, Button, cx, MenuItem, MenuSeparator, Popover } from "./ui";

export type MessageContext = "channel" | "thread" | "thread-root" | "preview";

const GROUP_WINDOW = 5 * 60 * 1000;

export function isGrouped(m: Msg, prev: Msg | undefined): boolean {
  if (!prev || prev.userId !== m.userId) return false;
  if (m.subtype || prev.subtype) return false;
  if (m.broadcast && m.threadRootId) return false;
  if (prev.broadcast && prev.threadRootId) return false;
  return (
    m.createdAt - prev.createdAt < GROUP_WINDOW &&
    new Date(m.createdAt).getDate() === new Date(prev.createdAt).getDate()
  );
}

export const MessageItem = memo(function MessageItem({
  id,
  grouped,
  context = "channel",
  highlight,
}: {
  id: string;
  grouped?: boolean;
  context?: MessageContext;
  highlight?: boolean;
}) {
  const m = useStore((s) => s.messages[id]) as LocalMessage | undefined;
  const author = useStore((s) => (m ? s.members[m.userId] : undefined));
  const meId = useStore((s) => s.me?.id);
  const canModerate = useStore((s) => s.role === "owner" || s.role === "admin");
  const archived = useStore((s) => (m ? !!s.channels[m.channelId]?.archivedAt : false));
  const isMember = useStore((s) => (m ? !!s.channels[m.channelId] : false));
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"emoji" | "more" | null>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: "center" });
  }, [highlight]);

  useEffect(() => {
    const onEdit = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setEditing(true);
    };
    window.addEventListener("kaiwa:edit", onEdit);
    return () => window.removeEventListener("kaiwa:edit", onEdit);
  }, [id]);

  if (!m) return null;
  const mine = m.userId === meId;
  const name = author?.displayName ?? (mine ? (get().me?.displayName ?? "") : "不明なユーザー");

  if (m.subtype && m.subtype !== "me") return <SystemMessage m={m} grouped={grouped} />;

  if (m.deletedAt) {
    return (
      <div className="group relative flex gap-2 px-5 py-1.5">
        <div className="w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-fg-subtle italic">このメッセージは削除されました。</p>
          {context === "channel" && m.replyCount > 0 && <ThreadSummary m={m} />}
        </div>
      </div>
    );
  }

  const mentionsMe = !!meId && (m.text.includes(`<@${meId}>`) || /<!(here|channel|everyone)>/.test(m.text));
  const canAct = !m.pending && context !== "preview";
  const showHeader = !grouped || context === "thread-root";

  return (
    <div
      ref={rowRef}
      data-message-id={m.id}
      className={cx(
        "group relative flex gap-2 px-5",
        showHeader ? "pt-2 pb-1" : "py-0.5",
        mentionsMe && !mine && "bg-mention-me",
        m.pinned && context !== "preview" && "bg-[#fdf6e3] dark:bg-[rgb(242_193_78/0.07)]",
        highlight && "jump-highlight",
        editing ? "bg-highlight" : "hover:bg-bg-soft",
        menu && "bg-bg-soft",
      )}
    >
      <div className="w-9 shrink-0">
        {showHeader ? (
          <button
            type="button"
            onClick={() => openProfile(m.userId)}
            className="mt-0.5 block"
            aria-label={`${name}のプロフィール`}
          >
            <Avatar user={author} size={36} />
          </button>
        ) : (
          <span
            title={formatFull(m.createdAt)}
            className="invisible block pt-[3px] text-right text-[11px] text-fg-subtle leading-[22px] group-hover:visible"
          >
            {formatTime(m.createdAt)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {(m.pinned || m.saved) && context !== "preview" && (
          <div className="mb-0.5 flex items-center gap-3 text-[12.5px] text-fg-muted">
            {m.pinned && (
              <span className="flex items-center gap-1">
                <Pin size={12} className="text-[#c48a00]" /> ピン留め済み
              </span>
            )}
            {m.saved && (
              <span className="flex items-center gap-1">
                <BookmarkCheck size={12} className="text-badge" /> 後で用に保存済み
              </span>
            )}
          </div>
        )}
        {m.threadRootId && m.broadcast && context === "channel" && <BroadcastLabel rootId={m.threadRootId} />}
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => openProfile(m.userId)}
              className="truncate font-bold text-[15px] hover:underline"
            >
              {name}
            </button>
            {author?.statusEmoji && (
              <span title={author.statusText}>
                <Emoji name={author.statusEmoji} size={14} />
              </span>
            )}
            <span title={formatFull(m.createdAt)} className="shrink-0 text-[12px] text-fg-subtle">
              {formatTime(m.createdAt)}
            </span>
          </div>
        )}
        {editing ? (
          <InlineEditor m={m} onDone={() => setEditing(false)} />
        ) : (
          <>
            {m.text &&
              (m.subtype === "me" ? (
                <em className="text-fg-muted">
                  <MessageText text={m.text} edited={!!m.editedAt} />
                </em>
              ) : (
                <MessageText text={m.text} edited={!!m.editedAt} className="text-[15px]" />
              ))}
            {m.files.length > 0 && <Attachments files={m.files} />}
            {!m.pending &&
              context !== "preview" &&
              linksIn(m.text).map((u) => <LinkPreview key={u} url={u} />)}
          </>
        )}
        {m.pending === "sending" && <p className="text-[12px] text-fg-subtle">送信中…</p>}
        {m.pending === "failed" && (
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <AlertCircle size={14} /> 送信できませんでした。
            <button type="button" className="font-bold underline" onClick={() => retryMessage(m.id)}>
              再試行
            </button>
            <button type="button" className="underline" onClick={() => deleteMessage(m.id)}>
              削除
            </button>
          </p>
        )}
        {m.reactions.length > 0 && <Reactions m={m} disabled={!isMember || context === "preview"} />}
        {context === "channel" && m.replyCount > 0 && <ThreadSummary m={m} />}
      </div>

      {canAct && !editing && (
        <div
          className={cx(
            "absolute -top-4 right-5 z-10 items-center rounded-lg border border-line bg-bg-elevated p-0.5 shadow-sm",
            menu ? "flex" : "hidden group-hover:flex",
          )}
        >
          {isMember && !archived && (
            <>
              <QuickReactions onPick={(n) => toggleReaction(m.id, n)} />
              <ToolbarButton
                ref={emojiBtn}
                label="リアクションする"
                onClick={() => setMenu(menu === "emoji" ? null : "emoji")}
              >
                <SmilePlus size={18} />
              </ToolbarButton>
            </>
          )}
          {context === "channel" && (isMember || m.replyCount > 0) && (
            <ToolbarButton label="スレッドで返信する" onClick={() => openThread(m.id)}>
              <MessageSquareText size={18} />
            </ToolbarButton>
          )}
          <ToolbarButton
            label={m.saved ? "「後で」から削除" : "後で用に保存"}
            onClick={() => toggleSaved(m.id)}
          >
            {m.saved ? <BookmarkCheck size={18} className="text-badge" /> : <Bookmark size={18} />}
          </ToolbarButton>
          <ToolbarButton
            ref={moreBtn}
            label="その他"
            onClick={() => setMenu(menu === "more" ? null : "more")}
          >
            <EllipsisVertical size={18} />
          </ToolbarButton>
        </div>
      )}
      {menu === "emoji" && (
        <Popover anchor={emojiBtn} onClose={() => setMenu(null)} placement="bottom-end">
          <EmojiPicker
            onPick={(n) => {
              setMenu(null);
              void toggleReaction(m.id, n);
            }}
          />
        </Popover>
      )}
      {menu === "more" && (
        <Popover anchor={moreBtn} onClose={() => setMenu(null)} placement="bottom-end" className="w-64 py-2">
          <MoreMenu
            m={m}
            mine={mine}
            canModerate={canModerate}
            isMember={isMember && !archived}
            onClose={() => setMenu(null)}
            onEdit={() => setEditing(true)}
          />
        </Popover>
      )}
    </div>
  );
});

const ToolbarButton = ({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
  >
    {children}
  </button>
);

function MoreMenu({
  m,
  mine,
  canModerate,
  isMember,
  onClose,
  onEdit,
}: {
  m: Msg;
  mine: boolean;
  canModerate: boolean;
  isMember: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const wid = useStore((s) => s.wid);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div role="menu">
      {isMember && (
        <MenuItem onClick={run(() => markUnread(m.id))} hint="Alt+クリック">
          ここから未読にする
        </MenuItem>
      )}
      <MenuItem
        onClick={run(() => {
          const url = `${window.location.origin}/w/${wid}/c/${m.channelId}?msg=${m.id}`;
          void navigator.clipboard?.writeText(url).then(
            () => toast("リンクをコピーしました"),
            () => toast(url),
          );
        })}
      >
        リンクをコピー
      </MenuItem>
      {isMember && (
        <MenuItem onClick={run(() => togglePin(m.id))}>
          {m.pinned ? "ピン留めを外す" : "チャンネルにピン留め"}
        </MenuItem>
      )}
      {(mine || canModerate) && <MenuSeparator />}
      {mine && isMember && (!m.subtype || m.subtype === "me") && (
        <MenuItem onClick={run(onEdit)} hint="E">
          メッセージを編集する
        </MenuItem>
      )}
      {(mine || canModerate) && (
        <MenuItem
          danger
          onClick={run(() =>
            openModal({
              kind: "confirm",
              title: "メッセージを削除する",
              body: "このメッセージを削除してもよろしいですか？この操作は取り消せません。",
              confirmLabel: "削除",
              danger: true,
              onConfirm: () => void deleteMessage(m.id),
            }),
          )}
        >
          メッセージを削除する…
        </MenuItem>
      )}
    </div>
  );
}

function InlineEditor({ m, onDone }: { m: Msg; onDone: () => void }) {
  const initial = decodeMentions(
    m.text,
    (id) => get().members[id]?.displayName,
    (id) => get().directory[id]?.name,
  );
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  });
  const save = () => {
    if (!value.trim()) {
      openModal({
        kind: "confirm",
        title: "メッセージを削除する",
        body: "メッセージが空のため、削除しますか？",
        confirmLabel: "削除",
        danger: true,
        onConfirm: () => void deleteMessage(m.id),
      });
      return;
    }
    void editMessage(m.id, value);
    onDone();
  };
  return (
    <div className="mt-1 rounded-lg border border-line-strong bg-bg focus-within:border-fg-subtle">
      <textarea
        ref={ref}
        value={value}
        aria-label="メッセージを編集"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
        className="block w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none"
        rows={1}
      />
      <div className="flex justify-end gap-2 px-2 pb-2">
        <Button className="h-8" onClick={onDone}>
          キャンセル
        </Button>
        <Button variant="primary" className="h-8" onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );
}

function Reactions({ m, disabled }: { m: Msg; disabled: boolean }) {
  const meId = useStore((s) => s.me?.id);
  const [picker, setPicker] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {m.reactions.map((r) => {
        const mine = !!meId && r.userIds.includes(meId);
        const names = r.userIds.map((u) => (u === meId ? "あなた" : displayName(u)));
        return (
          <button
            key={r.emoji}
            type="button"
            disabled={disabled}
            onClick={() => toggleReaction(m.id, r.emoji)}
            title={`${names.join("、")} が :${r.emoji}: でリアクションしました`}
            aria-pressed={mine}
            className={cx(
              "flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] font-bold",
              mine
                ? "border-link/60 bg-link/10 text-link"
                : "border-transparent bg-bg-muted text-fg-muted hover:border-fg-subtle",
            )}
          >
            <Emoji name={r.emoji} size={15} />
            <span>{r.userIds.length}</span>
          </button>
        );
      })}
      {!disabled && (
        <button
          ref={addRef}
          type="button"
          aria-label="リアクションを追加"
          onClick={() => setPicker(true)}
          className="flex h-6 w-8 items-center justify-center rounded-full bg-bg-muted text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100"
        >
          <SmilePlus size={14} />
        </button>
      )}
      {picker && (
        <Popover anchor={addRef} onClose={() => setPicker(false)}>
          <EmojiPicker
            onPick={(n) => {
              setPicker(false);
              void toggleReaction(m.id, n);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function ThreadSummary({ m }: { m: Msg }) {
  const members = useStore((s) => s.members);
  return (
    <button
      type="button"
      onClick={() => openThread(m.id)}
      className="group/thread mt-1 -ml-1 flex w-full max-w-[600px] items-center gap-2 rounded-md border border-transparent p-1 text-left hover:border-line hover:bg-bg"
    >
      <span className="flex -space-x-0.5">
        {m.replyUserIds.slice(0, 5).map((u) => (
          <Avatar key={u} user={members[u]} size={24} />
        ))}
      </span>
      <span className="font-bold text-[13px] text-link hover:underline">{m.replyCount}件の返信</span>
      {m.lastReplyAt && (
        <>
          <span className="text-[13px] text-fg-subtle group-hover/thread:hidden">
            最終返信: {formatRelative(m.lastReplyAt)}
          </span>
          <span className="hidden text-[13px] text-fg-subtle group-hover/thread:inline">
            スレッドを表示する
          </span>
        </>
      )}
    </button>
  );
}

function BroadcastLabel({ rootId }: { rootId: string }) {
  const root = useStore((s) => s.messages[rootId]);
  return (
    <button
      type="button"
      onClick={() => openThread(rootId)}
      className="mb-0.5 block max-w-full truncate text-left text-[13px] text-fg-muted hover:underline"
    >
      スレッドに返信しました
      {root && !root.deletedAt && (
        <span className="text-fg-subtle">: {root.text.replace(/<[^>]+>/g, "").slice(0, 60)}</span>
      )}
    </button>
  );
}

function SystemMessage({ m, grouped }: { m: Msg; grouped?: boolean }) {
  const author = useStore((s) => s.members[m.userId]);
  const channelName = useStore((s) => s.directory[m.channelId]?.name ?? "");
  const name = author?.displayName ?? "不明なユーザー";
  let body: React.ReactNode;
  const byOther = m.text && /^<@[A-Z0-9]+>$/.test(m.text);
  switch (m.subtype) {
    case "channel_join":
      body = byOther ? (
        <>
          が {<MessageText text={m.text} className="inline [&>p]:inline" />} によって #{channelName}{" "}
          に追加されました
        </>
      ) : (
        <>が #{channelName} に参加しました</>
      );
      break;
    case "channel_leave":
      body = byOther ? (
        <>
          が {<MessageText text={m.text} className="inline [&>p]:inline" />} によって #{channelName}{" "}
          から外されました
        </>
      ) : (
        <>が #{channelName} から退出しました</>
      );
      break;
    case "channel_topic":
      body = m.text ? (
        <>がチャンネルトピックを設定しました: {m.text}</>
      ) : (
        <>がチャンネルトピックをクリアしました</>
      );
      break;
    case "channel_purpose":
      body = m.text ? (
        <>がチャンネルの説明を設定しました: {m.text}</>
      ) : (
        <>がチャンネルの説明をクリアしました</>
      );
      break;
    case "channel_name":
      body = <>がチャンネル名を #{m.text} に変更しました</>;
      break;
    case "channel_archive":
      body = <>がこのチャンネルをアーカイブしました</>;
      break;
    case "channel_unarchive":
      body = <>がこのチャンネルのアーカイブを解除しました</>;
      break;
    default:
      body = m.text;
  }
  return (
    <div
      className={cx("group flex gap-2 px-5 hover:bg-bg-soft", grouped ? "py-0.5" : "pt-2 pb-1")}
      data-message-id={m.id}
    >
      <div className="w-9 shrink-0">
        {!grouped ? (
          <button type="button" onClick={() => openProfile(m.userId)} aria-label={`${name}のプロフィール`}>
            <Avatar user={author} size={36} />
          </button>
        ) : (
          <span className="invisible block text-right text-[11px] text-fg-subtle leading-[22px] group-hover:visible">
            {formatTime(m.createdAt)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => openProfile(m.userId)}
              className="font-bold text-[15px] hover:underline"
            >
              {name}
            </button>
            <span title={formatFull(m.createdAt)} className="text-[12px] text-fg-subtle">
              {formatTime(m.createdAt)}
            </span>
          </div>
        )}
        <p className="text-[15px] text-fg-muted">
          <span className="text-fg-muted">{name} </span>
          {body}
        </p>
      </div>
    </div>
  );
}

export function Attachments({ files }: { files: FileInfo[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {files.map((f) =>
        f.mime.startsWith("image/") && !f.mime.includes("svg") ? (
          <button
            key={f.id}
            type="button"
            onClick={() => openModal({ kind: "imagePreview", url: f.url, name: f.name })}
            className="overflow-hidden rounded-lg border border-line bg-bg-muted"
            title={f.name}
          >
            <img
              src={f.url}
              alt={f.name}
              loading="lazy"
              className="block max-h-[300px] max-w-[min(360px,100%)] object-contain"
            />
          </button>
        ) : f.mime.startsWith("video/") ? (
          // biome-ignore lint/a11y/useMediaCaption: user uploaded media
          <video
            key={f.id}
            src={f.url}
            controls
            className="max-h-[300px] max-w-[min(420px,100%)] rounded-lg border border-line"
          />
        ) : (
          <a
            key={f.id}
            href={`${f.url}?download`}
            className="flex w-[300px] max-w-full items-center gap-3 rounded-lg border border-line bg-bg p-2.5 hover:bg-bg-soft"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#3d6fb6] text-white">
              <FileText size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-[14px]">{f.name}</span>
              <span className="block text-[12px] text-fg-muted">
                {fileKind(f.mime)} · {formatBytes(f.size)}
              </span>
            </span>
            <Download size={16} className="shrink-0 text-fg-subtle" />
          </a>
        ),
      )}
    </div>
  );
}

function fileKind(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("text/")) return "テキスト";
  if (mime.startsWith("audio/")) return "音声";
  if (mime.includes("zip")) return "ZIP";
  if (mime.includes("sheet") || mime.includes("excel")) return "スプレッドシート";
  if (mime.includes("presentation")) return "プレゼンテーション";
  if (mime.includes("word")) return "ドキュメント";
  return "ファイル";
}

/** Compact, read-only message card used in search results, saved items and activity. */
export function MessagePreview({
  m,
  onClick,
  header,
}: {
  m: Msg;
  onClick?: () => void;
  header?: React.ReactNode;
}) {
  const author = useStore((s) => s.members[m.userId]);
  const wid = useStore((s) => s.wid);
  const open =
    onClick ??
    (() => {
      if (wid) navigate(`/w/${wid}/c/${m.channelId}?msg=${m.id}`);
      if (m.threadRootId) openThread(m.threadRootId);
    });
  return (
    // biome-ignore lint/a11y/useSemanticElements: contains nested interactive mentions, so it cannot be a <button>
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      className="block w-full cursor-pointer rounded-lg border border-line bg-bg px-4 py-3 text-left hover:bg-bg-soft"
    >
      {header && <div className="mb-1.5 text-[13px] text-fg-muted">{header}</div>}
      <div className="flex gap-2.5">
        <Avatar user={author} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-[15px]">{author?.displayName ?? "不明なユーザー"}</span>
            <span className="text-[12px] text-fg-subtle">{formatRelative(m.createdAt)}</span>
          </div>
          {m.text && <MessageText text={m.text} edited={!!m.editedAt} className="line-clamp-4 text-[15px]" />}
          {m.files.length > 0 && (
            <p className="mt-1 text-[13px] text-fg-muted">📎 {m.files.map((f) => f.name).join("、")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
