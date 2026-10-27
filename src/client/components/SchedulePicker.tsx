import { useState } from "react";
import { MenuItem, MenuSeparator } from "./ui";

const fmt = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function formatScheduleTime(ts: number): string {
  return fmt.format(ts);
}

function at(daysFromNow: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function nextMonday9(): number {
  const d = new Date();
  const add = (8 - d.getDay()) % 7 || 7;
  return at(add, 9);
}

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Preset send times plus a custom date/time, like other chat apps' "Schedule message". */
export function SchedulePicker({ onPick }: { onPick: (ts: number) => void }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(at(1, 9)));
  const presets: [string, number][] = [];
  const today18 = at(0, 18);
  if (today18 - Date.now() > 60_000) presets.push(["今日 18:00", today18]);
  presets.push(["明日 9:00", at(1, 9)], ["次の月曜日 9:00", nextMonday9()]);
  return (
    <div role="menu">
      <p className="px-5 pt-1 pb-1.5 font-bold text-[13px]">送信日時を指定</p>
      {presets.map(([label, ts]) => (
        <MenuItem key={label} onClick={() => onPick(ts)} hint={formatScheduleTime(ts)}>
          {label}
        </MenuItem>
      ))}
      <MenuSeparator />
      {custom ? (
        <form
          className="space-y-2 px-5 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            const ts = new Date(value).getTime();
            if (!Number.isNaN(ts)) onPick(ts);
          }}
        >
          <input
            type="datetime-local"
            value={value}
            min={toLocalInput(Date.now() + 60_000)}
            onChange={(e) => setValue(e.target.value)}
            aria-label="送信日時"
            className="h-9 w-full rounded-md border border-line-strong bg-bg px-2 text-[14px]"
          />
          <button
            type="submit"
            className="h-8 w-full rounded-md bg-primary font-bold text-[13px] text-primary-fg hover:bg-primary-hover"
          >
            この日時で予約する
          </button>
        </form>
      ) : (
        <MenuItem onClick={() => setCustom(true)}>日時をカスタマイズ…</MenuItem>
      )}
    </div>
  );
}
