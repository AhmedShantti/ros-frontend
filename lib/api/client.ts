/**
 * The HTTP transport.
 *
 * One function does the work — `request()` — and everything above it is a
 * typed wrapper. What it handles that a bare `fetch` does not:
 *
 *  - The bearer token, and rotating it when it expires. A refresh yields a
 *    *base* token, so the tenant selection is replayed afterwards —
 *    otherwise every scoped endpoint would start returning 403 ten minutes
 *    into a shift.
 *  - Nest's error envelope, turned into the `ServiceError` the UI renders.
 *    A `ValidationPipe` failure arrives as an array of messages; they are
 *    joined rather than dropped, because "name must be shorter than 120
 *    characters" is the only useful thing on that screen.
 *  - `idempotency-key` on every endpoint that requires it — orders, their
 *    lines, cash sessions and every drawer movement — minted once per
 *    logical call so the internal 401-and-refresh replay carries the *same*
 *    key. A retry over a flaky link cannot ring up the same order twice, and
 *    cannot pay out of the drawer twice.
 *  - A timeout, because a wrong LAN address does not fail — it hangs.
 */

import { API_BASE_URL, API_IS_PROXIED, DATA_MODE, REQUEST_TIMEOUT_MS, apiUrl } from "./config";
import { ServiceError } from "../console/services/types";
import {
  announceSessionChange,
  clearSession,
  getAccessToken,
  getRefreshToken,
  getTenantId,
  isAccessTokenStale,
  isSessionOverHardLimit,
  msUntilAccessTokenStale,
  onSessionChange,
  setTokens,
} from "./session";

export interface RequestOptions {
  /** Values substituted into `{placeholders}` in the path. */
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Sends `idempotency-key`; POST /orders, its lines, and /cash-sessions require it. */
  idempotent?: boolean;
  /** Sends `if-match` for the optimistic-concurrency endpoints on an order. */
  ifMatch?: string | number;
  /** Skips the bearer header and the refresh dance — used by /auth/login itself. */
  anonymous?: boolean;
  /**
   * An explicit token, instead of whichever one the active surface holds.
   *
   * Used to act on a session that is NOT the current one — revoking the
   * terminal's leftover PIN session from the console sign-in, say. Pair it
   * with `anonymous: true`: the point is to send exactly this credential and
   * nothing else, with no refresh dance that would rotate the wrong slot.
   */
  bearer?: string | null;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface ErrorEnvelope {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

/** `Unauthorized` becomes `UNAUTHORIZED`; `OrderVersionConflictError` becomes `ORDER_VERSION_CONFLICT`. */
function codeFrom(envelope: ErrorEnvelope, status: number): string {
  const label = envelope.error?.trim();
  if (label) {
    return label
      .replace(/(Error|Exception)$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/\s+/g, "_")
      .toUpperCase();
  }
  const byStatus: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    412: "PRECONDITION_FAILED",
    422: "UNPROCESSABLE",
    429: "RATE_LIMITED",
    503: "UPSTREAM_UNAVAILABLE",
  };
  return byStatus[status] ?? `HTTP_${status}`;
}

function messageFrom(envelope: ErrorEnvelope, status: number): string {
  const raw = envelope.message;
  if (Array.isArray(raw) && raw.length > 0) return raw.join(" · ");
  if (typeof raw === "string" && raw.trim()) return raw;
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 403) return "You do not have permission to do that.";
  return "The request could not be completed.";
}

/**
 * A connection that never reached the API at all.
 *
 * A CORS rejection is indistinguishable from a dead host here — the browser
 * hands JavaScript the same opaque "Failed to fetch" either way — so the
 * detail names both causes rather than guessing between them.
 */
function unreachable(detail: string): ServiceError {
  const advice = API_IS_PROXIED
    ? `Requests go through this server to API_PROXY_TARGET; check that it is set and reachable.`
    : `Check that the API listens on 0.0.0.0 rather than 127.0.0.1, that this device is on ` +
      `the same subnet, and that the API sends Access-Control-Allow-Origin for this origin. ` +
      `If it does not, set API_PROXY_TARGET and NEXT_PUBLIC_API_URL=/api/ros to route ` +
      `through this server instead.`;

  return new ServiceError(
    "NETWORK_UNREACHABLE",
    "The backend did not answer.",
    0,
    `${detail} Target: ${API_BASE_URL || "(unset)"}. ${advice}`,
  );
}

// ---------------------------------------------------------------------------
// Token rotation
// ---------------------------------------------------------------------------

