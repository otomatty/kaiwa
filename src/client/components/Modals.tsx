import { Check, Copy, Hash, Lock, Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { channelNameError, normalizeChannelName } from "../../shared/limits";
import type { Member, MyChannel } from "../../shared/types";
import { api, uploadFile } from "../lib/api";
import { formatRelative } from "../lib/format";
import { navigate, routes } from "../lib/router";
import {
  addChannel,
  dropChannel,
  joinChannel,
  leaveChannel,
  markChannelRead,
  openDm,
  refreshChannel,
  reportError,
  sendMessage,
  setChannelPrefs,
  updateChannel,
} from "../store/actions";
import {
  channelLabel,
  closeModal,
  get,
  type Modal as ModalState,
  set,
  toast,
  useStore,
} from "../store/store";
import { applyTheme, getThemePref, setThemePref, type ThemePref } from "../theme";
import { EmojiPicker } from "./EmojiPicker";
import { Emoji } from "./MessageText";
import { Avatar, Button, cx, Modal, Popover, PresenceDot, Spinner, TextField, usePresence } from "./ui";

export function ModalHost() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  return <ModalSwitch modal={modal} />;
}

function ModalSwitch({ modal }: { modal: ModalState }) {
  switch (modal.kind) {
    case "createChannel":
      return <CreateChannelModal initialName={modal.initialName} />;
    case "browseChannels":
      return <BrowseChannelsModal />;
    case "newMessage":
      return <NewMessageModal />;
    case "invite":
      return <InviteModal />;
    case "channelDetails":
      return <ChannelDetailsModal channelId={modal.channelId} initialTab={modal.tab} />;
    case "editProfile":
      return <EditProfileModal />;
    case "setStatus":
      return <StatusModal />;
    case "preferences":
      return <PreferencesModal />;
    case "workspaceSettings":
      return <WorkspaceSettingsModal />;
    case "quickSwitcher":
      return <QuickSwitcher />;
    case "shortcuts":
      return <ShortcutsModal />;
    case "createWorkspace":
      return <CreateWorkspaceModal />;
    case "forward":
      return <ForwardModal messageId={modal.messageId} />;
    case "customEmoji":
      return <CustomEmojiModal />;
    case "imagePreview":
      return (
        <Modal title={modal.name} onClose={closeModal} width={1000}>
          <img src={modal.url} alt={modal.name} className="mx-auto max-h-[70vh] max-w-full rounded" />
          <div className="mt-3 flex justify-end">
            <a href={`${modal.url}?download`} className="text-[14px] text-link hover:underline">
              ダウンロード
            </a>
          </div>
        </Modal>
      );
    case "confirm":
      return (
        <Modal
          title={modal.title}
          onClose={closeModal}
          width={460}
          footer={
            <>
              <Button onClick={closeModal}>キャンセル</Button>
              <Button
                variant={modal.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => {
                  closeModal();
                  modal.onConfirm();
                }}
              >
                {modal.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-[15px]">{modal.body}</p>
        </Modal>
      );
  }
}

// ---------- Channels ----------

function CreateChannelModal({ initialName = "" }: { initialName?: string }) {
  const wid = useStore((s) => s.wid) as string;
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeChannelName(name);
  const submit = async () => {
    const err = channelNameError(normalized);
    if (err) return setError(err);
    setBusy(true);
    try {
      const r = await api.createChannel(wid, { name: normalized, kind, description });
      addChannel(r.channel);
      closeModal();
      navigate(routes.channel(wid, r.channel.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="チャンネルを作成する"
      onClose={closeModal}
      footer={
        <Button variant="primary" disabled={!normalized || busy} onClick={() => void submit()}>
          作成する
        </Button>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="名前"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="例: プロジェクト-企画"
          error={error}
          hint={
            name && normalized !== name
              ? `#${normalized} として作成されます`
              : "チャンネル名はトピックに沿った短いものにしましょう。"
          }
        />
        <TextField
          label="説明（任意）"
          value={description}
          maxLength={250}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="このチャンネルの目的"
        />
        <fieldset>
          <legend className="mb-2 font-bold text-[14px]">公開範囲</legend>
          {(
            [
              ["public", "パブリック — ワークスペースの全員が閲覧・参加できます", <Hash key="h" size={16} />],
              ["private", "プライベート — 招待されたメンバーのみが閲覧できます", <Lock key="l" size={16} />],
            ] as const
          ).map(([value, label, icon]) => (
            <label key={value} className="mb-1.5 flex cursor-pointer items-center gap-2.5 text-[14px]">
              <input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} />
              {icon}
              {label}
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

function BrowseChannelsModal() {
  const wid = useStore((s) => s.wid) as string;
  const [list, setList] = useState<Awaited<ReturnType<typeof api.browseChannels>>["channels"] | null>(null);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    api
      .browseChannels(wid)
      .then((r) => setList(r.channels))
      .catch(reportError);
  }, [wid]);
  const shown = (list ?? []).filter(
    (c) => (showArchived || !c.archivedAt) && (c.name.includes(q.toLowerCase()) || c.description.includes(q)),
  );
  return (
    <Modal
      title="チャンネル一覧"
      onClose={closeModal}
      width={720}
      footer={
        <Button variant="primary" onClick={() => set({ modal: { kind: "createChannel", initialName: q } })}>
          チャンネルを作成する
        </Button>
      }
    >
      <div className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-line-strong px-3 focus-within:border-link">
        <Search size={16} className="text-fg-subtle" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="チャンネルを検索"
          aria-label="チャンネルを検索"
          className="w-full bg-transparent outline-none"
        />
      </div>
      <label className="mb-2 flex items-center gap-2 text-[13px] text-fg-muted">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        アーカイブされたチャンネルも表示
      </label>
      {!list ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-line border-line border-y">
          {shown.map((c) => (
            <li key={c.id} className="group flex items-center gap-3 py-3 hover:bg-bg-soft">
              <button
                type="button"
                className="min-w-0 flex-1 px-2 text-left"
                onClick={() => {
                  closeModal();
                  navigate(routes.channel(wid, c.id));
                }}
              >
                <p className="flex items-center gap-1 font-bold text-[15px]">
                  {c.kind === "private" ? <Lock size={14} /> : <Hash size={15} />}
                  {c.name}
                  {c.archivedAt && (
                    <span className="ml-1 font-normal text-[12px] text-fg-muted">（アーカイブ済み）</span>
                  )}
                </p>
                <p className="truncate text-[13px] text-fg-muted">
                  {c.isMember && <span className="mr-1 font-bold text-[#2f7f4f]">✓ 参加中</span>}
                  {c.memberCount}人のメンバー{c.description && ` · ${c.description}`}
                </p>
              </button>
              {!c.archivedAt &&
                (c.isMember ? (
                  <Button
                    className="mr-2 hidden h-8 group-hover:inline-flex"
                    onClick={async () => {
                      await leaveChannel(c.id);
                      setList(
                        (l) =>
                          l?.map((x) =>
                            x.id === c.id ? { ...x, isMember: false, memberCount: x.memberCount - 1 } : x,
                          ) ?? l,
                      );
                    }}
                  >
                    退出する
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="mr-2 hidden h-8 group-hover:inline-flex"
                    onClick={async () => {
                      const ch = await joinChannel(c.id);
                      if (ch)
                        setList(
                          (l) =>
                            l?.map((x) =>
                              x.id === c.id ? { ...x, isMember: true, memberCount: x.memberCount + 1 } : x,
                            ) ?? l,
                        );
                    }}
                  >
                    参加する
                  </Button>
                ))}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="py-8 text-center text-fg-muted">該当するチャンネルはありません</li>
          )}
        </ul>
      )}
    </Modal>
  );
}

function MemberPicker({
  selected,
  onChange,
  exclude = [],
  max,
  autoFocus,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  max?: number;
  autoFocus?: boolean;
}) {
  const members = useStore((s) => s.members);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const options = Object.values(members)
    .filter((m) => !exclude.includes(m.id) && !selected.includes(m.id))
    .filter((m) => (m.displayName + m.fullName + m.email).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  const add = (id: string) => {
    if (max && selected.length >= max) return;
    onChange([...selected, id]);
    setQ("");
    setActive(0);
  };
  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line-strong p-1.5 focus-within:border-link">
        {selected.map((id) => (
          <span
            key={id}
            className="flex items-center gap-1 rounded bg-link/12 py-0.5 pr-1 pl-0.5 text-[13px] text-link"
          >
            <Avatar user={members[id]} size={18} />
            {members[id]?.displayName}
            <button
              type="button"
              aria-label="削除"
              onClick={() => onChange(selected.filter((x) => x !== id))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && options[active]) {
              e.preventDefault();
              add(options[active].id);
            } else if (e.key === "Backspace" && !q && selected.length > 0) {
              onChange(selected.slice(0, -1));
            }
          }}
          placeholder={selected.length === 0 ? "名前またはメールアドレスで検索" : ""}
          aria-label="メンバーを検索"
          className="min-w-[120px] flex-1 bg-transparent px-1 text-[15px] outline-none"
        />
      </div>
      {q && (
        <div className="mt-1 overflow-hidden rounded-md border border-line" role="listbox">
          {options.map((m, i) => (
            <div key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(m.id)}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px]",
                  i === active && "bg-link text-white",
                )}
              >
                <Avatar user={m} size={22} />
                <b>{m.displayName}</b>
                <span className="truncate opacity-70">{m.fullName || m.email}</span>
              </button>
            </div>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-[14px] text-fg-muted">一致するメンバーがいません</div>
          )}
        </div>
      )}
    </div>
  );
}

function NewMessageModal() {
  const [ids, setIds] = useState<string[]>([]);
  const meId = useStore((s) => s.me?.id) as string;
  const members = useStore((s) => s.members);
  const recent = Object.values(members)
    .filter((m) => m.id !== meId)
    .slice(0, 6);
  return (
    <Modal
      title="新規メッセージ"
      onClose={closeModal}
      footer={
        <Button
          variant="primary"
          disabled={ids.length === 0}
          onClick={async () => {
            closeModal();
            await openDm(ids);
          }}
        >
          会話を始める
        </Button>
      }
    >
      <p className="mb-2 text-[14px] text-fg-muted">宛先（最大7人）</p>
      <MemberPicker selected={ids} onChange={setIds} exclude={[meId]} max={7} autoFocus />
      {ids.length === 0 && (
        <div className="mt-4">
          <p className="mb-2 font-bold text-[13px] text-fg-muted">メンバー</p>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={async () => {
                closeModal();
                await openDm([meId]);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-bg-muted"
            >
              <Avatar user={members[meId]} size={24} />
              {members[meId]?.displayName}（自分）
            </button>
            {recent.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setIds([m.id])}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-bg-muted"
              >
                <Avatar user={m} size={24} />
                {m.displayName}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function InviteModal() {
  const wid = useStore((s) => s.wid) as string;
  const workspace = useStore((s) => s.workspace);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api
      .invite(wid)
      .then((r) => setUrl(r.url))
      .catch(reportError);
  }, [wid]);
  return (
    <Modal title={`${workspace?.name ?? ""} にメンバーを招待する`} onClose={closeModal}>
      <p className="mb-3 text-[15px]">
        このリンクを共有すると、受け取った人はアカウントを作成してワークスペースに参加できます。リンクの有効期限は30日です。
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url ?? "作成中…"}
          aria-label="招待リンク"
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-bg-soft px-3 text-[14px]"
        />
        <Button
          variant="primary"
          disabled={!url}
          onClick={() => {
            if (!url) return;
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "コピーしました" : "リンクをコピー"}
        </Button>
      </div>
    </Modal>
  );
}

function ChannelDetailsModal({
  channelId,
  initialTab = "about",
}: {
  channelId: string;
  initialTab?: "about" | "members" | "settings";
}) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState<{ channel: MyChannel; members: Member[] } | null>(null);
  const [editing, setEditing] = useState<"topic" | "description" | "name" | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const meId = useStore((s) => s.me?.id);
  const role = useStore((s) => s.role);
  const allMembers = useStore((s) => s.members);
  const storeChannel = useStore((s) => s.channels[channelId]);

  const load = () =>
    api
      .channel(channelId)
      .then(setData)
      .catch((e) => {
        reportError(e);
        closeModal();
      });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when membership changes
  useEffect(() => {
    void load();
  }, [channelId, storeChannel?.memberCount]);

  if (!data) {
    return (
      <Modal title="チャンネル詳細" onClose={closeModal}>
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      </Modal>
    );
  }
  const ch = storeChannel ?? data.channel;
  const isDm = ch.kind === "dm" || ch.kind === "group";
  const isAdmin = role === "owner" || role === "admin";
  const canManage = isAdmin || ch.createdBy === meId;
  const save = async (patch: { name?: string; topic?: string; description?: string }) => {
    try {
      const r = await api.updateChannel(channelId, patch);
      updateChannel(channelId, r.channel);
      setData({ ...data, channel: r.channel });
      setEditing(null);
    } catch (err) {
      reportError(err);
    }
  };

  const title = isDm ? (
    channelLabel(ch, meId)
  ) : (
    <span className="flex items-center gap-1">
      {ch.kind === "private" ? <Lock size={20} /> : <Hash size={22} />}
      {ch.name}
    </span>
  );

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "about", label: "概要" },
    { id: "members", label: `メンバー ${data.members.length}` },
    ...(!isDm && ch.isMember ? [{ id: "settings" as const, label: "設定" }] : []),
  ];

  return (
    <Modal title={title} onClose={closeModal} width={640} bodyClassName="px-0 pb-0">
      {ch.isMember && (
        <div className="flex gap-2 px-7 pb-3">
          <Button
            className="h-8 text-[13px]"
            onClick={() => setChannelPrefs(channelId, { starred: !ch.starred })}
          >
            {ch.starred ? "★ スター付き" : "☆ スターを付ける"}
          </Button>
          <Button
            className="h-8 text-[13px]"
            onClick={() => setChannelPrefs(channelId, { muted: !ch.muted })}
          >
            {ch.muted ? "ミュートを解除" : "ミュートする"}
          </Button>
        </div>
      )}
      <div className="flex gap-4 border-line border-b px-7" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "-mb-px border-b-2 px-1 pb-2 text-[14px]",
              tab === t.id
                ? "border-primary font-bold text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bg-bg-soft px-7 py-5">
        {tab === "about" && (
          <div className="space-y-3">
            {!isDm && (
              <>
                <EditableField
                  label="チャンネル名"
                  value={`#${ch.name}`}
                  rawValue={ch.name}
                  editing={editing === "name"}
                  canEdit={ch.isMember && !ch.archivedAt && (!ch.isDefault || isAdmin)}
                  onEdit={() => setEditing("name")}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => save({ name: v })}
                />
                <EditableField
                  label="トピック"
                  value={ch.topic || "トピックを追加"}
                  rawValue={ch.topic}
                  editing={editing === "topic"}
                  canEdit={ch.isMember && !ch.archivedAt}
                  onEdit={() => setEditing("topic")}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => save({ topic: v })}
                />
                <EditableField
                  label="説明"
                  value={ch.description || "説明を追加"}
                  rawValue={ch.description}
                  editing={editing === "description"}
                  canEdit={ch.isMember && !ch.archivedAt}
                  onEdit={() => setEditing("description")}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => save({ description: v })}
                />
              </>
            )}
            <div className="rounded-lg border border-line bg-bg p-4 text-[14px]">
              <p className="font-bold">作成者</p>
              <p className="text-fg-muted">
                {allMembers[ch.createdBy]?.displayName ?? "不明"}（
                {new Date(ch.createdAt).toLocaleDateString("ja-JP")}）
              </p>
            </div>
            {!isDm && ch.isMember && !ch.isDefault && (
              <button
                type="button"
                onClick={() => {
                  closeModal();
                  void leaveChannel(channelId);
                }}
                className="w-full rounded-lg border border-line bg-bg p-4 text-left font-bold text-[14px] text-danger hover:bg-bg-soft"
              >
                チャンネルから退出する
              </button>
            )}
            {!isDm && !ch.isMember && !ch.archivedAt && (
              <Button variant="primary" onClick={() => void joinChannel(channelId).then(() => load())}>
                チャンネルに参加する
              </Button>
            )}
          </div>
        )}
        {tab === "members" && (
          <div>
            {!isDm && ch.isMember && !ch.archivedAt && (
              <div className="mb-4 rounded-lg border border-line bg-bg p-3">
                <p className="mb-2 font-bold text-[14px]">メンバーを追加する</p>
                <MemberPicker
                  selected={adding}
                  onChange={setAdding}
                  exclude={data.members.map((m) => m.id)}
                />
                {adding.length > 0 && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="primary"
                      className="h-8"
                      onClick={async () => {
                        try {
                          await api.addMembers(channelId, adding);
                          setAdding([]);
                          await refreshChannel(channelId);
                          await load();
                          toast("メンバーを追加しました");
                        } catch (err) {
                          reportError(err);
                        }
                      }}
                    >
                      追加する
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="mb-2 flex h-9 items-center gap-2 rounded-md border border-line-strong bg-bg px-2.5">
              <Search size={15} className="text-fg-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="メンバーを検索"
                aria-label="メンバーを検索"
                className="w-full bg-transparent text-[14px] outline-none"
              />
            </div>
            <ul className="max-h-[320px] overflow-y-auto rounded-lg border border-line bg-bg">
              {data.members
                .filter((m) => m.displayName.toLowerCase().includes(q.toLowerCase()))
                .map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    canRemove={!isDm && !ch.isDefault && canManage && m.id !== meId}
                    onRemove={async () => {
                      try {
                        await api.removeChannelMember(channelId, m.id);
                        await load();
                      } catch (err) {
                        reportError(err);
                      }
                    }}
                  />
                ))}
            </ul>
          </div>
        )}
        {tab === "settings" && (
          <div className="space-y-3">
            {canManage && !ch.isDefault && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await api.archiveChannel(channelId, !ch.archivedAt);
                    updateChannel(channelId, r.channel);
                    toast(ch.archivedAt ? "アーカイブを解除しました" : "チャンネルをアーカイブしました");
                    closeModal();
                  } catch (err) {
                    reportError(err);
                  }
                }}
                className="w-full rounded-lg border border-line bg-bg p-4 text-left text-[14px] hover:bg-bg-soft"
              >
                <p className="font-bold">
                  {ch.archivedAt ? "アーカイブを解除する" : "チャンネルをアーカイブする"}
                </p>
                <p className="text-fg-muted">
                  {ch.archivedAt
                    ? "再び投稿できるようになります。"
                    : "投稿できなくなりますが、メッセージは検索・閲覧できます。"}
                </p>
              </button>
            )}
            {isAdmin && !ch.isDefault && (
              <button
                type="button"
                onClick={() =>
                  set({
                    modal: {
                      kind: "confirm",
                      title: `#${ch.name} を削除する`,
                      body: "チャンネルとすべてのメッセージ・ファイルが完全に削除されます。この操作は取り消せません。",
                      confirmLabel: "完全に削除する",
                      danger: true,
                      onConfirm: async () => {
                        try {
                          await api.deleteChannel(channelId);
                          dropChannel(channelId);
                          toast("チャンネルを削除しました");
                        } catch (err) {
                          reportError(err);
                        }
                      },
                    },
                  })
                }
                className="w-full rounded-lg border border-line bg-bg p-4 text-left text-[14px] text-danger hover:bg-bg-soft"
              >
                <p className="font-bold">チャンネルを削除する</p>
              </button>
            )}
            {!canManage && (
              <p className="text-[14px] text-fg-muted">
                このチャンネルの設定を変更できるのは作成者と管理者のみです。
              </p>
            )}
            {ch.isDefault && (
              <p className="text-[14px] text-fg-muted">
                #{ch.name} は全員が参加する既定のチャンネルのため、アーカイブや削除はできません。
              </p>
            )}
          </div>
        )}
      </div>
      <div className="h-2 bg-bg-soft" />
    </Modal>
  );
}

function MemberRow({
  member,
  canRemove,
  onRemove,
}: {
  member: Member;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const presence = usePresence(member.id);
  return (
    <li className="group flex items-center gap-3 px-3 py-2 hover:bg-bg-soft">
      <Avatar user={member} size={32} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          closeModal();
          set({ panel: { kind: "profile", userId: member.id } });
        }}
      >
        <span className="flex items-center gap-1.5 font-bold text-[14px]">
          {member.displayName}
          <PresenceDot presence={presence} size={8} />
          {member.statusEmoji && <Emoji name={member.statusEmoji} size={14} />}
        </span>
        <span className="block truncate text-[12px] text-fg-muted">{member.title || member.fullName}</span>
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="hidden text-[13px] text-danger hover:underline group-hover:block"
        >
          削除する
        </button>
      )}
    </li>
  );
}

