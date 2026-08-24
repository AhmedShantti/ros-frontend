/**
 * The tokens, and the tenant/terminal the tokens are currently bound to.
 *
 * `POST /auth/login` returns a short-lived access token and a refresh token.
 * The tenant is *not* chosen at login: `POST /auth/tenant` rotates the access
 * token so it carries a tenant claim, and every `/org`, `/catalogue`,
 * `/inventory`, `/orders` call 403s until that has happened. The same is true
 * of `POST /auth/terminal` for the endpoints that need a bound device.
 *
 * Storage is `localStorage`, deliberately: a POS terminal that reloads mid
 * service must come back signed in. It is also, equally deliberately, only
 * the token — no permission set is cached here, because the server is the
 * authority on every request (FR-SEC-045).
 */

const KEY_ACCESS = "ros.api.accessToken";
const KEY_REFRESH = "ros.api.refreshToken";
const KEY_EXPIRES = "ros.api.expiresAt";
const KEY_TENANT = "ros.api.tenantId";
const KEY_TERMINAL = "ros.api.terminalId";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the session simply does not survive the reload.
  }
}

function announce(): void {
  for (const listener of listeners) listener();
}

/** Re-render the shell when the session appears or disappears. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function getTokens(): TokenSet | null {
  const accessToken = read(KEY_ACCESS);
  const refreshToken = read(KEY_REFRESH);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: Number(read(KEY_EXPIRES) ?? 0) };
}

export function setTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): void {
  write(KEY_ACCESS, tokens.accessToken);
  if (tokens.refreshToken) write(KEY_REFRESH, tokens.refreshToken);
  // A minute of headroom, so a token does not expire in flight.
  const lifetime = (tokens.expiresIn ?? 900) * 1000;
  write(KEY_EXPIRES, String(Date.now() + lifetime - 60_000));
  announce();
}

export function clearSession(): void {
  write(KEY_ACCESS, null);
  write(KEY_REFRESH, null);
  write(KEY_EXPIRES, null);
  write(KEY_TENANT, null);
  write(KEY_TERMINAL, null);
  announce();
}

export function getAccessToken(): string | null {
  return read(KEY_ACCESS);
}

export function getRefreshToken(): string | null {
  return read(KEY_REFRESH);
}

/** True once the stored lifetime has run out — refresh before sending. */
export function isAccessTokenStale(): boolean {
  const expiresAt = Number(read(KEY_EXPIRES) ?? 0);
  return expiresAt > 0 && Date.now() >= expiresAt;
}

export function isSignedIn(): boolean {
  return Boolean(read(KEY_ACCESS));
}

// ---------------------------------------------------------------------------
// Bound scope
// ---------------------------------------------------------------------------

export function getTenantId(): string | null {
  return read(KEY_TENANT);
}

export function setTenantId(tenantId: string | null): void {
  write(KEY_TENANT, tenantId);
  announce();
}

export function getTerminalId(): string | null {
  return read(KEY_TERMINAL);
}

export function setTerminalId(terminalId: string | null): void {
  write(KEY_TERMINAL, terminalId);
  announce();
}
