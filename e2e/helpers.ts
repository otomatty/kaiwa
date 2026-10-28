import { type Browser, expect, type Page } from "@playwright/test";

let seq = 0;

export interface TestUser {
  page: Page;
  name: string;
  email: string;
}

/** Signs in with the page's Google button through the local stand-in for Google (e2e/google-oauth-mock.mjs). */
export async function signInWithGoogle(page: Page, email: string, name: string) {
  await page.getByRole("link", { name: /^Google でサインイン/ }).click();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("名前").fill(name);
  await page.getByRole("button", { name: "続行" }).click();
}

/** Creates a fresh browser context and signs a new user in with Google. */
export async function newUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  seq++;
  const email = `user-${Date.now()}-${seq}@example.com`;
  await page.goto("/login");
  await signInWithGoogle(page, email, name);
  await page.waitForURL(/\/new$/);
  return { page, name, email };
}

/** Owner creates a workspace through the UI; others join via the invite link. Returns workspace id. */
export async function setupWorkspace(owner: TestUser, ...others: TestUser[]): Promise<string> {
  await owner.page.goto("/new");
  await owner.page.getByLabel("ワークスペース名").fill("E2E チーム");
  await owner.page.getByRole("button", { name: "作成する" }).click();
  await owner.page.waitForURL(/\/w\/[^/]+\/c\//);
  const wid = owner.page.url().split("/")[4] as string;
  const invite = await owner.page.request.post(`/api/workspaces/${wid}/invites`, { data: {} });
  const { code } = (await invite.json()) as { code: string };
  for (const o of others) {
    await o.page.goto(`/invite/${code}`);
    await o.page.getByRole("button", { name: "参加する" }).click();
    await o.page.waitForURL(/\/w\/[^/]+\/c\//);
  }
  return wid;
}

export function composer(page: Page) {
  return page.getByRole("textbox", { name: /へのメッセージ$/ });
}

export async function send(page: Page, text: string) {
  const box = composer(page);
  await box.click();
  await box.fill(text);
  await box.press("Enter");
}

export function message(page: Page, text: string | RegExp) {
  return page.getByTestId("message-list").locator("[data-message-id]").filter({ hasText: text });
}

export async function openChannel(page: Page, name: string) {
  await page.getByTestId(`sidebar-channel-${name}`).click();
  await expect(page.getByTestId("channel-title")).toContainText(name);
}
