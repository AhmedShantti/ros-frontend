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
 *
 * DEMO-SESSION-ISOLATION-HOTFIX — the identity fields (access/refresh token,
 * its expiry, the selected tenant) are kept in TWO INDEPENDENT storage slots,
 * one per "surface": `console` (password login, `(console)`/`(auth)` route
 * groups — the dashboard) and `terminal` (PIN login, `(terminal)` route
 * group — POS/KDS). Before this, `signInWithPin` overwrote the SAME
 * `ros.api.*` keys a signed-in Owner's dashboard session was reading, so a
 * cashier PIN login on the same browser silently replaced the Owner's own
 * token — every `/dashboard` call afterwards 403'd, authenticated as the
 * Cashier instead. `setActiveSurface`, called once by each route group's own
 * root layout (module scope, before any child can fire a request), picks
 * which slot every one of the functions below reads and writes — every
 * existing call site (`lib/api/auth.ts`, `lib/api/client.ts`,
 * `lib/console/services/http.ts`'s ~50 `getTenantId()` reads,
 * `components/terminal/pos-live.tsx`) keeps calling the SAME function names
 * unchanged, and is automatically correct for whichever surface it runs on.
 *
 * `terminalId`/`kdsStationId` stay a SINGLE shared value on purpose: they
 * name the PHYSICAL DEVICE ("which terminal/station is this till"), not an
 * authenticated identity — `/register-device` (a console-authenticated
 * screen) sets it once, and the SAME value must be visible to `/pos`/`/kds`
 * afterwards for a PIN sign-on to even know which terminal it is signing
 * into. `cashSessionId`/`cashSessionOpening`/`posEmployee` stay shared too —
 * they are already exclusively read and written by terminal code (never by
 * console code), so no cross-surface collision was ever possible for them.
 */

type AuthSurface = "console" | "terminal";

/**
 * Defaults to `console`: the safer failure mode for any code that runs
 * before a layout has claimed a surface (e.g. a module evaluated during a
 * test, or a race during the very first paint) is to see NO token rather
 * than accidentally read a terminal one.
 */
let activeSurface: AuthSurface = "console";

/** Called once, at module scope, by each route group's own root layout. */
export function setActiveSurface(surface: AuthSurface): void {
  activeSurface = surface;
}

export function getActiveSurface(): AuthSurface {
  return activeSurface;
}

const CONSOLE_KEYS = {
  access: "ros.api.accessToken",
  refresh: "ros.api.refreshToken",
  expires: "ros.api.expiresAt",
  tenant: "ros.api.tenantId",
};

const TERMINAL_KEYS = {
  access: "ros.terminal.accessToken",
  refresh: "ros.terminal.refreshToken",
  expires: "ros.terminal.expiresAt",
  tenant: "ros.terminal.tenantId",
};

function identityKeys() {
  return activeSurface === "console" ? CONSOLE_KEYS : TERMINAL_KEYS;
}

const KEY_TERMINAL = "ros.api.terminalId";
/**
 * PROD-POS-TERMINAL-LISTING-P0 — the display name of the device's own bound
 * terminal, exactly as `POST /auth/terminal` returned it at bind time.
 *
 * `GET /auth/terminal` (the read-only "am I bound" check) answers with the
 * id and nothing else; the only place a name has ever come from is
 * `GET /auth/terminals` — every terminal registered to the whole tenant,
 * a dashboard/admin listing a PIN-issued session is not entitled to call
 * (it 401s even freshly bound). `POST /auth/terminal`'s own response
 * already carries the full terminal record, name included, so `bindTerminal`
 * saves it here once instead of a screen re-deriving it from a listing call
 * its token can never legally make.
 */
const KEY_TERMINAL_NAME = "ros.api.terminalName";
/**
 * DEMO-SESSION-ISOLATION-HOTFIX — which tenant THIS DEVICE operates under,
 * as a DEVICE-level fact, independent of either surface's own active
 * identity. The Cashier PIN sign-on form has no tenant picker (FR-SEC-020 —
 * a till identifies staff by code and PIN, never by typing a tenant id) and
 * needs a tenantId to even attempt `POST /auth/pin`; before the surfaces
 * were separated it silently borrowed the shared `tenantId` slot, which
 * happened to already hold the right value only because the SAME browser
 * had, at some point, also been used for a console login as the manager who
 * registered this device. Kept here, set whenever EITHER surface
 * successfully resolves a tenant, and never cleared by a mere sign-out of
 * either one — the physical till does not change tenants just because
 * someone logged out of it.
 */
