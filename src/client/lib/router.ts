import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", emit);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const current = window.location.pathname + window.location.search;
  if (to === current) return;
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  emit();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getPath = () => window.location.pathname;
const getSearch = () => window.location.search;

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath, () => "/");
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSearch, () => "");
  return new URLSearchParams(search);
}

/** Matches "/w/:wid/c/:cid" style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] as string;
    const val = s[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

export const routes = {
  channel: (wid: string, cid: string, opts: { msg?: string } = {}) =>
    `/w/${wid}/c/${cid}${opts.msg ? `?msg=${encodeURIComponent(opts.msg)}` : ""}`,
  view: (wid: string, view: string) => `/w/${wid}/${view}`,
  search: (wid: string, q: string) => `/w/${wid}/search?q=${encodeURIComponent(q)}`,
};