/**
 * `"refreshed"` — a new token is in place. `"expired"` — the session is
 * genuinely over (no refresh token, it was rejected, or the hard lifetime
 * cap was reached); callers must send the operator back to the PIN/sign-in
 * screen. `"unreachable"` — the refresh attempt itself never got a real
 * answer (offline, timeout, a 5xx); the OLD token/session is left exactly as
 * it was, because a Wi-Fi hiccup is not "this shift is over" and must not
 * force a PIN re-entry — see POS-KDS-SESSION-LIFETIME-POLICY-P0.
 */
type RefreshOutcome = "refreshed" | "expired" | "unreachable";

let refreshInFlight: Promise<RefreshOutcome> | null = null;

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/** A clean rejection of the refresh token itself, not a transport failure. */
function isAuthRejection(error: unknown): boolean {
  return error instanceof ServiceError && (error.status === 401 || error.status === 403);
}

/**
 * Rotates the refresh token, then replays whatever scope the old access token
 * carried.
 */
async function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshOutcome> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return "expired";

      // POS-KDS-SESSION-LIFETIME-POLICY-P0 — a shift ends even if the
      // refresh token would still be honoured. Checked here, ahead of the
      // network call, so it applies to every path that refreshes: the
      // request-time retry below AND the proactive timer.
      if (isSessionOverHardLimit()) {
        clearSession();
        return "expired";
      }

      let rotated: TokenResponse;
      try {
        rotated = await send<TokenResponse>("POST", "/auth/refresh", {
          body: { refreshToken },
          anonymous: true,
        });
      } catch (caught) {
        if (isAuthRejection(caught)) {
          clearSession();
          return "expired";
        }
        // Transient — offline till, a dropped LAN, a backend restart. The
        // stored token/session is untouched; the caller retries (the
        // proactive timer backs off and tries again; a request-time caller
        // surfaces a retryable network error instead of forcing sign-on).
        return "unreachable";
      }
      // Silent: this is the BASE, tenant-less token — announcing it would
      // let a listener (`useLiveOrgContext`) re-fetch the org context
      // using it before the tenant/terminal replay below has restored
      // scope, which reliably fails and looked exactly like a real
      // session's data vanishing.
      setTokens(rotated, { silent: true });

      // The rotated token is tenant-less; put the scope back onto it.
      const tenantId = getTenantId();
      if (tenantId) {
        try {
          const scoped = await send<TokenResponse>("POST", "/auth/tenant", {
            body: { tenantId },
            anonymous: true,
            bearer: getAccessToken(),
          });
          setTokens(scoped, { silent: true });
        } catch {
          // The membership may have been revoked while we were away. The next
          // scoped call 403s and the UI sends the user back to tenant pick.
        }
      }

      // FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — there used to be a third
      // replay step here, re-binding a Terminal (`POST /auth/terminal`) after
      // the tenant re-select. POS/KDS tokens no longer carry a terminal claim
      // to restore: `sessionType`/`branchId` are minted once at PIN sign-on
      // and a token refresh does not change either, so there is nothing left
      // to replay. Do not reintroduce a call to `/auth/terminal` here.

      // One announce, now that the replay (base, then tenant) has settled —
      // whatever a listener re-fetches with is the final, fully-scoped
      // token, never an intermediate one. This is also what re-arms the
      // proactive refresh timer (`scheduleProactiveRefresh` below is itself
      // an `onSessionChange` listener) for the token's new expiry.
      announceSessionChange();
      return "refreshed";
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Proactive refresh
// ---------------------------------------------------------------------------

/** Backoff between retries after a refresh attempt that never reached the backend. */
const REFRESH_RETRY_BACKOFF_MS = 30_000;

