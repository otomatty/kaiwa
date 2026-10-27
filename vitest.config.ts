import { defineConfig } from "vitest/config";

// Two test projects:
//  - unit:   pure logic + React components (jsdom)
//  - worker: API / Durable Object integration tests running inside workerd (Miniflare)
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.worker.config.ts"],
  },
});
