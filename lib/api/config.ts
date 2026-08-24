/**
 * Where the backend is, and whether to talk to it at all.
 *
 * `NEXT_PUBLIC_API_URL` is read at build time by Next, so it must be present
 * in `.env.local` before `next dev` starts — changing it mid-session needs a
 * restart. On a LAN it is the machine's address, not localhost, because the
 * browser resolving it may be an iPad across the room:
 *
 *   NEXT_PUBLIC_API_URL=http://192.168.1.43:3000
 *
 * The document's single server entry is `/` — no `/v1` prefix is registered
 * by the application. If a proxy in front of the API adds one, put it on the
 * end of the URL above and everything below follows.
 */

export type DataMode = "mock" | "http";

/**
 * Trailing slash trimmed so `${BASE}${path}` is always well formed.
 *
 * A relative value such as `/api/ros` is valid and means "go through this
 * server", which `next.config.ts` rewrites to the backend. That is the way
 * round a backend that sends no CORS headers.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** True when calls are relative and therefore same-origin. */
export const API_IS_PROXIED = API_BASE_URL.startsWith("/");

/**
 * `auto` (the default) uses HTTP when a URL is configured and mocks when it
 * is not, so the marketing site and a fresh clone still run with no backend.
 * Force one or the other with `NEXT_PUBLIC_API_MODE=mock|http`.
 */
export const DATA_MODE: DataMode = (() => {
  const requested = process.env.NEXT_PUBLIC_API_MODE;
  if (requested === "mock") return "mock";
  if (requested === "http") return "http";
  return API_BASE_URL ? "http" : "mock";
})();

/** Milliseconds before a request is abandoned. A LAN hop should be quick. */
export const REQUEST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 15000);

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Shown in Settings → diagnostics so a misconfigured LAN address is visible. */
export function describeTarget(): string {
  if (DATA_MODE === "mock") return "In-memory demo data";
  if (!API_BASE_URL) return "(NEXT_PUBLIC_API_URL is empty)";
  if (API_IS_PROXIED) return `${API_BASE_URL} (proxied by this server)`;
  return API_BASE_URL;
}
