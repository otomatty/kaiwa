import { expect, test } from "@playwright/test";
import { composer, message, newUser, openChannel, send, setupWorkspace } from "./helpers";

test("short conversations are marked read when opened, and stay read after reload", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  await openChannel(B, "random");
  await openChannel(A, "general");
  await send(A, "短いチャンネルの未読 1");
  await send(A, "短いチャンネルの未読 2");
  const row = B.getByTestId("sidebar-channel-general");
  await expect(row).toHaveCSS("font-weight", "700");
  await row.click();
  await expect(message(B, "短いチャンネルの未読 2")).toBeVisible();
  await expect(row).not.toHaveCSS("font-weight", "700");
  await B.waitForTimeout(800); // read marker is sent after a short debounce
  await B.reload();
  await expect(B.getByTestId("sidebar-channel-general")).not.toHaveCSS("font-weight", "700");
});

test("drafts survive quick channel switches", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  await setupWorkspace(aoi);
  const A = aoi.page;
  await composer(A).click();
  await composer(A).pressSequentially("速い下書き");
  await A.keyboard.press("Alt+ArrowDown");
  await expect(A.getByTestId("channel-title")).toContainText("random");
  await A.keyboard.press("Alt+ArrowUp");
  await expect(A.getByTestId("channel-title")).toContainText("general");
  await expect(composer(A)).toHaveValue("速い下書き");
});

test("leaving a private channel with /leave removes it from the sidebar", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  await setupWorkspace(aoi);
  const A = aoi.page;
  await A.getByRole("button", { name: "チャンネルを追加する" }).first().click();
  await A.getByRole("menuitem", { name: "新しいチャンネルを作成する" }).click();
  await A.getByLabel("名前").fill("secret-room");
  await A.getByText("プライベート — 招待されたメンバーのみが閲覧できます").click();
  await A.getByRole("button", { name: "作成する" }).click();
  await expect(A.getByTestId("channel-title")).toContainText("secret-room");
  await send(A, "/leave");
  await expect(A.getByTestId("sidebar-channel-secret-room")).toHaveCount(0);
  await expect(A.getByTestId("channel-title")).toContainText("general");
});

test("a search result jump highlights the message and does not affect the next channel", async ({
  browser,
}) => {
  const aoi = await newUser(browser, "青井");
  await setupWorkspace(aoi);
  const A = aoi.page;
  await send(A, "検索ジャンプ確認用メッセージ");
  await openChannel(A, "random");
  await send(A, "ランダムの投稿");
  await A.getByRole("textbox", { name: "検索" }).fill("検索ジャンプ");
  await A.getByRole("textbox", { name: "検索" }).press("Enter");
  await A.getByTestId("search-results").getByText("検索ジャンプ確認用メッセージ").click();
  await expect(A.getByTestId("channel-title")).toContainText("general");
  await expect(message(A, "検索ジャンプ確認用メッセージ")).toHaveClass(/jump-highlight/);
  await openChannel(A, "random");
  await expect(message(A, "ランダムの投稿")).toBeVisible();
  await expect(A.getByText("メッセージが見つかりません")).toHaveCount(0);
});

test("browse channels does not offer leaving #general", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  await setupWorkspace(aoi);
  const A = aoi.page;
  await A.getByRole("button", { name: "チャンネルを追加する" }).first().click();
  await A.getByRole("menuitem", { name: "チャンネル一覧" }).click();
  const row = A.getByRole("dialog").getByRole("listitem").filter({ hasText: "general" });
  await row.hover();
  await expect(row.getByRole("button", { name: "退出する" })).toHaveCount(0);
  await expect(
    A.getByRole("dialog")
      .getByRole("listitem")
      .filter({ hasText: "random" })
      .getByRole("button", { name: "退出する" }),
  ).toHaveCount(1);
});

async function channelId(page: import("@playwright/test").Page, wid: string, name: string) {
  const boot = (await (await page.request.get(`/api/workspaces/${wid}/bootstrap`)).json()) as {
    channels: { id: string; name: string }[];
  };
  return boot.channels.find((c) => c.name === name)?.id as string;
}

