import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
// Sign-in is Google-only, so the app under test is built against a local stand-in for Google.
const OAUTH_MOCK_PORT = Number(process.env.E2E_OAUTH_MOCK_PORT ?? 4175);
const oauthMockURL = `http://localhost:${OAUTH_MOCK_PORT}`;

// In CI, `playwright install chromium` provides the browser.
// Locally you can point at any Chromium build with PW_CHROMIUM_PATH.
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: executablePath
          ? {
              executablePath,
              args: ["--no-sandbox", "--no-zygote", "--use-gl=angle", "--use-angle=swiftshader"],
            }
          : {},
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `node e2e/google-oauth-mock.mjs ${OAUTH_MOCK_PORT}`,
          url: `${oauthMockURL}/health`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `pnpm db:migrate:local && pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: "pipe",
          env: {
            E2E_GOOGLE_OAUTH_URL: oauthMockURL,
            // Used unless .dev.vars exists; the mock accepts any client.
            GOOGLE_CLIENT_ID: "e2e-client-id",
            GOOGLE_CLIENT_SECRET: "e2e-client-secret",
          },
        },
      ],
});
