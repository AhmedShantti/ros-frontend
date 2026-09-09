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
 * into.
 *
 * POS-CUSTODY — everything else on this device is scoped to WHO IS ON THE
 * TILL, and the split is the whole point of this module:
 *
 *   DEVICE-scoped, survives any sign-out: terminalId, kdsStationId,
 *   deviceTenantId, deviceFingerprint. A till does not stop being that till
 *   because someone went home.
 *
 *   USER-scoped, must never outlive the person who created it: both token
 *   slots, `posEmployee`, and any half-finished drawer open. Left behind,
 *   these are not stale display state — they are a working credential. A
 *   cashier arriving at a till still holding the previous employee's token
 *   was authenticated, authorised and billed as that employee, because the
 *   server reads the token and the token was never replaced.
 *
 *   CUSTODY-scoped, the one genuine middle case: the open cash session. It
 *   belongs to the employee who took the drawer (so it may not be inherited)
 *   but it also refers to real money in a real box (so it may not simply be
 *   deleted when they sign out). It is therefore stored WITH the employee
 *   code that opened it — `OpenCashSession` below — and the till adopts it
 *   only for that employee. Anyone else is shown whose drawer it is rather
 *   than silently handed it.
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
/**
 * DEMO-POS-P0-5 — which branch THIS DEVICE's bound terminal belongs to, a
 * DEVICE-level fact mirroring `KEY_DEVICE_TENANT` above. `POST /auth/terminal`
 * (`bindTerminal`) already receives the full terminal record — `branchId`
 * included — so it is saved here once, the same way the terminal's name
 * already is. Every terminal-scoped read that needs "this till's own branch"
 * (the menu, the tables, the branch chip) reads it from here instead of the
 * console's brand/branch scope switcher: that switcher's storage keys
 * (`ros.console.brand`/`.branch`) are shared with `(console)` and persist
 * across a manager's own console session, so a Cashier who signs on to a
 * till right after that manager registered it would otherwise inherit
 * whatever branch the manager's dashboard happened to be filtered to — never
 * cleared by a sign-out, for the same reason `KEY_DEVICE_TENANT` is not: the
 * physical till does not change branches just because someone signed out.
 */
const KEY_TERMINAL_BRANCH = "ros.api.terminalBranchId";
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

function clearIdentity(surface: AuthSurface): void {
  const keys = surface === "console" ? CONSOLE_KEYS : TERMINAL_KEYS;
  write(keys.access, null);
  write(keys.refresh, null);
  write(keys.expires, null);
  write(keys.tenant, null);
  if (surface === "terminal") {
    write(KEY_POS_EMPLOYEE, null);
    // A half-finished open is NOT cleared here. It carries the employee code
    // that started it (`PendingCashOpen`) and is replayed only for them, so
    // it defends itself the same way the open session does — and it has to
    // survive, because it is the only thing that stops a cashier who signed
    // off during a timed-out open from opening a SECOND drawer when they
    // come back and press the button again.
  }
}

/**
 * Clears the CURRENT surface's own identity.
 *
 * POS-CUSTODY — this deliberately does NOT clear the open cash session. It
 * used to, on the reasoning that a drawer belongs to the employee who opened
 * it and must not be handed to the next one. That reasoning is right and the
 * remedy was wrong: forgetting the id does not close the drawer, it only
 * makes real money unreachable, and there is no `GET /cash-sessions` index to
 * find it again with. The record now carries the employee code that opened it
 * (`OpenCashSession`), so it defends itself — signing out no longer needs to
 * destroy it.
 */
export function clearSession(): void {
  clearIdentity(activeSurface);
  announce();
}

/**
 * Ends the terminal's PIN session from ANYWHERE, whichever surface is active.
 *
 * POS-CUSTODY — the leak this closes: `clearSession()` only ever touched the
 * surface it was called on, and the only caller is a CONSOLE sign-out. So
 * `ros.terminal.*` was never cleared by anything, by any route, ever. A
 * cashier signing in with their own email wrote `ros.api.*` and left the
 * previous employee's terminal token exactly where `/pos` reads it — and
 * `refreshSession()` kept renewing it from the previous employee's refresh
 * token, so it never even lapsed on its own.
 */
