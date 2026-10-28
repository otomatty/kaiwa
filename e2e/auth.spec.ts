import { expect, test } from "@playwright/test";
import { newUser, setupWorkspace, signInWithGoogle } from "./helpers";

test("sign in with Google, create a workspace, sign out and sign back in", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await signInWithGoogle(page, email, "山田 太郎");

  await expect(page).toHaveURL(/\/new/);
  await expect(page.getByText("山田 太郎 さん、ようこそ。")).toBeVisible();
  await page.getByLabel("ワークスペース名").fill("テスト株式会社");
  await page.getByRole("button", { name: "作成する" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/c\//);
  await expect(page.getByTestId("channel-title")).toContainText("general");
  await expect(page.getByTestId("sidebar-channel-random")).toBeVisible();

  // Sign out via the user menu
  await page.getByRole("button", { name: "自分のメニュー" }).click();
  await page.getByRole("menuitem", { name: "サインアウト" }).click();
  await expect(page).toHaveURL(/\/login/);

  // The same Google account comes back to the same Kaiwa account.
  await signInWithGoogle(page, email, "山田 太郎");
  await expect(page).toHaveURL(/\/w\/[^/]+\/c\//);
  await expect(page.getByTestId("channel-title")).toContainText("general");
});

test("cancelling on Google shows why and keeps where to go next", async ({ page }) => {
  await page.goto("/w/T000/threads");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole("link", { name: "Google でサインイン" }).click();
  await page.getByRole("link", { name: "キャンセル" }).click();
  await expect(page).toHaveURL(/\/login\?error=access_denied&next=%2Fw%2FT000%2Fthreads/);
  await expect(page.getByRole("alert")).toContainText("キャンセルされました");
});

test("an invite link signs in with Google and comes back to join", async ({ browser }) => {
  const owner = await newUser(browser, "オーナー");
  const wid = await setupWorkspace(owner);
  const invite = await owner.page.request.post(`/api/workspaces/${wid}/invites`, { data: {} });
  const { code } = (await invite.json()) as { code: string };

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/invite/${code}`);
  await expect(page.getByRole("heading", { name: "E2E チーム に参加" })).toBeVisible();
  await signInWithGoogle(page, `guest-${Date.now()}@example.com`, "ゲスト");
  await expect(page).toHaveURL(new RegExp(`/invite/${code}$`));
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${wid}/c/`));
});
