/**
 * Append copy keys to both console dictionaries at once.
 *
 * `content/console/ar.ts` is typed as `ConsoleCopy`, so a key added to
 * English alone is a build error and a key added to Arabic alone is a type
 * error. Editing the two files by hand keeps producing one-sided commits, so
 * this writes both from a single JSON payload:
 *
 *   node scripts/add-copy.mjs '{"set.title":{"en":"Settings","ar":"الإعدادات"}}'
 *   node scripts/add-copy.mjs --file path/to/copy.json
 *
 * Existing keys are left alone and reported, so re-running is safe.
 */

import { readFileSync, writeFileSync } from "node:fs";

const EN = "content/console/en.ts";
const AR = "content/console/ar.ts";

function readPayload() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const raw =
    fileFlag !== -1 ? readFileSync(args[fileFlag + 1], "utf8") : args.join(" ");
  if (!raw.trim()) {
    console.error("Nothing to add. Pass JSON inline or with --file.");
    process.exit(1);
  }
  return JSON.parse(raw);
}

/** TS string literal with the quoting the existing files use. */
function literal(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function insert(path, entries, closing) {
  let source = readFileSync(path, "utf8");
  const at = source.lastIndexOf(closing);
  if (at === -1) throw new Error(`Could not find the end of ${path}`);

  const added = [];
  const skipped = [];
  for (const [key, value] of entries) {
    // Anchored on the quoted key so a substring match cannot false-positive.
    if (source.includes(`\n  "${key}":`)) {
      skipped.push(key);
      continue;
    }
    added.push(`  ${literal(key)}: ${literal(value)},`);
  }

  if (added.length > 0) {
    source = source.slice(0, at) + added.join("\n") + "\n" + source.slice(at);
    writeFileSync(path, source);
  }
  return { added: added.length, skipped };
}

const payload = readPayload();
const keys = Object.keys(payload);
for (const key of keys) {
  const entry = payload[key];
  if (typeof entry?.en !== "string" || typeof entry?.ar !== "string") {
    console.error(`"${key}" needs both an "en" and an "ar" string.`);
    process.exit(1);
  }
}

const en = insert(
  EN,
  keys.map((k) => [k, payload[k].en]),
  "} as const;",
);
const ar = insert(
  AR,
  keys.map((k) => [k, payload[k].ar]),
  "};",
);

console.log(`en: +${en.added}  ar: +${ar.added}  (of ${keys.length})`);
if (en.skipped.length > 0) {
  console.log(`already present: ${en.skipped.join(", ")}`);
}
