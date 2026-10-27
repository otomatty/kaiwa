import { BellOff, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Presence, User } from "../../shared/types";
import { initials } from "../lib/format";
import { useStore } from "../store/store";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ---------- Avatar ----------

export function Avatar({
  user,
  size = 36,
  presence,
  className,
  ring,
}: {
  user: Pick<User, "displayName" | "avatarColor" | "avatarUrl"> | undefined;
  size?: number;
  presence?: Presence | null;
  className?: string;
  ring?: string;
}) {
  const radius = size <= 20 ? 4 : size <= 36 ? 6 : 10;
  return (
    <span className={cx("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          style={{ borderRadius: radius }}
          draggable={false}
        />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full select-none items-center justify-center font-bold text-white"
          style={{
            borderRadius: radius,
            background: user?.avatarColor ?? "#87969a",
            fontSize: Math.max(9, Math.round(size * 0.42)),
          }}
        >
          {initials(user?.displayName ?? "?")}
        </span>
      )}
      {presence !== undefined && presence !== null && (
        <PresenceDot
          presence={presence}
          className="absolute -right-[3px] -bottom-[3px]"
          size={size <= 24 ? 9 : 11}
          ring={ring}
        />
      )}
    </span>
  );
}

export function PresenceDot({
  presence,
  size = 9,
  className,
  ring = "var(--bg)",
}: {
  presence: Presence;
  size?: number;
  className?: string;
  ring?: string;
}) {
  const active = presence === "active";
  return (
    <span
      role="img"
      aria-label={active ? "アクティブ" : presence === "away" ? "離席中" : "オフライン"}
      className={cx("inline-block rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: active ? "var(--online)" : ring,
        border: `${size <= 9 ? 1.5 : 2}px solid ${active ? ring : "var(--fg-subtle)"}`,
        boxShadow: active ? `0 0 0 ${size <= 9 ? 1.5 : 2}px ${ring}` : `0 0 0 1px ${ring}`,
      }}
    />
  );
}

export function usePresence(userId: string | undefined): Presence {
  return useStore((s) => (userId ? (s.presence[userId] ?? "offline") : "offline"));
}

// ---------- Buttons ----------

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 font-bold text-[14px] transition-colors disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-fg hover:bg-primary-hover",
        variant === "secondary" && "border border-line-strong bg-bg text-fg hover:bg-bg-soft",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        variant === "ghost" && "text-fg-muted hover:bg-bg-muted hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg disabled:opacity-40",
        active && "bg-bg-muted text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  width = 520,
  footer,
  subtitle,
  bodyClassName,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  subtitle?: ReactNode;
  bodyClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focusable = el.querySelector<HTMLElement>(
      "[autofocus], input, textarea, select, button:not([data-close])",
    );
    focusable?.focus();
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 pt-[8vh] pb-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className="flex max-h-[84vh] w-full flex-col rounded-xl bg-bg-elevated text-fg shadow-pop"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-3">
          <div className="min-w-0">
            <h2 className="font-bold text-[22px] leading-tight">{title}</h2>
            {subtitle && <div className="mt-1 text-[14px] text-fg-muted">{subtitle}</div>}
          </div>
          <IconButton label="閉じる" data-close onClick={onClose} className="-mr-2 shrink-0">
            <X size={20} />
          </IconButton>
        </div>
        <div className={cx("scroll-thin min-h-0 flex-1 overflow-y-auto px-7 pb-6", bodyClassName)}>
          {children}
        </div>
        {footer && <div className="flex justify-end gap-2 border-line border-t px-7 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Popover ----------

export function Popover({
  anchor,
  onClose,
  children,
  placement = "bottom-start",
  className,
  offset = 6,
}: {
  anchor: RefObject<HTMLElement | null> | DOMRect;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start" | "left-start";
  className?: string;
  offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const rect = anchor instanceof DOMRect ? anchor : anchor.current?.getBoundingClientRect();
      if (!el || !rect) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = 0;
      let left = 0;
      if (placement.startsWith("bottom")) {
        top = rect.bottom + offset;
        if (top + h > vh - 8 && rect.top - offset - h > 8) top = rect.top - offset - h;
      } else if (placement.startsWith("top")) {
        top = rect.top - offset - h;
        if (top < 8) top = rect.bottom + offset;
      } else {
        top = rect.top;
      }
      if (placement === "right-start") left = rect.right + offset;
      else if (placement === "left-start") left = rect.left - offset - w;
      else left = placement.endsWith("end") ? rect.right - w : rect.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      top = Math.max(8, Math.min(top, vh - h - 8));
      setPos({ top, left });
    };
    place();
    // Re-place when the content changes size (e.g. a menu switching to a sub-view).
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, placement, offset]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (!(anchor instanceof DOMRect) && anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={cx(
        "fixed z-[60] rounded-lg border border-line bg-bg-elevated text-fg shadow-pop",
        className,
      )}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  children,
  onClick,
  danger,
  hint,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center justify-between gap-6 px-5 py-1.5 text-left text-[14.5px] hover:bg-link hover:text-white disabled:opacity-40",
        danger && "text-danger hover:bg-danger",
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {hint && <span className="text-[12px] opacity-70">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1.5 border-line border-t" />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="読み込み中"
      className={cx(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-fg-muted",
        className,
      )}
    />
  );
}

export function TextField({
  label,
  hint,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-bold text-[14px]">{label}</span>
      <input
        {...props}
        className={cx(
          "h-10 w-full rounded-md border bg-bg px-3 text-[15px] outline-none focus:border-link focus:ring-2 focus:ring-link/25",
          error ? "border-danger" : "border-line-strong",
          props.className,
        )}
      />
      {error ? (
        <span className="mt-1 block text-[13px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[13px] text-fg-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** Small "notifications paused" marker shown next to a person's name. */
export function DndIcon({ until, size = 13 }: { until: number | null | undefined; size?: number }) {
  if (!until || until < Date.now()) return null;
  const time = new Date(until).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span title={`通知を一時停止中（${time}まで）`} className="inline-flex text-fg-subtle">
      <BellOff size={size} aria-label="通知を一時停止中" />
    </span>
  );
}
