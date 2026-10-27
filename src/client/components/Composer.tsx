import {
  AtSign,
  Bold,
  Code,
  FileText,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  SendHorizontal,
  Smile,
  SquareCode,
  Strikethrough,
  TextQuote,
  Type,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LIMITS } from "../../shared/limits";
import type { FileInfo } from "../../shared/types";
import { api, uploadFile } from "../lib/api";
import {
  type ActiveToken,
  activeToken,
  type FormatResult,
  parseSlash,
  prefixLines,
  SLASH_COMMANDS,
  wrapSelection,
} from "../lib/compose";
import { searchAllEmoji } from "../lib/emoji";
import { formatBytes } from "../lib/format";
import { navigate, routes } from "../lib/router";
import {
  encodeOutgoing,
  leaveChannel,
  openDm,
  reportError,
  sendMessage,
  updateChannel,
} from "../store/actions";
import { sendEvent } from "../store/realtime";
import { channelLabel, get, toast, useStore } from "../store/store";
import { EmojiPicker } from "./EmojiPicker";
import { Avatar, cx, Popover } from "./ui";

interface Upload {
  key: string;
  file: File;
  progress: number;
  info?: FileInfo;
  error?: string;
  abort?: () => void;
}

interface Suggestion {
  key: string;
  label: React.ReactNode;
  sub?: string;
  insert: string;
}

const draftKey = (cid: string, rootId?: string | null) => `kaiwa:draft:${cid}${rootId ? `:${rootId}` : ""}`;

function saveDraft(key: string, value: string) {
  try {
    const prev = localStorage.getItem(key) ?? "";
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    if (prev !== (value.trim() ? value : "")) window.dispatchEvent(new Event("kaiwa:drafts"));
  } catch {
    // storage unavailable
  }
}

export function readDraft(cid: string, rootId?: string | null): string {
  try {
    return localStorage.getItem(draftKey(cid, rootId)) ?? "";
  } catch {
    return "";
  }
}

