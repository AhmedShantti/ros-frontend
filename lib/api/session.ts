/**
 * The tokens, and the tenant/branch the tokens are currently scoped to.
 *
 * `POST /auth/login` returns a short-lived access token and a refresh token.
 * The tenant is *not* chosen at login: `POST /auth/tenant` rotates the access
 * token so it carries a tenant claim, and every `/org`, `/catalogue`,
 * `/inventory`, `/orders` call 403s until that has happened.
 *
 * Storage is `localStorage`, deliberately: a POS/KDS device that reloads mid
 * service must come back signed in. It is also, equally deliberately, only
 * the token — no permission set is cached here, because the server is the
 * authority on every request (FR-SEC-045).
 *
 * DEMO-SESSION-ISOLATION-HOTFIX — the identity fields (access/refresh token,
 * its expiry, the selected tenant) are kept in INDEPENDENT storage slots, one
 * per "surface": `console` (password login, `(console)`/`(auth)` route
 * groups — the dashboard), `pos` and `kds` (PIN login, `(terminal)` route
 * group; the surface name predates, and is unrelated to, the ROS Terminal
 * device concept decoupled below). Before this, `signInWithPin` overwrote the
 * SAME `ros.api.*` keys a signed-in Owner's dashboard session was reading, so
 * a cashier PIN login on the same browser silently replaced the Owner's own
 * token — every `/dashboard` call afterwards 403'd, authenticated as the
 * Cashier instead. `setActiveSurface`, called once by each route group's own
 * root layout (module scope, before any child can fire a request), picks
 * which slot every one of the functions below reads and writes — every
 * existing call site (`lib/api/auth.ts`, `lib/api/client.ts`,
 * `lib/console/services/http.ts`'s ~50 `getTenantId()` reads,
 * `components/terminal/pos-live.tsx`) keeps calling the SAME function names
 * unchanged, and is automatically correct for whichever surface it runs on.
 *
 * POS-KDS-SESSION-ISOLATION-P0 — `pos` and `kds` used to be ONE combined
 * `terminal` slot, on the reasoning that both live under the same
 * `(terminal)` route group and neither is the console. That reasoning
 * conflated "not the console" with "the same session": a KDS PIN sign-on
 * wrote the exact same `ros.terminal.*` keys and `posEmployee` record a POS
 * cashier's session was reading, so signing on to the kitchen display on a
 * shared browser silently replaced the till's own token — `/pos` then sent
 * the KDS employee's token to an order-line endpoint, which correctly 403'd
 * it ("PIN (KDS) sessions cannot access dashboard, back-office, or POS
 * endpoints."). This is the SAME namespacing mechanism, extended to a third,
 * independent slot rather than a second auth system: `ConsoleProvider`
 * resolves which of `pos`/`kds` a mount of the shared `(terminal)` layout
 * actually is from the route itself (`/kds*` vs everything else under
 * `(terminal)`), exactly as it already resolved `console` vs `terminal` from
 * which route group mounted it.
 *
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — POS and KDS are branch/employee
 * application sessions, not registered Terminal/device ones: `POST /auth/pin`
 * takes `branchId` and `sessionType` ("pos" | "kds") instead of `terminalId`,
 * and the JWT it mints no longer carries `trm`.
 *
 * FRONTEND-REMOVE-DEVICE-UX-P1 — there is no "device" concept in this model
 * at all, not even a lightweight one: POS/KDS need no setup, registration, or
 * binding step before use, only an operating BRANCH (and, for KDS, a Kitchen
 * Station, chosen separately inside KDS itself). `activeBranchId`/
 * `kdsStationId` are ordinary application state — the currently selected
 * operating context — not a device identity, and are named accordingly.
 * `/select-branch` (a console-authenticated screen) sets the branch once,
 * and the SAME value must be visible to `/pos`/`/kds` afterwards for a PIN
 * sign-on to even know which branch it is signing into. This state happens
 * to live in this browser's `localStorage` (so it survives a reload without
 * asking again), but that is a storage-lifetime detail, not the concept.
 *
 * POS-CUSTODY — everything else here is scoped to WHO IS ON THE TILL, and
 * the split is the whole point of this module:
 *
 *   Survives any sign-out: activeBranchId, kdsStationId, deviceTenantId,
 *   deviceFingerprint. Signing off does not change which branch/station this
 *   browser is currently operating.
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

export type AuthSurface = "console" | "pos" | "kds";

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
  sessionStart: "ros.api.sessionStartedAt",
};

/** POS-KDS-SESSION-ISOLATION-P0 — was the one shared `ros.terminal.*` slot. */
const POS_KEYS = {
  access: "ros.pos.accessToken",
  refresh: "ros.pos.refreshToken",
  expires: "ros.pos.expiresAt",
  tenant: "ros.pos.tenantId",
  sessionStart: "ros.pos.sessionStartedAt",
};

