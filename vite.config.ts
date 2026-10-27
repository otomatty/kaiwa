import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
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
