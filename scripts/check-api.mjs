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
      signal: AbortSignal.timeout(10_000),
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
 * the console still fails in a browser. Two headers decide it: the API must
 * echo an allowed origin, and Helmet's default `same-origin` resource policy
 * must be relaxed, or the browser discards the response regardless.
 */
async function checkCors() {
  console.log("");
  console.log("Browser access (CORS)");

  const origin = "http://127.0.0.1:3000";

  try {
    const response = await fetch(`${base}/health`, {
      headers: { origin, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
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

    if (resourcePolicy && resourcePolicy !== "cross-origin") {
      failures += 1;
      console.error(`  FAIL Cross-Origin-Resource-Policy: ${resourcePolicy} — the browser discards the response.`);
      console.error("       Fix in the backend:  helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })");
    }
  } catch (error) {
    failures += 1;
    console.error(`  FAIL CORS probe — ${error.message}`);
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
}

console.log(`Backend: ${base}`);
console.log("");
console.log("Unauthenticated");
await call("GET /health", "/health");

if (!configured.startsWith("/")) await checkCors();

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