const KDS_KEYS = {
  access: "ros.kds.accessToken",
  refresh: "ros.kds.refreshToken",
  expires: "ros.kds.expiresAt",
  tenant: "ros.kds.tenantId",
  sessionStart: "ros.kds.sessionStartedAt",
};

/**
 * POS-KDS-SESSION-LIFETIME-POLICY-P0 — the maximum an operational session may
 * live even under continuous, successful silent refresh: a shift ends, so the
 * session does too, rather than a rotating refresh token letting a PIN
 * sign-on outlive the person who made it indefinitely. 12h covers a long
 * shift (with a close) while still being a real bound. Checked in
 * `client.ts`'s `refreshSession()` — see `isSessionOverHardLimit` below.
 */
export const HARD_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

function keysFor(surface: AuthSurface) {
  if (surface === "console") return CONSOLE_KEYS;
  return surface === "kds" ? KDS_KEYS : POS_KEYS;
}

function identityKeys() {
  return keysFor(activeSurface);
}

/**
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 / FRONTEND-REMOVE-DEVICE-UX-P1 —
 * these keys named concepts this build no longer has: a registered ROS
 * Terminal device (`POST /auth/terminal`'s bind response, `PinLoginDto.
 * terminalId`), and — one migration later — a "device branch" implying the
 * selected operating branch belonged to the physical device rather than
 * simply being the application's current selection. See `KEY_ACTIVE_BRANCH`
 * for the branch key this app actually uses now, and
 * `migrateLegacyPosKdsDeviceState` for the one-time, value-preserving move
 * off every one of these. Kept only as string literals, deliberately not
 * live constants: nothing outside that migration may read or write through
 * them again.
 *
 *   "ros.api.terminalId"        — the bound terminal's id (no successor)
 *   "ros.api.terminalName"      — its display name, cached at bind time (no successor)
 *   "ros.api.terminalBranchId"  — its branch, cached at bind time (oldest predecessor of `activeBranchId`)
 */
const LEGACY_TERMINAL_KEYS = ["ros.api.terminalId", "ros.api.terminalName"] as const;
/** The oldest predecessor of `KEY_ACTIVE_BRANCH`, from the Terminal-bind model — see `migrateLegacyPosKdsDeviceState`. */
const LEGACY_TERMINAL_BRANCH_KEY = "ros.api.terminalBranchId";

/**
 * DEMO-SESSION-ISOLATION-HOTFIX — which tenant THIS DEVICE operates under,
 * as a DEVICE-level fact, independent of either surface's own active
 * identity. The Cashier PIN sign-on form has no tenant picker (FR-SEC-020 —
 * a till identifies staff by code and PIN, never by typing a tenant id) and
 * needs a tenantId to even attempt `POST /auth/pin`; before the surfaces
 * were separated it silently borrowed the shared `tenantId` slot, which
 * happened to already hold the right value only because the SAME browser
 * had, at some point, also been used for a console login as the manager who
 * set this device up. Kept here, set whenever EITHER surface successfully
 * resolves a tenant, and never cleared by a mere sign-out of either one — the
 * physical till does not change tenants just because someone logged out of it.
 */
const KEY_DEVICE_TENANT = "ros.api.deviceTenantId";
/**
 * FRONTEND-REMOVE-DEVICE-UX-P1 — the currently selected operating branch for
 * POS/KDS on this browser. Was `deviceBranchId`/`KEY_DEVICE_BRANCH`: that
 * name implied the branch belonged to the physical device, a leftover of the
 * Terminal-bind model this app no longer has. There is no device to own it —
 * it is simply which branch the application is currently pointed at,
 * selected once at `/select-branch` (from the same authorized-branches list
 * the console's own switcher offers) and read from here by every POS/KDS
 * screen that needs it (the PIN sign-on request, the menu, the tables, the
 * branch chip) instead of the console's brand/branch scope switcher: that
 * switcher's storage keys (`ros.console.brand`/`.branch`) are shared with
 * `(console)` and persist across a manager's own console session, so a
 * cashier signing on right after that manager finished there would otherwise
 * inherit whatever branch the manager's dashboard happened to be filtered
 * to. Never cleared by a sign-out — signing off does not change which branch
 * this browser is currently operating.
 *
 * A DIFFERENT key from the legacy `ros.api.deviceBranchId`/
 * `ros.api.terminalBranchId` ones on purpose, so a value cached under either
 * old model is never silently reinterpreted as this — see
 * `migrateLegacyPosKdsDeviceState` below for the one-time, value-preserving
 * move off the immediate predecessor key.
 */
