/**
 * Manager approval at the till — FR-POS-047, FR-POS-048, FR-POS-073,
 * FR-POS-075, FR-SEC-016, FR-SEC-031/032.
 *
 * Every control that needs a manager used to be a dropdown of managers'
 * names: pick one and the discount went through. That records a name, not an
 * approval — the manager was never asked, and anyone at the till could type
 * their way past the threshold.
 *
 * FR-POS-048 names three ways a manager can approve without the order being
 * abandoned, and each of them now proves who is approving:
 *
 *   pin     the manager enters their staff code and PIN on the terminal
 *   card    the manager swipes their staff card through the till's reader
 *   remote  the request goes to the manager, the till keeps working, and the
 *           decision lands on the order when it is made (FR-SEC-032)
 *
 * This module holds the rules and nothing else. The reducer asks it whether
 * an action needs an approval and whether the stamp it was given is good
 * enough, and refuses the action if not — the screen asking first is a
 * courtesy, not the control (FR-SEC-045).
 *
 * ## Demo credentials
 *
 * The in-memory engine has no credential store, so a manager's demo PIN is
 * the digits of their staff code (E1027 → 1027) and their demo staff card
 * reads `%S<code>?`. The backend till (`pos-live.tsx`) never uses either: it
 * sends the code and PIN to the server, which is the only thing that may
 * decide whether they are right.
 */

import type {
  ApprovalMethod,
  ApprovalStamp,
  Currency,
  Employee,
  Id,
  IsoDateTime,
  Localised,
  Order,
} from "../types";
import { activeEmployees } from "../mock/workforce";
import { isPaymentCardSwipe } from "../pci";

// ---------------------------------------------------------------------------
// Who may approve
// ---------------------------------------------------------------------------

/**
 * The positions that carry approval authority on the floor.
 *
 * One definition. The discount sheet, the 86 override and the shift close
 * each had their own regex, and they disagreed about whether a head chef
 * could sign off a cash variance.
 */
const APPROVER_POSITION = /manager|supervisor|head/i;

export function isApprover(employee: Employee): boolean {
  return employee.status === "active" && APPROVER_POSITION.test(employee.position.en);
}

/** FR-SEC-021 — a credential is only good at a branch the employee may work in. */
export function worksAt(employee: Employee, branchId: Id): boolean {
  return employee.homeBranchId === branchId || employee.permittedBranchIds.includes(branchId);
}

