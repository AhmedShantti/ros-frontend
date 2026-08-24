/**
 * Traceability from ROS-SRS-001 to this codebase.
 *
 *   node scripts/srs-trace.mjs            summary to stdout
 *   node scripts/srs-trace.mjs --write    also rewrites docs/SRS_TRACEABILITY.md
 *   node scripts/srs-trace.mjs --module POS
 *
 * The requirement list is extracted once into `docs/srs-requirements.json`;
 * this script only cross-references it against the tree, so it is safe to run
 * after every change and is the thing to check before claiming a module is
 * finished.
 *
 * ## What the four states mean
 *
 * The distinction that matters here is between a requirement the code
 * *implements* and one it merely *mentions*. The public site tags its claims
 * with requirement ids, so a naive grep counts marketing copy as coverage —
 * which is exactly the kind of overstatement the gap analysis was written to
 * catch. Hits are therefore attributed by where they are found.
 *
 *   implemented    referenced from application or library code
 *   displayed      referenced only from marketing copy or documentation
 *   backend        cannot be satisfied in a browser: schema, jobs, tokens,
 *                  encryption at rest, tenant isolation, backend test policy
 *   absent         no reference anywhere
 *
 * `backend` is not a synonym for "not done". It records that this repository
 * is the wrong artefact for the requirement — there is no server, no database
 * and no scheduler here — so building UI that claims it would be a false
 * claim rather than progress.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "docs", "scripts", "api"]);

/**
 * Whether a requirement has a frontend deliverable at all.
 *
 * Judged from the requirement's own text rather than from its module code,
 * because the two do not line up: FR-POS-002 asks for number blocks issued on
 * sync, which is a server concern inside the most frontend-shaped module,
 * while CRM — nominally backend — still owes a customer lookup screen.
 *
 * A requirement that speaks only of partitions, tokens, encryption at rest or
 * scheduled jobs has nothing for this repository to build. One that speaks of
 * displaying, presenting, allowing or requiring something almost always does.
 */
const BACKEND_MODULES = new Set(["DR", "QA", "API", "PLT", "INT", "OFF"]);

const SERVER_ONLY_TEXT =
  /(partitioned?|encrypt(ed|ion)?|at rest|refresh tokens?|access tokens?|database|schema|index(es)?|constraints?|scheduled job|cron|backups?|replica|failover|RPO|RTO|migrations?|SQL|rate limits?|webhooks?|idempotenc\w+|foreign keys?|unit tests?|test coverage|pipelines?)/i;

const CLIENT_TEXT =
  /(SHALL (display|present|show|prompt|render)|screen|grid|layout|button|colou?r|keyboard|touch|printer?|receipt|visible|drawer|tile|dialog|wizard|scan)/i;

/**
 * Two signals, because neither alone is trustworthy.
 *
 * The module is the stronger one: whole chapters — disaster recovery, the QA
 * policy, the HTTP contract, the platform — describe infrastructure this
 * repository does not contain, and no amount of screen would satisfy them.
 *
 * The text catches what the module misses. FR-POS-002 wants number blocks
 * issued on sync: a server concern inside the most frontend-shaped chapter
 * in the document.
 *
 * Deliberately conservative. "SHALL provide" and "SHALL support" open almost
 * every requirement here, so a text signal alone would call nearly the whole
 * specification a frontend job. When the two disagree the module wins, and
 * whatever is left is reported `unclear` rather than quietly counted as work
 * this repository owes.
 */
function surface(module, text) {
  if (BACKEND_MODULES.has(module)) return "server-only";
  if (SERVER_ONLY_TEXT.test(text) && !CLIENT_TEXT.test(text)) return "server-only";
  if (CLIENT_TEXT.test(text)) return "frontend";
  return "unclear";
}

/** Paths whose mentions are claims about the product, not implementations. */
const COPY = [/^content[\\/]/, /\.md$/, /^app[\\/]\(marketing\)/];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|md)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = walk(ROOT);
const hits = new Map(); // id -> Set<relative path>

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\b(?:FR|NFR)-[A-Z]{2,4}-\d{3}\b/g)) {
    if (!hits.has(m[0])) hits.set(m[0], new Set());
    hits.get(m[0]).add(rel);
  }
}

