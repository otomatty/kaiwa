import { AlarmClock, AtSign, Bookmark, Check, MessageSquareText, RotateCcw, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toPlainText } from "../../shared/mrkdwn";
import type { ActivityItem, SavedItem } from "../../shared/types";
import { api } from "../lib/api";
import { emojify } from "../lib/emoji";
import { formatRelative, formatWhen } from "../lib/format";
import { navigate } from "../lib/router";
import { completeSaved, openThread, reportError, setReminder, upsertMessages } from "../store/actions";
import { channelLabel, displayName, get, set, useStore } from "../store/store";
import { Emoji } from "./MessageText";
import { ReminderPicker } from "./SchedulePicker";
import { Avatar, cx, Popover, Spinner } from "./ui";

function useChannelName() {
  const meId = useStore((s) => s.me?.id);
  const channels = useStore((s) => s.channels);
  const directory = useStore((s) => s.directory);
  return (cid: string) => {
    const ch = channels[cid] ?? directory[cid];
    if (!ch) return "";
    return ch.kind === "dm" || ch.kind === "group" ? channelLabel(ch, meId) : `#${ch.name}`;
  };
}

function plain(text: string) {
  return emojify(
    toPlainText(text, { user: displayName, channel: (id) => get().directory[id]?.name ?? "channel" }),
  );
}

function openMessage(channelId: string, messageId: string, threadRootId: string | null) {
  const wid = get().wid;
  if (!wid) return;
  if (threadRootId) {
    navigate(`/w/${wid}/c/${channelId}?msg=${threadRootId}`);
    openThread(threadRootId);
  } else {
    navigate(`/w/${wid}/c/${channelId}?msg=${messageId}`);
  }
  set({ mobileSidebar: false });
}

