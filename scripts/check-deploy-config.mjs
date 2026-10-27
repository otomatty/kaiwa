// Fails the deploy early (with a readable message) when wrangler.jsonc still
// contains the placeholder D1 database id or the Cloudflare secrets are missing.
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const errors = [];

if (config.includes("00000000-0000-0000-0000-000000000000")) {
  errors.push(
    "wrangler.jsonc: d1_databases[0].database_id is still the placeholder.\n" +
      "  Run `pnpm exec wrangler d1 create kaiwa-db` (or scripts/setup-cloudflare.sh) and commit the id.",
  );
}
if (!process.env.CLOUDFLARE_API_TOKEN && process.env.GITHUB_ACTIONS) {
  errors.push("Repository secret CLOUDFLARE_API_TOKEN is not set.");
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID && process.env.GITHUB_ACTIONS) {
  errors.push("Repository secret CLOUDFLARE_ACCOUNT_ID is not set.");
}

if (errors.length > 0) {
  console.error(`Deploy configuration is incomplete:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.info("Deploy configuration OK");
