import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Test-only binding so the setup file can apply migrations to the isolated D1.
            TEST_MIGRATIONS: migrations,
            GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
          },
        },
      };
    }),
  ],
  test: {
    name: "worker",
    include: ["test/worker/**/*.test.ts"],
    setupFiles: ["./test/worker/apply-migrations.ts"],
  },
});
