/**
 * The handover between the screens of the sign-in flow.
 *
 * Session storage rather than query parameters: which account is mid-way
 * through MFA is not something to leave in a URL where it lands in browser
 * history and server logs, and it should not survive the tab.
 *
 * The flow is a chain, and each screen reads what the one before it wrote:
 *
 *   /login  →  /mfa  →  /select-tenant  →  /select-brand  →  /select-branch
 *      └─────────────────────────────────────────────────────────→  home
 *
 * Screens that are unnecessary for the signing-in role are skipped rather
 * than shown with a single option — `nextScopeStep()` decides.
 */

import { ROLE_DEFINITIONS, type RoleKey } from "./permissions";

const PENDING_ROLE = "ros.console.pendingRole";
const RETURN_TO = "ros.console.returnTo";
const DENIED_PERMISSION = "ros.console.deniedPermission";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode: the receiving screen falls back to its default.
  }
}

function clear(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------
// The account part-way through the flow
// ---------------------------------------------------------------------------

export function setPendingRole(role: RoleKey): void {
  write(PENDING_ROLE, role);
}

export function readPendingRole(): RoleKey | null {
  const value = read(PENDING_ROLE);
  return value && value in ROLE_DEFINITIONS ? (value as RoleKey) : null;
}

export function clearPendingRole(): void {
  clear(PENDING_ROLE);
}

// ---------------------------------------------------------------------------
// Where to go after signing back in
// ---------------------------------------------------------------------------

/**
 * Remembers the page the user was on when the session ended, so signing back
 * in returns them there instead of dumping them on a dashboard. Only same-origin
 * paths are stored; an absolute URL here would be an open-redirect.
 */
export function setReturnTo(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  write(RETURN_TO, path);
}

export function takeReturnTo(): string | null {
  const value = read(RETURN_TO);
  clear(RETURN_TO);
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

// ---------------------------------------------------------------------------
// What the access-denied screen should name
// ---------------------------------------------------------------------------

export function setDeniedPermission(permission: string): void {
  write(DENIED_PERMISSION, permission);
}

export function takeDeniedPermission(): string | null {
  const value = read(DENIED_PERMISSION);
  clear(DENIED_PERMISSION);
  return value;
}

// ---------------------------------------------------------------------------
// Which scope-selection screens this role actually needs
// ---------------------------------------------------------------------------

export type ScopeStep = "tenant" | "brand" | "branch" | "done";

/**
 * A role pinned to one branch has nothing to choose, so it is sent straight
 * through. Asking someone to confirm the only option available to them is a
 * screen that exists to be dismissed.
 */
export function nextScopeStep(
  role: RoleKey,
  chosen: { tenant?: boolean; brand?: boolean; branch?: boolean },
  counts: { tenants: number; brands: number; branches: number },
): ScopeStep {
  const scope = ROLE_DEFINITIONS[role].defaultScope;

  if (!chosen.tenant && counts.tenants > 1) return "tenant";
  if (scope === "branch") return "done";
  if (!chosen.brand && counts.brands > 1 && scope !== "tenant") return "brand";
  if (!chosen.branch && counts.branches > 1 && scope === "branch_set") return "branch";
  return "done";
}

// ---------------------------------------------------------------------------
// Which console role a real account most resembles
// ---------------------------------------------------------------------------

/**
 * The API issues flat permission codes; the console renders against named
 * roles. There is no mapping between them on the wire, so the closest role
 * is the one whose permission set overlaps the granted codes best.
 *
 * This decides what the navigation *shows*, nothing more — FR-SEC-045 is
 * explicit that the server authorises every request regardless. An account
 * with no codes yet (no tenant selected) falls back to the narrowest role,
 * so the console never renders more than the server would allow.
 */
export function roleFromPermissions(codes: readonly string[]): RoleKey {
  if (codes.length === 0) return "cashier";

  const granted = new Set(codes.map((code) => code.toLowerCase().replace(/[:/]/g, ".")));

  let best: RoleKey = "cashier";
  let bestScore = -Infinity;

  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const wanted = definition.permissions as readonly string[];
    const overlap = wanted.filter((permission) => granted.has(permission)).length;
    // Penalise a role that claims far more than the account was granted, so
    // one shared permission does not promote a cashier to owner.
    const score = overlap - Math.abs(wanted.length - granted.size) * 0.05;

    if (score > bestScore) {
      bestScore = score;
      best = key as RoleKey;
    }
  }

  return best;
}