let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearProactiveRefreshTimer(): void {
  if (proactiveRefreshTimer !== null) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

async function proactiveRefreshTick(): Promise<void> {
  const outcome = await refreshSession();
  if (outcome === "unreachable") {
    proactiveRefreshTimer = setTimeout(() => void proactiveRefreshTick(), REFRESH_RETRY_BACKOFF_MS);
  }
  // "refreshed" re-arms itself: `refreshSession()`'s `announceSessionChange()`
  // fires this module's own `onSessionChange` listener below, for the new
  // expiry. "expired" also re-arms (as a no-op — `getAccessToken()` is gone)
  // via `clearSession()`'s own `announce()`.
}

/**
 * Keeps a signed-on POS/KDS/console screen's token alive on a timer, rather
 * than only when the next outbound request happens to notice it went stale.
 * Without this, a KDS rail sitting idle between tickets — or any screen with
 * nobody touching it — never sends a request during the ~14 minutes before
 * expiry, so nothing refreshes; the FIRST thing to touch the network after
 * that is whatever the operator does next, and if THAT refresh attempt hits
 * even a transient hiccup the previous reactive-only design had no fallback
 * — see POS-KDS-SESSION-LIFETIME-POLICY-P0. Re-armed on every session change
 * (sign-in, PIN sign-on, a completed refresh, sign-out) via `onSessionChange`
 * below, and once explicitly on mount by `SessionProvider` for the one case
 * that fires no such change: a tab reloading while already signed in.
 */
export function scheduleProactiveRefresh(): void {
  clearProactiveRefreshTimer();
  if (typeof window === "undefined") return;
  if (!getAccessToken() || !getRefreshToken()) return;

  const delay = Math.max(0, msUntilAccessTokenStale());
  proactiveRefreshTimer = setTimeout(() => void proactiveRefreshTick(), delay);
}

if (typeof window !== "undefined") {
  onSessionChange(scheduleProactiveRefresh);
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

interface SendOptions extends RequestOptions {
  /**
   * The `idempotency-key` for this attempt, minted once per logical call.
   *
   * It has to be minted by `request()` rather than here, because `send()`
   * runs twice when a 401 sends us through a token refresh — and a replay
   * carrying a *different* key is, to the server, a different request. That
   * is precisely the double-charge the header exists to prevent: a pay-out
   * or a drawer opening applied once by the server, 401'd on the way back,
   * and applied a second time by the retry.
   */
  idempotencyKey?: string;
}

function buildPath(path: string, options: SendOptions): string {
  let out = path;

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      out = out.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }

  const remaining = /\{(\w+)\}/.exec(out);
  if (remaining) {
    throw new ServiceError(
      "BAD_REQUEST",
      "That link is incomplete.",
      400,
      `No value supplied for path parameter "${remaining[1]}" of ${path}.`,
    );
  }

  if (options.query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
    }
    const qs = search.toString();
    if (qs) out += `?${qs}`;
  }

  return out;
}

function newIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function send<T>(method: string, path: string, options: SendOptions = {}): Promise<T> {
  const url = apiUrl(buildPath(path, options));

  const headers: Record<string, string> = { accept: "application/json" };

  const token = options.anonymous ? options.bearer : (options.bearer ?? getAccessToken());
  if (token) headers.authorization = `Bearer ${token}`;

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotent) {
    headers["idempotency-key"] = options.idempotencyKey ?? newIdempotencyKey();
  }
  if (options.ifMatch !== undefined) headers["if-match"] = String(options.ifMatch);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  options.signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: timeout.signal,
      // The API authenticates by bearer token, not cookie; omitting
      // credentials keeps the CORS preflight simple.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (caught) {
    if (options.signal?.aborted) throw caught;
    if (timeout.signal.aborted) {
      throw unreachable(`No response within ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw unreachable(caught instanceof Error ? caught.message : "Connection failed.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new ServiceError(
          "BAD_RESPONSE",
          "The backend sent something this app could not read.",
          response.status,
          `Expected JSON from ${method} ${path}, got: ${text.slice(0, 200)}`,
        );
      }
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    throw new ServiceError(
      codeFrom(envelope, response.status),
      messageFrom(envelope, response.status),
      response.status,
      `${method} ${path}`,
    );
  }

  return payload as T;
}

/**
 * The call every endpoint wrapper makes. Refreshes ahead of a known-stale
 * token, and once more if the server disagrees about that.
 */
export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (DATA_MODE === "mock") {
    throw new ServiceError(
      "NO_BACKEND",
      "No API is configured.",
      0,
      "Set NEXT_PUBLIC_API_URL in .env.local and restart `next dev`.",
    );
  }

  if (!options.anonymous && isAccessTokenStale() && getRefreshToken()) {
    await refreshSession();
  }

  // One key for both attempts below. See `SendOptions.idempotencyKey`.
  const attempt: SendOptions = options.idempotent
    ? { ...options, idempotencyKey: newIdempotencyKey() }
    : options;

  try {
    return await send<T>(method, path, attempt);
  } catch (caught) {
    const is401 = caught instanceof ServiceError && caught.status === 401;
    if (!is401 || options.anonymous) throw caught;

    const outcome = await refreshSession();
    if (outcome === "refreshed") {
      return send<T>(method, path, attempt);
    }
    if (outcome === "unreachable") {
      // The session may well still be good — the refresh attempt just never
      // reached the backend. Surface a retryable network error rather than
      // forcing the operator back to the PIN screen over a dropped LAN.
      throw unreachable("Could not reach the backend to renew the session.");
    }
    throw new ServiceError(
      "SESSION_EXPIRED",
      "Your session has ended. Sign in again.",
      401,
      `${method} ${path}`,
    );
  }
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>("POST", path, options),
  put: <T>(path: string, options?: RequestOptions) => request<T>("PUT", path, options),
  patch: <T>(path: string, options?: RequestOptions) => request<T>("PATCH", path, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, options),
};

export { ServiceError };
