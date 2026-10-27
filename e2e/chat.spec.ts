import { expect, test } from "@playwright/test";
import { composer, message, newUser, openChannel, send, setupWorkspace } from "./helpers";

test("two people chat in real time with mentions, formatting, reactions, edits and threads", async ({
  browser,
}) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;

  // Formatting + emoji render for the other user without reloading
  await send(A, "おはようございます *太字* と `code` :tada:");
  await expect(message(B, "おはようございます")).toBeVisible();
  await expect(message(B, "おはようございます").locator("strong")).toHaveText("太字");
  await expect(message(B, "おはようございます").locator("code")).toHaveText("code");
  await expect(message(B, "おはようございます").getByRole("img", { name: "tada" })).toBeVisible();

  // Mention via autocomplete
  const box = composer(A);
  await box.click();
  await box.pressSequentially("@佐藤");
  await expect(A.getByRole("option", { name: /佐藤/ })).toBeVisible();
  await box.press("Enter");
  await box.pressSequentially("確認お願いします");
  await box.press("Enter");
  const mention = message(B, "確認お願いします");
  await expect(mention).toBeVisible();
  await expect(mention.getByRole("button", { name: "@佐藤" })).toBeVisible();

  // Typing indicator
  await composer(B).click();
  await composer(B).pressSequentially("入力中", { delay: 30 });
  await expect(A.getByText("佐藤 さんが入力中です")).toBeVisible();
  await composer(B).fill("");

  // Reaction from B shows up for A
  await mention.hover();
  await B.getByRole("button", { name: ":eyes: でリアクション" }).click();
  await expect(message(A, "確認お願いします").getByRole("button", { name: /1/ }).first()).toBeVisible();

  // Thread reply with "also send to channel"
  await mention.hover();
  await B.getByRole("button", { name: "スレッドで返信する" }).click();
  const thread = B.getByTestId("thread-panel");
  await expect(thread).toContainText("確認お願いします");
  const reply = B.getByRole("textbox", { name: "返信する…" });
  await reply.fill("了解です！");
  await B.getByText("#general にも投稿する").click();
  await reply.press("Enter");
  await expect(thread).toContainText("了解です！");
  await expect(message(A, "確認お願いします").first()).toContainText("1件の返信");
  await expect(message(A, "了解です！")).toContainText("スレッドに返信しました");

  // Edit the last message with ↑ and delete a message
  await send(A, "書き間違え");
  await expect(message(B, "書き間違え")).toBeVisible();
  await composer(A).press("ArrowUp");
  const editor = A.getByRole("textbox", { name: "メッセージを編集" });
  await editor.fill("書き直しました");
  await editor.press("Enter");
  await expect(message(B, "書き直しました")).toContainText("（編集済み）");

  await message(A, "書き直しました").hover();
  await A.getByRole("button", { name: "その他" }).click();
  await A.getByRole("menuitem", { name: /メッセージを削除する/ }).click();
  await A.getByRole("button", { name: "削除", exact: true }).click();
  await expect(message(B, "書き直しました")).toHaveCount(0);
});

test("unread state, channel creation, joining and slash commands", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;

  // A creates a channel
  await A.getByRole("button", { name: "チャンネルを追加する" }).first().click();
  await A.getByRole("menuitem", { name: "新しいチャンネルを作成する" }).click();
  await A.getByLabel("名前").fill("Project X");
  await A.getByRole("button", { name: "作成する" }).click();
  await expect(A.getByTestId("channel-title")).toContainText("project-x");
  await send(A, "/topic 今週のリリース準備");
  await expect(A.getByTestId("message-list")).toContainText(
    "チャンネルトピックを設定しました: 今週のリリース準備",
  );

  // B browses and joins
  await B.getByRole("button", { name: "チャンネルを追加する" }).first().click();
  await B.getByRole("menuitem", { name: "チャンネル一覧" }).click();
  await B.getByRole("dialog")
    .getByRole("button", { name: /project-x/ })
    .click();
  await expect(B.getByText("をプレビュー中です")).toBeVisible();
  await B.getByRole("button", { name: "チャンネルに参加する" }).click();
  await expect(composer(B)).toBeVisible();
  await expect(A.getByTestId("message-list")).toContainText("佐藤 が #project-x に参加しました");

  // Unread + mention badge for B while viewing another channel
  await openChannel(B, "random");
  await send(A, "@佐藤 ちょっといいですか");
  const row = B.getByTestId("sidebar-channel-project-x");
  await expect(row).toHaveCSS("font-weight", "700");
  await expect(row).toContainText("1");
  await openChannel(B, "project-x");
  await expect(B.getByTestId("unread-divider")).toBeVisible();
  await expect(row).not.toHaveCSS("font-weight", "700");

  // /leave
  await send(B, "/leave");
  await expect(B.getByTestId("sidebar-channel-project-x")).toHaveCount(0);
});

test("direct messages, search, saved items and quick switcher", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;

  // New DM from A to B
  await A.getByRole("button", { name: "新規メッセージ" }).first().click();
  await A.getByLabel("メンバーを検索").fill("佐藤");
  await A.keyboard.press("Enter");
  await A.getByRole("button", { name: "会話を始める" }).click();
  await expect(A.getByTestId("channel-title")).toContainText("佐藤");
  await send(A, "来週の打ち合わせの議事録を共有します");
  const dmRow = B.getByTestId("sidebar-channel-dm");
  await expect(dmRow).toBeVisible();
  await expect(dmRow).toContainText("1");
  await dmRow.click();
  await expect(message(B, "議事録を共有します")).toBeVisible();

  // Save for later
  await message(B, "議事録を共有します").hover();
  await B.getByRole("button", { name: "後で用に保存" }).click();
  await expect(message(B, "議事録を共有します")).toContainText("後で用に保存済み");
  await B.getByRole("button", { name: "後で", exact: true }).click();
  await expect(B.getByText("来週の打ち合わせの議事録を共有します").first()).toBeVisible();
  await B.getByRole("button", { name: /^ホーム/ }).click();

  // Search and jump to message
  await openChannel(A, "general");
  await send(A, "デプロイ手順はwikiにまとめました");
  await A.getByRole("textbox", { name: "検索" }).fill("デプロイ手順");
  await A.getByRole("textbox", { name: "検索" }).press("Enter");
  await expect(A.getByTestId("search-results")).toContainText("デプロイ手順はwikiにまとめました");
  await A.getByTestId("search-results").getByText("デプロイ手順はwikiにまとめました").click();
  await expect(A.getByTestId("channel-title")).toContainText("general");

  // Quick switcher
  await A.keyboard.press("Control+k");
  await A.getByRole("textbox", { name: "移動先を検索" }).fill("rand");
  await A.keyboard.press("Enter");
  await expect(A.getByTestId("channel-title")).toContainText("random");
});

test("file upload shows an attachment for everyone", async ({ browser }) => {
  const aoi = await newUser(browser, "青井");
  const ren = await newUser(browser, "佐藤");
  await setupWorkspace(aoi, ren);
  const A = aoi.page;
  const B = ren.page;
  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await A.locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "pixel.png", mimeType: "image/png", buffer: png },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    ]);
  await expect(A.getByText("pixel.png")).toBeVisible();
  await expect(A.getByRole("button", { name: "送信" })).toBeEnabled();
  await composer(A).fill("資料です");
  await composer(A).press("Enter");
  const msg = message(B, "資料です");
  await expect(msg.getByRole("img", { name: "pixel.png" })).toBeVisible();
  await expect(msg.getByText("notes.txt")).toBeVisible();
});
