import { ArrowLeft, ArrowRight, CircleHelp, Clock, Hash, Menu, Search, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate, routes, usePath, useSearchParams } from "../lib/router";
import { openModal, set, useStore } from "../store/store";
import { Avatar, cx } from "./ui";

const RECENT_KEY = "kaiwa:recent-searches";

function recentSearches(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 5);
  } catch {
    return [];
  }
}

function rememberSearch(q: string) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([q, ...recentSearches().filter((x) => x !== q)].slice(0, 8)),
    );
  } catch {
    // ignore
  }
}

export function TopBar() {
  const wid = useStore((s) => s.wid) as string;
  const workspace = useStore((s) => s.workspace);
  const connection = useStore((s) => s.connection);
  const path = usePath();
  const params = useSearchParams();
  const currentQ = path.endsWith("/search") ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(currentQ);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const directory = useStore((s) => s.directory);
  const members = useStore((s) => s.members);
  const meId = useStore((s) => s.me?.id);

  useEffect(() => setQ(currentQ), [currentQ]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const query = q.trim().toLowerCase();
  const channelHits = query
    ? Object.values(directory)
        .filter((c) => (c.kind === "public" || c.kind === "private") && c.name.includes(query))
        .slice(0, 4)
    : [];
  const peopleHits = query
    ? Object.values(members)
        .filter((m) => (m.displayName + m.fullName).toLowerCase().includes(query))
        .slice(0, 4)
    : [];
  const recents = query ? [] : recentSearches();

  type Opt = { key: string; node: React.ReactNode; run: () => void };
  const options: Opt[] = [
    ...(query
      ? [
          {
            key: "search",
            node: (
              <>
                <Search size={15} /> 「{q.trim()}」でメッセージを検索
              </>
            ),
            run: () => submit(q.trim()),
          },
        ]
      : []),
    ...recents.map((r) => ({
      key: `r-${r}`,
      node: (
        <>
          <Clock size={15} /> {r}
        </>
      ),
      run: () => submit(r),
    })),
    ...channelHits.map((c) => ({
      key: c.id,
      node: (
        <>
          <Hash size={15} /> {c.name}
        </>
      ),
      run: () => {
        setOpen(false);
        setQ("");
        navigate(routes.channel(wid, c.id));
      },
    })),
    ...peopleHits.map((m) => ({
      key: m.id,
      node: (
        <>
          <Avatar user={m} size={18} /> {m.displayName}
          {m.id === meId && "（自分）"}
          <span className="text-[12px] opacity-70">{m.title}</span>
        </>
      ),
      run: () => {
        setOpen(false);
        setQ("");
        set({ panel: { kind: "profile", userId: m.id } });
      },
    })),
  ];

  function submit(text: string) {
    if (!text) return;
    rememberSearch(text);
    setOpen(false);
    inputRef.current?.blur();
    navigate(routes.search(wid, text));
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-rail px-3 text-sidebar-fg">
      <button
        type="button"
        aria-label="メニュー"
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 md:hidden"
        onClick={() => set((s) => ({ mobileSidebar: !s.mobileSidebar }))}
      >
        <Menu size={18} />
      </button>
      <div className="hidden w-[300px] shrink-0 items-center gap-1 md:flex">
        <button
          type="button"
          aria-label="戻る"
          title="戻る"
          onClick={() => window.history.back()}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="進む"
          title="進む"
          onClick={() => window.history.forward()}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <div ref={boxRef} className="relative mx-auto w-full max-w-[720px]">
        <div
          className={cx(
            "flex h-7 items-center gap-2 rounded-md px-2.5",
            open ? "bg-bg text-fg shadow-pop" : "bg-white/15 hover:bg-white/20",
          )}
        >
          <Search size={14} className="shrink-0 opacity-80" />
          <input
            ref={inputRef}
            data-search-input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, -1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const opt = options[active];
                if (opt) opt.run();
                else submit(q.trim());
              } else if (e.key === "Escape") {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
            placeholder={`${workspace?.name ?? ""} 内を検索`}
            aria-label="検索"
            className={cx(
              "h-full w-full bg-transparent text-[13px] outline-none",
              open ? "placeholder:text-fg-subtle" : "text-white placeholder:text-sidebar-fg",
            )}
          />
        </div>
        {open && options.length > 0 && (
          <div className="absolute top-full right-0 left-0 z-40 mt-1 overflow-hidden rounded-lg border border-line bg-bg-elevated py-2 text-fg shadow-pop">
            {!query && <p className="px-4 pb-1 font-bold text-[12px] text-fg-muted">最近の検索</p>}
            {options.map((o, i) => (
              <button
                key={o.key}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={o.run}
                className={cx(
                  "flex w-full items-center gap-2 px-4 py-1.5 text-left text-[14px]",
                  i === active ? "bg-link text-white" : "",
                )}
              >
                {o.node}
              </button>
            ))}
            <p className="mt-1 border-line border-t px-4 pt-2 text-[12px] text-fg-subtle">
              ヒント: <code>in:#チャンネル名</code> <code>from:@名前</code> で絞り込めます
            </p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 md:w-[300px]">
        {connection === "offline" && (
          <span
            className="flex items-center gap-1 rounded bg-badge px-2 py-0.5 text-[12px] text-white"
            role="status"
          >
            <WifiOff size={13} /> 再接続中…
          </span>
        )}
        <button
          type="button"
          aria-label="ヘルプ"
          title="キーボードショートカット"
          onClick={() => openModal({ kind: "shortcuts" })}
          className="hidden h-7 w-7 items-center justify-center rounded hover:bg-white/10 md:flex"
        >
          <CircleHelp size={16} />
        </button>
      </div>
    </div>
  );
}