const KEY_ACTIVE_BRANCH = "ros.api.activeBranchId";
/** The immediately preceding name for `KEY_ACTIVE_BRANCH` — see `migrateLegacyPosKdsDeviceState`. */
const LEGACY_DEVICE_BRANCH_KEY = "ros.api.deviceBranchId";
const KEY_CASH_SESSION = "ros.api.cashSessionId";
const KEY_CASH_OPENING = "ros.api.cashSessionOpening";
/**
 * POS-KDS-SESSION-ISOLATION-P0 — was ONE shared `ros.api.posEmployee` slot
 * for both surfaces, on the same "they're not the console" reasoning the
 * token keys had — a KDS sign-on overwrote the display record `/pos` was
 * reading right alongside its token. Split the same way the tokens were.
 */
const POS_EMPLOYEE_KEYS = {
  pos: "ros.pos.employee",
  kds: "ros.kds.employee",
};
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
 * refresh is a two-step replay (base token, then tenant re-select — see
 * `client.ts`'s `refreshSession()`), each of which calls this. Announcing
 * after the first step let `useLiveOrgContext`'s own `onSessionChange`
 * listener re-trigger its FULL org bootstrap mid-replay, using whatever
 * PARTIALLY-scoped token happened to exist at that instant (the bare,
 * tenant-less base token, before the tenant re-select step had even
 * started) — that premature fetch then genuinely failed, and the failure
 * path is what a real session's data disappearing around the access-token
 * expiry actually was. Only the LAST write of a replay should announce;
 * every caller outside a replay (sign-in, PIN sign-on, tenant selection —
 * all genuinely one-shot) is unaffected, since they never pass `silent`.
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
  // POS-KDS-SESSION-LIFETIME-POLICY-P0 — `silent` is passed ONLY by a token
  // refresh replay (`client.ts`'s `refreshSession()`), never by a genuine
  // sign-in/PIN sign-on. So "not silent" is exactly "a new session started
  // here" — the one moment the hard-lifetime clock should (re)start. A
  // refresh rotating the token every ~14 minutes must never touch it, or the
  // 12h cap would never actually arrive.
  if (!options?.silent) write(keys.sessionStart, String(Date.now()));
  if (!options?.silent) announce();
}

/** Exposed so a multi-step caller (a token refresh replay) can announce ONCE, after its last silent write, rather than after every intermediate one. */
export function announceSessionChange(): void {
  announce();
}

function clearIdentity(surface: AuthSurface): void {
  const keys = keysFor(surface);
  write(keys.access, null);
  write(keys.refresh, null);
  write(keys.expires, null);
  write(keys.tenant, null);
  write(keys.sessionStart, null);
  if (surface === "pos" || surface === "kds") {
    write(POS_EMPLOYEE_KEYS[surface], null);
    // A half-finished open is NOT cleared here. It carries the employee code
    // that started it (`PendingCashOpen`) and is replayed only for them, so
    // it defends itself the same way the open session does — and it has to
    // survive, because it is the only thing that stops a cashier who signed
    // off during a timed-out open from opening a SECOND drawer when they
    // come back and press the button again.
  }
}

/**
 * Clears the CURRENT surface's own identity — and ONLY that surface's.
 *
 * POS-CUSTODY — this deliberately does NOT clear the open cash session. It
 * used to, on the reasoning that a drawer belongs to the employee who opened
 * it and must not be handed to the next one. That reasoning is right and the
 * remedy was wrong: forgetting the id does not close the drawer, it only
 * makes real money unreachable, and there is no `GET /cash-sessions` index to
 * find it again with. The record now carries the employee code that opened it
 * (`OpenCashSession`), so it defends itself — signing out no longer needs to
 * destroy it.
 *
 * POS-KDS-SESSION-ISOLATION-P0 — this is also what `signInWithPin` and
 * `signOffTerminal` call now (never `clearTerminalIdentity` below): both run
 * on exactly one of `pos`/`kds` at a time, via `activeSurface`, so clearing
 * "the current surface" already means "this one, not the other" — a KDS
 * sign-on/sign-off must never touch POS's token or vice versa.
 */
