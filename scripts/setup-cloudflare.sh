#!/usr/bin/env bash
# One-time Cloudflare setup: creates the D1 database and R2 bucket, and writes
# the D1 database id into wrangler.jsonc. Requires `wrangler login` (or
# CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment).
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="${DB_NAME:-kaiwa-db}"
BUCKET="${BUCKET:-kaiwa-files}"

echo "==> Creating D1 database: $DB_NAME"
if out=$(pnpm exec wrangler d1 create "$DB_NAME" 2>&1); then
  echo "$out"
else
  echo "$out"
  echo "(continuing: the database may already exist)"
fi

# `d1 info <name>` resolves the name through wrangler.jsonc, so a placeholder
# database_id makes the lookup miss the database that was just created.
id=$(pnpm exec wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const row=JSON.parse(s).find(d=>d.name===process.argv[1]);console.log(row?.uuid??"")})' "$DB_NAME")
if [ -z "$id" ]; then
  echo "Could not read the database id. Run: pnpm exec wrangler d1 list" >&2
  exit 1
fi
echo "    database_id = $id"
node -e '
const fs=require("fs");const f="wrangler.jsonc";
const s=fs.readFileSync(f,"utf8").replace(/"database_id":\s*"[^"]*"/, `"database_id": "${process.argv[1]}"`);
fs.writeFileSync(f,s);' "$id"

echo "==> Creating R2 bucket: $BUCKET"
pnpm exec wrangler r2 bucket create "$BUCKET" || echo "(continuing: the bucket may already exist)"

echo "==> Applying D1 migrations (remote)"
pnpm exec wrangler d1 migrations apply DB --remote

echo
echo "Done. Commit wrangler.jsonc, then deploy with: pnpm run deploy  (or push to main)"