function EditableField({
  label,
  value,
  rawValue,
  editing,
  canEdit,
  onEdit,
  onCancel,
  onSave,
}: {
  label: string;
  value: string;
  rawValue: string;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(rawValue);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when entering edit mode
  useEffect(() => setV(rawValue), [editing]);
  return (
    <div className="rounded-lg border border-line bg-bg p-4">
      <div className="flex items-center justify-between">
        <p className="font-bold text-[14px]">{label}</p>
        {canEdit && !editing && (
          <button type="button" onClick={onEdit} className="font-bold text-[13px] text-link hover:underline">
            編集
          </button>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(v);
          }}
          className="mt-2"
        >
          <input
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            aria-label={label}
            className="h-9 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[14px] outline-none focus:border-link"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button className="h-8" onClick={onCancel}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" className="h-8">
              保存
            </Button>
          </div>
        </form>
      ) : (
        <p className={cx("mt-0.5 text-[14px]", rawValue ? "" : "text-fg-muted")}>{value}</p>
      )}
    </div>
  );
}

// ---------- Profile & status ----------

function EditProfileModal() {
  const me = useStore((s) => s.me);
  const wid = useStore((s) => s.wid);
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [fullName, setFullName] = useState(me?.fullName ?? "");
  const [title, setTitle] = useState(me?.title ?? "");
  const [timezone, setTimezone] = useState(me?.timezone ?? "Asia/Tokyo");
  const [avatarFileId, setAvatarFileId] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(me?.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!me) return null;
  const save = async () => {
    try {
      const r = await api.updateMe({
        displayName,
        fullName,
        title,
        timezone,
        ...(avatarFileId !== undefined ? { avatarFileId } : {}),
      });
      set((s) => ({
        me: r.user,
        members: s.members[r.user.id]
          ? { ...s.members, [r.user.id]: { ...s.members[r.user.id], ...r.user } as Member }
          : s.members,
      }));
      closeModal();
      toast("プロフィールを更新しました");
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <Modal
      title="プロフィールを編集"
      onClose={closeModal}
      width={680}
      footer={
        <>
          <Button onClick={closeModal}>キャンセル</Button>
          <Button variant="primary" disabled={!displayName.trim() || uploading} onClick={() => void save()}>
            変更を保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col-reverse gap-6 sm:flex-row">
        <div className="flex-1 space-y-4">
          <TextField
            label="表示名"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            hint="メッセージやメンションで表示される名前です。"
          />
          <TextField
            label="氏名"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
          />
          <TextField
            label="役職"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="例: プロダクトデザイナー"
          />
          <label className="block">
            <span className="mb-1.5 block font-bold text-[14px]">タイムゾーン</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-10 w-full rounded-md border border-line-strong bg-bg px-2"
            >
              {[
                "Asia/Tokyo",
                "Asia/Seoul",
                "Asia/Shanghai",
                "Asia/Singapore",
                "Europe/London",
                "Europe/Paris",
                "America/New_York",
                "America/Los_Angeles",
                "UTC",
              ].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="font-bold text-[14px]">プロフィール写真</span>
          <Avatar user={{ ...me, avatarUrl: preview }} size={160} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f || !wid) return;
              setUploading(true);
              uploadFile(wid, f).promise.then(
                (info) => {
                  setAvatarFileId(info.id);
                  setPreview(info.url);
                  setUploading(false);
                },
                (err) => {
                  setUploading(false);
                  reportError(err);
                },
              );
            }}
          />
          <Button className="h-8 w-40" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? "アップロード中…" : "写真をアップロード"}
          </Button>
          {preview && (
            <button
              type="button"
              className="text-[13px] text-link hover:underline"
              onClick={() => {
                setAvatarFileId(null);
                setPreview(null);
              }}
            >
              写真を削除
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

const STATUS_PRESETS = [
  { emoji: "spiral_calendar_pad", text: "会議中", minutes: 60 },
  { emoji: "bus", text: "移動中", minutes: 30 },
  { emoji: "face_with_thermometer", text: "体調不良", minutes: 24 * 60 },
  { emoji: "palm_tree", text: "休暇中", minutes: null },
  { emoji: "house_with_garden", text: "リモートワーク", minutes: 24 * 60 },
  { emoji: "bento", text: "ランチ中", minutes: 60 },
] as const;

const EXPIRY_OPTIONS = [
  { label: "クリアしない", minutes: null },
  { label: "30分", minutes: 30 },
  { label: "1時間", minutes: 60 },
  { label: "4時間", minutes: 240 },
  { label: "今日", minutes: -1 },
  { label: "今週", minutes: -7 },
] as const;

function expiryTs(minutes: number | null): number | null {
  if (minutes === null) return null;
  if (minutes === -1) {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    return d.getTime();
  }
  if (minutes === -7) {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    d.setHours(23, 59, 59, 0);
    return d.getTime();
  }
  return Date.now() + minutes * 60_000;
}

function StatusModal() {
  const me = useStore((s) => s.me);
  const [emoji, setEmoji] = useState(me?.statusEmoji ?? "");
  const [text, setText] = useState(me?.statusText ?? "");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const save = async (e: string, t: string, exp: number | null) => {
    try {
      const r = await api.updateMe({ statusEmoji: e, statusText: t, statusExpiresAt: expiryTs(exp) });
      set({ me: r.user });
      closeModal();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <Modal
      title="ステータスを設定"
      onClose={closeModal}
      width={520}
      footer={
        <>
          {(me?.statusEmoji || me?.statusText) && (
            <Button className="mr-auto" onClick={() => void save("", "", null)}>
              ステータスをクリア
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!text.trim() && !emoji}
            onClick={() => void save(emoji || "speech_balloon", text, expiry)}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="flex h-11 items-center gap-2 rounded-md border border-line-strong px-2 focus-within:border-link">
        <button
          ref={emojiRef}
          type="button"
          aria-label="絵文字を選ぶ"
          onClick={() => setPicker(true)}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-bg-muted"
        >
          {emoji ? <Emoji name={emoji} size={20} /> : "🙂"}
        </button>
        <input
          autoFocus
          value={text}
          maxLength={100}
          onChange={(e) => setText(e.target.value)}
          placeholder="ステータスを入力"
          aria-label="ステータス"
          className="h-full flex-1 bg-transparent outline-none"
        />
      </div>
      {picker && (
        <Popover anchor={emojiRef} onClose={() => setPicker(false)}>
          <EmojiPicker
            onPick={(n) => {
              setEmoji(n);
              setPicker(false);
            }}
          />
        </Popover>
      )}
      <label className="mt-4 block">
        <span className="mb-1.5 block font-bold text-[14px]">次の時間が経過したらクリア</span>
        <select
          value={String(expiry)}
          onChange={(e) => setExpiry(e.target.value === "null" ? null : Number(e.target.value))}
          className="h-10 w-full rounded-md border border-line-strong bg-bg px-2"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.label} value={String(o.minutes)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-5 mb-1 font-bold text-[13px] text-fg-muted">おすすめ</p>
      <ul>
        {STATUS_PRESETS.map((p) => (
          <li key={p.text}>
            <button
              type="button"
              onClick={() => void save(p.emoji, p.text, p.minutes)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[15px] hover:bg-bg-muted"
            >
              <Emoji name={p.emoji} size={18} />
              {p.text}
              <span className="text-[13px] text-fg-subtle">
                — {p.minutes === null ? "クリアしない" : p.minutes >= 1440 ? "今日" : `${p.minutes}分`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PreferencesModal() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [notif, setNotif] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [notifOff, setNotifOff] = useState(() => localStorage.getItem("kaiwa:notifications") === "off");
  return (
    <Modal title="環境設定" onClose={closeModal} width={560}>
      <section className="mb-6">
        <h3 className="mb-2 font-bold text-[16px]">テーマ</h3>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["system", "システムに合わせる"],
              ["light", "ライト"],
              ["dark", "ダーク"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setTheme(v);
                setThemePref(v);
                applyTheme();
              }}
              className={cx(
                "rounded-lg border-2 p-3 text-[14px]",
                theme === v ? "border-primary font-bold" : "border-line hover:border-line-strong",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-bold text-[16px]">通知</h3>
        <p className="mb-3 text-[14px] text-fg-muted">
          ダイレクトメッセージ、メンション、フォロー中のスレッドへの返信があったときにデスクトップ通知を表示します。
        </p>
        {notif === "unsupported" ? (
          <p className="text-[14px]">このブラウザは通知に対応していません。</p>
        ) : notif === "granted" ? (
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={!notifOff}
              onChange={(e) => {
                setNotifOff(!e.target.checked);
                localStorage.setItem("kaiwa:notifications", e.target.checked ? "on" : "off");
              }}
            />
            デスクトップ通知を有効にする
          </label>
        ) : notif === "denied" ? (
          <p className="text-[14px]">
            ブラウザの設定で通知がブロックされています。サイトの設定から許可してください。
          </p>
        ) : (
          <Button onClick={() => void Notification.requestPermission().then(setNotif)}>通知を許可する</Button>
        )}
      </section>
    </Modal>
  );
}

function WorkspaceSettingsModal() {
  const workspace = useStore((s) => s.workspace);
  const wid = useStore((s) => s.wid) as string;
  const members = useStore((s) => s.members);
  const meId = useStore((s) => s.me?.id);
  const myRole = useStore((s) => s.role);
  const [name, setName] = useState(workspace?.name ?? "");
  return (
    <Modal title="ワークスペースの設定" onClose={closeModal} width={680}>
      <form
        className="mb-6 flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.updateWorkspace(wid, name);
            toast("ワークスペース名を変更しました");
          } catch (err) {
            reportError(err);
          }
        }}
      >
        <div className="flex-1">
          <TextField
            label="ワークスペース名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!name.trim() || name === workspace?.name}>
          保存
        </Button>
      </form>
      <h3 className="mb-2 font-bold text-[16px]">メンバーと権限</h3>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {Object.values(members)
          .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
          .map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar user={m} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-[14px]">{m.displayName}</span>
                <span className="block truncate text-[12px] text-fg-muted">
                  {m.email} · {formatRelative(m.joinedAt)}に参加
                </span>
              </span>
              {m.role === "owner" ? (
                <span className="text-[13px] text-fg-muted">オーナー</span>
              ) : (
                <>
                  <select
                    value={m.role}
                    disabled={m.id === meId}
                    aria-label={`${m.displayName}の権限`}
                    onChange={async (e) => {
                      try {
                        await api.setRole(wid, m.id, e.target.value as "admin" | "member");
                      } catch (err) {
                        reportError(err);
                      }
                    }}
                    className="h-8 rounded-md border border-line-strong bg-bg px-1.5 text-[13px]"
                  >
                    <option value="admin">管理者</option>
                    <option value="member">メンバー</option>
                  </select>
                  {m.id !== meId && (
                    <button
                      type="button"
                      className="text-[13px] text-danger hover:underline"
                      onClick={() =>
                        set({
                          modal: {
                            kind: "confirm",
                            title: `${m.displayName} さんを削除する`,
                            body: "このメンバーはワークスペースにアクセスできなくなります。",
                            confirmLabel: "削除する",
                            danger: true,
                            onConfirm: () => void api.removeMember(wid, m.id).catch(reportError),
                          },
                        })
                      }
                    >
                      削除
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
      </ul>
      {myRole !== "member" && (
        <div className="mt-6">
          <h3 className="mb-2 font-bold text-[16px]">招待リンク</h3>
          <p className="mb-2 text-[14px] text-fg-muted">これまでに共有した招待リンクをすべて無効にします。</p>
          <Button
            onClick={async () => {
              try {
                await api.resetInvites(wid);
                toast("招待リンクを無効にしました");
              } catch (err) {
                reportError(err);
              }
            }}
          >
            招待リンクをリセット
          </Button>
        </div>
      )}
    </Modal>
  );
}

function CreateWorkspaceModal() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="ワークスペースを作成する"
      onClose={closeModal}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.createWorkspace(name.trim());
              set((s) => ({ workspaces: [...s.workspaces, r.summary] }));
              closeModal();
              navigate(routes.channel(r.workspace.id, r.defaultChannelId));
            } catch (err) {
              reportError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          作成する
        </Button>
      }
    >
      <TextField
        label="ワークスペース名"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={50}
        placeholder="例: 株式会社サンプル"
        hint="会社やチームの名前など、メンバーが見てわかる名前にしましょう。"
      />
    </Modal>
  );
}

// ---------- Custom emoji ----------

function CustomEmojiModal() {
  const wid = useStore((s) => s.wid) as string;
  const custom = useStore((s) => s.customEmoji);
  const meId = useStore((s) => s.me?.id);
  const role = useStore((s) => s.role);
  const members = useStore((s) => s.members);
  const [list, setList] = useState<{ name: string; url: string; createdBy: string }[] | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the workspace list changes
  useEffect(() => {
    api
      .customEmoji(wid)
      .then((r) => setList(r.emoji))
      .catch(reportError);
  }, [wid, custom]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const add = async () => {
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const info = await uploadFile(wid, file).promise;
      const r = await api.addEmoji(wid, name.trim().toLowerCase(), info.id);
      set({ customEmoji: Object.fromEntries(r.emoji.map((e) => [e.name, e.url])) });
      setName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast(`:${name.trim().toLowerCase()}: を追加しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="カスタム絵文字"
      subtitle="ワークスペースのメンバー全員が使える絵文字を追加できます。"
      onClose={closeModal}
      width={600}
    >
      <div className="mb-6 rounded-lg border border-line p-4">
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-line-strong border-dashed text-[12px] text-fg-muted hover:border-link"
          >
            {preview ? <img src={preview} alt="" className="h-14 w-14 object-contain" /> : "画像を選択"}
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <TextField
              label="名前"
              value={name}
              maxLength={40}
              onChange={(e) => {
                setName(e.target.value.replace(/[\s:]/g, "").toLowerCase());
                setError(null);
              }}
              placeholder="例: party-parrot"
              hint={name ? `:${name}: で使えます` : "半角英小文字・数字・ハイフン・アンダースコア"}
              error={error}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/gif,image/jpeg,image/webp"
              hidden
              aria-label="絵文字の画像"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex justify-end">
              <Button variant="primary" disabled={!file || !name || busy} onClick={() => void add()}>
                追加する
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-fg-muted">
          正方形の画像（128×128px 程度、1MB まで）がおすすめです。
        </p>
      </div>
      {!list ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-[14px] text-fg-muted">まだカスタム絵文字はありません。</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {list.map((e) => (
            <li key={e.name} className="flex items-center gap-3 px-3 py-2">
              <img src={e.url} alt="" className="h-7 w-7 object-contain" />
              <span className="flex-1 font-mono text-[14px]">:{e.name}:</span>
              <span className="text-[12px] text-fg-muted">{members[e.createdBy]?.displayName}</span>
              {(e.createdBy === meId || role !== "member") && (
                <button
                  type="button"
                  className="text-[13px] text-danger hover:underline"
                  onClick={async () => {
                    try {
                      const r = await api.deleteEmoji(wid, e.name);
                      set({ customEmoji: Object.fromEntries(r.emoji.map((x) => [x.name, x.url])) });
                    } catch (err) {
                      reportError(err);
                    }
                  }}
                >
                  削除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- Forward ----------

function ForwardModal({ messageId }: { messageId: string }) {
  const m = useStore((s) => s.messages[messageId]);
  const channels = useStore((s) => s.channels);
  const members = useStore((s) => s.members);
  const meId = useStore((s) => s.me?.id);
  const wid = useStore((s) => s.wid) as string;
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<{ kind: "channel" | "user"; id: string; label: string } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const query = q.toLowerCase();
  const options = [
    ...Object.values(channels)
      .filter((c) => !c.archivedAt && (c.kind === "public" || c.kind === "private"))
      .map((c) => ({ kind: "channel" as const, id: c.id, label: `#${c.name}` })),
    ...Object.values(channels)
      .filter((c) => c.kind === "group")
      .map((c) => ({ kind: "channel" as const, id: c.id, label: channelLabel(c, meId) })),
    ...Object.values(members).map((u) => ({
      kind: "user" as const,
      id: u.id,
      label: u.id === meId ? `${u.displayName}（自分）` : u.displayName,
    })),
  ]
    .filter((o) => o.label.toLowerCase().includes(query))
    .slice(0, 8);
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const cid = target.kind === "channel" ? target.id : (await api.openDm(wid, [target.id])).channel.id;
      if (target.kind === "user") await refreshChannel(cid);
      await sendMessage(cid, comment, {
        shared: m.shared ?? {
          id: m.id,
          channelId: m.channelId,
          channelName: get().directory[m.channelId]?.name ?? "",
          channelKind: get().directory[m.channelId]?.kind ?? "public",
          userId: m.userId,
          text: m.text,
          createdAt: m.createdAt,
          files: m.files,
        },
      });
      closeModal();
      toast(`${target.label} に転送しました`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="メッセージを転送"
      onClose={closeModal}
      width={560}
      footer={
        <Button variant="primary" disabled={!target || busy} onClick={() => void submit()}>
          転送する
        </Button>
      }
    >
      {target ? (
        <div className="mb-3 flex items-center justify-between rounded-md border border-line-strong px-3 py-2 text-[14px]">
          <span>
            宛先: <b>{target.label}</b>
          </span>
          <button type="button" className="text-link hover:underline" onClick={() => setTarget(null)}>
            変更
          </button>
        </div>
      ) : (
        <div className="mb-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="チャンネル名またはメンバー名を入力"
            aria-label="転送先を検索"
            className="h-10 w-full rounded-md border border-line-strong bg-bg px-3 outline-none focus:border-link"
          />
          <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-line" role="listbox">
            {options.map((o) => (
              <button
                key={`${o.kind}-${o.id}`}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => setTarget(o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] hover:bg-link hover:text-white"
              >
                {o.kind === "user" ? <Avatar user={members[o.id]} size={18} /> : <Hash size={14} />}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="メッセージを追加（任意）"
        aria-label="転送時のメッセージ"
        rows={2}
        className="w-full resize-none rounded-md border border-line-strong bg-bg px-3 py-2 text-[15px] outline-none focus:border-link"
      />
      <div className="mt-3 rounded-md border border-line bg-bg-soft p-3 text-[14px]">
        <p className="mb-1 font-bold">{members[m.userId]?.displayName}</p>
        <p className="line-clamp-4 whitespace-pre-wrap text-fg-muted">{m.text || "（ファイル）"}</p>
      </div>
    </Modal>
  );
}

// ---------- Quick switcher ----------

interface SwitchItem {
  key: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void;
  score: number;
}

function QuickSwitcher() {
  const channels = useStore((s) => s.channels);
  const directory = useStore((s) => s.directory);
  const members = useStore((s) => s.members);
  const meId = useStore((s) => s.me?.id);
  const wid = useStore((s) => s.wid) as string;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const items: SwitchItem[] = useMemo(() => {
    const query = q.toLowerCase().replace(/^[#@]/, "");
    const score = (label: string, recent: number) => {
      const l = label.toLowerCase();
      if (!query) return recent;
      if (l.startsWith(query)) return 1e15 + recent;
      if (l.includes(query)) return 1e14 + recent;
      return -1;
    };
    const out: SwitchItem[] = [];
    for (const c of Object.values(directory)) {
      if (c.kind === "dm" || c.kind === "group") continue;
      const mine = channels[c.id];
      out.push({
        key: c.id,
        label: c.name,
        sub: mine ? undefined : "未参加",
        icon: c.kind === "private" ? <Lock size={15} /> : <Hash size={15} />,
        run: () => navigate(routes.channel(wid, c.id)),
        score: score(c.name, (mine?.latestAt ?? 0) + (mine?.unreadCount ? 1e13 : 0)),
      });
    }
    for (const c of Object.values(channels)) {
      if (c.kind !== "group") continue;
      out.push({
        key: c.id,
        label: channelLabel(c, meId),
        icon: <span className="text-[12px]">{c.memberIds.length - 1}</span>,
        run: () => navigate(routes.channel(wid, c.id)),
        score: score(channelLabel(c, meId), c.latestAt ?? 0),
      });
    }
    for (const m of Object.values(members)) {
      const dm = Object.values(channels).find(
        (c) => c.kind === "dm" && (m.id === meId ? c.memberIds.length === 1 : c.memberIds.includes(m.id)),
      );
      out.push({
        key: `u-${m.id}`,
        label: m.id === meId ? `${m.displayName}（自分）` : m.displayName,
        sub: m.fullName || m.title,
        icon: <Avatar user={m} size={18} />,
        run: () => (dm ? navigate(routes.channel(wid, dm.id)) : void openDm([m.id])),
        score: Math.max(score(m.displayName, dm?.latestAt ?? 0), score(m.fullName, dm?.latestAt ?? 0)),
      });
    }
    return out
      .filter((i) => i.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [q, channels, directory, members, meId, wid]);

  const choose = (i: SwitchItem | undefined) => {
    if (!i) return;
    closeModal();
    set({ sidebarTab: "home", mobileSidebar: false });
    i.run();
  };

  return (
    <Modal title="移動先を検索" onClose={closeModal} width={600}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(items[active]);
          }
        }}
        placeholder="チャンネル名やメンバー名を入力"
        aria-label="移動先を検索"
        className="mb-3 h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] outline-none focus:border-link"
      />
      <div role="listbox">
        {items.map((i, idx) => (
          <div key={i.key}>
            <button
              type="button"
              role="option"
              aria-selected={idx === active}
              onMouseEnter={() => setActive(idx)}
              onClick={() => choose(i)}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[15px]",
                idx === active && "bg-link text-white",
              )}
            >
              <span className="flex w-5 justify-center">{i.icon}</span>
              <span className="truncate font-bold">{i.label}</span>
              {i.sub && <span className="truncate text-[13px] opacity-70">{i.sub}</span>}
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="py-6 text-center text-fg-muted">見つかりませんでした</div>}
      </div>
      <p className="mt-3 text-[12px] text-fg-subtle">↑↓ で選択、Enter で移動、Esc で閉じる</p>
    </Modal>
  );
}

function ShortcutsModal() {
  const rows: [string, string][] = [
    ["Ctrl / ⌘ + K", "移動先を検索（クイックスイッチャー）"],
    ["Ctrl / ⌘ + Shift + K", "新規メッセージ"],
    ["Ctrl / ⌘ + Shift + L", "チャンネル一覧"],
    ["Ctrl / ⌘ + Shift + F", "検索"],
    ["Alt + ↑ / ↓", "前 / 次のチャンネルへ"],
    ["Alt + Shift + ↑ / ↓", "前 / 次の未読チャンネルへ"],
    ["Esc", "パネルを閉じる / 現在のチャンネルを既読にする"],
    ["Shift + Esc", "すべてのチャンネルを既読にする"],
    ["↑（入力欄が空のとき）", "最後に送信したメッセージを編集"],
    ["Ctrl / ⌘ + B / I", "太字 / 斜体"],
    ["Ctrl / ⌘ + Shift + X", "取り消し線"],
    ["Ctrl / ⌘ + Shift + C", "コードブロック"],
    ["Shift + Enter", "改行"],
    ["Alt + クリック", "メッセージを未読にする"],
    ["Ctrl / ⌘ + /", "このショートカット一覧"],
  ];
  return (
    <Modal title="キーボードショートカット" onClose={closeModal} width={560}>
      <table className="w-full text-[14px]">
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k} className="border-line border-b last:border-0">
              <td className="py-2 pr-4">{d}</td>
              <td className="py-2 text-right">
                <kbd className="rounded border border-line-strong bg-bg-soft px-1.5 py-0.5 font-mono text-[12px]">
                  {k}
                </kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = get();
      if (!s.wid) return;
      // Typing while nothing is focused goes to the message box.
      const active = document.activeElement;
      const editing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      const onControl = active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement;
      if (
        !editing &&
        !s.modal &&
        e.key.length === 1 &&
        !(e.key === " " && onControl) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing
      ) {
        window.dispatchEvent(new Event("kaiwa:focus-composer"));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        set({ modal: { kind: "quickSwitcher" } });
      } else if (mod && e.shiftKey && key === "k") {
        e.preventDefault();
        set({ modal: { kind: "newMessage" } });
      } else if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        set({ modal: { kind: "browseChannels" } });
      } else if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search-input]")?.focus();
      } else if (mod && key === "/") {
        e.preventDefault();
        set({ modal: { kind: "shortcuts" } });
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        cycleChannel(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
      } else if (e.key === "Escape" && e.shiftKey && !s.modal) {
        // Shift+Esc: mark everything as read
        e.preventDefault();
        for (const ch of Object.values(s.channels)) {
          if (ch.unreadCount > 0 || ch.mentionCount > 0)
            markChannelRead(ch.id, Math.max(Date.now(), ch.latestAt ?? 0));
        }
        toast("すべてのチャンネルを既読にしました");
      } else if (e.key === "Escape" && !s.modal) {
        if (s.panel) set({ panel: null });
        else {
          const cid = /\/c\/([^/?]+)/.exec(window.location.pathname)?.[1];
          const ch = cid ? s.channels[cid] : undefined;
          if (ch && ch.unreadCount > 0) {
            markChannelRead(ch.id, Math.max(Date.now(), ch.latestAt ?? 0));
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function cycleChannel(dir: 1 | -1, unreadOnly: boolean) {
  const s = get();
  const all = Object.values(s.channels).filter((c) => !c.hidden);
  const ordered = [
    ...all.filter((c) => c.starred),
    ...all
      .filter((c) => !c.starred && (c.kind === "public" || c.kind === "private"))
      .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    ...all
      .filter((c) => !c.starred && (c.kind === "dm" || c.kind === "group"))
      .sort((a, b) => (b.latestAt ?? b.createdAt) - (a.latestAt ?? a.createdAt)),
  ].filter((c) => !unreadOnly || c.unreadCount > 0 || c.id === currentId());
  if (ordered.length === 0) return;
  const idx = ordered.findIndex((c) => c.id === currentId());
  const next = ordered[(idx + dir + ordered.length) % ordered.length];
  if (next && s.wid) navigate(routes.channel(s.wid, next.id));
}

function currentId() {
  return /\/c\/([^/?]+)/.exec(window.location.pathname)?.[1];
}