export function clearSession(): void {
  clearIdentity(activeSurface);
  announce();
}

/**
 * Ends BOTH terminal PIN sessions — POS's and KDS's — regardless of which
 * surface is active. For a CONSOLE user reclaiming the device, which is the
 * only kind of caller this has: it does not know, and must not guess, which
 * of the two a stray till session left behind actually was.
 *
 * POS-CUSTODY — the leak this closes: `clearSession()` only ever touched the
 * surface it was called on, and the only caller is a CONSOLE sign-out. So
 * neither terminal slot was ever cleared by anything, by any route, ever. A
 * cashier signing in with their own email wrote `ros.api.*` and left the
 * previous employee's terminal token exactly where `/pos`/`/kds` reads it —
 * and `refreshSession()` kept renewing it from the previous employee's
 * refresh token, so it never even lapsed on its own.
 */
export function clearTerminalIdentity(): void {
  clearIdentity("pos");
  clearIdentity("kds");
  announce();
}

/**
 * Both terminal slots' access tokens, regardless of which surface is active.
 *
 * Only for revoking them: a console sign-in ends whatever PIN session(s)
 * this device was left holding, and revoking server-side needs the
 * credential itself. Everything else must go through `getAccessToken()`,
 * which answers for the surface it is asked on.
 */
