/**
 * Checks that the configured backend is actually reachable, before the
 * browser has to tell you it is not.
 *
 *   npm run api:check
 *   npm run api:check -- --email you@example.com --password secret
 *
 * With credentials it goes further than /health: it signs in, lists the
 * tenants, selects one, and reads every scoped list the console depends on —
 * which is the sequence that fails quietly when a token is not tenant-scoped.
 *
 * It also compares the deployed document against `api/openapi.json`, the
 * snapshot `lib/api/schema.ts` and `lib/api/endpoints.ts` are generated from.
 * That drift is the failure mode nothing else catches: the app typechecks,
 * builds and boots against a spec the server stopped serving weeks ago, and
 * the first symptom is a 404 in production.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `next dev` loads .env.local for us; a plain `node` run does not.
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(root, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] === undefined) {
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local; rely on the ambient environment.
  }
}

loadEnvLocal();

/**
 * Cold starts are the normal case on a sleeping free-tier host: the first
 * request after an idle period took 23s against Render. Ten seconds turned
 * that into "the API is unreachable", which is exactly the wrong diagnosis.
 */
const PROBE_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 45_000);

const args = process.argv.slice(2);

function arg(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const configured = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

// A relative URL means the app proxies through `next dev`; from a plain Node
// script there is no such server, so check the real target behind it.
const base = configured.startsWith("/")
  ? (process.env.API_PROXY_TARGET ?? "").replace(/\/+$/, "")
  : configured;

if (!base) {
  console.error("No backend address configured. Put one in .env.local:");
  console.error("  NEXT_PUBLIC_API_URL=http://192.168.1.43:3000");
  console.error("or, when proxying:");
  console.error("  NEXT_PUBLIC_API_URL=/api/ros");
  console.error("  API_PROXY_TARGET=http://192.168.1.43:3000");
  process.exit(1);
}

let failures = 0;

async function call(label, path, { method = "GET", body, token } = {}) {
  const url = `${base}${path}`;
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const ms = Date.now() - started;
    const text = await response.text();

    let payload;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = text.slice(0, 120);
    }

    if (!response.ok) {
      failures += 1;
      const detail = payload?.message ?? payload ?? response.statusText;
      console.error(`  FAIL ${label} — ${response.status} ${JSON.stringify(detail)} (${ms}ms)`);
      return null;
    }

    const size = Array.isArray(payload) ? `${payload.length} rows` : "ok";
    console.log(`  OK   ${label} — ${response.status} ${size} (${ms}ms)`);
    return payload;
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label} — ${error.message}`);
    console.error(
      `       Is the API listening on 0.0.0.0 (not 127.0.0.1), and is ${base} reachable from here?`,
    );
    return null;
  }
}

/**
 * The check that catches the "connected but the browser reads nothing" case.
 *
 * `fetch` from Node ignores CORS entirely, so every call above can pass while
 * the console still fails in a browser. Two things decide it: the API must
 * echo an allowed origin, and its preflight must admit the headers this
 * client sends — `authorization` on every authenticated call, plus
 * `idempotency-key` and `if-match` on order and cash-session writes.
 */
async function checkCors() {
  console.log("");
  console.log("Browser access (CORS)");

  const origin = "http://127.0.0.1:3000";

  try {
    const response = await fetch(`${base}/health`, {
      headers: { origin, accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const allowOrigin = response.headers.get("access-control-allow-origin");
    const resourcePolicy = response.headers.get("cross-origin-resource-policy");

    if (!allowOrigin) {
      failures += 1;
      console.error("  FAIL No Access-Control-Allow-Origin — a browser will block every call.");
      console.error("       Fix in the backend:  app.enableCors({ origin: true, credentials: false });");
      console.error("       Or route around it:  API_PROXY_TARGET + NEXT_PUBLIC_API_URL=/api/ros");
    } else if (allowOrigin !== "*" && allowOrigin !== origin) {
      console.log(`  WARN Access-Control-Allow-Origin is ${allowOrigin}; confirm it covers the console's origin.`);
    } else {
      console.log(`  OK   Access-Control-Allow-Origin: ${allowOrigin}`);
    }

    /**
     * CORP is a note here, not a failure.
     *
     * This check used to fail the run on `Cross-Origin-Resource-Policy:
     * same-origin`, which was wrong. Per the Fetch standard, the CORP check
     * only runs when a response's tainting is "opaque" — that is, for
     * `no-cors` subresource loads (images, scripts, fonts). Every request
     * this app makes is a `cors`-mode fetch that gets a valid
     * `Access-Control-Allow-Origin` back, so its tainting is "cors" and CORP
     * is never consulted. Helmet's default therefore does not block the
     * console, and reporting it as a blocker sent people to fix a
     * non-problem while the real cause went unlooked-at.
     *
     * It is still worth relaxing for anything that loads assets from the API
     * cross-origin, which is why it is printed at all.
     */
    if (resourcePolicy && resourcePolicy !== "cross-origin") {
      console.log(`  NOTE Cross-Origin-Resource-Policy: ${resourcePolicy}`);
      console.log("       Does not block this app: CORP is only enforced on no-cors (opaque)");
      console.log("       responses, and every call here is a CORS-mode fetch with a valid ACAO.");
      console.log("       Relax it only if something loads assets from the API cross-origin:");
      console.log("         helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })");
    }

    // What actually would block the browser: the headers this client sends.
    const preflight = await fetch(`${base}/auth/login`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,idempotency-key,if-match",
      },
    });
    const allowedHeaders = (
      preflight.headers.get("access-control-allow-headers") ?? ""
    ).toLowerCase();

    const missing = ["authorization", "content-type", "idempotency-key", "if-match"].filter(
      (header) => !allowedHeaders.includes(header),
    );

    if (missing.length > 0) {
      failures += 1;
      console.error(`  FAIL Preflight rejects: ${missing.join(", ")}`);
      console.error("       Every authenticated call sends `authorization`; orders and cash");
      console.error("       sessions also send `idempotency-key`, and order writes `if-match`.");
    } else {
      console.log("  OK   Preflight allows authorization, idempotency-key and if-match");
    }
  } catch (error) {
    failures += 1;
    console.error(`  FAIL CORS probe — ${error.message}`);
  }
}

