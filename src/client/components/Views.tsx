import {
  AtSign,
  CheckCheck,
  Clock,
  FileText,
  Hash,
  Inbox,
  MessageSquareText,
  Pencil,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FileInfo, SearchResult, ThreadSummary } from "../../shared/types";
import { api } from "../lib/api";
import { decodeMentions } from "../lib/compose";
import { formatBytes, formatRelative } from "../lib/format";
import { navigate, routes, useSearchParams } from "../lib/router";
import { parseSearchQuery, searchTerms } from "../lib/search";
import {
  loadScheduled,
  markChannelRead,
  openProfile,
  openThread,
  reportError,
  upsertMessages,
} from "../store/actions";
import { channelLabel, get, set, useStore } from "../store/store";
import { Composer } from "./Composer";
import { ActivityList, SavedList } from "./Lists";
import { MessageItem, MessagePreview } from "./Message";
import { HighlightContext, MessageText as MessageTextBlock } from "./MessageText";
import { formatScheduleTime } from "./SchedulePicker";
import { Avatar, Button, cx, PresenceDot, Spinner, usePresence } from "./ui";

function ViewHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between gap-3 border-line border-b px-5">
      <h1 className="flex items-center gap-2 font-bold text-[18px]">
        {icon}
        {title}
      </h1>
      {children}
    </header>
  );
}

export function ThreadsView() {
  const wid = useStore((s) => s.wid);
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const meId = useStore((s) => s.me?.id);
  const channels = useStore((s) => s.channels);
  const directory = useStore((s) => s.directory);
  const threadState = useStore((s) => s.threads);

  useEffect(() => {
    if (!wid) return;
    api
      .threads(wid)
      .then((r) => {
        setThreads(r.threads);
        upsertMessages(r.threads.flatMap((t) => [t.root, ...t.latestReplies]));
      })
      .catch(reportError);
  }, [wid]);

  // Mark all as read once viewed.
  useEffect(() => {
    if (!threads) return;
    for (const t of threads) {
      const last = t.latestReplies[t.latestReplies.length - 1];
      if (t.unreadCount > 0 && last) api.threadRead(t.root.id, last.createdAt).catch(() => undefined);
    }
    const timer = setTimeout(() => set({ unreadThreads: 0 }), 300);
    return () => clearTimeout(timer);
  }, [threads]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<MessageSquareText size={18} />} title="スレッド" />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-bg-soft">
        <div className="mx-auto max-w-[860px] space-y-4 p-5">
          {!threads ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-fg-muted">
              <MessageSquareText size={32} />
              <p className="font-bold text-[17px] text-fg">参加中のスレッドはまだありません</p>
              <p>スレッドに返信したり、自分のメッセージに返信がつくと、ここにまとめて表示されます。</p>
            </div>
          ) : (
            threads.map((t) => {
              const ch = channels[t.root.channelId] ?? directory[t.root.channelId];
              const loadedReplies = threadState[t.root.id]?.loaded
                ? threadState[t.root.id]?.replyIds.slice(-3)
                : null;
              const replyIds = loadedReplies ?? t.latestReplies.map((r) => r.id);
              const hidden = t.root.replyCount - replyIds.length;
              return (
                <section key={t.root.id} className="overflow-hidden rounded-lg border border-line bg-bg">
                  <div className="flex items-center justify-between px-5 pt-3 pb-1">
                    <p className="font-bold text-[15px]">
                      {ch
                        ? ch.kind === "dm" || ch.kind === "group"
                          ? channelLabel(ch, meId)
                          : `#${ch.name}`
                        : ""}
                    </p>
                    {t.unreadCount > 0 && (
                      <span className="rounded-full bg-badge px-2 font-bold text-[12px] text-white leading-5">
                        新着 {t.unreadCount}
                      </span>
                    )}
                  </div>
                  <MessageItem id={t.root.id} context="thread-root" />
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => openThread(t.root.id)}
                      className="ml-[64px] py-1 font-bold text-[13px] text-link hover:underline"
                    >
                      他 {hidden} 件の返信を表示
                    </button>
                  )}
                  {replyIds.map((id) => (
                    <MessageItem key={id} id={id} context="thread" />
                  ))}
                  <div className="pt-1">
                    <Composer
                      channelId={t.root.channelId}
                      threadRootId={t.root.id}
                      placeholder="返信する…"
                      autoFocus={false}
                    />
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function ActivityView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<AtSign size={18} />} title="メンションとリアクション" />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <ActivityList />
      </div>
    </div>
  );
}

