import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// E2E builds sign in through a local stand-in for Google's OAuth endpoints (e2e/google-oauth-mock.mjs).
const googleOAuthMock = process.env.E2E_GOOGLE_OAUTH_URL;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(googleOAuthMock ? { config: { vars: { GOOGLE_OAUTH_URL: googleOAuthMock } } } : {}),
  ],
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
  },
  environments: {
    client: {
      build: {
        chunkSizeWarningLimit: 600,
        rolldownOptions: {
          output: {
            // Long-lived caching: libraries and the emoji table change less often than app code.
            codeSplitting: {
              groups: [
                { name: "emoji", test: /emoji-data\.json/ },
                { name: "vendor", test: /node_modules/ },
              ],
            },
          },
        },
      },
    },
  },
});