test("forwarding from a private channel: files load for everyone, deletes show a placeholder", async ({
  browser,
}) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  const wid = await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  const created = await A.request.post(`/api/workspaces/${wid}/channels`, {
    data: { name: "himitsu", kind: "private" },
  });
  const secretId = ((await created.json()) as { channel: { id: string } }).channel.id;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const up = await A.request.post(`/api/workspaces/${wid}/files`, {
    multipart: { file: { name: "plan.png", mimeType: "image/png", buffer: png } },
  });
  const fileId = ((await up.json()) as { file: { id: string } }).file.id;
  await A.request.post(`/api/channels/${secretId}/messages`, {
    data: { text: "極秘の計画", fileIds: [fileId] },
  });

  await openChannel(A, "himitsu");
  await message(A, "極秘の計画").hover();
  await A.getByRole("button", { name: "その他" }).click();
  await A.getByRole("menuitem", { name: "メッセージを転送…" }).click();
  // The preview renders the message instead of raw markup; the destination is picked with the keyboard.
  await expect(A.getByTestId("forward-preview")).toContainText("極秘の計画");
  await A.getByLabel("転送先を検索").fill("gene");
  await A.getByLabel("転送先を検索").press("Enter");
  await expect(A.getByText("宛先:")).toContainText("#general");
  await A.getByRole("button", { name: "転送する" }).click();

  const card = B.getByTestId("shared-message");
  await expect(card).toContainText("極秘の計画");
  await expect(card).toContainText("プライベートチャンネル のメッセージ");
  await expect(card.getByRole("button", { name: "元のメッセージを表示" })).toHaveCount(0);
  await expect
    .poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(1);

  // Deleting the original updates the forwarded copy live
  await message(A, "極秘の計画").hover();
  await A.getByRole("button", { name: "その他" }).click();
  await A.getByRole("menuitem", { name: "メッセージを削除する…" }).click();
  await A.getByRole("button", { name: "削除", exact: true }).click();
  await expect(card).toHaveText("元のメッセージは削除されました");
});

test("a link to a thread reply opens the thread with the reply highlighted", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  const wid = await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  const cid = await channelId(A, wid, "general");
  const root = await A.request.post(`/api/channels/${cid}/messages`, { data: { text: "スレッドの親" } });
  const rootId = ((await root.json()) as { message: { id: string } }).message.id;
  const reply = await A.request.post(`/api/channels/${cid}/messages`, {
    data: { text: "リンク先の返信", threadRootId: rootId },
  });
  const replyId = ((await reply.json()) as { message: { id: string } }).message.id;
  await openChannel(B, "random");
  await B.goto(`/w/${wid}/c/${cid}?msg=${replyId}`);
  const panel = B.getByTestId("thread-panel");
  await expect(panel).toContainText("リンク先の返信");
  await expect(panel.locator(".jump-highlight")).toContainText("リンク先の返信");
});

test("deleting an unread message clears the unread state", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  const wid = await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  await openChannel(B, "random");
  const cid = await channelId(A, wid, "general");
  const res = await A.request.post(`/api/channels/${cid}/messages`, { data: { text: "すぐ消す投稿" } });
  const mid = ((await res.json()) as { message: { id: string } }).message.id;
  const row = B.getByTestId("sidebar-channel-general");
  await expect(row).toHaveCSS("font-weight", "700");
  await A.request.delete(`/api/messages/${mid}`);
  await expect(row).not.toHaveCSS("font-weight", "700");
});

test("drafts survive an immediate reload, and a cleared draft stays cleared", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  await setupWorkspace(aoi);
  const A = aoi.page;
  await composer(A).click();
  await composer(A).pressSequentially("リロード直前の下書き");
  await A.reload();
  await expect(composer(A)).toHaveValue("リロード直前の下書き");
  await composer(A).fill("");
  await A.reload();
  await expect(composer(A)).toHaveValue("");
});

test("the paused-notifications icon disappears when the pause ends", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  await B.getByText("メンバー", { exact: true }).click();
  await A.request.patch("/api/me", { data: { dndUntil: Date.now() + 4000 } });
  const icon = B.getByLabel("通知を一時停止中");
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCount(0, { timeout: 8000 });
});
