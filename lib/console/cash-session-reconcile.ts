/**
 * Pure reconciliation logic between the till's LOCAL idea of "whose drawer is
 * open here" and the SERVER's authoritative answer for "does the signed-on
 * cashier have an open cash session".
 *
 * Kept free of React/storage/network so it can be exercised directly by
 * tests — `components/terminal/pos-live.tsx` is the only caller, and it does
 * nothing with these results except write them straight into
 * `setOpenCashSession`/`useState`.
 *
 * The model, end to end:
 *
 *   `held`   — whatever `OpenCashSession` this till's `localStorage` last
 *              remembered, whoever it belongs to. Read once at mount and
 *              kept in sync afterward; survives a refresh precisely because
 *              the backend publishes no `GET /cash-sessions` index to
 *              rediscover an id with.
 *   `mine`   — a LOCAL-ONLY custody check: does `held` name the currently
 *              signed-on cashier, at this terminal. This has to run before
 *              any network call, because a server call scoped to the new
 *              cashier's own token can only ever answer for THEM — it has no
 *              way to say "yes, but it's someone else's" the way `held` can.
 *   server   — `GET /cash-sessions/current` under the signed-on cashier's own
 *              token: the one call that can be trusted to say whether THIS
 *              employee genuinely has an open session right now, regardless
 *              of what `held` happens to remember.
 *
 * `reconcileWithServer` below is only ever meaningful once `mine` is true (or
 * `held` is empty) — never call it while a FOREIGN drawer is held, or its
 * "clear" branch would delete a record that is not this cashier's to delete.
 */

export interface HeldSession {
  cashSessionId: string;
  employeeCode: string;
  terminalId: string;
}

export interface CashierIdentity {
  code: string;
}

/**
 * Whether two employee codes name the same person.
 *
 * Compared loosely on purpose: the code is typed by hand on a touchscreen at
 * the start of every shift, and `EMP01`, `emp01` and a trailing space from a
 * fat-fingered keyboard are the same employee to everyone except a strict
 * equality check. Getting this wrong locks a cashier out of their OWN open
 * drawer and sends them to a screen saying it belongs to somebody else — the
 * worst possible failure of a custody check, because it is both wrong and
 * unarguable. The server still decides who the token is regardless.
 */
export function sameEmployee(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether the drawer this till is holding, LOCALLY, belongs to the currently
 * signed-on cashier — a pure, offline check over `held`/`cashier`/`terminalId`
 * only. Never consults the server: this is what decides whether the server
 * may even be asked (see the module doc above).
 */
export function isMine(
  held: HeldSession | null,
  cashier: CashierIdentity | null,
  terminalId: string | null,
): boolean {
  return (
    held !== null &&
    cashier !== null &&
    held.employeeCode !== "" &&
    sameEmployee(held.employeeCode, cashier.code) &&
    (held.terminalId === "" || held.terminalId === terminalId)
  );
}

export type ReconcileAction =
  /** Nothing to change — local storage already agrees with the server. */
  | { type: "none" }
  /** The server has an open session `held` did not know about (or knew a stale id for) — write it through. */
  | { type: "restore"; cashSessionId: string }
  /** `held` named a session the server no longer recognises as open — forget it. */
  | { type: "clear" };

/**
 * Server truth vs. the locally-held record, for the SAME cashier/terminal.
 *
 * Only meaningful once the caller has confirmed `held === null || isMine(...)`
 * — see the module doc. Given that guarantee, this covers every case the
 * task's reconciliation table calls for:
 *
 *   server open, `held` empty or stale     → restore
 *   server open, `held` already matches    → none (idempotent)
 *   server none, `held` remembers one      → clear (stale local session)
 *   server none, `held` already empty      → none
 */
export function reconcileWithServer(input: {
  held: HeldSession | null;
  serverCashSessionId: string | null;
}): ReconcileAction {
  const { held, serverCashSessionId } = input;

  if (serverCashSessionId) {
    if (held?.cashSessionId === serverCashSessionId) return { type: "none" };
    return { type: "restore", cashSessionId: serverCashSessionId };
  }

  if (held) return { type: "clear" };
  return { type: "none" };
}

/**
 * Whether a failed `openCashSession` call is the "you already have an open
 * shift" conflict — recoverable by fetching and restoring the cashier's
 * actual current session, rather than a dead end.
 *
 * The exact NestJS exception name is not something the frontend controls, so
 * this matches broadly: the HTTP status a conflict actually arrives as, the
 * status-derived fallback code `client.ts` assigns when the server sends no
 * named error, and any server-named code or message that says "already"
 * open/exists — never narrowed to one literal string the backend is free to
 * rename.
 */
export function isAlreadyOpenConflict(error: {
  status?: number;
  code?: string;
  message?: string;
}): boolean {
  if (error.status === 409) return true;
  if (error.code === "CONFLICT") return true;
  if (error.code && /ALREADY_OPEN/i.test(error.code)) return true;
  if (error.message && /already\s+(have|has|an?)\b.*\bopen/i.test(error.message)) return true;
  return false;
}