export function ActivityList({ dark }: { dark?: boolean }) {
  const wid = useStore((s) => s.wid);
  const version = useStore((s) => s.activityVersion);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | "mention" | "reply" | "reaction">("all");
  const channelName = useChannelName();
  const members = useStore((s) => s.members);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on activity version
  useEffect(() => {
    if (!wid) return;
    let cancelled = false;
    api
      .activity(wid)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        upsertMessages(r.items.map((i) => i.message));
      })
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [wid, version]);

  const shown = (items ?? []).filter((i) => filter === "all" || i.kind === filter);
  const tabs: { id: typeof filter; label: string }[] = [
    { id: "all", label: "すべて" },
    { id: "mention", label: "メンション" },
    { id: "reply", label: "スレッド" },
    { id: "reaction", label: "リアクション" },
  ];

  return (
    <div className={cx(dark ? "" : "mx-auto w-full max-w-[760px] px-5 py-4")}>
      <div className={cx("flex flex-wrap gap-1", dark ? "px-3 py-3" : "mb-3")}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={cx(
              "shrink-0 rounded-full px-3 py-1 text-[13px]",
              dark
                ? filter === t.id
                  ? "bg-white font-bold text-sidebar"
                  : "bg-white/10 hover:bg-white/20"
                : filter === t.id
                  ? "bg-fg font-bold text-bg"
                  : "bg-bg-muted hover:bg-line",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!items ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <p className={cx("px-4 py-10 text-center text-[14px]", dark ? "" : "text-fg-muted")}>
          新しいアクティビティはありません。メンションやスレッドへの返信、リアクションがここに表示されます。
        </p>
      ) : (
        <ul className={cx(!dark && "divide-y divide-line overflow-hidden rounded-lg border border-line")}>
          {shown.map((i) => {
            const actor = i.kind === "reaction" ? i.userId : i.message.userId;
            return (
              <li key={`${i.kind}-${i.message.id}-${i.kind === "reaction" ? i.emoji + i.userId : ""}`}>
                <button
                  type="button"
                  onClick={() => openMessage(i.message.channelId, i.message.id, i.message.threadRootId)}
                  className={cx(
                    "flex w-full gap-3 px-4 py-3 text-left",
                    dark ? "border-white/10 border-b hover:bg-sidebar-hover" : "bg-bg hover:bg-bg-soft",
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar user={members[actor]} size={36} />
                    <span
                      className={cx(
                        "absolute -right-1.5 -bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2",
                        dark ? "ring-sidebar" : "ring-bg",
                        i.kind === "mention"
                          ? "bg-badge"
                          : i.kind === "reply"
                            ? "bg-[#3d6fb6]"
                            : "bg-[#c48a00]",
                      )}
                    >
                      {i.kind === "mention" ? (
                        <AtSign size={11} />
                      ) : i.kind === "reply" ? (
                        <MessageSquareText size={11} />
                      ) : (
                        <SmilePlus size={11} />
                      )}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className={cx("truncate", dark ? "opacity-80" : "text-fg-muted")}>
                        {i.kind === "mention"
                          ? `${channelName(i.message.channelId)} でのメンション`
                          : i.kind === "reply"
                            ? `${channelName(i.message.channelId)} のスレッド`
                            : `${channelName(i.message.channelId)} のあなたのメッセージ`}
                      </span>
                      <span className={cx("shrink-0", dark ? "opacity-70" : "text-fg-subtle")}>
                        {formatRelative(i.at)}
                      </span>
                    </span>
                    <span className={cx("block font-bold text-[14px]", dark && "text-sidebar-strong")}>
                      {displayName(actor)}
                      {i.kind === "reaction" && (
                        <span className="font-normal">
                          {" "}
                          が <Emoji name={i.emoji} size={15} /> でリアクションしました
                        </span>
                      )}
                    </span>
                    <span className={cx("line-clamp-2 text-[14px]", dark ? "opacity-85" : "text-fg-muted")}>
                      {plain(i.message.text) || "（ファイル）"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SavedList({ dark }: { dark?: boolean }) {
  const wid = useStore((s) => s.wid);
  const version = useStore((s) => s.activityVersion);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const members = useStore((s) => s.members);
  const channelName = useChannelName();

  // Only show the spinner when switching tabs; background refreshes keep the list in place.
  const shownKey = useRef("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on version
  useEffect(() => {
    if (!wid) return;
    let cancelled = false;
    const key = `${wid}:${tab}`;
    if (shownKey.current !== key) setItems(null);
    shownKey.current = key;
    api
      .saved(wid, tab === "done")
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        upsertMessages(r.items.map((i) => i.message));
      })
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [wid, tab, version]);

  const complete = async (i: SavedItem, done: boolean) => {
    if (await completeSaved(i.message.id, done))
      setItems((list) => (list ? list.filter((x) => x.message.id !== i.message.id) : list));
  };

  return (
    <div className={cx(dark ? "" : "mx-auto w-full max-w-[760px] px-5 py-4")}>
      <div className={cx("flex gap-1", dark ? "px-3 py-3" : "mb-3")}>
        {(
          [
            ["open", "進行中"],
            ["done", "完了"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cx(
              "rounded-full px-3 py-1 text-[13px]",
              dark
                ? tab === id
                  ? "bg-white font-bold text-sidebar"
                  : "bg-white/10 hover:bg-white/20"
                : tab === id
                  ? "bg-fg font-bold text-bg"
                  : "bg-bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {!items ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-[14px]">
          <Bookmark size={26} />
          {tab === "open" ? (
            <p>
              あとで見返したいメッセージは、メッセージにカーソルを合わせて「後で用に保存」を選ぶとここに表示されます。
            </p>
          ) : (
            <p>完了したアイテムはまだありません。</p>
          )}
        </div>
      ) : (
        <ul>
          {items.map((i) => (
            <li
              key={i.message.id}
              className={cx(
                "group/saved relative flex gap-3 px-4 py-3",
                dark
                  ? "border-white/10 border-b hover:bg-sidebar-hover"
                  : "border-line border-b hover:bg-bg-soft",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 gap-3 text-left"
                onClick={() => openMessage(i.message.channelId, i.message.id, i.message.threadRootId)}
              >
                <Avatar user={members[i.message.userId]} size={32} />
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[12px]", dark ? "opacity-75" : "text-fg-muted")}>
                    {channelName(i.message.channelId)} · {formatRelative(i.savedAt)}に保存
                  </span>
                  {i.remindAt && tab === "open" && <ReminderLabel at={i.remindAt} dark={dark} />}
                  <span className={cx("block font-bold text-[14px]", dark && "text-sidebar-strong")}>
                    {displayName(i.message.userId)}
                  </span>
                  <span className="line-clamp-2 text-[14px] opacity-90">
                    {plain(i.message.text) || "（ファイル）"}
                  </span>
                </span>
              </button>
              <div
                className={cx(
                  "flex shrink-0 items-start gap-1.5",
                  // In the narrow sidebar the actions float over the item on hover/focus,
                  // so the message text keeps the full width.
                  dark &&
                    "absolute top-2.5 right-3 rounded-full bg-sidebar-hover p-0.5 opacity-0 group-hover/saved:opacity-100 focus-within:opacity-100",
                )}
              >
                {tab === "open" && <ReminderButton item={i} dark={dark} />}
                <button
                  type="button"
                  title={tab === "open" ? "完了にする" : "進行中に戻す"}
                  aria-label={tab === "open" ? "完了にする" : "進行中に戻す"}
                  onClick={() => void complete(i, tab === "open")}
                  className={cx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                    dark ? "border-white/30 hover:bg-white/15" : "border-line-strong hover:bg-bg-muted",
                  )}
                >
                  {tab === "open" ? <Check size={14} /> : <RotateCcw size={14} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReminderLabel({ at, dark }: { at: number; dark?: boolean }) {
  // Re-render once the reminder time passes so the label turns into "overdue".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const wait = at - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 500);
    return () => clearTimeout(t);
  }, [at]);
  const overdue = at <= now;
  return (
    <span
      className={cx(
        "mt-0.5 flex items-center gap-1 font-bold text-[12px]",
        overdue ? (dark ? "text-[#ff8a8a]" : "text-danger") : dark ? "opacity-90" : "text-fg-muted",
      )}
    >
      <AlarmClock size={12} aria-hidden />
      {overdue ? `期限切れ: ${formatWhen(at)}` : `リマインダー: ${formatWhen(at)}`}
    </span>
  );
}

function ReminderButton({ item, dark }: { item: SavedItem; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = item.remindAt ? "リマインダーを変更" : "リマインダーを設定";
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cx(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          dark ? "border-white/30 hover:bg-white/15" : "border-line-strong hover:bg-bg-muted",
        )}
      >
        <AlarmClock size={14} />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} placement="bottom-end" className="w-72 py-2">
          <ReminderPicker
            onPick={(ts) => {
              setOpen(false);
              void setReminder(item.message.id, ts);
            }}
            onClear={
              item.remindAt
                ? () => {
                    setOpen(false);
                    void setReminder(item.message.id, null);
                  }
                : undefined
            }
          />
        </Popover>
      )}
    </>
  );
}