/**
 * The deployed document against the snapshot this repository generates from.
 *
 * NestJS serves the Swagger JSON at `/docs-json`; a deployment that does not
 * is not a failure here, only an unchecked one.
 */
async function checkSpecDrift() {
  console.log("");
  console.log("Spec drift (api/openapi.json vs the deployed document)");

  let live;
  try {
    const response = await fetch(`${base}/docs-json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.log(`  SKIP GET /docs-json — ${response.status}. Nothing to compare against.`);
      return;
    }
    live = await response.json();
  } catch (error) {
    console.log(`  SKIP GET /docs-json — ${error.message}`);
    return;
  }

  const local = JSON.parse(readFileSync(resolve(root, "api/openapi.json"), "utf8"));
  const METHODS = ["get", "post", "put", "patch", "delete"];

  const operations = (spec) => {
    const set = new Set();
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const method of Object.keys(item)) {
        if (METHODS.includes(method)) set.add(`${method.toUpperCase()} ${path}`);
      }
    }
    return set;
  };

  const deployed = operations(live);
  const snapshot = operations(local);

  // The direction that breaks the app: the console calls something that is
  // no longer there. The other direction is only unrealised capability.
  const gone = [...snapshot].filter((op) => !deployed.has(op)).sort();
  const added = [...deployed].filter((op) => !snapshot.has(op)).sort();

  if (gone.length > 0) {
    failures += 1;
    console.error(`  FAIL ${gone.length} operation(s) the console calls are not deployed:`);
    for (const op of gone.slice(0, 12)) console.error(`       ${op}`);
    if (gone.length > 12) console.error(`       … and ${gone.length - 12} more`);
    console.error("       Re-export the spec into api/openapi.json and run `npm run api:types`.");
  } else {
    console.log(`  OK   All ${snapshot.size} operations in the snapshot are deployed`);
  }

  if (added.length > 0) {
    console.log(`  NOTE ${added.length} deployed operation(s) the console does not know about:`);
    for (const op of added.slice(0, 12)) console.log(`       ${op}`);
    if (added.length > 12) console.log(`       … and ${added.length - 12} more`);
    console.log("       Refresh api/openapi.json and run `npm run api:types` to wire them.");
  }

  if (live.info?.version && local.info?.version && live.info.version !== local.info.version) {
    console.log(`  NOTE Version ${local.info.version} locally, ${live.info.version} deployed.`);
  }
}

async function checkAuthenticated(email, password) {
  console.log("");
  console.log("Authentication");

  const session = await call("POST /auth/login", "/auth/login", {
    method: "POST",
    body: { email, password },
  });

  if (!session?.accessToken) {
    console.error("  Sign-in failed; the scoped checks cannot run.");
    return;
  }

  let token = session.accessToken;

  await call("GET /auth/me", "/auth/me", { token });
  const memberships = await call("GET /auth/tenants", "/auth/tenants", { token });

  const tenantId = memberships?.[0]?.tenant?.id;
  if (!tenantId) {
    failures += 1;
    console.error("  This account has no tenant membership; scoped endpoints will all 403.");
    return;
  }

  // Without this rotation the token carries no tenant claim and every read
  // below answers 403 — the most common "connected but blank" cause.
  const scoped = await call("POST /auth/tenant", "/auth/tenant", {
    method: "POST",
    token,
    body: { tenantId },
  });

  if (scoped?.accessToken) token = scoped.accessToken;

  console.log("");
  console.log(`Tenant-scoped reads (tenant ${tenantId})`);

  const reads = [
    ["GET /auth/permissions", "/auth/permissions"],
    ["GET /org/brands", "/org/brands"],
    ["GET /org/branches", "/org/branches"],
    ["GET /catalogue/items", "/catalogue/items"],
    ["GET /catalogue/menus", "/catalogue/menus"],
    ["GET /inventory/items", "/inventory/items"],
    ["GET /inventory/levels", "/inventory/levels"],
    ["GET /orders", "/orders?limit=5"],
    ["GET /recipes", "/recipes"],
    ["GET /auth/roles", "/auth/roles"],
    ["GET /auth/terminals", "/auth/terminals"],
  ];

  for (const [label, path] of reads) {
    await call(label, path, { token });
  }

  await checkTillSignOn(token, tenantId);
}

/**
 * The till sign-on, which is the one flow no console login can stand in for.
 *
 * Opening a cash session needs a token that names the *employee* taking
 * custody of the drawer, and only `POST /auth/pin` mints one. Its 401 is
 * deliberately uniform — "Invalid PIN, unknown employee code, or unknown
 * terminal/tenant" — so it never says which of the four was wrong. This
 * checks the three that are knowable before blaming the PIN.
 */
async function checkTillSignOn(token, tenantId) {
  const employeeCode = arg("employee-code");
  const pin = arg("pin");

  console.log("");
  console.log("Till sign-on (POST /auth/pin)");

  if (!employeeCode || !pin) {
    console.log("  SKIP  pass --employee-code and --pin to test the POS sign-on.");
    return;
  }

  const terminals = await call("GET /auth/terminals", "/auth/terminals", { token });

  if (!Array.isArray(terminals) || terminals.length === 0) {
    console.error("  FAIL  no terminals are registered — /auth/pin cannot succeed without one.");
    console.error("        Register one first: the console's /register-device screen, or");
    console.error("        POST /auth/terminals.");
    failures += 1;
    return;
  }

  const terminalId = arg("terminal-id") ?? terminals.find((row) => row.status === "active")?.id;

  if (!terminalId) {
    console.error("  FAIL  every registered terminal is disabled or revoked.");
    failures += 1;
    return;
  }

  console.log(`  Using terminal ${terminalId} and tenant ${tenantId}.`);

  const session = await call("POST /auth/pin", "/auth/pin", {
    method: "POST",
    body: { tenantId, terminalId, employeeCode, pin },
  });

  if (!session) {
    console.error("");
    console.error("  The tenant and terminal above came back from the server, so both exist.");
    console.error("  That leaves the employee code or the PIN — and this API has no endpoint");
    console.error("  that creates an employee or sets a PIN (employeeCode appears in exactly");
    console.error("  two request bodies and in no response anywhere). If no employee was");
    console.error("  seeded with a PIN directly in the database, no client can sign on to a");
    console.error("  till, and the cash drawer is unreachable by design rather than by bug.");
    return;
  }

  console.log("  This token identifies an employee; the drawer can be opened with it.");
}

console.log(`Backend: ${base}`);
console.log("");
console.log("Unauthenticated");
await call("GET /health", "/health");

if (!configured.startsWith("/")) await checkCors();

await checkSpecDrift();

const email = arg("email");
const password = arg("password");

if (email && password) {
  await checkAuthenticated(email, password);
} else {
  console.log("");
  console.log("Pass --email and --password to check the authenticated surface too.");
}

console.log("");
console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);

// Setting the code rather than calling `process.exit()` lets Node close
// fetch's keep-alive sockets first; exiting on top of them trips a libuv
// assertion on Windows.
process.exitCode = failures > 0 ? 1 : 0;
