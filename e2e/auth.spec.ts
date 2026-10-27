import { expect, test } from "@playwright/test";

test("sign up, create a workspace, sign out and sign back in", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "アカウントを作成する" }).click();
  await page.getByLabel("表示名").fill("山田 太郎");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("password123");
  await page.getByRole("button", { name: "アカウントを作成する" }).click();

  await expect(page).toHaveURL(/\/new/);
  await page.getByLabel("ワークスペース名").fill("テスト株式会社");
  await page.getByRole("button", { name: "作成する" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/c\//);
  await expect(page.getByTestId("channel-title")).toContainText("general");
  await expect(page.getByTestId("sidebar-channel-random")).toBeVisible();

  // Sign out via the user menu
  await page.getByRole("button", { name: "自分のメニュー" }).click();
  await page.getByRole("menuitem", { name: "サインアウト" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "サインインする" }).click();
  await expect(page.getByRole("alert")).toContainText("パスワードが違います");

  await page.getByLabel("パスワード").fill("password123");
  await page.getByRole("button", { name: "サインインする" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/c\//);
  await expect(page.getByTestId("channel-title")).toContainText("general");
});

test("protected pages redirect to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/w/T000/threads");
  await expect(page).toHaveURL(/\/login\?next=/);
});