export function Composer({
  channelId,
  threadRootId,
  placeholder,
  autoFocus = true,
}: {
  channelId: string;
  threadRootId?: string | null;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(() => readDraft(channelId, threadRootId));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [token, setToken] = useState<ActiveToken | null>(null);
  const [selected, setSelected] = useState(0);
  const [showFormatting, setShowFormatting] = useState(true);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const wid = useStore((s) => s.wid);
  const channel = useStore((s) => s.channels[channelId]);
  const meId = useStore((s) => s.me?.id);
  const members = useStore((s) => s.members);
  const directory = useStore((s) => s.directory);
  const customEmoji = useStore((s) => s.customEmoji);

  // Reset when switching conversations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on conversation change
  useEffect(() => {
    setValue(readDraft(channelId, threadRootId));
    setUploads([]);
    setToken(null);
    setBroadcast(false);
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus());
  }, [channelId, threadRootId]);

  // Persist drafts: debounced while typing, flushed immediately when leaving the conversation.
  const draftRef = useRef({ key: draftKey(channelId, threadRootId), value });
  useEffect(() => {
    draftRef.current.value = value;
    const t = setTimeout(() => saveDraft(draftRef.current.key, draftRef.current.value), 250);
    return () => clearTimeout(t);
  }, [value]);
  useEffect(() => {
    draftRef.current = { key: draftKey(channelId, threadRootId), value: readDraft(channelId, threadRootId) };
    return () => saveDraft(draftRef.current.key, draftRef.current.value);
  }, [channelId, threadRootId]);

  // Auto-grow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depends on value
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [value]);

  // Focus composer when typing anywhere (like other chat apps) or via custom event.
  useEffect(() => {
    if (threadRootId) return;
    const onFocus = () => ref.current?.focus();
    window.addEventListener("kaiwa:focus-composer", onFocus);
    return () => window.removeEventListener("kaiwa:focus-composer", onFocus);
  }, [threadRootId]);

  // Selection to restore right after React commits a programmatic value change.
  const pendingSelection = useRef<[number, number] | null>(null);
  const apply = useCallback((r: FormatResult) => {
    pendingSelection.current = [r.selectionStart, r.selectionEnd];
    setValue(r.value);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each value commit
  useLayoutEffect(() => {
    const el = ref.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  const format = (kind: "bold" | "italic" | "strike" | "code" | "pre" | "link" | "ul" | "ol" | "quote") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    switch (kind) {
      case "bold":
        return apply(wrapSelection(value, s, e, "*"));
      case "italic":
        return apply(wrapSelection(value, s, e, "_"));
      case "strike":
        return apply(wrapSelection(value, s, e, "~"));
      case "code":
        return apply(wrapSelection(value, s, e, "`"));
      case "pre":
        return apply(wrapSelection(value, s, e, "```\n", "\n```"));
      case "link": {
        const text = value.slice(s, e) || "リンクテキスト";
        const insert = `[${text}](https://)`;
        const next = value.slice(0, s) + insert + value.slice(e);
        const urlStart = s + text.length + 3;
        return apply({ value: next, selectionStart: urlStart, selectionEnd: urlStart + 8 });
      }
      case "ul":
        return apply(prefixLines(value, s, e, () => "- "));
      case "ol":
        return apply(prefixLines(value, s, e, (i) => `${i + 1}. `));
      case "quote":
        return apply(prefixLines(value, s, e, () => "> "));
    }
  };

  const insertAtCaret = (text: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const next = value.slice(0, s) + text + value.slice(e);
    apply({ value: next, selectionStart: s + text.length, selectionEnd: s + text.length });
  };

  // ---------- autocomplete ----------

  const suggestions: Suggestion[] = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    if (token.trigger === "@") {
      const list: Suggestion[] = Object.values(members)
        .filter((m) => m.displayName.toLowerCase().includes(q) || m.fullName.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(!a.displayName.toLowerCase().startsWith(q)) -
            Number(!b.displayName.toLowerCase().startsWith(q)),
        )
        .slice(0, 8)
        .map((m) => ({
          key: m.id,
          label: (
            <span className="flex items-center gap-2">
              <Avatar user={m} size={20} />
              <span className="font-bold">{m.displayName}</span>
              {m.fullName && <span className="text-[13px] opacity-70">{m.fullName}</span>}
            </span>
          ),
          insert: `@${m.displayName} `,
        }));
      if (channel && channel.kind !== "dm") {
        for (const sp of [
          { k: "here", d: "このチャンネルのオンラインのメンバーに通知" },
          { k: "channel", d: "このチャンネルの全員に通知" },
          { k: "everyone", d: "このチャンネルの全員に通知" },
        ]) {
          if (sp.k.startsWith(q))
            list.push({ key: sp.k, label: <b>@{sp.k}</b>, sub: sp.d, insert: `@${sp.k} ` });
        }
      }
      return list;
    }
    if (token.trigger === "#") {
      return Object.values(directory)
        .filter((c) => (c.kind === "public" || c.kind === "private") && c.name.includes(q))
        .slice(0, 8)
        .map((c) => ({
          key: c.id,
          label: <span className="font-bold">#{c.name}</span>,
          insert: `#${c.name} `,
        }));
    }
    if (token.trigger === ":") {
      return searchAllEmoji(token.query, customEmoji, 8).map((e) => ({
        key: e.names[0] as string,
        label: (
          <span className="flex items-center gap-2">
            <span className="text-[18px]">
              {e.url ? <img src={e.url} alt="" className="h-[18px] w-[18px] object-contain" /> : e.char}
            </span>
            :{e.names[0]}:
          </span>
        ),
        insert: `:${e.names[0]}: `,
      }));
    }
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
      key: c.name,
      label: <span className="font-bold">{c.usage}</span>,
      sub: c.description,
      insert: `/${c.name} `,
    }));
  }, [token, members, directory, channel, customEmoji]);

  const updateToken = () => {
    const el = ref.current;
    if (!el) return;
    const t = activeToken(el.value, el.selectionStart);
    setToken(t);
    setSelected(0);
  };

  const accept = (s: Suggestion) => {
    if (!token) return;
    const next = value.slice(0, token.start) + s.insert + value.slice(token.end);
    const caret = token.start + s.insert.length;
    setToken(null);
    apply({ value: next, selectionStart: caret, selectionEnd: caret });
  };

  // ---------- files ----------

  const addFiles = (files: FileList | File[]) => {
    if (!wid) return;
    for (const file of Array.from(files)) {
      if (file.size > LIMITS.fileSize) {
        toast(`${file.name} は25MBを超えているためアップロードできません`, "error");
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const { promise, abort } = uploadFile(wid, file, (p) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
      );
      setUploads((u) => [...u, { key, file, progress: 0, abort }]);
      promise.then(
        (info) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, info, progress: 1 } : x))),
        (err: Error) => {
          setUploads((u) => u.filter((x) => x.key !== key));
          if (!/キャンセル/.test(err.message)) reportError(err);
        },
      );
    }
    ref.current?.focus();
  };

  // Files dropped anywhere on the channel view land in the main composer.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    if (threadRootId) return;
    const onDrop = (e: Event) => addFilesRef.current((e as CustomEvent<File[]>).detail);
    window.addEventListener("kaiwa:drop-files", onDrop);
    return () => window.removeEventListener("kaiwa:drop-files", onDrop);
  }, [threadRootId]);

  // ---------- sending ----------

  const uploading = uploads.some((u) => !u.info);
  const canSend = (value.trim().length > 0 || uploads.length > 0) && !uploading;

  const runSlash = async (text: string): Promise<boolean> => {
    const cmd = parseSlash(text);
    if (!cmd || threadRootId) return false;
    const s = get();
    switch (cmd.name) {
      case "me":
        if (cmd.args) await sendMessage(channelId, cmd.args, { subtype: "me" });
        return true;
      case "shrug":
        await sendMessage(channelId, `${cmd.args} ¯\\\\\\_(ツ)\\_/¯`.trim());
        return true;
      case "topic":
        try {
          const r = await api.updateChannel(channelId, { topic: cmd.args });
          updateChannel(channelId, r.channel);
        } catch (err) {
          reportError(err);
        }
        return true;
      case "rename":
        try {
          const r = await api.updateChannel(channelId, { name: cmd.args });
          updateChannel(channelId, r.channel);
        } catch (err) {
          reportError(err);
        }
        return true;
      case "invite": {
        const ids = [...encodeOutgoing(cmd.args).matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1] as string);
        if (ids.length === 0) {
          toast("追加するメンバーを @ で指定してください", "error");
          return true;
        }
        try {
          const r = await api.addMembers(channelId, ids);
          toast(r.added.length > 0 ? `${r.added.length}人を追加しました` : "既にメンバーです");
        } catch (err) {
          reportError(err);
        }
        return true;
      }
      case "leave":
        await leaveChannel(channelId);
        return true;
      case "away":
      case "active":
        try {
          await api.updateMe({ away: cmd.name === "away" });
          toast(cmd.name === "away" ? "ステータスを離席中にしました" : "アクティブに戻りました");
        } catch (err) {
          reportError(err);
        }
        return true;
      case "status": {
        const m = /^:([a-z0-9_+\-']+):\s*(.*)$/i.exec(cmd.args);
        try {
          await api.updateMe(
            m
              ? { statusEmoji: m[1], statusText: m[2] ?? "" }
              : { statusEmoji: "speech_balloon", statusText: cmd.args },
          );
          toast("ステータスを設定しました");
        } catch (err) {
          reportError(err);
        }
        return true;
      }
      case "clear":
        await api.updateMe({ statusEmoji: "", statusText: "", statusExpiresAt: null }).catch(reportError);
        toast("ステータスをクリアしました");
        return true;
      case "search":
        if (s.wid) navigate(routes.search(s.wid, cmd.args));
        return true;
      case "msg": {
        const encoded = encodeOutgoing(cmd.args);
        const m = /^<@([A-Z0-9]+)>\s*([\s\S]*)$/.exec(encoded);
        if (!m) {
          toast("/msg @ユーザー メッセージ の形式で入力してください", "error");
          return true;
        }
        await openDm([m[1] as string]);
        const dmId = Object.values(get().channels).find(
          (c) => c.kind === "dm" && c.memberIds.includes(m[1] as string) && c.memberIds.length === 2,
        )?.id;
        if (dmId && m[2]) await sendMessage(dmId, m[2]);
        return true;
      }
      default:
        toast(`/${cmd.name} というコマンドはありません`, "error");
        return true;
    }
  };

  const submit = async () => {
    if (!canSend) return;
    const text = value;
    const files = uploads.filter((u) => u.info).map((u) => u.info as FileInfo);
    setValue("");
    setUploads([]);
    setToken(null);
    try {
      localStorage.removeItem(draftKey(channelId, threadRootId));
      window.dispatchEvent(new Event("kaiwa:drafts"));
    } catch {
      // ignore
    }
    if (text.startsWith("/") && files.length === 0 && (await runSlash(text))) return;
    await sendMessage(channelId, text, {
      threadRootId,
      broadcast: threadRootId ? broadcast : undefined,
      fileIds: files.map((f) => f.id),
      files,
    });
    setBroadcast(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (token && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      // A fully typed slash command runs on Enter instead of re-inserting itself.
      const exactCommand = token.trigger === "/" && suggestions.some((s) => s.key === token.query);
      if ((e.key === "Enter" && !exactCommand) || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[selected];
        if (s) accept(s);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setToken(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      return format("bold");
    }
    if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      return format("italic");
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      return format("strike");
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      return format("pre");
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      // Inside an open code block, Enter inserts a newline.
      const before = value.slice(0, ref.current?.selectionStart ?? value.length);
      if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return;
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp" && value === "") {
      // Edit your last message (in this channel, or in this thread).
      const s = get();
      const ids = threadRootId
        ? (s.threads[threadRootId]?.replyIds ?? [])
        : (s.channelMsgs[channelId]?.ids ?? []);
      for (let i = ids.length - 1; i >= 0; i--) {
        const m = s.messages[ids[i] as string];
        if (m && m.userId === meId && (!m.subtype || m.subtype === "me") && !m.deletedAt && !m.pending) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("kaiwa:edit", { detail: m.id }));
          return;
        }
        if (i < ids.length - 20) break;
      }
    }
  };

  const onChange = (v: string) => {
    setValue(v);
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      sendEvent({ type: "typing", channelId, threadRootId: threadRootId ?? null });
    }
  };

  const channelName = channel ? channelLabel(channel, meId) : "";

  return (
    <div className="px-5 pb-1">
      <div
        className={cx(
          "relative rounded-lg border bg-bg transition-colors focus-within:border-fg-subtle",
          dragOver ? "border-link bg-link/5" : "border-line-strong",
        )}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        {token && suggestions.length > 0 && (
          <div
            role="listbox"
            className="absolute right-0 bottom-full left-0 z-20 mb-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-bg-elevated py-1.5 shadow-pop"
          >
            <div className="px-4 pb-1 font-bold text-[12px] text-fg-muted">
              {token.trigger === "@"
                ? "メンバー"
                : token.trigger === "#"
                  ? "チャンネル"
                  : token.trigger === ":"
                    ? "絵文字"
                    : "コマンド"}
            </div>
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={i === selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                onMouseEnter={() => setSelected(i)}
                className={cx(
                  "flex w-full items-center justify-between gap-4 px-4 py-1.5 text-left text-[14px]",
                  i === selected ? "bg-link text-white" : "text-fg",
                )}
              >
                {s.label}
                {s.sub && <span className="truncate text-[12px] opacity-75">{s.sub}</span>}
              </button>
            ))}
          </div>
        )}

        {showFormatting && (
          <div className="flex items-center gap-0.5 rounded-t-lg bg-bg-soft px-1.5 py-1">
            <FmtBtn label="太字 (Ctrl+B)" onClick={() => format("bold")}>
              <Bold size={16} />
            </FmtBtn>
            <FmtBtn label="斜体 (Ctrl+I)" onClick={() => format("italic")}>
              <Italic size={16} />
            </FmtBtn>
            <FmtBtn label="取り消し線 (Ctrl+Shift+X)" onClick={() => format("strike")}>
              <Strikethrough size={16} />
            </FmtBtn>
            <Sep />
            <FmtBtn label="リンク" onClick={() => format("link")}>
              <Link2 size={16} />
            </FmtBtn>
            <Sep />
            <FmtBtn label="番号付きリスト" onClick={() => format("ol")}>
              <ListOrdered size={16} />
            </FmtBtn>
            <FmtBtn label="箇条書き" onClick={() => format("ul")}>
              <List size={16} />
            </FmtBtn>
            <Sep />
            <FmtBtn label="引用" onClick={() => format("quote")}>
              <TextQuote size={16} />
            </FmtBtn>
            <FmtBtn label="コード" onClick={() => format("code")}>
              <Code size={16} />
            </FmtBtn>
            <FmtBtn label="コードブロック (Ctrl+Shift+C)" onClick={() => format("pre")}>
              <SquareCode size={16} />
            </FmtBtn>
          </div>
        )}

        <textarea
          ref={ref}
          value={value}
          rows={1}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            requestAnimationFrame(updateToken);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) updateToken();
          }}
          onClick={updateToken}
          onBlur={() => setTimeout(() => setToken(null), 150)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          className="scroll-thin block max-h-[300px] min-h-[42px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-[22px] outline-none placeholder:text-fg-subtle"
        />

        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {uploads.map((u) => (
              <div
                key={u.key}
                className="relative flex w-56 items-center gap-2 overflow-hidden rounded-lg border border-line bg-bg p-2"
              >
                {u.file.type.startsWith("image/") && u.info ? (
                  <img src={u.info.url} alt="" className="h-9 w-9 rounded object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#3d6fb6] text-white">
                    <FileText size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-[13px]">{u.file.name}</span>
                  <span className="block text-[12px] text-fg-muted">
                    {u.info ? formatBytes(u.file.size) : `アップロード中… ${Math.round(u.progress * 100)}%`}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`${u.file.name} を削除`}
                  onClick={() => {
                    u.abort?.();
                    setUploads((list) => list.filter((x) => x.key !== u.key));
                  }}
                  className="rounded-full bg-fg/70 p-0.5 text-bg hover:bg-fg"
                >
                  <X size={12} />
                </button>
                {!u.info && (
                  <span
                    className="absolute bottom-0 left-0 h-0.5 bg-link"
                    style={{ width: `${u.progress * 100}%` }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-0.5">
            <FmtBtn label="ファイルを添付" onClick={() => fileInput.current?.click()}>
              <Paperclip size={17} />
            </FmtBtn>
            <FmtBtn
              label="書式設定を表示/非表示"
              onClick={() => setShowFormatting((v) => !v)}
              active={showFormatting}
            >
              <Type size={17} />
            </FmtBtn>
            <FmtBtn ref={emojiBtn} label="絵文字" onClick={() => setEmojiOpen(true)}>
              <Smile size={17} />
            </FmtBtn>
            <FmtBtn
              label="メンション"
              onClick={() => {
                insertAtCaret(
                  value && !/\s$/.test(value.slice(0, ref.current?.selectionStart ?? 0)) ? " @" : "@",
                );
                requestAnimationFrame(updateToken);
              }}
            >
              <AtSign size={17} />
            </FmtBtn>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <button
            type="button"
            aria-label="送信"
            title="送信 (Enter)"
            disabled={!canSend}
            onClick={() => void submit()}
            className={cx(
              "flex h-8 w-9 items-center justify-center rounded-md transition-colors",
              canSend ? "bg-primary text-primary-fg hover:bg-primary-hover" : "text-fg-subtle",
            )}
          >
            <SendHorizontal size={17} />
          </button>
        </div>
      </div>
      <div className="flex min-h-[22px] items-center justify-between gap-4 px-1 text-[12px] text-fg-muted">
        <TypingIndicator channelId={channelId} threadRootId={threadRootId ?? null} />
        {threadRootId ? (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
            {channel?.kind === "dm" || channel?.kind === "group"
              ? "ダイレクトメッセージにも送信"
              : `#${channelName} にも投稿する`}
          </label>
        ) : (
          value.length > 0 && (
            <span className="hidden shrink-0 sm:inline">
              <b>Shift + Enter</b> で改行
            </span>
          )
        )}
      </div>
      {emojiOpen && (
        <Popover anchor={emojiBtn} onClose={() => setEmojiOpen(false)} placement="top-start">
          <EmojiPicker
            onPick={(n) => {
              setEmojiOpen(false);
              insertAtCaret(`:${n}: `);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

const FmtBtn = ({
  label,
  onClick,
  children,
  active,
  ref,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={cx(
      "flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg",
      active && "text-fg",
    )}
  >
    {children}
  </button>
);

const Sep = () => <span className="mx-1 h-4 w-px bg-line-strong" />;

function TypingIndicator({ channelId, threadRootId }: { channelId: string; threadRootId: string | null }) {
  const key = threadRootId ? `${channelId}:${threadRootId}` : channelId;
  const typing = useStore((s) => s.typing[key]);
  const members = useStore((s) => s.members);
  const names = Object.keys(typing ?? {})
    .map((id) => members[id]?.displayName)
    .filter(Boolean) as string[];
  if (names.length === 0) return <span />;
  const label =
    names.length === 1
      ? `${names[0]} さんが入力中です`
      : names.length === 2
        ? `${names[0]} さんと ${names[1]} さんが入力中です`
        : "複数の人が入力中です";
  return (
    <span className="flex items-center gap-1.5" aria-live="polite">
      <span className="flex gap-0.5">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      <b className="font-bold">{label}</b>
    </span>
  );
}

const Dot = ({ delay }: { delay: number }) => (
  <span
    className="inline-block h-1 w-1 animate-bounce rounded-full bg-fg-muted"
    style={{ animationDelay: `${delay}ms` }}
  />
);
