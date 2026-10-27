import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  test: {
    name: "unit",
    environment: "jsdom",
    include: ["src/shared/**/*.test.ts", "src/client/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/unit/setup.ts"],
  },
});
