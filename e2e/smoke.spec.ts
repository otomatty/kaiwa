import { expect, test } from "@playwright/test";

test("health endpoint and app shell load", async ({ page, request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page).toHaveTitle(/Kaiwa/);
});