const KEY_DEVICE_TENANT = "ros.api.deviceTenantId";
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
  const keys = identityKeys();
  const accessToken = read(keys.access);
  const refreshToken = read(keys.refresh);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: Number(read(keys.expires) ?? 0) };
}

/**
 * PROD-AUTH-EXPIRY-P0 — `silent` skips the `announce()` at the end. A token
 * refresh is a MULTI-STEP replay (base token, then tenant re-select, then
 * terminal re-bind — see `client.ts`'s `refreshSession()`), each of which
 * calls this. Announcing after every intermediate step let
 * `useLiveOrgContext`'s own `onSessionChange` listener re-trigger its FULL
 * org bootstrap mid-replay, using whatever PARTIALLY-scoped token happened
 * to exist at that instant (e.g. the bare, tenant-less base token, before
 * the tenant re-select step had even started) — that premature fetch then
 * genuinely failed, and the failure path is what a real session's data
 * disappearing around the access-token expiry actually was. Only the LAST
 * write of a replay should announce; every caller outside a replay
 * (sign-in, PIN sign-on, tenant selection, terminal bind — all genuinely
 * one-shot) is unaffected, since they never pass `silent`.
 */
export function setTokens(
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  },
  options?: { silent?: boolean },
): void {
  const keys = identityKeys();
  write(keys.access, tokens.accessToken);
  if (tokens.refreshToken) write(keys.refresh, tokens.refreshToken);
  // A minute of headroom, so a token does not expire in flight.
  const lifetime = (tokens.expiresIn ?? 900) * 1000;
  write(keys.expires, String(Date.now() + lifetime - 60_000));
  if (!options?.silent) announce();
}

/** Exposed so a multi-step caller (a token refresh replay) can announce ONCE, after its last silent write, rather than after every intermediate one. */
export function announceSessionChange(): void {
  announce();
}

/**
 * Clears the CURRENT surface's own identity only — a console sign-out must
 * never touch a terminal's PIN session (or the device's own terminal/KDS
 * binding) and vice versa. Terminal-only display/custody state
 * (`cashSessionId`/`cashSessionOpening`/`posEmployee`) is cleared alongside
 * a terminal sign-out specifically: a cash session belongs to the employee
 * who opened it, not to the till, so leaving the id behind would hand the
 * next cashier someone else's drawer to count and close.
 */
export function clearSession(): void {
  const keys = identityKeys();
  write(keys.access, null);
  write(keys.refresh, null);
  write(keys.expires, null);
  write(keys.tenant, null);
  if (activeSurface === "terminal") {
    write(KEY_CASH_SESSION, null);
    write(KEY_CASH_OPENING, null);
    write(KEY_POS_EMPLOYEE, null);
  }
  announce();
}

export function getAccessToken(): string | null {
  return read(identityKeys().access);
}

export function getRefreshToken(): string | null {
  return read(identityKeys().refresh);
}

/** True once the stored lifetime has run out — refresh before sending. */
export function isAccessTokenStale(): boolean {
  const expiresAt = Number(read(identityKeys().expires) ?? 0);
  return expiresAt > 0 && Date.now() >= expiresAt;
}

export function isSignedIn(): boolean {
  return Boolean(read(identityKeys().access));
}

// ---------------------------------------------------------------------------
// Bound scope
// ---------------------------------------------------------------------------

export function getTenantId(): string | null {
  return read(identityKeys().tenant);
}

export function setTenantId(tenantId: string | null): void {
  write(identityKeys().tenant, tenantId);
  if (tenantId) write(KEY_DEVICE_TENANT, tenantId);
  announce();
}

/**
 * Which tenant this DEVICE is known to operate under — see `KEY_DEVICE_TENANT`.
 * This is what the Cashier PIN sign-on form reads (never `getTenantId()`,
 * which is this surface's own current session and starts empty on a
 * terminal that has never signed anyone on yet).
 */
export function getDeviceTenantId(): string | null {
  return read(KEY_DEVICE_TENANT);
}

export function getTerminalId(): string | null {
  return read(KEY_TERMINAL);
}

export function setTerminalId(terminalId: string | null): void {
  write(KEY_TERMINAL, terminalId);
  announce();
}

/** The bound terminal's display name — see `KEY_TERMINAL_NAME`. */
export function getTerminalName(): string | null {
  return read(KEY_TERMINAL_NAME);
}

export function setTerminalName(name: string | null): void {
  write(KEY_TERMINAL_NAME, name);
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
