/**
 * The HTTP transport.
 *
 * One function does the work — `request()` — and everything above it is a
 * typed wrapper. What it handles that a bare `fetch` does not:
 *
 *  - The bearer token, and rotating it when it expires. A refresh yields a
 *    *base* token, so the tenant selection (and terminal binding) is replayed
 *    afterwards — otherwise every scoped endpoint would start returning 403
 *    ten minutes into a shift.
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
  clearSession,
  getAccessToken,
  getRefreshToken,
  getTenantId,
  getTerminalId,
  isAccessTokenStale,
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

let refreshInFlight: Promise<boolean> | null = null;

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/**
 * Rotates the refresh token, then replays whatever scope the old access token
 * carried. Returns false when the session is genuinely over.
 */
async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;

      try {
        const rotated = await send<TokenResponse>("POST", "/auth/refresh", {
          body: { refreshToken },
          anonymous: true,
        });
        setTokens(rotated);
      } catch {
        clearSession();
        return false;
      }

      // The rotated token is tenant-less; put the scope back onto it.
      const tenantId = getTenantId();
      if (tenantId) {
        try {
          const scoped = await send<TokenResponse>("POST", "/auth/tenant", {
            body: { tenantId },
            anonymous: true,
            bearer: getAccessToken(),
          });
          setTokens(scoped);
        } catch {
          // The membership may have been revoked while we were away. The next
          // scoped call 403s and the UI sends the user back to tenant pick.
        }
      }

      const terminalId = getTerminalId();
      if (terminalId) {
        try {
          const bound = await send<TokenResponse>("POST", "/auth/terminal", {
            body: { terminalId },
            anonymous: true,
            bearer: getAccessToken(),
          });
          setTokens(bound);
        } catch {
          // Terminal revoked or reassigned; POS screens prompt to re-bind.
        }
      }

      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

interface SendOptions extends RequestOptions {
  /** Explicit token, for the calls made during a refresh. */
  bearer?: string | null;
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

    const recovered = await refreshSession();
    if (!recovered) {
      throw new ServiceError(
        "SESSION_EXPIRED",
        "Your session has ended. Sign in again.",
        401,
        `${method} ${path}`,
      );
    }
    return send<T>(method, path, attempt);
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
