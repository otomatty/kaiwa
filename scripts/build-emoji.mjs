// Generates src/shared/emoji-data.json from emojibase-data.
// Shortcodes follow the iamcal set (the de-facto standard for team chat apps).
// Run with: node scripts/build-emoji.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "node_modules/emojibase-data/en");
const compact = JSON.parse(readFileSync(join(base, "compact.json"), "utf8"));
const iamcal = JSON.parse(readFileSync(join(base, "shortcodes/iamcal.json"), "utf8"));
const github = JSON.parse(readFileSync(join(base, "shortcodes/github.json"), "utf8"));

const toList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** @type {[string, string[], number, string][]} */
const rows = [];
for (const e of compact) {
  if (e.group === undefined || e.group === 2) continue; // skip components (skin tone swatches etc.)
  const codes = [...new Set([...toList(iamcal[e.hexcode]), ...toList(github[e.hexcode])])];
  if (codes.length === 0) continue;
  rows.push([e.unicode, codes, e.group, (e.tags ?? []).join(" ")]);
}
rows.sort((a, b) => a[2] - b[2]);

writeFileSync(join(root, "src/shared/emoji-data.json"), `${JSON.stringify(rows)}\n`);
console.info(`wrote ${rows.length} emoji`);