export function LaterView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<Pencil size={18} />} title="後で" />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <SavedList />
      </div>
    </div>
  );
}

export function DraftsView() {
  const wid = useStore((s) => s.wid) as string;
  const channels = useStore((s) => s.channels);
  const meId = useStore((s) => s.me?.id);
  const scheduled = useStore((s) => s.scheduled);
  const tab = useSearchParams().get("tab") === "scheduled" ? "scheduled" : "drafts";
  const [drafts, setDrafts] = useState<{ key: string; cid: string; rootId?: string; text: string }[]>([]);
  useEffect(() => {
    const read = () => {
      const list: typeof drafts = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k?.startsWith("kaiwa:draft:")) continue;
          const [cid, rootId] = k.slice("kaiwa:draft:".length).split(":");
          if (cid && channels[cid]) list.push({ key: k, cid, rootId, text: localStorage.getItem(k) ?? "" });
        }
      } catch {
        // ignore
      }
      setDrafts(list);
    };
    read();
    window.addEventListener("kaiwa:drafts", read);
    return () => window.removeEventListener("kaiwa:drafts", read);
  }, [channels]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<Pencil size={18} />} title="下書きと予約" />
      <div className="flex gap-4 border-line border-b px-5" role="tablist">
        {(
          [
            ["drafts", `下書き ${drafts.length || ""}`],
            ["scheduled", `予約済み ${scheduled.length || ""}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() =>
              navigate(`/w/${wid}/drafts${id === "scheduled" ? "?tab=scheduled" : ""}`, { replace: true })
            }
            className={cx(
              "-mb-px border-b-2 px-1 py-2 text-[14px]",
              tab === id ? "border-primary font-bold" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {label.trim()}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] p-5">
          {tab === "scheduled" ? (
            <ScheduledList />
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-fg-muted">
              <Pencil size={30} />
              <p className="font-bold text-[17px] text-fg">下書きはありません</p>
              <p>送信していないメッセージは自動的に下書きとして保存されます。</p>
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {drafts.map((d) => {
                const ch = channels[d.cid];
                return (
                  <li key={d.key} className="flex items-start gap-3 bg-bg px-4 py-3 hover:bg-bg-soft">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        navigate(routes.channel(wid, d.cid));
                        if (d.rootId) openThread(d.rootId);
                      }}
                    >
                      <p className="font-bold text-[14px]">
                        {ch
                          ? ch.kind === "dm" || ch.kind === "group"
                            ? channelLabel(ch, meId)
                            : `#${ch.name}`
                          : ""}
                        {d.rootId && <span className="ml-1 font-normal text-fg-muted">（スレッド）</span>}
                      </p>
                      <p className="line-clamp-2 text-[14px] text-fg-muted">{d.text}</p>
                    </button>
                    <button
                      type="button"
                      aria-label="下書きを削除"
                      className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-danger"
                      onClick={() => {
                        localStorage.removeItem(d.key);
                        window.dispatchEvent(new Event("kaiwa:drafts"));
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduledList() {
  const scheduled = useStore((s) => s.scheduled);
  const channels = useStore((s) => s.channels);
  const directory = useStore((s) => s.directory);
  const meId = useStore((s) => s.me?.id);
  const wid = useStore((s) => s.wid) as string;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ text: "", when: "" });
  if (scheduled.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-fg-muted">
        <Clock size={30} />
        <p className="font-bold text-[17px] text-fg">予約済みのメッセージはありません</p>
        <p>メッセージ入力欄の送信ボタン横の ▾ から、送信日時を指定できます。</p>
      </div>
    );
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocal = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return (
    <ul
      className="divide-y divide-line overflow-hidden rounded-lg border border-line"
      data-testid="scheduled-list"
    >
      {scheduled.map((s) => {
        const ch = channels[s.channelId] ?? directory[s.channelId];
        const where = ch
          ? ch.kind === "dm" || ch.kind === "group"
            ? channelLabel(ch, meId)
            : `#${ch.name}`
          : "";
        return (
          <li key={s.id} className="bg-bg px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[13px] text-fg-muted">
              <span className="flex items-center gap-1.5">
                <Clock size={13} /> {formatScheduleTime(s.sendAt)} に {where}
                {s.threadRootId ? "（スレッド）" : ""} へ送信
              </span>
            </div>
            {s.error && <p className="mt-1 text-[13px] text-danger">送信できませんでした: {s.error}</p>}
            {editing === s.id ? (
              <form
                className="mt-2 space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api.updateScheduled(s.id, {
                      text: draft.text,
                      sendAt: new Date(draft.when).getTime(),
                    });
                    setEditing(null);
                    await loadScheduled();
                  } catch (err) {
                    reportError(err);
                  }
                }}
              >
                <textarea
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  rows={3}
                  aria-label="予約メッセージ"
                  className="w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[14px]"
                />
                <input
                  type="datetime-local"
                  value={draft.when}
                  onChange={(e) => setDraft({ ...draft, when: e.target.value })}
                  aria-label="送信日時"
                  className="h-9 rounded-md border border-line-strong bg-bg px-2 text-[14px]"
                />
                <div className="flex justify-end gap-2">
                  <Button className="h-8" onClick={() => setEditing(null)}>
                    キャンセル
                  </Button>
                  <Button type="submit" variant="primary" className="h-8">
                    保存
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <MessageTextBlock text={s.text} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    className="h-7 text-[12px]"
                    onClick={async () => {
                      try {
                        await api.sendScheduledNow(s.id);
                        await loadScheduled();
                        navigate(routes.channel(wid, s.channelId));
                      } catch (err) {
                        reportError(err);
                        await loadScheduled();
                      }
                    }}
                  >
                    今すぐ送信
                  </Button>
                  <Button
                    className="h-7 text-[12px]"
                    onClick={() => {
                      setDraft({
                        text: decodeMentions(
                          s.text,
                          (id) => get().members[id]?.displayName,
                          (id) => get().directory[id]?.name,
                        ),
                        when: toLocal(s.sendAt),
                      });
                      setEditing(s.id);
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    className="h-7 text-[12px] text-danger"
                    onClick={async () => {
                      try {
                        await api.deleteScheduled(s.id);
                        await loadScheduled();
                      } catch (err) {
                        reportError(err);
                      }
                    }}
                  >
                    削除
                  </Button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PeopleView() {
  const members = useStore((s) => s.members);
  const [q, setQ] = useState("");
  const list = Object.values(members)
    .filter((m) =>
      [m.displayName, m.fullName, m.title, m.email].some((x) => x.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<Users size={18} />} title="メンバー">
        <Button variant="primary" className="h-8" onClick={() => set({ modal: { kind: "invite" } })}>
          メンバーを招待
        </Button>
      </ViewHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1000px] p-5">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-line-strong px-3 focus-within:border-link">
            <Search size={16} className="text-fg-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="名前・役職・メールで検索"
              aria-label="メンバーを検索"
              className="w-full bg-transparent outline-none"
            />
          </div>
          <p className="mb-3 text-[13px] text-fg-muted">{list.length}人</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((m) => (
              <PersonCard key={m.id} id={m.id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonCard({ id }: { id: string }) {
  const m = useStore((s) => s.members[id]);
  const presence = usePresence(id);
  if (!m) return null;
  return (
    <button
      type="button"
      onClick={() => openProfile(id)}
      className="overflow-hidden rounded-lg border border-line bg-bg text-left hover:shadow-md"
    >
      <Avatar user={m} size={200} className="!h-auto !w-full aspect-square [&>*]:!rounded-none" />
      <div className="p-3">
        <p className="flex items-center gap-1.5 truncate font-bold text-[15px]">
          {m.displayName} <PresenceDot presence={presence} size={9} />
        </p>
        <p className="truncate text-[13px] text-fg-muted">{m.title || m.fullName || " "}</p>
      </div>
    </button>
  );
}

export function FilesView() {
  const wid = useStore((s) => s.wid);
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [q, setQ] = useState("");
  const members = useStore((s) => s.members);
  const directory = useStore((s) => s.directory);
  const meId = useStore((s) => s.me?.id);
  useEffect(() => {
    if (!wid) return;
    api
      .files(wid)
      .then((r) => setFiles(r.files))
      .catch(reportError);
  }, [wid]);
  const shown = (files ?? []).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<FileText size={18} />} title="ファイル" />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[900px] p-5">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-line-strong px-3 focus-within:border-link">
            <Search size={16} className="text-fg-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ファイル名で検索"
              aria-label="ファイルを検索"
              className="w-full bg-transparent outline-none"
            />
          </div>
          {!files ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <p className="py-16 text-center text-fg-muted">共有されたファイルはまだありません。</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {shown.map((f) => {
                const ch = f.channelId ? directory[f.channelId] : undefined;
                return (
                  <li key={f.id} className="flex items-center gap-3 bg-bg px-4 py-2.5 hover:bg-bg-soft">
                    {f.mime.startsWith("image/") ? (
                      <img src={f.url} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded bg-[#3d6fb6] text-white">
                        <FileText size={18} />
                      </span>
                    )}
                    <a href={`${f.url}?download`} className="min-w-0 flex-1">
                      <p className="truncate font-bold text-[14px] hover:underline">{f.name}</p>
                      <p className="truncate text-[12px] text-fg-muted">
                        {members[f.userId]?.displayName} · {formatRelative(f.createdAt)} ·{" "}
                        {formatBytes(f.size)}
                        {ch &&
                          ` · ${ch.kind === "dm" || ch.kind === "group" ? channelLabel(ch, meId) : `#${ch.name}`}`}
                      </p>
                    </a>
                    {f.messageId && f.channelId && wid && (
                      <Button
                        className="h-8 text-[13px]"
                        onClick={() => navigate(`/w/${wid}/c/${f.channelId}?msg=${f.messageId}`)}
                      >
                        メッセージを表示
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchView() {
  const wid = useStore((s) => s.wid) as string;
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [channelFilter, setChannelFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [sort, setSort] = useState<"recent" | "relevance">("recent");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const channels = useStore((s) => s.directory);
  const members = useStore((s) => s.members);
  const meId = useStore((s) => s.me?.id);
  const parsed = useMemo(() => {
    const s = get();
    return parseSearchQuery(
      q,
      Object.values(s.members).map((m) => ({ id: m.id, name: m.displayName })),
      Object.values(s.directory)
        .filter((c) => c.kind === "public" || c.kind === "private")
        .map((c) => ({ id: c.id, name: c.name })),
    );
  }, [q]);

  // A new query starts from a clean set of filters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the query changes
  useEffect(() => {
    setChannelFilter("");
    setUserFilter("");
  }, [q]);

  useEffect(() => {
    setResults(null);
    if (parsed.unknown) {
      setResults([]);
      setHasMore(false);
      return;
    }
    let cancelled = false;
    api
      .search(wid, {
        q: parsed.text,
        channel: channelFilter || parsed.channel,
        user: userFilter || parsed.user,
        sort,
      })
      .then((r) => {
        if (cancelled) return;
        setResults(r.results);
        setHasMore(r.hasMore);
      })
      .catch((err) => {
        reportError(err);
        setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wid, parsed, channelFilter, userFilter, sort]);

  const more = async () => {
    if (!results) return;
    setLoadingMore(true);
    try {
      const r = await api.search(wid, {
        q: parsed.text,
        channel: channelFilter || parsed.channel,
        user: userFilter || parsed.user,
        sort,
        offset: results.length,
      });
      setResults([...results, ...r.results]);
      setHasMore(r.hasMore);
    } catch (err) {
      reportError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<Search size={18} />} title={q ? `「${q}」の検索結果` : "検索"} />
      <div className="flex flex-wrap items-center gap-2 border-line border-b px-5 py-2.5 text-[13px]">
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className={cx(
            "h-8 rounded-full border px-3",
            channelFilter ? "border-link bg-link/10" : "border-line-strong bg-bg",
          )}
          aria-label="チャンネルで絞り込み"
        >
          <option value="">すべての場所</option>
          {Object.values(channels)
            .filter((c) => c.kind === "public" || c.kind === "private" || c.memberIds.length > 0)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "dm" || c.kind === "group" ? channelLabel(c, meId) : `#${c.name}`}
              </option>
            ))}
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className={cx(
            "h-8 rounded-full border px-3",
            userFilter ? "border-link bg-link/10" : "border-line-strong bg-bg",
          )}
          aria-label="送信者で絞り込み"
        >
          <option value="">すべての送信者</option>
          {Object.values(members).map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "recent" | "relevance")}
          className="ml-auto h-8 rounded-full border border-line-strong bg-bg px-3"
          aria-label="並び順"
        >
          <option value="recent">新しい順</option>
          <option value="relevance">関連性の高い順</option>
        </select>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] space-y-2 p-5" data-testid="search-results">
          {!results ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-fg-muted">
              <Search size={30} />
              <p className="font-bold text-[17px] text-fg">一致するメッセージは見つかりませんでした</p>
              {parsed.unknown && (
                <p className="text-danger">
                  {parsed.unknown.kind === "from"
                    ? `「${parsed.unknown.name}」というメンバーは見つかりません。`
                    : `「${parsed.unknown.name}」というチャンネルは見つかりません。`}
                </p>
              )}
              <p>
                別のキーワードを試すか、絞り込みを解除してください。in:#チャンネル名 や from:@名前
                も使えます。
              </p>
            </div>
          ) : (
            <>
              <p className="pb-1 text-[13px] text-fg-muted">
                {results.length}
                {hasMore ? "+" : ""} 件のメッセージ
              </p>
              {results.map((r) => (
                <HighlightContext.Provider key={r.message.id} value={searchTerms(parsed.text)}>
                  <MessagePreview
                    m={r.message}
                    header={
                      <span className="flex items-center gap-1 font-bold">
                        {r.channel.kind === "dm" || r.channel.kind === "group" ? (
                          channelLabel({ ...r.channel, memberIds: r.channel.memberIds }, meId)
                        ) : (
                          <>
                            <Hash size={13} />
                            {r.channel.name}
                          </>
                        )}
                        {r.message.threadRootId && <span className="font-normal">（スレッド）</span>}
                      </span>
                    }
                  />
                </HighlightContext.Provider>
              ))}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button onClick={() => void more()} disabled={loadingMore}>
                    さらに表示
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyDmView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-fg-muted">
      <MessageSquareText size={36} />
      <p className="font-bold text-[18px] text-fg">会話を選択してください</p>
      <p>左のリストからダイレクトメッセージを選ぶか、新しいメッセージを始めましょう。</p>
      <Button variant="primary" className="mt-2" onClick={() => set({ modal: { kind: "newMessage" } })}>
        新規メッセージ
      </Button>
    </div>
  );
}

/** "All unreads": every conversation with unread messages, newest conversations first. */
export function UnreadsView() {
  const wid = useStore((s) => s.wid) as string;
  const meId = useStore((s) => s.me?.id);
  const channels = useStore((s) => s.channels);
  const unread = Object.values(channels)
    .filter((c) => c.unreadCount > 0 && !c.hidden)
    .sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
  const [loaded, setLoaded] = useState<Record<string, { key: string; ids: string[] }>>({});
  const channelKey = (c: (typeof unread)[number]) => `${c.lastReadAt}:${c.unreadCount}`;
  const key = unread.map((c) => `${c.id}:${channelKey(c)}`).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the unread set changes
  useEffect(() => {
    let alive = true;
    for (const c of unread) {
      if (loaded[c.id]?.key === channelKey(c)) continue;
      api
        .messages(c.id, { limit: 50 })
        .then((page) => {
          if (!alive) return;
          upsertMessages(page.messages);
          const ids = page.messages
            .filter(
              (m) => m.createdAt > c.lastReadAt && m.userId !== meId && (!m.subtype || m.subtype === "me"),
            )
            .map((m) => m.id);
          setLoaded((l) => ({ ...l, [c.id]: { key: channelKey(c), ids } }));
        })
        .catch(reportError);
    }
    return () => {
      alive = false;
    };
  }, [key]);

  const markAll = () => {
    for (const c of unread) markChannelRead(c.id, Math.max(Date.now(), c.latestAt ?? 0));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader icon={<Inbox size={18} />} title="すべての未読">
        {unread.length > 0 && (
          <Button className="h-8 text-[13px]" onClick={markAll}>
            <CheckCheck size={15} /> すべて既読にする
          </Button>
        )}
      </ViewHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-bg-soft">
        <div className="mx-auto max-w-[860px] space-y-4 p-5">
          {unread.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-fg-muted">
              <CheckCheck size={34} />
              <p className="font-bold text-[17px] text-fg">未読はありません</p>
              <p>すべてのメッセージを確認しました。</p>
            </div>
          ) : (
            unread.map((c) => (
              <section key={c.id} className="overflow-hidden rounded-lg border border-line bg-bg">
                <div className="flex items-center justify-between gap-3 border-line border-b px-5 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate(routes.channel(wid, c.id))}
                    className="flex items-center gap-1 font-bold text-[15px] hover:underline"
                  >
                    {c.kind === "dm" || c.kind === "group" ? channelLabel(c, meId) : `#${c.name}`}
                    <span className="ml-1 rounded-full bg-bg-muted px-2 font-normal text-[12px] text-fg-muted">
                      {c.unreadCount}件
                    </span>
                  </button>
                  <Button
                    className="h-7 text-[12px]"
                    onClick={() => markChannelRead(c.id, Math.max(Date.now(), c.latestAt ?? 0))}
                  >
                    既読にする
                  </Button>
                </div>
                {!loaded[c.id] ? (
                  <div className="flex justify-center p-4">
                    <Spinner />
                  </div>
                ) : (
                  <div className="py-1">
                    {loaded[c.id]?.ids.map((id) => (
                      <MessageItem key={id} id={id} />
                    ))}
                  </div>
                )}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
