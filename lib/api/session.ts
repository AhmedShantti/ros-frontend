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
const KEY_CASH_SESSION = "ros.api.cashSessionId";
const KEY_CASH_OPENING = "ros.api.cashSessionOpening";
const KEY_POS_EMPLOYEE = "ros.api.posEmployee";
const KEY_KDS_STATION = "ros.api.kdsStationId";

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
  // A cash session belongs to the employee who opened it, not to the till.
  // Leaving the id behind would hand the next cashier to sign in someone
  // else's drawer to count and close.
  write(KEY_CASH_SESSION, null);
  write(KEY_CASH_OPENING, null);
  write(KEY_POS_EMPLOYEE, null);
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

/**
 * The station this kitchen display is showing.
 *
 * The backend binds a KDS terminal to exactly one station and 403s a read
 * aimed at any other, so the station is a property of the device rather than
 * a per-visit choice. Kept here for the same reason the drawer is: a screen
 * on a wall in a kitchen gets reloaded, and it must come back to the station
 * it was showing rather than to a picker nobody is standing at.
 */
export function getKdsStationId(): string | null {
  return read(KEY_KDS_STATION);
}

export function setKdsStationId(stationId: string | null): void {
  write(KEY_KDS_STATION, stationId);
  announce();
}

// ---------------------------------------------------------------------------
// The open drawer
// ---------------------------------------------------------------------------

/**
 * The cash session this till currently has open.
 *
 * Stored for the same reason the token is: a POS that reloads mid service
 * must come back to the drawer it left open. Holding this in React state
 * alone stranded it — after a refresh the screen offered to open a drawer
 * that was already open, and because the backend serves no cash-session
 * index (there is no `GET /cash-sessions`), the id was simply unrecoverable
 * and the shift could never be counted or closed.
 */
export function getCashSessionId(): string | null {
  return read(KEY_CASH_SESSION);
}

export function setCashSessionId(cashSessionId: string | null): void {
  write(KEY_CASH_SESSION, cashSessionId);
  announce();
}

/**
 * The ids minted for an open that has not been confirmed yet.
 *
 * `POST /cash-sessions` carries two device ULIDs which are, in the spec's
 * words, "independent duplicate protection" beneath the idempotency key.
 * That protection only works if a second attempt sends the *same* pair —
 * minting fresh ones on every press turns a retry into a genuinely new
 * request, which is how one flaky connection becomes two open drawers.
 *
 * So the pair is written here before the call goes out and cleared only
 * once the server has answered.
 */
export interface PendingCashOpen {
  cashSessionId: string;
  shiftId: string;
  drawerId: string;
  openingFloat: string;
}

export function getPendingCashOpen(): PendingCashOpen | null {
  const raw = read(KEY_CASH_OPENING);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCashOpen>;
    if (!parsed.cashSessionId || !parsed.shiftId || !parsed.drawerId) return null;
    return {
      cashSessionId: parsed.cashSessionId,
      shiftId: parsed.shiftId,
      drawerId: parsed.drawerId,
      openingFloat: parsed.openingFloat ?? "0",
    };
  } catch {
    // A shape from an older build. Forget it rather than replay a guess.
    return null;
  }
}

export function setPendingCashOpen(pending: PendingCashOpen | null): void {
  write(KEY_CASH_OPENING, pending === null ? null : JSON.stringify(pending));
}

// ---------------------------------------------------------------------------
// The cashier on the till
// ---------------------------------------------------------------------------

/**
 * Who signed on at this terminal with a PIN.
 *
 * A drawer is taken into someone's custody, so the token has to say whose:
 * open a cash session on a console user's token and the server answers
 * "Opening a cash session requires a session that identifies the employee
 * taking custody of the drawer." Only `POST /auth/pin` mints a token that
 * carries an employee, which is why the till has a sign-on of its own on top
 * of signing in.
 *
 * This is a *display* record, not an authorisation one — the token is what
 * the server checks, and it will refuse regardless of what is stored here.
 * It exists so the till can show who is on it and know to ask when nobody
 * is, without decoding a JWT it does not own.
 */
export interface PosEmployee {
  code: string;
  name: string;
}

export function getPosEmployee(): PosEmployee | null {
  const raw = read(KEY_POS_EMPLOYEE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PosEmployee>;
    return parsed.code ? { code: parsed.code, name: parsed.name ?? parsed.code } : null;
  } catch {
    return null;
  }
}

export function setPosEmployee(employee: PosEmployee | null): void {
  write(KEY_POS_EMPLOYEE, employee === null ? null : JSON.stringify(employee));
  announce();
}
