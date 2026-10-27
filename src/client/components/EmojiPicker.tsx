import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EMOJI, type Emoji, emojiChar, GROUPS, recentEmoji, rememberEmoji, searchEmoji } from "../lib/emoji";
import { cx } from "./ui";

/** Emoji picker. Calls onPick with the shortcode name (e.g. "+1"). */
export function EmojiPicker({
  onPick,
  autoFocus = true,
}: {
  onPick: (name: string) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Emoji | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => (query ? searchEmoji(query, 120) : null), [query]);
  const grouped = useMemo(() => {
    const map = new Map<number, Emoji[]>();
    for (const e of EMOJI) map.set(e.group, [...(map.get(e.group) ?? []), e]);
    return map;
  }, []);
  const recent = recentEmoji()
    .map((n) => EMOJI.find((e) => e.names.includes(n)))
    .filter((e): e is Emoji => !!e);

  const pick = (e: Emoji) => {
    const name = e.names[0] as string;
    rememberEmoji(name);
    onPick(name);
  };

  const cell = (e: Emoji) => (
    <button
      key={e.char + e.names[0]}
      type="button"
      onClick={() => pick(e)}
      onMouseEnter={() => setHover(e)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-[22px] leading-none hover:bg-bg-muted"
      aria-label={e.names[0]}
    >
      {e.char}
    </button>
  );

  return (
    <div className="flex w-[352px] flex-col" data-testid="emoji-picker">
      <div className="p-3 pb-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-line-strong px-2 focus-within:border-link">
          <Search size={15} className="text-fg-subtle" />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.[0]) {
                e.preventDefault();
                pick(results[0]);
              }
            }}
            placeholder="絵文字を検索（英語名）"
            className="w-full bg-transparent text-[14px] outline-none"
          />
        </div>
      </div>
      {!results && (
        <div className="flex gap-0.5 border-line border-b px-3 pb-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.label}
              className="flex h-7 w-7 items-center justify-center rounded text-[16px] opacity-70 hover:bg-bg-muted hover:opacity-100"
              onClick={() => {
                scrollRef.current
                  ?.querySelector(`[data-group="${g.id}"]`)
                  ?.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="scroll-thin h-[280px] overflow-y-auto px-2.5 py-1">
        {results ? (
          results.length > 0 ? (
            <div className="grid grid-cols-9">{results.map(cell)}</div>
          ) : (
            <p className="px-2 py-8 text-center text-[13px] text-fg-muted">
              「{query}」に一致する絵文字はありません
            </p>
          )
        ) : (
          <>
            <Section title="よく使う絵文字">{recent.map(cell)}</Section>
            {GROUPS.map((g) => (
              <Section key={g.id} title={g.label} group={g.id}>
                {(grouped.get(g.id) ?? []).map(cell)}
              </Section>
            ))}
          </>
        )}
      </div>
      <div className="flex h-11 items-center gap-2 border-line border-t px-3 text-[13px]">
        {hover ? (
          <>
            <span className="text-[22px]">{hover.char}</span>
            <span className="truncate font-bold">:{hover.names[0]}:</span>
          </>
        ) : (
          <span className="text-fg-muted">絵文字を選択してください</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, group }: { title: string; children: React.ReactNode; group?: number }) {
  return (
    <div data-group={group}>
      <div className="sticky top-0 z-[1] bg-bg-elevated/95 px-1 py-1.5 font-bold text-[12px] text-fg-muted">
        {title}
      </div>
      <div className="grid grid-cols-9">{children}</div>
    </div>
  );
}

export function QuickReactions({
  onPick,
  className,
}: {
  onPick: (name: string) => void;
  className?: string;
}) {
  // Like other chat apps, the hover bar offers the reactions you use most.
  const recent = recentEmoji();
  const names = [...new Set([...recent, "white_check_mark", "eyes", "raised_hands"])].slice(0, 3);
  return (
    <>
      {names.map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`:${n}: でリアクション`}
          title={`:${n}:`}
          onClick={() => onPick(n)}
          className={cx(
            "flex h-8 w-8 items-center justify-center rounded-md text-[17px] hover:bg-bg-muted",
            className,
          )}
        >
          {emojiChar(n)}
        </button>
      ))}
    </>
  );
}
