import data from "../../shared/emoji-data.json";

type Row = [string, string[], number, string];
const rows = data as Row[];

export interface Emoji {
  char: string;
  names: string[];
  group: number;
  tags: string;
  /** Set for workspace custom emoji (rendered as an image). */
  url?: string;
}

export function customEmojiList(map: Record<string, string>): Emoji[] {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, url]) => ({ char: "", names: [name], group: -1, tags: "", url }));
}

/** Standard + custom search, custom matches first. */
export function searchAllEmoji(query: string, custom: Record<string, string>, limit = 50): Emoji[] {
  const q = query.toLowerCase().replace(/^:/, "");
  const customHits = customEmojiList(custom).filter((e) => !q || (e.names[0] as string).includes(q));
  return [...customHits, ...searchEmoji(query, limit)].slice(0, limit);
}

export const EMOJI: Emoji[] = rows.map(([char, names, group, tags]) => ({ char, names, group, tags }));

const byName = new Map<string, Emoji>();
for (const e of EMOJI) for (const n of e.names) if (!byName.has(n)) byName.set(n, e);

// A few common aliases people type.
const ALIASES: Record<string, string> = {
  thumbsup: "+1",
  thumbs_up: "+1",
  thumbsdown: "-1",
  ok: "ok_hand",
  pray: "pray",
  smile: "smile",
};
for (const [alias, target] of Object.entries(ALIASES)) {
  const e = byName.get(target);
  if (e && !byName.has(alias)) byName.set(alias, e);
}

export function emojiChar(name: string): string | null {
  return byName.get(name)?.char ?? null;
}

/** Canonical shortcode for a unicode emoji (used when a picker returns the char). */
export function emojiName(char: string): string | null {
  const e = EMOJI.find((x) => x.char === char);
  return e?.names[0] ?? null;
}

export const GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: "スマイリーと感情", icon: "😀" },
  { id: 1, label: "人と体", icon: "👋" },
  { id: 3, label: "動物と自然", icon: "🐻" },
  { id: 4, label: "食べ物と飲み物", icon: "🍔" },
  { id: 5, label: "旅行と場所", icon: "🚗" },
  { id: 6, label: "アクティビティ", icon: "⚽" },
  { id: 7, label: "物", icon: "💡" },
  { id: 8, label: "記号", icon: "❤️" },
  { id: 9, label: "旗", icon: "🏁" },
];

export function searchEmoji(query: string, limit = 50): Emoji[] {
  const q = query.toLowerCase().replace(/^:/, "");
  if (!q) return EMOJI.slice(0, limit);
  const starts: Emoji[] = [];
  const contains: Emoji[] = [];
  const tagged: Emoji[] = [];
  for (const e of EMOJI) {
    if (e.names.some((n) => n.startsWith(q))) starts.push(e);
    else if (e.names.some((n) => n.includes(q))) contains.push(e);
    else if (e.tags.includes(q)) tagged.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains, ...tagged].slice(0, limit);
}

const RECENT_KEY = "kaiwa:recent-emoji";
const DEFAULT_RECENT = ["white_check_mark", "eyes", "raised_hands", "+1", "pray", "tada", "heart", "joy"];

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "null") as string[] | null;
    return Array.isArray(v) && v.length > 0 ? v : DEFAULT_RECENT;
  } catch {
    return DEFAULT_RECENT;
  }
}

export function rememberEmoji(name: string) {
  try {
    const next = [name, ...recentEmoji().filter((n) => n !== name)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
}

/** Replaces :shortcode: with the emoji character (for plain-text previews and notifications). */
export function emojify(text: string): string {
  return text.replace(/:([a-z0-9_+\-']+):/g, (m, name: string) => emojiChar(name) ?? m);
}
