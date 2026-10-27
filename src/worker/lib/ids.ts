// Time-sortable identifiers (ULID-style, Crockford base32) with a one-letter type prefix.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number, len: number): string {
  let out = "";
  let n = ms;
  for (let i = 0; i < len; i++) {
    out = (ALPHABET[n % 32] as string) + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

export type IdPrefix = "U" | "T" | "C" | "D" | "G" | "M" | "F" | "B";

export function newId(prefix: IdPrefix, now = Date.now()): string {
  return `${prefix}${encodeTime(now, 10)}${encodeRandom(12)}`;
}

export function randomCode(len = 12): string {
  return encodeRandom(len).toLowerCase();
}

const AVATAR_COLORS = [
  "#2F6F73",
  "#7A4E9E",
  "#B5543C",
  "#3D6FB6",
  "#8A6A1F",
  "#3F7F4F",
  "#A3456F",
  "#5A5FA8",
  "#9C5B2E",
  "#2E7C93",
];

export function pickColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] as string;
}
