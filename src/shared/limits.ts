// Limits and pure helpers shared by the client and the API (no zod, so the client bundle stays small).

export const LIMITS = {
  messageLength: 40_000,
  channelName: 80,
  topic: 250,
  description: 250,
  displayName: 80,
  statusText: 100,
  workspaceName: 50,
  fileSize: 25 * 1024 * 1024,
  filesPerMessage: 10,
  groupDmMembers: 8,
  pageSize: 50,
} as const;

/**
 * Normalises a channel name the way team chat apps do: lowercase, spaces → "-",
 * strips characters that are not allowed. Non-Latin letters (日本語 etc.) are kept.
 */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .slice(0, LIMITS.channelName);
}

export function channelNameError(name: string): string | null {
  if (name.length === 0) return "チャンネル名を入力してください";
  if (name.length > LIMITS.channelName) return `チャンネル名は${LIMITS.channelName}文字以内にしてください`;
  if (!/^[\p{L}\p{N}_-]+$/u.test(name))
    return "チャンネル名に使えるのは文字・数字・ハイフン・アンダースコアのみです";
  return null;
}
