import type {
  ActivityItem,
  Bookmark,
  Bootstrap,
  FileInfo,
  InviteInfo,
  Me,
  Member,
  Message,
  MessagePage,
  MyChannel,
  Reaction,
  SavedItem,
  SearchResult,
  ThreadSummary,
  ThreadView,
  User,
  Workspace,
  WorkspaceSummary,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "network", "ネットワークに接続できません");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      // Session expired or signed out elsewhere.
      window.dispatchEvent(new Event("kaiwa:unauthorized"));
    }
    const err = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      res.status,
      err.error ?? "error",
      err.message ?? `エラーが発生しました (${res.status})`,
    );
  }
  return data as T;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b: unknown = {}) => request<T>("POST", p, b);
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

export function uploadFile(
  workspaceId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): { promise: Promise<FileInfo>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<FileInfo>((resolve, reject) => {
    xhr.open("POST", `/api/workspaces/${workspaceId}/files`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as { file?: FileInfo; message?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data.file) resolve(data.file);
        else
          reject(
            new ApiError(xhr.status, data.error ?? "upload", data.message ?? "アップロードに失敗しました"),
          );
      } catch {
        reject(new ApiError(xhr.status, "upload", "アップロードに失敗しました"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "ネットワークに接続できません"));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "キャンセルしました"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}

export const api = {
  me: () => get<Me | { user: null; workspaces: [] }>("/me"),
  signup: (b: { email: string; password: string; displayName: string }) => post<Me>("/auth/signup", b),
  login: (b: { email: string; password: string }) => post<Me>("/auth/login", b),
  logout: () => post<{ ok: true }>("/auth/logout"),
  updateMe: (
    b: Partial<Omit<User, "id" | "email" | "createdAt" | "avatarUrl">> & { avatarFileId?: string | null },
  ) => patch<{ user: User }>("/me", b),

  createWorkspace: (name: string) =>
    post<{ workspace: Workspace; summary: WorkspaceSummary; defaultChannelId: string }>("/workspaces", {
      name,
    }),
  bootstrap: (wid: string) => get<Bootstrap>(`/workspaces/${wid}/bootstrap`),
  updateWorkspace: (wid: string, name: string) =>
    patch<{ workspace: Workspace }>(`/workspaces/${wid}`, { name }),
  invite: (wid: string) => post<{ code: string; url: string }>(`/workspaces/${wid}/invites`),
  resetInvites: (wid: string) => post<{ ok: true }>(`/workspaces/${wid}/invites/reset`),
  inviteInfo: (code: string) => get<InviteInfo>(`/invites/${code}`),
  acceptInvite: (code: string) => post<{ workspace: WorkspaceSummary }>(`/invites/${code}/accept`),
  setRole: (wid: string, uid: string, role: "admin" | "member") =>
    patch<{ member: Member }>(`/workspaces/${wid}/members/${uid}`, { role }),
  removeMember: (wid: string, uid: string) => del<{ ok: true }>(`/workspaces/${wid}/members/${uid}`),

  browseChannels: (wid: string) =>
    get<{
      channels: {
        id: string;
        name: string;
        kind: "public" | "private";
        topic: string;
        description: string;
        memberCount: number;
        isMember: boolean;
        archivedAt: number | null;
        createdAt: number;
      }[];
    }>(`/workspaces/${wid}/channels/browse`),
  createChannel: (
    wid: string,
    b: { name: string; kind: "public" | "private"; description?: string; memberIds?: string[] },
  ) => post<{ channel: MyChannel }>(`/workspaces/${wid}/channels`, b),
  openDm: (wid: string, userIds: string[]) =>
    post<{ channel: MyChannel }>(`/workspaces/${wid}/dms`, { userIds }),
  channel: (cid: string) => get<{ channel: MyChannel; members: Member[] }>(`/channels/${cid}`),
  updateChannel: (cid: string, b: { name?: string; topic?: string; description?: string }) =>
    patch<{ channel: MyChannel }>(`/channels/${cid}`, b),
  joinChannel: (cid: string) => post<{ channel: MyChannel }>(`/channels/${cid}/join`),
  leaveChannel: (cid: string) => post<{ ok: true }>(`/channels/${cid}/leave`),
  addMembers: (cid: string, userIds: string[]) =>
    post<{ added: string[] }>(`/channels/${cid}/members`, { userIds }),
  removeChannelMember: (cid: string, uid: string) => del<{ ok: true }>(`/channels/${cid}/members/${uid}`),
  archiveChannel: (cid: string, archive: boolean) =>
    post<{ channel: MyChannel }>(`/channels/${cid}/${archive ? "archive" : "unarchive"}`),
  deleteChannel: (cid: string) => del<{ ok: true }>(`/channels/${cid}`),
  markRead: (cid: string, ts: number) => post<{ lastReadAt: number }>(`/channels/${cid}/read`, { ts }),
  channelPrefs: (cid: string, b: { starred?: boolean; muted?: boolean; hidden?: boolean }) =>
    patch<{ channel: MyChannel }>(`/channels/${cid}/prefs`, b),
  pins: (cid: string) => get<{ messages: Message[] }>(`/channels/${cid}/pins`),
  channelFiles: (cid: string) => get<{ files: FileInfo[] }>(`/channels/${cid}/files`),
  bookmarks: (cid: string) => get<{ bookmarks: Bookmark[] }>(`/channels/${cid}/bookmarks`),
  addBookmark: (cid: string, b: { title: string; url: string }) =>
    post<{ bookmark: Bookmark }>(`/channels/${cid}/bookmarks`, b),
  deleteBookmark: (cid: string, bid: string) => del<{ ok: true }>(`/channels/${cid}/bookmarks/${bid}`),

  messages: (cid: string, q: { before?: string; after?: string; around?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    return get<MessagePage>(`/channels/${cid}/messages${qs ? `?${qs}` : ""}`);
  },
  postMessage: (
    cid: string,
    b: {
      text: string;
      threadRootId?: string | null;
      broadcast?: boolean;
      fileIds?: string[];
      clientMsgId?: string;
      subtype?: "me";
      sharedMessageId?: string;
    },
  ) => post<{ message: Message }>(`/channels/${cid}/messages`, b),
  editMessage: (mid: string, text: string) => patch<{ message: Message }>(`/messages/${mid}`, { text }),
  deleteMessage: (mid: string) => del<{ ok: true }>(`/messages/${mid}`),
  thread: (mid: string) => get<ThreadView>(`/messages/${mid}/thread`),
  react: (mid: string, emoji: string) =>
    post<{ reactions: Reaction[] }>(`/messages/${mid}/reactions`, { emoji }),
  unreact: (mid: string, emoji: string) =>
    del<{ reactions: Reaction[] }>(`/messages/${mid}/reactions/${encodeURIComponent(emoji)}`),
  pin: (mid: string) => post<{ pinned: boolean }>(`/messages/${mid}/pin`),
  unpin: (mid: string) => del<{ pinned: boolean }>(`/messages/${mid}/pin`),
  save: (mid: string, completed?: boolean) =>
    post<{ saved: boolean }>(`/messages/${mid}/save`, completed === undefined ? {} : { completed }),
  unsave: (mid: string) => del<{ saved: boolean }>(`/messages/${mid}/save`),
  markUnread: (mid: string) => post<{ lastReadAt: number }>(`/messages/${mid}/unread`),
  threadRead: (rid: string, ts: number) => post<{ ok: true }>(`/threads/${rid}/read`, { ts }),
  follow: (rid: string, on: boolean) =>
    on
      ? post<{ subscribed: boolean }>(`/threads/${rid}/follow`)
      : del<{ subscribed: boolean }>(`/threads/${rid}/follow`),

  search: (
    wid: string,
    q: { q: string; channel?: string; user?: string; sort?: string; offset?: number },
  ) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
    return get<{ results: SearchResult[]; hasMore: boolean }>(`/workspaces/${wid}/search?${params}`);
  },
  threads: (wid: string) => get<{ threads: ThreadSummary[] }>(`/workspaces/${wid}/threads`),
  activity: (wid: string) => get<{ items: ActivityItem[] }>(`/workspaces/${wid}/activity`),
  saved: (wid: string, completed = false) =>
    get<{ items: SavedItem[] }>(`/workspaces/${wid}/saved${completed ? "?state=completed" : ""}`),
  files: (wid: string) => get<{ files: FileInfo[] }>(`/workspaces/${wid}/files`),
};
