// Parses search modifiers out of a query: in:#channel and from:@name.
// Names may contain spaces (common for Japanese names), so we match the longest
// known name, and also accept quotes: from:@"鈴木 ボブ".

export interface NamedRef {
  id: string;
  name: string;
}

export interface ParsedSearch {
  text: string;
  channel?: string;
  user?: string;
  /** A modifier that named an unknown channel/person. */
  unknown?: { kind: "in" | "from"; name: string };
}

function takeModifier(
  text: string,
  keyword: "in" | "from",
  sigil: "#" | "@",
  refs: NamedRef[],
): { text: string; id?: string; unknown?: string } {
  const re = new RegExp(`(^|\\s)${keyword}:${sigil}?`);
  const m = re.exec(text);
  if (!m) return { text };
  const start = m.index + (m[1]?.length ?? 0);
  const afterKeyword = m.index + m[0].length;
  const rest = text.slice(afterKeyword);
  let name: string;
  let consumed: number;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    name = end === -1 ? rest.slice(1) : rest.slice(1, end);
    consumed = end === -1 ? rest.length : end + 1;
  } else {
    const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);
    const hit = sorted.find((r) => rest.startsWith(r.name) && /^(\s|$)/.test(rest.slice(r.name.length)));
    if (hit) {
      name = hit.name;
      consumed = hit.name.length;
    } else {
      name = /^\S*/.exec(rest)?.[0] ?? "";
      consumed = name.length;
    }
  }
  const remaining = `${text.slice(0, start)} ${text.slice(afterKeyword + consumed)}`
    .replace(/\s+/g, " ")
    .trim();
  const ref =
    refs.find((r) => r.name === name) ?? refs.find((r) => r.name.toLowerCase() === name.toLowerCase());
  return ref ? { text: remaining, id: ref.id } : { text: remaining, unknown: name };
}

export function parseSearchQuery(raw: string, members: NamedRef[], channels: NamedRef[]): ParsedSearch {
  const out: ParsedSearch = { text: raw.trim() };
  const inMod = takeModifier(out.text, "in", "#", channels);
  out.text = inMod.text;
  if (inMod.id) out.channel = inMod.id;
  else if (inMod.unknown !== undefined) out.unknown = { kind: "in", name: inMod.unknown };
  const fromMod = takeModifier(out.text, "from", "@", members);
  out.text = fromMod.text;
  if (fromMod.id) out.user = fromMod.id;
  else if (fromMod.unknown !== undefined) out.unknown = { kind: "from", name: fromMod.unknown };
  return out;
}

/** Search terms for highlighting: quoted phrases stay together. */
export function searchTerms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? "").trim();
    if (t) out.push(t);
  }
  return out;
}
