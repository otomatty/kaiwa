import { Fragment, memo, type ReactNode } from "react";
import { type Block, type Inline, isJumboEmoji, parse } from "../../shared/mrkdwn";
import { emojiChar } from "../lib/emoji";
import { navigate } from "../lib/router";
import { openProfile } from "../store/actions";
import { useStore } from "../store/store";
import { cx } from "./ui";

export function Emoji({ name, size }: { name: string; size?: number }) {
  const custom = useStore((s) => s.customEmoji[name]);
  const ch = custom ? null : emojiChar(name);
  if (custom) {
    const px = size ?? 20;
    return (
      <img
        src={custom}
        alt={`:${name}:`}
        title={`:${name}:`}
        className="inline-block align-[-0.25em] object-contain"
        style={{ width: px, height: px }}
        draggable={false}
      />
    );
  }
  if (!ch) return <>{`:${name}:`}</>;
  return (
    <span
      role="img"
      aria-label={name}
      title={`:${name}:`}
      className="inline-block align-[-0.12em] leading-none"
      style={size ? { fontSize: size } : undefined}
    >
      {ch}
    </span>
  );
}

function UserMention({ id }: { id: string }) {
  const name = useStore((s) => s.members[id]?.displayName ?? (s.me?.id === id ? s.me.displayName : null));
  const isMe = useStore((s) => s.me?.id === id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openProfile(id);
      }}
      className={cx(
        "rounded-[3px] px-[2px] font-normal",
        isMe ? "bg-mention text-mention-fg" : "bg-link/12 text-link hover:bg-link/20",
      )}
    >
      @{name ?? "不明なユーザー"}
    </button>
  );
}

function ChannelMention({ id }: { id: string }) {
  const ch = useStore((s) => s.directory[id]);
  const wid = useStore((s) => s.wid);
  if (!ch) return <span className="rounded-[3px] bg-bg-muted px-[2px] text-fg-muted">#非公開チャンネル</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (wid) navigate(`/w/${wid}/c/${id}`);
      }}
      className="rounded-[3px] bg-link/12 px-[2px] text-link hover:bg-link/20"
    >
      #{ch.name}
    </button>
  );
}

function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function renderInline(nodes: Inline[], jumbo: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    const key = i;
    switch (n.t) {
      case "text":
        return <Fragment key={key}>{n.v}</Fragment>;
      case "br":
        return <br key={key} />;
      case "bold":
        return <strong key={key}>{renderInline(n.c, jumbo)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(n.c, jumbo)}</em>;
      case "strike":
        return <del key={key}>{renderInline(n.c, jumbo)}</del>;
      case "code":
        return <code key={key}>{n.v}</code>;
      case "link": {
        const href = safeHref(n.url);
        if (!href) return <Fragment key={key}>{renderInline(n.c, jumbo)}</Fragment>;
        return (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(n.c, jumbo)}
          </a>
        );
      }
      case "user":
        return <UserMention key={key} id={n.id} />;
      case "channel":
        return <ChannelMention key={key} id={n.id} />;
      case "special":
        return (
          <span key={key} className="rounded-[3px] bg-mention px-[2px] text-mention-fg">
            @{n.v}
          </span>
        );
      case "emoji":
        return <Emoji key={key} name={n.name} size={jumbo ? 32 : undefined} />;
    }
    return null;
  });
}

function renderBlocks(blocks: Block[], jumbo: boolean): ReactNode[] {
  return blocks.map((b, i) => {
    const key = i;
    switch (b.t) {
      case "p":
        return (
          <p key={key} className={jumbo ? "text-[32px] leading-[1.25]" : undefined}>
            {renderInline(b.c, jumbo)}
          </p>
        );
      case "pre":
        return <pre key={key}>{b.v}</pre>;
      case "quote":
        return <blockquote key={key}>{renderBlocks(b.c, false)}</blockquote>;
      case "ul":
        return (
          <ul key={key}>
            {b.items.map((it, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content
              <li key={j}>{renderInline(it, false)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key} start={b.start}>
            {b.items.map((it, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content
              <li key={j}>{renderInline(it, false)}</li>
            ))}
          </ol>
        );
    }
    return null;
  });
}

export const MessageText = memo(function MessageText({
  text,
  edited,
  className,
}: {
  text: string;
  edited?: boolean;
  className?: string;
}) {
  const blocks = parse(text);
  const jumbo = isJumboEmoji(blocks);
  return (
    <div className={cx("msg-text", className)}>
      {renderBlocks(blocks, jumbo)}
      {edited && <span className="ml-1 text-[12px] text-fg-subtle">（編集済み）</span>}
    </div>
  );
});
