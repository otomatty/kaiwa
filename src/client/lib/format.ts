const timeFmt = new Intl.DateTimeFormat("ja-JP", { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" });
const dayYearFmt = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const fullFmt = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export const formatTime = (ts: number) => timeFmt.format(ts);
export const formatFull = (ts: number) => fullFmt.format(ts);

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDay(ts: number, now = Date.now()): string {
  const day = startOfDay(ts);
  const today = startOfDay(now);
  if (day === today) return "今日";
  if (day === today - 86_400_000) return "昨日";
  return new Date(ts).getFullYear() === new Date(now).getFullYear()
    ? dayFmt.format(ts)
    : dayYearFmt.format(ts);
}

/** A point in time near now: "今日 18:00", "明日 9:00", "10月30日(金) 9:00". */
export function formatWhen(ts: number, now = Date.now()): string {
  const day = startOfDay(ts);
  const today = startOfDay(now);
  const time = formatTime(ts);
  if (day === today) return `今日 ${time}`;
  if (day === today + 86_400_000) return `明日 ${time}`;
  if (day === today - 86_400_000) return `昨日 ${time}`;
  return `${formatDay(ts, now)} ${time}`;
}

/** "3分前", "昨日", "4月3日" style relative label for lists. */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (startOfDay(ts) === startOfDay(now)) return formatTime(ts);
  if (startOfDay(ts) === startOfDay(now) - 86_400_000) return "昨日";
  return dayFmt.format(ts);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function localTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(Date.now());
  } catch {
    return formatTime(Date.now());
  }
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const chars = [...trimmed];
  // Latin names: first letter of the first two words; otherwise the first character.
  if (/^[A-Za-z]/.test(trimmed)) {
    const words = trimmed.split(/\s+/);
    return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
  }
  return chars[0] ?? "?";
}