export function clearTerminalIdentity(): void {
  clearIdentity("terminal");
  announce();
}

/**
 * The terminal slot's access token, regardless of which surface is active.
 *
 * Only for revoking it: a console sign-in ends whatever PIN session this
 * device was left holding, and revoking it server-side needs the credential
 * itself. Everything else must go through `getAccessToken()`, which answers
 * for the surface it is asked on.
 */
export function peekTerminalAccessToken(): string | null {
  return read(TERMINAL_KEYS.access);
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

/** The bound terminal's own branch — see `KEY_TERMINAL_BRANCH`. */
export function getTerminalBranchId(): string | null {
  return read(KEY_TERMINAL_BRANCH);
}

export function setTerminalBranchId(branchId: string | null): void {
  write(KEY_TERMINAL_BRANCH, branchId);
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
 * The cash session this till currently has open, AND whose it is.
 *
 * Stored for the same reason the token is: a POS that reloads mid service
 * must come back to the drawer it left open. Holding this in React state
 * alone stranded it — after a refresh the screen offered to open a drawer
 * that was already open, and because the backend serves no cash-session
 * index (there is no `GET /cash-sessions`), the id was simply unrecoverable
 * and the shift could never be counted or closed.
 *
 * POS-CUSTODY — it used to be the bare id and nothing else, which is what
 * made it inheritable. A drawer is taken into ONE employee's custody: every
 * sale, pay-in, pay-out and the closing count all land on whoever opened it.
 * An unowned id is therefore a record the till cannot reason about, and the
 * till did the worst possible thing with it — adopted it wholesale, so the
 * next person to stand at the terminal transacted against someone else's
 * drawer and appeared on someone else's close report.
 *
 * So the employee code travels with the id. `employeeCode` is the employee
 * who opened it; `terminalId` is where. Neither is an authorisation — the
 * server decides that from the token, as always — they are what lets the
 * till tell "this is your drawer, carry on" apart from "this drawer is
 * someone else's, here is whose".
 */
export interface OpenCashSession {
  cashSessionId: string;
  /**
   * The employee code that took custody. Empty only for a record written by
   * a build from before custody was tracked — treated as "owner unknown",
   * which is to say: shown to whoever is standing there, never adopted.
   */
  employeeCode: string;
  /** The terminal it was opened at, so a re-bound device does not inherit it. */
  terminalId: string;
}

export function getOpenCashSession(): OpenCashSession | null {
  const raw = read(KEY_CASH_SESSION);
  if (!raw) return null;

  // A bare id is the pre-custody shape. Keep it — there is real money behind
  // it and no endpoint to rediscover it with — but keep it as what it is: a
  // session whose owner this device cannot vouch for.
  if (!raw.startsWith("{")) {
    return { cashSessionId: raw, employeeCode: "", terminalId: read(KEY_TERMINAL) ?? "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OpenCashSession>;
    if (!parsed.cashSessionId) return null;
    return {
      cashSessionId: parsed.cashSessionId,
      employeeCode: parsed.employeeCode ?? "",
      terminalId: parsed.terminalId ?? "",
    };
  } catch {
    return null;
  }
}

export function setOpenCashSession(session: OpenCashSession | null): void {
  write(KEY_CASH_SESSION, session === null ? null : JSON.stringify(session));
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
  /**
   * POS-CUSTODY — who pressed the button. A replay is only a replay for the
   * same employee; for anyone else those ids would open a drawer in the
   * wrong name, with the wrong float. Empty from a pre-custody build, which
   * matches nobody and so is never replayed.
   */
  employeeCode: string;
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
      employeeCode: parsed.employeeCode ?? "",
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
