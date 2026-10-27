// Helpers for turning what people type in the composer into stored message text and back.

export interface NamedRef {
  id: string;
  name: string;
}

const SPECIALS = ["here", "channel", "everyone"] as const;
const BOUNDARY_AFTER = /^(?:$|[\s.,!?:;)\]}'"、。！？」』）]|さん|様|くん|ちゃん)/;

function isBoundaryBefore(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1] ?? "";
  return !/[A-Za-z0-9_@#]/.test(prev);
}

/**
 * Converts "@Display Name", "@here" and "#channel" into storage tokens
 * (<@U…>, <!here>, <#C…>). Longest names win so "@Taro Yamada" beats "@Taro".
 */
export function encodeMentions(text: string, users: NamedRef[], channels: NamedRef[]): string {
  const sortedUsers = [...users].filter((u) => u.name).sort((a, b) => b.name.length - a.name.length);
  const sortedChannels = [...channels].filter((c) => c.name).sort((a, b) => b.name.length - a.name.length);
  let out = "";
  let i = 0;
  // Skip code spans/blocks so `@foo` inside code is left untouched.
  while (i < text.length) {
    if (text.startsWith("```", i)) {
      const end = text.indexOf("```", i + 3);
      const stop = end === -1 ? text.length : end + 3;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === "@" && isBoundaryBefore(text, i)) {
      const rest = text.slice(i + 1);
      const special = SPECIALS.find((s) => rest.startsWith(s) && BOUNDARY_AFTER.test(rest.slice(s.length)));
      if (special) {
        out += `<!${special}>`;
        i += 1 + special.length;
        continue;
      }
      const user = sortedUsers.find(
        (u) => rest.startsWith(u.name) && BOUNDARY_AFTER.test(rest.slice(u.name.length)),
      );
      if (user) {
        out += `<@${user.id}>`;
        i += 1 + user.name.length;
        continue;
      }
    }
    if (ch === "#" && isBoundaryBefore(text, i)) {
      const rest = text.slice(i + 1);
      const channel = sortedChannels.find(
        (c) => rest.startsWith(c.name) && BOUNDARY_AFTER.test(rest.slice(c.name.length)),
      );
      if (channel) {
        out += `<#${channel.id}>`;
        i += 1 + channel.name.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Reverse of encodeMentions, used when editing a stored message. */
export function decodeMentions(
  text: string,
  userName: (id: string) => string | undefined,
  channelName: (id: string) => string | undefined,
): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (m, id: string) => {
      const n = userName(id);
      return n ? `@${n}` : m;
    })
    .replace(/<#([A-Z0-9]+)>/g, (m, id: string) => {
      const n = channelName(id);
      return n ? `#${n}` : m;
    })
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:\/\/[^|>]+)>/g, "$1");
}

/** Converts markdown-style [label](url) links to the stored <url|label> form. */
export function encodeLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");
}

export interface ActiveToken {
  trigger: "@" | "#" | ":" | "/";
  query: string;
  start: number;
  end: number;
}

/** Finds the autocomplete token the caret is currently in, if any. */
export function activeToken(value: string, caret: number): ActiveToken | null {
  const before = value.slice(0, caret);
  // Slash commands only at the very start.
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash) return { trigger: "/", query: slash[1] ?? "", start: 0, end: caret };
  const m = /(^|[\s(（「])([@#:])([^\s@#:]*)$/.exec(before);
  if (!m) return null;
  const trigger = m[2] as "@" | "#" | ":";
  const query = m[3] ?? "";
  if (trigger === ":" && query.length < 2) return null;
  return { trigger, query, start: caret - query.length - 1, end: caret };
}

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wraps the current selection with a marker (or inserts an empty pair at the caret). */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before,
): FormatResult {
  const selected = value.slice(start, end);
  // Toggle off when the selection is already wrapped.
  if (
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    const next = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    return { value: next, selectionStart: start - before.length, selectionEnd: end - before.length };
  }
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { value: next, selectionStart: start + before.length, selectionEnd: end + before.length };
}

/** Prefixes each selected line (bullets, numbers, quotes). */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: (index: number) => string,
): FormatResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIdx = value.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const replaced = lines.map((l, i) => prefix(i) + l).join("\n");
  const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
  return { value: next, selectionStart: lineStart, selectionEnd: lineStart + replaced.length };
}

export interface SlashCommand {
  name: string;
  args: string;
}

export function parseSlash(text: string): SlashCommand | null {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  return { name: (m[1] ?? "").toLowerCase(), args: (m[2] ?? "").trim() };
}

export const SLASH_COMMANDS: { name: string; usage: string; description: string }[] = [
  { name: "me", usage: "/me [テキスト]", description: "動作をイタリックで表示します" },
  { name: "shrug", usage: "/shrug [メッセージ]", description: "¯\\_(ツ)_/¯ を付けて送信します" },
  { name: "topic", usage: "/topic [テキスト]", description: "チャンネルのトピックを設定します" },
  { name: "rename", usage: "/rename [新しい名前]", description: "チャンネル名を変更します" },
  { name: "invite", usage: "/invite @ユーザー", description: "このチャンネルにメンバーを追加します" },
  { name: "leave", usage: "/leave", description: "このチャンネルから退出します" },
  { name: "away", usage: "/away", description: "ステータスを「離席中」に切り替えます" },
  { name: "active", usage: "/active", description: "ステータスを「アクティブ」に戻します" },
  { name: "status", usage: "/status :絵文字: [テキスト]", description: "ステータスを設定します" },
  { name: "clear", usage: "/clear", description: "ステータスをクリアします" },
  { name: "search", usage: "/search [キーワード]", description: "メッセージを検索します" },
  { name: "msg", usage: "/msg @ユーザー [メッセージ]", description: "ダイレクトメッセージを送ります" },
];
