// Checks that Cloudflare deployment is configured before deploying.
//
// - Fully configured: prints "OK" and sets the step output `ready=true`.
// - Not set up at all yet in CI (placeholder D1 id and no secrets, e.g. a fresh fork):
//   prints a warning and sets `ready=false`, so the deploy steps are skipped instead of failing.
// - Partially configured (or run locally with the placeholder id): fails with a readable message.
import { appendFileSync, readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const inCI = !!process.env.GITHUB_ACTIONS;
const placeholder = config.includes("00000000-0000-0000-0000-000000000000");
const hasToken = !!process.env.CLOUDFLARE_API_TOKEN;
const hasAccount = !!process.env.CLOUDFLARE_ACCOUNT_ID;

function setOutput(ready) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
}

if (inCI && placeholder && !hasToken && !hasAccount) {
  console.info(
    "::warning title=Deploy skipped::Cloudflare is not set up for this repository yet. " +
      "Run scripts/setup-cloudflare.sh, commit wrangler.jsonc and add the CLOUDFLARE_API_TOKEN / " +
      "CLOUDFLARE_ACCOUNT_ID secrets (see README).",
  );
  setOutput(false);
  process.exit(0);
}

const errors = [];
if (placeholder) {
  errors.push(
    "wrangler.jsonc: d1_databases[0].database_id is still the placeholder.\n" +
      "  Run `pnpm exec wrangler d1 create kaiwa-db` (or scripts/setup-cloudflare.sh) and commit the id.",
  );
}
if (inCI && !hasToken) errors.push("Repository secret CLOUDFLARE_API_TOKEN is not set.");
if (inCI && !hasAccount) errors.push("Repository secret CLOUDFLARE_ACCOUNT_ID is not set.");

if (errors.length > 0) {
  console.error(`Deploy configuration is incomplete:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.info("Deploy configuration OK");
setOutput(true);