export function approversFor(branchId: Id): Employee[] {
  return activeEmployees.filter((e) => isApprover(e) && worksAt(e, branchId));
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** See the module note: demo only, never used against the backend. */
export function demoPinFor(employee: Employee): string {
  return employee.code.replace(/\D/g, "").slice(-4).padStart(4, "0");
}

/** The demo staff card an employee would swipe. */
export function demoStaffCardFor(employee: Employee): string {
  return `%S${employee.code}?`;
}

/**
 * A staff card read, or null.
 *
 * Staff cards use a private track-1 format code (`S`) rather than the `B`
 * that marks a bank card, so the two are told apart by their first
 * characters. A payment card swiped here by mistake is recognised by
 * `isPaymentCardSwipe` and discarded without its number being read
 * (FR-POS-066).
 */
export function parseStaffCard(raw: string): string | null {
  const text = raw.trim();
  if (isPaymentCardSwipe(text)) return null;
  const match = /^%S([A-Za-z0-9-]{2,16})\??$/.exec(text);
  return match ? match[1]!.toUpperCase() : null;
}

export type ApprovalRefusal =
  | "unknown"
  | "not_approver"
  | "wrong_pin"
  | "self"
  | "branch"
  | "payment_card"
  | "unreadable";

export type Verification =
  | { ok: true; approver: Employee }
  | { ok: false; reason: ApprovalRefusal };

interface VerifyContext {
  branchId: Id;
  /** The operator asking. FR-SEC-016 — they may never approve themselves. */
  requesterId: Id;
}

function byCode(code: string): Employee | undefined {
  const wanted = code.trim().toUpperCase();
  return activeEmployees.find((e) => e.code.toUpperCase() === wanted);
}

function authorise(employee: Employee | undefined, ctx: VerifyContext): Verification {
  if (!employee) return { ok: false, reason: "unknown" };
  if (!isApprover(employee)) return { ok: false, reason: "not_approver" };
  if (!worksAt(employee, ctx.branchId)) return { ok: false, reason: "branch" };
  if (employee.id === ctx.requesterId) return { ok: false, reason: "self" };
  return { ok: true, approver: employee };
}

export function verifyPin(code: string, pin: string, ctx: VerifyContext): Verification {
  const employee = byCode(code);
  // The PIN is checked before anything about the employee is revealed. An
  // unknown code and a wrong PIN fail identically, so the prompt cannot be
  // used to discover which staff codes exist or which belong to managers;
  // only someone holding the right PIN learns why else they were refused.
  if (!employee || pin !== demoPinFor(employee)) return { ok: false, reason: "wrong_pin" };
  return authorise(employee, ctx);
}

export function verifyCard(raw: string, ctx: VerifyContext): Verification {
  if (isPaymentCardSwipe(raw)) return { ok: false, reason: "payment_card" };
  const code = parseStaffCard(raw);
  if (!code) return { ok: false, reason: "unreadable" };
  return authorise(byCode(code), ctx);
}

/** How many wrong PINs before the prompt locks, and for how long. */
export const PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 30_000;

export function stampFrom(
  approver: Employee,
  method: ApprovalMethod,
  at: IsoDateTime,
  requestId: Id | null = null,
): ApprovalStamp {
  return { approverId: approver.id, approverName: approver.name, method, at, requestId };
}

/**
 * Whether a stamp is good enough for the reducer to act on.
 *
 * Re-checked there rather than trusted from the screen: the approver must
 * still be an approver at this branch, and must not be the operator.
 */
export function stampValid(
  stamp: ApprovalStamp | null | undefined,
  ctx: VerifyContext,
): stamp is ApprovalStamp {
  if (!stamp) return false;
  const employee = activeEmployees.find((e) => e.id === stamp.approverId);
  return authorise(employee, ctx).ok;
}

// ---------------------------------------------------------------------------
// When an approval is needed
// ---------------------------------------------------------------------------

export interface ApprovalPolicy {
  /** FR-POS-047 — percentage a cashier may give unapproved. */
  discountApprovalThreshold: number;
  /** FR-POS-047 — amount a cashier may give unapproved, minor units. 0 is no limit. */
  discountApprovalAmountMinor: number;
  /** FR-POS-047 — discounts per employee per shift before each needs approval. 0 is no limit. */
  maxDiscountsPerShift: number;
  /** FR-POS-047 — whether a cashier may discount once payment has started. */
  discountAfterPaymentStarted: boolean;
  /** FR-POS-073 — refunds above this need a manager, minor units. */
  refundApprovalMinor: number;
  /** FR-POS-070/075 — which voids need a manager. */
  voidApproval: "none" | "post_fire" | "all";
}

export type DiscountTrigger = "percent" | "amount" | "count" | "after_payment";

/**
 * FR-POS-047 — every threshold a discount crosses.
 *
 * Returned as a list rather than a boolean so the sheet can say which limit
 * was crossed: "over 10%" and "fourth discount this shift" are different
 * conversations with a manager.
 */
export function discountTriggers(
  input: {
    /** Effective percentage of the base, whether entered as % or amount. */
    percent: number;
    amountMinor: number;
    discountsThisShift: number;
    paymentStarted: boolean;
  },
  policy: ApprovalPolicy,
): DiscountTrigger[] {
  const out: DiscountTrigger[] = [];
  if (input.percent > policy.discountApprovalThreshold) out.push("percent");
  if (policy.discountApprovalAmountMinor > 0 && input.amountMinor > policy.discountApprovalAmountMinor) {
    out.push("amount");
  }
  if (policy.maxDiscountsPerShift > 0 && input.discountsThisShift >= policy.maxDiscountsPerShift) {
    out.push("count");
  }
  if (input.paymentStarted && !policy.discountAfterPaymentStarted) out.push("after_payment");
  return out;
}

export function refundNeedsApproval(amountMinor: number, policy: ApprovalPolicy): boolean {
  return amountMinor > policy.refundApprovalMinor;
}

/** A pre-fire void makes nothing and costs nothing; a post-fire one wastes food. */
export function voidNeedsApproval(preFire: boolean, policy: ApprovalPolicy): boolean {
  if (policy.voidApproval === "all") return true;
  if (policy.voidApproval === "post_fire") return !preFire;
  return false;
}

/** Cancelling an order is a void of every line on it, and is judged the same way. */
export function cancelNeedsApproval(order: Order, policy: ApprovalPolicy): boolean {
  const live = order.lines.filter((l) => l.state !== "voided");
  if (live.length === 0) return false;
  if (policy.voidApproval === "all") return true;
  if (policy.voidApproval === "post_fire") return live.some((l) => l.state !== "pending");
  return false;
}

// ---------------------------------------------------------------------------
// Remote requests — FR-POS-048, FR-SEC-031/032
// ---------------------------------------------------------------------------

export type RemoteApprovalKind = "discount" | "refund" | "void" | "cancel" | "section";

export type RemoteApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "withdrawn";

/**
 * FR-SEC-031 — the requester, the action, the entity, the value, the
 * approver it needs and an expiry. `summary` is what the manager reads; the
 * action itself is replayed by the reducer when the request is approved, so
 * what gets approved is exactly what was asked for.
 */
export interface RemoteApprovalBase {
  id: Id;
  kind: RemoteApprovalKind;
  orderId: Id;
  orderNumber: string;
  branchId: Id;
  requestedBy: Id;
  requestedByName: Localised;
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  terminalId: Id;
  amountMinor: number;
  currency: Currency;
  summary: Localised;
  reason: string;
  /** A specific manager, or null for whoever on duty picks it up. */
  targetApproverId: Id | null;
  targetApproverName: Localised | null;
  status: RemoteApprovalStatus;
  decidedBy: Id | null;
  decidedByName: Localised | null;
  decidedAt: IsoDateTime | null;
  comment: string | null;
}

export function isExpired(request: { expiresAt: IsoDateTime }, at: IsoDateTime): boolean {
  return Date.parse(at) >= Date.parse(request.expiresAt);
}

export function expiryFrom(at: IsoDateTime, minutes: number): IsoDateTime {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}