const { requirements } = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs/srs-requirements.json"), "utf8"),
);

const isCopy = (p) => COPY.some((re) => re.test(p));

const rows = requirements.map((req) => {
  const where = [...(hits.get(req.id) ?? [])].sort();
  const code = where.filter((p) => !isCopy(p));
  const face = surface(req.module, req.text);
  let state;
  if (code.length > 0) state = "implemented";
  else if (where.length > 0) state = "displayed";
  else if (face === "server-only") state = "backend";
  else state = "absent";
  return { ...req, state, surface: face, where, code };
});

const only = process.argv.includes("--module")
  ? process.argv[process.argv.indexOf("--module") + 1]
  : null;
const scoped = only ? rows.filter((r) => r.module === only) : rows;

const count = (s, list = scoped) => list.filter((r) => r.state === s).length;
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));

console.log(`ROS-SRS-001 traceability${only ? ` — ${only}` : ""}`);
console.log(`  requirements   ${scoped.length}`);
for (const s of ["implemented", "displayed", "backend", "absent"]) {
  console.log(`  ${s.padEnd(14)} ${String(count(s)).padStart(4)}  ${pct(count(s), scoped.length)}%`);
}

if (!only) {
  const modules = [...new Set(rows.map((r) => r.module))].sort();
  console.log(`\n  ${"module".padEnd(7)}${"total".padStart(6)}${"impl".padStart(6)}${"disp".padStart(6)}${"backend".padStart(9)}${"absent".padStart(8)}`);
  for (const m of modules) {
    const list = rows.filter((r) => r.module === m);
    console.log(
      `  ${m.padEnd(7)}${String(list.length).padStart(6)}` +
        `${String(count("implemented", list)).padStart(6)}` +
        `${String(count("displayed", list)).padStart(6)}` +
        `${String(count("backend", list)).padStart(9)}` +
        `${String(count("absent", list)).padStart(8)}`,
    );
  }
}

/**
 * The work queue: everything with a frontend deliverable that has none yet.
 * This is the list that "finish the SRS as a frontend" actually means.
 */
if (process.argv.includes("--backlog")) {
  const backlog = scoped.filter(
    (r) => r.state === "absent" && r.surface !== "server-only",
  );
  const byModule = new Map();
  for (const r of backlog) {
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push(r);
  }
  console.log(`
FRONTEND BACKLOG — ${backlog.length} requirements
`);
  for (const [m, list] of [...byModule].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${m} (${list.length})`);
    for (const r of list) console.log(`    ${r.id}  ${r.text.slice(0, 96)}`);
    console.log();
  }
}

if (process.argv.includes("--write")) {
  const line = (r) =>
    `| ${r.id} | ${r.priority ?? "—"} | ${r.state} | ${r.code[0] ?? "—"} | ${r.text.replace(/\|/g, "\\|").slice(0, 160)} |`;
  const modules = [...new Set(rows.map((r) => r.module))].sort();
  const body = modules
    .map((m) => {
      const list = rows.filter((r) => r.module === m);
      return [
        `\n## ${m} — ${count("implemented", list)}/${list.length} implemented\n`,
        "| Requirement | Pri | State | First reference | Text |",
        "| --- | --- | --- | --- | --- |",
        ...list.map(line),
      ].join("\n");
    })
    .join("\n");

  fs.writeFileSync(
    path.join(ROOT, "docs/SRS_TRACEABILITY.md"),
    `# ROS-SRS-001 traceability\n\n` +
      `Generated by \`node scripts/srs-trace.mjs --write\`. Do not edit by hand.\n\n` +
      `| State | Count | |\n| --- | ---: | --- |\n` +
      ["implemented", "displayed", "backend", "absent"]
        .map((s) => `| ${s} | ${count(s)} | ${pct(count(s), rows.length)}% |`)
        .join("\n") +
      `\n\n**displayed** means the id appears only in marketing copy or documentation — ` +
      `a claim about the product rather than an implementation of it. ` +
      `**backend** means the requirement asks for a database, a scheduled job, ` +
      `server-issued tokens or encryption at rest, none of which exist in a ` +
      `browser frontend.\n` +
      body +
      "\n",
    "utf8",
  );
  console.log("\nwrote docs/SRS_TRACEABILITY.md");
}