export function peekTerminalAccessTokens(): { pos: string | null; kds: string | null } {
  return { pos: read(POS_KEYS.access), kds: read(KDS_KEYS.access) };
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

/**
 * Milliseconds until the access token goes stale — negative once it already
 * has. Used to arm a proactive refresh timer instead of waiting for the next
 * outbound request to notice (`client.ts`'s `scheduleProactiveRefresh`),
 * which is what keeps an idle-but-signed-on screen — a KDS rail nobody is
 * touching between tickets — from ever hitting a stale token in the first
 * place.
 */
export function msUntilAccessTokenStale(): number {
  const expiresAt = Number(read(identityKeys().expires) ?? 0);
  if (expiresAt <= 0) return 0;
  return expiresAt - Date.now();
}

/**
 * POS-KDS-SESSION-LIFETIME-POLICY-P0 — whether this surface's session has run
 * longer than `HARD_SESSION_LIFETIME_MS`, independent of whether its refresh
 * token is still good. Self-healing for a session that predates this check
 * (or a `console` session, which never wrote `sessionStart` before this
 * fix landed): rather than treat an already-open session as instantly over
 * the limit the moment this ships, the clock starts on the first read.
 */
export function isSessionOverHardLimit(): boolean {
  const keys = identityKeys();
  const startedRaw = read(keys.sessionStart);
  if (!startedRaw) {
    write(keys.sessionStart, String(Date.now()));
    return false;
  }
  return Date.now() - Number(startedRaw) >= HARD_SESSION_LIFETIME_MS;
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

/** The currently selected operating branch for POS/KDS — see `KEY_ACTIVE_BRANCH`. */
export function getActiveBranchId(): string | null {
  return read(KEY_ACTIVE_BRANCH);
}

export function setActiveBranchId(branchId: string | null): void {
  write(KEY_ACTIVE_BRANCH, branchId);
  announce();
}

/**
 * Forgets a pre-decoupling browser's Terminal/device state, and carries its
 * selected branch (if any) forward onto the current key — see
 * `LEGACY_TERMINAL_KEYS`/`LEGACY_TERMINAL_BRANCH_KEY`. Safe to call
 * unconditionally and repeatedly: a key already absent is simply a no-op
 * removal, and an `activeBranchId` already set is never overwritten. Called
 * once at POS/KDS bootstrap so a production browser holding old
 * `terminalId`/`terminalName`/`terminalBranchId`/`deviceBranchId` values
 * cannot have them read, misinterpreted, or acted on by anything — the whole
 * point being that a returning user keeps the branch they already had
 * selected, rather than a crash, a redirect loop, or being asked again over
 * state this build no longer knows how to use.
 */
export function migrateLegacyPosKdsDeviceState(): void {
  for (const key of LEGACY_TERMINAL_KEYS) write(key, null);

  if (read(KEY_ACTIVE_BRANCH) === null) {
    const inherited = read(LEGACY_DEVICE_BRANCH_KEY) ?? read(LEGACY_TERMINAL_BRANCH_KEY);
    if (inherited) write(KEY_ACTIVE_BRANCH, inherited);
  }
  write(LEGACY_DEVICE_BRANCH_KEY, null);
  write(LEGACY_TERMINAL_BRANCH_KEY, null);
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
 * that was already open.
 *
 * PROD-CASH-SESSION-RECOVERY-P0 — this value is only ever a starting guess
 * now. `GET /cash-sessions/current` is the server's own index of the
 * employee's open session, and `components/terminal/pos-live.tsx` checks
 * this id against it as soon as a PIN sign-on is known, overwriting it (or
 * clearing it) with whatever the server answers. Storage alone can never be
 * trusted over that: a deploy or a cleared browser loses it outright, and a
 * stale value here — from a session someone else already closed — must not
 * be replayed as if it were still open.
 */
export interface OpenCashSession {
  cashSessionId: string;
  /**
   * The employee code that took custody. Empty only for a record written by
   * a build from before custody was tracked — treated as "owner unknown",
   * which is to say: shown to whoever is standing there, never adopted.
   */
  employeeCode: string;
  /**
   * The branch operating when it was opened, so switching to a different
   * operating branch does not inherit it. Was `terminalId` — a re-bound
   * Terminal is not a scenario this build has anymore, but the operating
   * branch changing underneath a stored session is the same shape of event,
   * and gets the same protection.
   */
  branchId: string;
}

export function getOpenCashSession(): OpenCashSession | null {
  const raw = read(KEY_CASH_SESSION);
  if (!raw) return null;

  // A bare id is the pre-custody shape. Keep it — there is real money behind
  // it and no endpoint to rediscover it with — but keep it as what it is: a
  // session whose owner this browser cannot vouch for.
  if (!raw.startsWith("{")) {
    return { cashSessionId: raw, employeeCode: "", branchId: read(KEY_ACTIVE_BRANCH) ?? "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OpenCashSession> & { terminalId?: string };
    if (!parsed.cashSessionId) return null;
    return {
      cashSessionId: parsed.cashSessionId,
      employeeCode: parsed.employeeCode ?? "",
      // A record written before this migration carried `terminalId` instead;
      // read as owner-unknown-for-branch rather than thrown away outright —
      // there is still real money behind it — but never as a match for the
      // device's CURRENT branch, since that field named a different axis.
      branchId: parsed.branchId ?? "",
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
 * Who signed on at this terminal with a PIN — the POS cashier, or the KDS
 * employee, whichever `sessionType` this device's PIN sign-on actually used.
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
 * It exists so the till/display can show who is on it and know to ask when
 * nobody is, without decoding a JWT it does not own.
 *
 * POS-KDS-SESSION-ISOLATION-P0 — reads/writes `POS_EMPLOYEE_KEYS[activeSurface]`
 * (falling back to the `pos` slot for `console`, which never legitimately
 * calls this): POS and KDS each have their own record now, the same way
 * they have their own token, so `sessionType` on the stored value is no
 * longer load-bearing for telling the two apart — kept only because a record
 * already on a returning browser from before this fix still carries it, and
 * it costs nothing to keep believing it.
 */
export interface PosEmployee {
  code: string;
  name: string;
  /** Absent on a record from before KDS had its own PIN sign-on — treated as `"pos"`, the only kind that existed then. */
  sessionType?: "pos" | "kds";
}

function posEmployeeKey(): string {
  return POS_EMPLOYEE_KEYS[activeSurface === "kds" ? "kds" : "pos"];
}

export function getPosEmployee(): PosEmployee | null {
  const raw = read(posEmployeeKey());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PosEmployee>;
    if (!parsed.code) return null;
    return {
      code: parsed.code,
      name: parsed.name ?? parsed.code,
      sessionType: parsed.sessionType === "kds" ? "kds" : "pos",
    };
  } catch {
    return null;
  }
}

export function setPosEmployee(employee: PosEmployee | null): void {
  write(posEmployeeKey(), employee === null ? null : JSON.stringify(employee));
  announce();
}
