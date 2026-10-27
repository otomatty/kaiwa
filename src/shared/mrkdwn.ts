// A small parser for the chat markup used in messages.
//
// Inline:  *bold*  **bold**  _italic_  ~strike~  ~~strike~~  `code`
//          <@USERID>  <#CHANNELID>  <!here> <!channel> <!everyone>
//          <https://url|label>  bare URLs  :emoji_name:
// Blocks:  ```code blocks```   > quotes   - bullet lists   1. ordered lists
// Escapes: \\* \\_ \\~ \\` \\\\ show the character literally.
//
// Emphasis markers must sit on a "word boundary": the opening marker must not be
// preceded by an ASCII letter/digit and the closing marker must not be followed
// by one. This keeps snake_case and 2*3*4 intact while still allowing markup
// directly inside Japanese text (これは*太字*です).

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "strike"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; url: string; c: Inline[] }
  | { t: "user"; id: string }
  | { t: "channel"; id: string }
  | { t: "special"; v: "here" | "channel" | "everyone" }
  | { t: "emoji"; name: string }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "pre"; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] };

const ASCII_WORD = /[A-Za-z0-9]/;
const URL_RE = /^https?:\/\/[^\s<>"]+/;
const TRAILING_PUNCT = /[.,!?;:)\]}'"、。！？」』）】]+$/;
const ANGLE_RE = /^<(@[A-Z0-9]+|#[A-Z0-9]+|![a-z]+|(?:https?:\/\/|mailto:)[^>|\s]+(?:\|[^>\n]+)?)>/;
const EMOJI_RE = /^:([a-z0-9_+\-']+):/;

const MARKERS: Record<string, "bold" | "italic" | "strike"> = {
  "**": "bold",
  "~~": "strike",
  "*": "bold",
  _: "italic",
  "~": "strike",
};

function isOpeningBoundary(s: string, i: number, marker: string): boolean {
  const prev = i > 0 ? (s[i - 1] ?? "") : "";
  const next = s[i + marker.length] ?? "";
  if (prev && ASCII_WORD.test(prev)) return false;
  if (!next || /\s/.test(next)) return false;
  return true;
}

function isClosingBoundary(s: string, j: number, marker: string): boolean {
  const prev = s[j - 1] ?? "";
  const next = s[j + marker.length] ?? "";
  if (!prev || /\s/.test(prev)) return false;
  if (next && ASCII_WORD.test(next)) return false;
  // Avoid treating "**" as closing a single "*" marker.
  if (marker.length === 1 && next === marker) return false;
  return true;
}

function findClosing(s: string, from: number, marker: string): number {
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\n") return -1;
    if (ch === "`") {
      const end = s.indexOf("`", j + 1);
      if (end !== -1) {
        j = end;
        continue;
      }
    }
    if (s.startsWith(marker, j) && j > from && isClosingBoundary(s, j, marker)) return j;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const rest = s.slice(i);

    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }

    // Backslash escapes: \* \_ \~ \` \\ \: render the next character literally.
    if (ch === "\\" && "*_~`\\:<".includes(s[i + 1] ?? "\n")) {
      buf += s[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "<") {
      const m = ANGLE_RE.exec(rest);
      if (m?.[1]) {
        const body = m[1];
        flush();
        if (body.startsWith("@")) out.push({ t: "user", id: body.slice(1) });
        else if (body.startsWith("#")) out.push({ t: "channel", id: body.slice(1) });
        else if (body.startsWith("!")) {
          const v = body.slice(1);
          if (v === "here" || v === "channel" || v === "everyone") out.push({ t: "special", v });
          else out.push({ t: "text", v: m[0] });
        } else {
          const bar = body.indexOf("|");
          const url = bar === -1 ? body : body.slice(0, bar);
          const label = bar === -1 ? url.replace(/^mailto:/, "") : body.slice(bar + 1);
          out.push({ t: "link", url, c: bar === -1 ? [{ t: "text", v: label }] : parseInline(label) });
        }
        i += m[0].length;
        continue;
      }
    }

    if (ch === ":" && (i === 0 || !ASCII_WORD.test(s[i - 1] ?? ""))) {
      const m = EMOJI_RE.exec(rest);
      if (m?.[1]) {
        flush();
        out.push({ t: "emoji", name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && (i === 0 || !ASCII_WORD.test(s[i - 1] ?? ""))) {
      const m = URL_RE.exec(rest);
      if (m) {
        let url = m[0];
        const trail = TRAILING_PUNCT.exec(url);
        if (trail) url = url.slice(0, url.length - trail[0].length);
        // Keep balanced parentheses (e.g. Wikipedia links).
        if (s[i + url.length] === ")" && url.includes("(") && !url.includes(")")) url += ")";
        if (url.length > "https://".length) {
          flush();
          out.push({ t: "link", url, c: [{ t: "text", v: url }] });
          i += url.length;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const double = s[i + 1] === ch && (ch === "*" || ch === "~") ? ch + ch : null;
      const candidates = double ? [double, ch] : [ch];
      let matched = false;
      for (const marker of candidates) {
        if (!isOpeningBoundary(s, i, marker)) continue;
        const close = findClosing(s, i + marker.length, marker);
        if (close === -1) continue;
        const inner = s.slice(i + marker.length, close);
        const kind = MARKERS[marker];
        if (!kind || inner.length === 0) continue;
        flush();
        out.push({ t: kind, c: parseInline(inner) });
        i = close + marker.length;
        matched = true;
        break;
      }
      if (matched) continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET_RE = /^\s*[-•*]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d{1,4})[.)]\s+(.*)$/;

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ t: "p", c: parseInline(para.join("\n")) });
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;

    // Fenced code block. Supports ```inline on one line``` and multi-line fences.
    if (line.trimStart().startsWith("```")) {
      const start = line.trimStart().slice(3);
      const sameLineEnd = start.indexOf("```");
      if (sameLineEnd !== -1) {
        flushPara();
        blocks.push({ t: "pre", v: start.slice(0, sameLineEnd) });
        const after = start.slice(sameLineEnd + 3).trim();
        if (after) para.push(after);
        i++;
        continue;
      }
      // Look for a closing fence.
      let j = i + 1;
      const body: string[] = start ? [start] : [];
      let closed = false;
      while (j < lines.length) {
        const l = lines[j] as string;
        const idx = l.indexOf("```");
        if (idx !== -1) {
          if (idx > 0) body.push(l.slice(0, idx));
          closed = true;
          break;
        }
        body.push(l);
        j++;
      }
      if (closed) {
        flushPara();
        blocks.push({ t: "pre", v: body.join("\n") });
        const tail = (lines[j] as string).slice((lines[j] as string).indexOf("```") + 3).trim();
        if (tail) para.push(tail);
        i = j + 1;
        continue;
      }
    }

    // Quote
    if (/^(>|&gt;)/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^(>|&gt;)/.test(lines[i] as string)) {
        q.push((lines[i] as string).replace(/^(>|&gt;)\s?/, ""));
        i++;
      }
      blocks.push({ t: "quote", c: parse(q.join("\n")) });
      continue;
    }

    // Lists
    if (BULLET_RE.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = BULLET_RE.exec(lines[i] as string);
        if (!m) break;
        items.push(parseInline(m[1] ?? ""));
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }
    const om = ORDERED_RE.exec(line);
    if (om) {
      flushPara();
      const items: Inline[][] = [];
      const start = Number(om[1]);
      while (i < lines.length) {
        const m = ORDERED_RE.exec(lines[i] as string);
        if (!m) break;
        items.push(parseInline(m[2] ?? ""));
        i++;
      }
      blocks.push({ t: "ol", start, items });
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();

  // Drop empty trailing paragraphs produced by trailing newlines.
  return blocks.filter((b) => !(b.t === "p" && b.c.length === 0));
}

/** True when the message consists only of 1–3 emoji (rendered larger, like other chat apps). */
export function isJumboEmoji(blocks: Block[]): boolean {
  if (blocks.length !== 1) return false;
  const b = blocks[0];
  if (b?.t !== "p") return false;
  let count = 0;
  for (const node of b.c) {
    if (node.t === "emoji") count++;
    else if (node.t === "text" && node.v.trim() === "") continue;
    else if (
      node.t === "text" &&
      /^\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*$/u.test(node.v.trim())
    )
      count++;
    else return false;
  }
  return count > 0 && count <= 3;
}

/** Plain-text rendering, used for notifications, previews and search snippets. */
export function toPlainText(
  text: string,
  resolve: { user?: (id: string) => string; channel?: (id: string) => string } = {},
): string {
  const render = (nodes: Inline[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "code":
            return n.v;
          case "bold":
          case "italic":
          case "strike":
            return render(n.c);
          case "link":
            return render(n.c);
          case "user":
            return `@${resolve.user?.(n.id) ?? "user"}`;
          case "channel":
            return `#${resolve.channel?.(n.id) ?? "channel"}`;
          case "special":
            return `@${n.v}`;
          case "emoji":
            return `:${n.name}:`;
          case "br":
            return " ";
        }
        return "";
      })
      .join("");
  const blocks = parse(text);
  const renderBlock = (b: Block): string => {
    switch (b.t) {
      case "p":
        return render(b.c);
      case "pre":
        return b.v;
      case "quote":
        return b.c.map(renderBlock).join(" ");
      case "ul":
      case "ol":
        return b.items.map(render).join(" ");
    }
    return "";
  };
  return blocks.map(renderBlock).join(" ").replace(/\s+/g, " ").trim();
}

/** Extracts mention targets from a message text. */
export function extractMentions(text: string): {
  userIds: string[];
  specials: Set<"here" | "channel" | "everyone">;
} {
  const userIds = new Set<string>();
  const specials = new Set<"here" | "channel" | "everyone">();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === "user") userIds.add(n.id);
      else if (n.t === "special") specials.add(n.v);
      else if (n.t === "bold" || n.t === "italic" || n.t === "strike" || n.t === "link") walk(n.c);
    }
  };
  const walkBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.t === "p") walk(b.c);
      else if (b.t === "quote") walkBlocks(b.c);
      else if (b.t === "ul" || b.t === "ol") for (const item of b.items) walk(item);
    }
  };
  walkBlocks(parse(text));
  return { userIds: [...userIds], specials };
}
