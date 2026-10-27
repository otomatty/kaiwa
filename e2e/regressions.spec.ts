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
