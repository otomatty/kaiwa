import { useEffect, useState } from "react";
import { type Block, type Inline, parse } from "../../shared/mrkdwn";
import type { Unfurl } from "../../shared/types";

const cache = new Map<string, Promise<Unfurl | null>>();

function fetchUnfurl(url: string): Promise<Unfurl | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/unfurl?url=${encodeURIComponent(url)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Unfurl>) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** Up to `max` distinct http(s) links in a message (code is excluded by the parser). */
export function linksIn(text: string, max = 2): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (out.length >= max) return;
      if (n.t === "link" && /^https?:\/\//i.test(n.url) && !out.includes(n.url)) out.push(n.url);
      else if (n.t === "bold" || n.t === "italic" || n.t === "strike") walk(n.c);
    }
  };
  const walkBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.t === "p") walk(b.c);
      else if (b.t === "ul" || b.t === "ol") for (const i of b.items) walk(i);
    }
  };
  walkBlocks(parse(text));
  return out;
}

export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<Unfurl | null>(null);
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    let alive = true;
    void fetchUnfurl(url).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!data || (!data.title && !data.image)) return null;
  return (
    <div
      className="mt-1.5 flex max-w-[520px] gap-3 border-line-strong border-l-4 pl-3"
      data-testid="link-preview"
    >
      <div className="min-w-0 flex-1">
        {data.siteName && <p className="truncate font-bold text-[13px] text-fg-muted">{data.siteName}</p>}
        {data.title && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="line-clamp-2 font-bold text-[15px] text-link hover:underline"
          >
            {data.title}
          </a>
        )}
        {data.description && <p className="line-clamp-3 text-[14px] text-fg">{data.description}</p>}
        {data.image && imgOk && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 block">
            <img
              src={data.image}
              alt=""
              loading="lazy"
              onError={() => setImgOk(false)}
              className="max-h-[220px] max-w-full rounded-md border border-line object-cover"
            />
          </a>
        )}
      </div>
    </div>
  );
}
