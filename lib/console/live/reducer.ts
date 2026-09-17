/**
 * Every state transition the restaurant can make.
 *
 * This reducer is pure. Timestamps arrive on the action rather than being
 * read from the clock, and ids come from a counter in state, so replaying
 * the same actions always produces the same store. That is what lets the
 * server render and the client hydration agree, and it is why the POS can
 * be driven from a test without a browser.
 *
 * Two decisions are worth stating outright, because they are the ones that
 * make the numbers downstream honest:
 *
 *  1. Stock depletes when a line is *fired*, not when the order is paid.
 *     FR-POS-070 says a post-fire void leaves the depletion standing and
 *     asks for a waste record instead — which is only coherent if the food
 *     was already taken out of stock when the kitchen was told to make it.
 *
 *  2. A comp zeroes revenue but keeps cost and depletion (FR-POS-050).
 *     A discount is a pricing decision, a comp is a service-recovery cost,
 *     and conflating them destroys the ability to analyse either.
 */

import type {
  ApprovalStamp,
  CostingMethod,
  AuditEntry,
  DenominationCount,
  Id,
  IsoDateTime,
  KitchenTicket,
  Localised,
  MenuItem,
  MenuItemVariant,
  ModifierPriceRule,
  Money,
  Order,
  OrderDiscount,
  OrderLine,
  OrderLineModifier,
  OrderLinePriceSource,
  OrderType,
  StockMovement,
  SyncState,
  TenderType,
  TicketLine,
  WasteRecord,
} from "../types";
import {
  branchById,
  branches,
  stations,
  tables as seededTables,
  terminals,
} from "../mock/org";
import {
  combos,
  menuItemById,
  menuItemBrandCode,
  modifierGroups,
  priceLists,
  recipeById,
} from "../mock/catalogue";
import { stockItemById } from "../mock/stock-items";
import { wasteReasonByCode } from "../mock/inventory";
import { activeEmployees, employeeById } from "../mock/workforce";
import { countryPacks } from "../mock/platform";
import { money } from "../format";
import { redactCardData, redactOptional, retainCardData } from "../pci";
import {
  balanceOf,
  computeLine,
  computeOrderTotals,
  expandLineToStock,
  modifierGroupsForItem,
  passStation,
  quoteCombo,
  resolveModifierDelta,
  resolvePrice,
  resolveStacking,
  roundCash,
  releaseOffsetSeconds,
  routeLine,
  urgencyFor,
  type ComboPick,
  type ModifierPriceContext,
} from "./engine";
import {
  extraStationTypes,
  itemTargetSeconds,
  normaliseKdsSetup,
  restamp,
  stamp,
  type KdsSetup,
} from "./kds";
import {
  cancelNeedsApproval,
  discountTriggers,
  expiryFrom,
  isExpired,
  refundNeedsApproval,
  stampValid,
  voidNeedsApproval,
  worksAt,
} from "./approval";
import {
  emptyOrderPromotionState,
  reconcileOrderPromotions,
  redemptionsFor,
  saleTimeOf,
  type OrderPromotionState,
} from "./promotions";
import type { Promotion } from "../types";
import type { PromotionCart } from "../crm-promotion-engine";
import {
  DEFAULT_SETTINGS,
  initialLiveState,
  recallableAt,
  type CostLayer,
  stockKey,
  upsertAlert,
  type LiveCashSession,
  type LiveState,
  type RemoteApproval,
  type ServerSection,
  type VoidDisposition,
} from "./state";

// ---------------------------------------------------------------------------
// Lookups the reducer leans on
// ---------------------------------------------------------------------------

const EG_PACK = countryPacks.find((p) => p.code === "EG")!;

export function packForBranch(branchId: Id) {
  const branch = branchById.get(branchId);
  return countryPacks.find((p) => p.code === branch?.countryCode) ?? EG_PACK;
}

/**
 * Every modifier in the catalogue, looked up fresh.
 *
 * Was a map built once at module load, which meant a modifier added in the
 * console this session could be picked at the till and then silently
 * dropped from the line — and never depleted — because the map had never
 * heard of it. The catalogue is a handful of groups; rebuilding is cheap.
 */
function modifierMap() {
  return new Map(modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)));
}

export const stationsByBranch = new Map<Id, typeof stations>();
for (const station of stations) {
  const list = stationsByBranch.get(station.branchId) ?? [];
  list.push(station);
  stationsByBranch.set(station.branchId, list);
}

const SYSTEM_ACTOR: Localised = { en: "POS terminal", ar: "جهاز نقطة البيع" };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface DiscountInput {
  percentage: number | null;
  amountMinor: number | null;
  reason: Localised;
  /** FR-POS-046/051 — the preset the reason came from, if any. */
  presetId: string | null;
  /** FR-POS-051 — an exclusive discount never combines with another. */
  exclusive: boolean;
  /** FR-POS-048 — required whenever a FR-POS-047 threshold is crossed. */
  approval: ApprovalStamp | null;
}

/**
 * FR-POS-022 — the per-context modifier prices in force, passed in.
 *
 * The rules live in a service rather than in the catalogue fixtures, so they
 * reach the reducer the way the timestamp does: on the action. Resolution
 * happens here rather than at the caller because the context includes the
 * price list that priced the line, and that is only known once
 * `resolvePrice` has run — inside this reducer.
 */
export type ModifierPriceRules = readonly ModifierPriceRule[];

/** A request a manager can decide from elsewhere — FR-POS-048. */
export type RemoteApprovalInput = Omit<
  RemoteApproval,
  "id" | "requestedAt" | "expiresAt" | "status" | "decidedBy" | "decidedByName" | "decidedAt" | "comment" | "applied"
>;

export type LiveAction =
  | { type: "RESET"; at: IsoDateTime; branchId?: Id }
  | { type: "SET_BRANCH"; at: IsoDateTime; branchId: Id }
  | { type: "SET_TERMINAL"; at: IsoDateTime; terminalId: Id }
  | { type: "SET_SETTINGS"; at: IsoDateTime; patch: Partial<LiveState["settings"]> }
  | { type: "SHIFT_OPEN"; at: IsoDateTime; employeeId: Id; openingFloatMinor: number }
  | {
      type: "SHIFT_CASH";
      at: IsoDateTime;
      kind: "pay_in" | "pay_out" | "safe_drop";
      amountMinor: number;
      reason: string;
    }
  | {
      type: "SHIFT_CLOSE";
      at: IsoDateTime;
      denominations: DenominationCount[];
      varianceReason: string | null;
      acknowledgedByName: Localised | null;
    }
  | {
      type: "ORDER_NEW";
      at: IsoDateTime;
      orderType: OrderType;
      tableId: Id | null;
      guestCount: number | null;
      /** FR-POS-084 — a manager letting a server open a table outside their section. */
      sectionOverride?: ApprovalStamp | null;
    }
  | { type: "ORDER_SELECT"; at: IsoDateTime; orderId: Id | null }
  | { type: "ORDER_SET_GUESTS"; at: IsoDateTime; orderId: Id; guestCount: number }
  /** FR-POS-006 — set aside, to be picked up by anyone on any till in the branch. */
  | { type: "ORDER_PARK"; at: IsoDateTime; orderId: Id }
  | { type: "ORDER_RESUME"; at: IsoDateTime; orderId: Id }
  | {
      type: "ORDER_CANCEL";
      at: IsoDateTime;
      orderId: Id;
      reason: string;
      /** FR-POS-075 — required when `voidApproval` covers the order's lines. */
      approval?: ApprovalStamp | null;
    }
  | { type: "ORDER_MOVE_TABLE"; at: IsoDateTime; orderId: Id; tableId: Id }
  /** FR-POS-082 — fold `sourceOrderId`'s table into `targetOrderId`'s. */
  | { type: "ORDER_MERGE"; at: IsoDateTime; targetOrderId: Id; sourceOrderId: Id }
  /** FR-POS-082 — move lines onto a new check, at the same table or another. */
  | { type: "ORDER_SPLIT"; at: IsoDateTime; orderId: Id; lineIds: Id[]; tableId: Id | null }
  /** FR-POS-007 — who is serving the order. */
  | { type: "ORDER_SET_SERVER"; at: IsoDateTime; orderId: Id; serverId: Id }
  | { type: "ORDER_NOTE"; at: IsoDateTime; orderId: Id; note: string }
  /** FR-CRM-004 — attach (or detach, with nulls) a customer to the order. */
  | {
      type: "ORDER_SET_CUSTOMER";
      at: IsoDateTime;
      orderId: Id;
      customerId: Id | null;
      customerName: Localised | null;
    }
  /** FR-CRM-025/027 — mirror the console's promotions and recorded redemptions in. */
  | {
      type: "PROMOTIONS_SYNC";
      at: IsoDateTime;
      promotions: Promotion[];
      redemptions: LiveState["promotionBook"]["redemptions"];
    }
  /** FR-CRM-025 — the attached customer's profile, loaded for tag/tier/visit conditions. */
  | { type: "ORDER_PROMOTION_CUSTOMER"; at: IsoDateTime; orderId: Id; customer: NonNullable<PromotionCart["customer"]> }
  /** FR-CRM-028 — a coupon validated at the till; `promotionId: null` takes the code off. */
  | { type: "ORDER_COUPON"; at: IsoDateTime; orderId: Id; code: string; promotionId: Id | null }
  /** A cashier takes an auto-applied promotion off this order, or puts it back. */
  | { type: "ORDER_PROMOTION_DECLINE"; at: IsoDateTime; orderId: Id; promotionId: Id; declined: boolean }
  /** FR-CRM-026 / FR-CRM-016 — the CRM service has recorded this sale's redemptions or points. */
  | { type: "ORDER_PROMOTIONS_RECORDED"; at: IsoDateTime; orderId: Id; kind: "redeemed" | "earned" }
  /** Offline sync — never changes anything financial, only the sync ledger. */
  | {
      type: "ORDER_SYNC";
      at: IsoDateTime;
      orderId: Id;
      syncState: SyncState;
      syncedAt?: IsoDateTime | null;
    }
  | {
      type: "LINE_ADD";
      at: IsoDateTime;
      orderId: Id;
      menuItemId: Id;
      variantId: Id;
      quantity: number;
      modifierIds: Id[];
      course: number;
      seatNumber: number | null;
      notes: string | null;
      openPriceMinor?: number | null;
      /** FR-POS-022 — the per-context modifier prices in force. */
      priceRules?: ModifierPriceRules;
    }
  /** FR-POS-030/031 — a combo, sold as its component lines. */
  | {
      type: "COMBO_ADD";
      at: IsoDateTime;
      orderId: Id;
      comboId: Id;
      picks: ComboPick[];
      /** Modifiers chosen per slot, keyed by slot id. */
      modifierIds: Record<Id, Id[]>;
      priceRules?: ModifierPriceRules;
      course: number;
      seatNumber: number | null;
    }
  | { type: "LINE_QTY"; at: IsoDateTime; orderId: Id; lineId: Id; quantity: number }
  | { type: "LINE_NOTE"; at: IsoDateTime; orderId: Id; lineId: Id; notes: string | null }
  /** FR-POS-036 — lines are grouped into courses and fired independently. */
  | { type: "LINE_COURSE"; at: IsoDateTime; orderId: Id; lineId: Id; course: number }
  /** FR-POS-004 — `null` means shared by the table. */
  | { type: "LINE_SEAT"; at: IsoDateTime; orderId: Id; lineId: Id; seat: number | null }
  | {
      type: "LINE_VOID";
      at: IsoDateTime;
      orderId: Id;
      lineId: Id;
      reason: string;
      disposition: VoidDisposition | null;
      /** FR-POS-075 — required when `voidApproval` covers this void. */
      approval?: ApprovalStamp | null;
    }
  | { type: "LINE_COMP"; at: IsoDateTime; orderId: Id; lineId: Id; reason: string }
  | {
      type: "LINE_DISCOUNT";
      at: IsoDateTime;
      orderId: Id;
      lineId: Id;
      discount: DiscountInput;
    }
  | { type: "ORDER_DISCOUNT"; at: IsoDateTime; orderId: Id; discount: DiscountInput }
  /** FR-POS-049 — the record stays, marked removed, with who and why. */
  | { type: "DISCOUNT_REMOVE"; at: IsoDateTime; orderId: Id; discountId: Id; reason: string }
  | { type: "ORDER_DISCOUNT_CLEAR"; at: IsoDateTime; orderId: Id }
  | { type: "ORDER_FIRE"; at: IsoDateTime; orderId: Id; course: number | null; hold?: boolean }
  /** FR-POS-037 — let the kitchen start a held course. */
  | { type: "ORDER_RELEASE_HOLD"; at: IsoDateTime; orderId: Id; course: number | null }
  | {
      type: "ORDER_PAY";
      at: IsoDateTime;
      orderId: Id;
      tender: TenderType;
      amountMinor: number;
      /** What the customer physically handed over, cash only — omit for
       *  every other tender, where it always equals `amountMinor`. */
      tenderedMinor?: number;
      tipMinor: number;
      /**
       * FR-POS-066 — whatever the terminal or the cashier supplied. Passed
       * through `retainCardData` before anything is stored, so a full card
       * number here is truncated to its last four rather than kept.
       */
      cardLast4?: string | null;
      cardScheme?: string | null;
      authorisationCode?: string | null;
      terminalReference?: string | null;
    }
  | {
      type: "ORDER_REFUND";
      at: IsoDateTime;
      orderId: Id;
      amountMinor: number;
      reason: string;
      /** FR-POS-073 — a reason from the list, with `reason` as the detail. */
      reasonCode?: string | null;
      returnToStock: boolean;
      /** FR-POS-073 — required above `refundApprovalMinor`. */
      approval?: ApprovalStamp | null;
    }
  /** FR-POS-048 — send an approval to a manager and keep trading. */
  | { type: "APPROVAL_REQUEST"; at: IsoDateTime; request: RemoteApprovalInput }
  | {
      type: "APPROVAL_DECIDE";
      at: IsoDateTime;
      requestId: Id;
      decision: "approved" | "rejected";
      deciderId: Id;
      deciderName: Localised;
      comment: string | null;
    }
  | { type: "APPROVAL_WITHDRAW"; at: IsoDateTime; requestId: Id }
  /** FR-POS-084 — the sections for the terminal's branch, replaced whole. */
  | { type: "SECTIONS_SET"; at: IsoDateTime; sections: ServerSection[] }
  | { type: "TICKET_START"; at: IsoDateTime; ticketId: Id }
  | { type: "TICKET_BUMP_LINE"; at: IsoDateTime; ticketId: Id; lineId: Id }
  | { type: "TICKET_BUMP"; at: IsoDateTime; ticketId: Id }
  | { type: "TICKET_RECALL"; at: IsoDateTime; ticketId: Id; remake?: boolean }
  /** FR-KDS-040 — a station display has shown these tickets. Write-once per ticket. */
  | { type: "TICKET_VIEWED"; at: IsoDateTime; ticketIds: Id[] }
  /** FR-KDS-027 — rush / VIP on the whole order, now and for what it fires later. */
  | { type: "ORDER_PRIORITY"; at: IsoDateTime; orderId: Id; priority: KitchenTicket["priority"] }
  /** FR-KDS-011/023/044 — the console saved the kitchen-display setup. */
  | { type: "KDS_SETUP_SYNC"; at: IsoDateTime; setup: KdsSetup }
  /** FR-POS-082 — push a free table up against a seated one: one party, one bill. */
  | { type: "ORDER_LINK_TABLE"; at: IsoDateTime; orderId: Id; tableId: Id }
  | { type: "ORDER_UNLINK_TABLE"; at: IsoDateTime; orderId: Id; tableId: Id }
  /** A cook has seen the cancellation; the card may now leave the display. */
  | { type: "TICKET_ACK_CANCEL"; at: IsoDateTime; ticketId: Id }
  | { type: "TICKET_PRIORITY"; at: IsoDateTime; ticketId: Id; priority: KitchenTicket["priority"] }
  | { type: "ORDER_SERVE"; at: IsoDateTime; orderId: Id }
  | { type: "TABLE_STATE"; at: IsoDateTime; tableId: Id; state: import("../types").TableState }
  | { type: "ITEM_86"; at: IsoDateTime; menuItemId: Id; reason: string | null }
  /**
   * FR-MNU-031 — a manager lets an 86'd item through for one order.
   *
   * Deliberately not "un-86 it": restoring makes the item available on every
   * order on the terminal, which is a different decision made by a different
   * person for a different reason. This is scoped to the order in hand and
   * expires with it.
   */
  | {
      type: "ITEM_86_OVERRIDE";
      at: IsoDateTime;
      orderId: Id;
      menuItemId: Id;
      approvedBy: Id;
    }
  | { type: "TICK"; at: IsoDateTime; nowMs: number };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function minter(state: LiveState) {
  let seq = state.idSeq;
  return {
    next(prefix: string): string {
      seq += 1;
      return `${prefix}_${String(seq).padStart(6, "0")}`;
    },
    get seq() {
      return seq;
    },
  };
}

/**
 * A stand-in for the SHA-256 chain in FR-AUD-004. It is a real chain — each
 * entry covers the previous hash — but the digest is FNV-1a so it can run
 * synchronously inside a reducer. The tamper-evidence property is the point;
 * the algorithm is the server's to choose.
 */
function chainHash(payload: string, previous: string): string {
  let h = 0x811c9dc5;
  const input = `${previous}|${payload}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").repeat(4);
}

function operatorOf(state: LiveState): { id: Id; name: Localised } {
  if (state.session) {
    return { id: state.session.employeeId, name: state.session.employeeName };
  }
  const fallback = activeEmployees.find((e) => e.homeBranchId === state.branchId) ?? activeEmployees[0];
  return fallback
    ? { id: fallback.id, name: fallback.name }
    : { id: "emp_unknown", name: SYSTEM_ACTOR };
}

function currencyOf(state: LiveState) {
  return branchById.get(state.branchId)?.currency ?? "EGP";
}

function audit(
  state: LiveState,
  mint: ReturnType<typeof minter>,
  input: {
    at: IsoDateTime;
    action: string;
    entityType: string;
    entityId: Id;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reasonCode?: string | null;
    reasonText?: string | null;
    approverName?: Localised | null;
  },
): AuditEntry {
  const operator = operatorOf(state);
  const branch = branchById.get(state.branchId);
  const previousHash = state.audit[0]?.hash ?? "0".repeat(32);
  const id = mint.next("aud");
  const payload = `${input.action}|${input.entityId}|${input.at}|${operator.id}`;

  return {
    id,
    tenantId: branch?.tenantId ?? "tnt_0001",
    branchId: state.branchId,
    branchName: branch?.name ?? null,
    occurredAt: input.at,
    recordedAt: input.at,
    actorId: operator.id,
    actorName: operator.name,
    actorType: "user",
    impersonatedBy: null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    approverName: input.approverName ?? null,
    ipAddress: "127.0.0.1",
    terminalId: state.terminalId,
    correlationId: id,
    hash: chainHash(payload, previousHash),
    previousHash,
  };
}

function withAudit(state: LiveState, entry: AuditEntry): LiveState {
  return { ...state, audit: [entry, ...state.audit].slice(0, 500) };
}

function retotal(state: LiveState, order: Order): Order {
  const pack = packForBranch(state.branchId);
  const recorded = applyLineDiscountRecords(order);
  const withLines = {
    ...recorded,
    lines: recorded.lines.map((line) => {
      const item = menuItemById.get(line.menuItemId);
      return computeLine(line, item?.taxClass ?? "standard", pack);
    }),
  };
  // Line discounts are already inside the lines; only the order's own count here.
  const orderDiscount = withLines.discounts
    .filter((d) => !d.lineId && !d.removedAt)
    .reduce((sum, d) => sum + d.amount.amount, 0);
  return computeOrderTotals(withLines, {
    pack,
    serviceChargePercent:
      order.orderType === "dine_in" ? state.settings.serviceChargePercent : 0,
    serviceChargeTaxable: state.settings.serviceChargeTaxable,
    orderDiscountAmountMinor: orderDiscount,
  });
}

function putOrder(state: LiveState, order: Order): LiveState {
  return { ...state, orders: { ...state.orders, [order.id]: order } };
}

/** A line's price before any discount: unit plus modifiers, times quantity. */
function grossOf(line: OrderLine): number {
  return (line.unitPrice.amount + line.modifiers.reduce((s, m) => s + m.priceDelta.amount, 0)) * line.quantity;
}

/**
 * FR-POS-045/049 — a line's discount is the sum of its discount records.
 *
 * A percentage record is re-taken from the line's current gross, so a 10%
 * discount on a burger stays 10% when a second burger is added; an amount
 * record stays the amount. Lines with no record at all keep whatever
 * discount they already carry, which is how orders written before records
 * existed survive a migration untouched.
 */
function applyLineDiscountRecords(order: Order): Order {
  const byLine = new Map<Id, OrderDiscount[]>();
  for (const record of order.discounts) {
    if (!record.lineId) continue;
    const list = byLine.get(record.lineId) ?? [];
    list.push(record);
    byLine.set(record.lineId, list);
  }
  if (byLine.size === 0) return order;

  const discounts = order.discounts.map((record) => {
    if (!record.lineId || record.removedAt || record.percentage == null) return record;
    const line = order.lines.find((l) => l.id === record.lineId);
    if (!line) return record;
    return { ...record, amount: money(Math.round((grossOf(line) * record.percentage) / 100), order.currency) };
  });

  const lines = order.lines.map((line) => {
    const records = discounts.filter((d) => d.lineId === line.id);
    if (records.length === 0) return line;
    const total = records.filter((d) => !d.removedAt).reduce((s, d) => s + d.amount.amount, 0);
    return { ...line, lineDiscount: money(Math.min(total, grossOf(line)), order.currency) };
  });

  return { ...order, lines, discounts };
}

/** Discounts in force: not removed, and not on a line that has since been voided. */
export function activeDiscountsOf(order: Order): OrderDiscount[] {
  return order.discounts.filter((d) => {
    if (d.removedAt) return false;
    if (!d.lineId) return true;
    const line = order.lines.find((l) => l.id === d.lineId);
    return Boolean(line) && line!.state !== "voided" && !line!.isComp;
  });
}

/** Whether the till may still change what is on the order. */
export function isEditable(order: Order): boolean {
  return !["completed", "cancelled", "refunded", "partially_refunded", "merged", "parked"].includes(order.state);
}

/**
 * FR-POS-048 / FR-SEC-016 — whether an approval stamp may be acted on.
 *
 * A PIN or card stamp names an employee who must still be an approver at
 * this branch and must not be the operator. A remote stamp is good only if
 * it points at a request this store holds as approved by the same person —
 * the decision is the evidence, not the stamp.
 */
function approvalOk(state: LiveState, stamp: ApprovalStamp | null | undefined): stamp is ApprovalStamp {
  if (!stamp) return false;
  const requesterId = operatorOf(state).id;
  if (stamp.method === "remote") {
    const request = state.approvals.find((r) => r.id === stamp.requestId);
    return (
      Boolean(request) &&
      request!.status === "approved" &&
      request!.decidedBy === stamp.approverId &&
      stamp.approverId !== requesterId
    );
  }
  return stampValid(stamp, { branchId: state.branchId, requesterId });
}

/**
 * FR-POS-075 — the order as the audit trail records it, before and after.
 *
 * "Full before/after state" is read as everything a reviewer needs to see
 * what a void, cancellation or refund changed: every line with its state and
 * money, the totals, and every payment. Ids are kept so an entry can be
 * matched to the ledger; names are English so the trail reads the same
 * whichever language the till was in.
 */
export function orderSnapshot(order: Order): Record<string, unknown> {
  return {
    orderNumber: order.orderNumber,
    state: order.state,
    orderType: order.orderType,
    table: order.tableLabel,
    lines: order.lines.map((line) => ({
      id: line.id,
      item: line.itemNameSnapshot.en,
      quantity: line.quantity,
      state: line.state,
      comp: line.isComp,
      discount: line.lineDiscount.amount,
      total: line.lineTotal.amount,
      ...(line.voidReason ? { voidReason: line.voidReason } : {}),
    })),
    subtotal: order.subtotal.amount,
    discountTotal: order.discountTotal.amount,
    serviceCharge: order.serviceChargeTotal.amount,
    tax: order.taxTotal.amount,
    grandTotal: order.grandTotal.amount + order.roundingAdjustment.amount,
    paidTotal: order.paidTotal.amount,
    payments: order.payments.map((p) => ({
      id: p.id,
      tender: p.tender,
      amount: p.amount.amount,
      ...(p.cardLast4 ? { cardLast4: p.cardLast4 } : {}),
    })),
  };
}

/**
 * FR-POS-025/026 — a note as the branch allows it, and never a card number.
 *
 * With free-text notes switched off, only the configured chips survive: the
 * note is split on the separator the chips are joined with, and any part
 * that is not a chip in either language is dropped. The chips are the
 * point of the switch — "no ice" still reaches the bar, "call me Dave" does
 * not reach the grill.
 */
function noteForPolicy(note: string | null, settings: LiveState["settings"]): string | null {
  if (note == null) return null;
  let text = redactCardData(note).trim();
  if (!settings.lineNotes) {
    const chips = new Set(settings.noteChips.flatMap((chip) => [chip.en.trim(), chip.ar.trim()]));
    text = text
      .split(NOTE_SEPARATOR.trim())
      .map((part) => part.trim())
      .filter((part) => chips.has(part))
      .join(NOTE_SEPARATOR);
  }
  return text.slice(0, 140) || null;
}

/** How note chips are joined on a line — shared with the till's note sheet. */
export const NOTE_SEPARATOR = " · ";

/** Every table an order occupies: its own and any merged into it. */
function tablesOfOrder(order: Order): Id[] {
  return [order.tableId, ...(order.linkedTableIds ?? [])].filter((id): id is Id => Boolean(id));
}

function releaseTables(state: LiveState, order: Order): LiveState {
  let next = state;
  for (const tableId of tablesOfOrder(order)) {
    next = setTable(next, tableId, { state: "needs_cleaning", orderId: null, seatedAt: null });
  }
  return next;
}

/** FR-POS-084 — the section a table belongs to at this branch, if any. */
export function sectionOfTable(state: LiveState, tableId: Id | null): ServerSection | null {
  if (!tableId) return null;
  return state.sections.find((s) => s.branchId === state.branchId && s.tableIds.includes(tableId)) ?? null;
}

function setTable(
  state: LiveState,
  tableId: Id | null,
  patch: Partial<import("../types").RestaurantTable>,
): LiveState {
  if (!tableId) return state;
  const current = state.tableStates[tableId] ?? seededTables.find((t) => t.id === tableId);
  if (!current) return state;
  return {
    ...state,
    tableStates: { ...state.tableStates, [tableId]: { ...current, ...patch } },
  };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * FR-INV-042 — what leaving stock costs, according to the item's method.
 *
 * Returns the cost of the movement in minor units and the layers that remain
 * afterwards. The three methods differ only in which layers they draw from:
 *
 *   fifo              oldest arrivals first, at the price they arrived at
 *   weighted_average  the pooled average of everything on hand
 *   standard          the catalogue cost, ignoring what was actually paid
 *
 * Stock going *in* is always a new layer at its own cost, whatever the
 * method — that is the record the other two are computed from.
 *
 * Issuing more than the layers hold is normal here, because negative stock
 * is recorded rather than blocked. The shortfall is priced at the last cost
 * known for the item, which is the closest thing to the truth available.
 */
function consumeCost(
  layers: CostLayer[],
  quantity: number,
  method: CostingMethod,
  fallbackMinor: number,
): { costMinor: number; layers: CostLayer[] } {
  if (quantity > 0) {
    return {
      costMinor: Math.round(quantity * fallbackMinor),
      layers: [...layers, { qty: quantity, costMinor: fallbackMinor }],
    };
  }

  const wanted = Math.abs(quantity);
  if (wanted === 0) return { costMinor: 0, layers };

  if (method === "standard") {
    // Standard costing does not care what was paid, but the layers still
    // have to be drawn down or the on-hand basis drifts from the balance.
    return { costMinor: Math.round(wanted * fallbackMinor), layers: drawDown(layers, wanted) };
  }

  const onHand = layers.reduce((sum, l) => sum + l.qty, 0);

  if (method === "weighted_average") {
    const value = layers.reduce((sum, l) => sum + l.qty * l.costMinor, 0);
    const average = onHand > 0 ? value / onHand : fallbackMinor;
    return { costMinor: Math.round(wanted * average), layers: drawDown(layers, wanted) };
  }

  // FIFO — walk the layers oldest first, taking what each can give.
  let remaining = wanted;
  let cost = 0;
  const rest: CostLayer[] = [];

  for (const layer of layers) {
    if (remaining <= 0) {
      rest.push(layer);
      continue;
    }
    const taken = Math.min(layer.qty, remaining);
    cost += taken * layer.costMinor;
    remaining -= taken;
    if (layer.qty > taken) rest.push({ ...layer, qty: layer.qty - taken });
  }

  // Whatever the layers could not cover went out anyway.
  if (remaining > 0) {
    const last = layers[layers.length - 1]?.costMinor ?? fallbackMinor;
    cost += remaining * last;
  }

  return { costMinor: Math.round(cost), layers: rest };
}

/** Reduces layers by a quantity without pricing it — oldest first. */
function drawDown(layers: CostLayer[], quantity: number): CostLayer[] {
  let remaining = quantity;
  const rest: CostLayer[] = [];
  for (const layer of layers) {
    if (remaining <= 0) {
      rest.push(layer);
      continue;
    }
    const taken = Math.min(layer.qty, remaining);
    remaining -= taken;
    if (layer.qty > taken) rest.push({ ...layer, qty: layer.qty - taken });
  }
  return rest;
}

/**
 * Applies signed stock deltas and writes the ledger entries behind them.
 *
 * Negative stock is recorded, never blocked — UC-POS-01 alt-flow 13a. The
 * food left the building; refusing to write that down because the count was
 * already wrong just moves the error somewhere harder to find.
 */
function applyStock(
  state: LiveState,
  mint: ReturnType<typeof minter>,
  deltas: { itemId: Id; quantity: number; costMinor: number }[],
  meta: {
    at: IsoDateTime;
    movementType: StockMovement["movementType"];
    referenceType: string;
    referenceId: Id;
    reasonCode?: string | null;
    notes?: string | null;
  },
): LiveState {
  if (deltas.length === 0) return state;

  const operator = operatorOf(state);
  const branch = branchById.get(state.branchId);
  const locationId = state.branchId;
  const stock = { ...state.stock };
  const costLayers = { ...state.costLayers };
  const movements: StockMovement[] = [];
  let alerts = state.alerts;

  for (const delta of deltas) {
    const stockItem = stockItemById.get(delta.itemId);
    if (!stockItem) continue;
    const key = stockKey(locationId, delta.itemId);
    const before = stock[key] ?? 0;
    const after = before + delta.quantity;
    stock[key] = after;

    // UC-POS-01 alt-flow 13a — the sale is never blocked, but crossing zero
    // is the moment somebody has to be told. Raised on the crossing and on
    // every step further down, keyed by item so one line does not stack.
    if (after < 0) {
      alerts = upsertAlert(alerts, {
        id: mint.next("alt"),
        key: `negative_stock:${locationId}:${delta.itemId}`,
        kind: "negative_stock",
        severity: before >= 0 ? "medium" : "high",
        at: meta.at,
        subjectId: delta.itemId,
        subjectName: stockItem.name,
        value: after,
        unit: stockItem.baseUnit,
        acknowledged: false,
      });
    }

    // The caller's `costMinor` is the recipe's snapshot cost. What the stock
    // actually cost is decided here, by the item's own costing method.
    const priced = consumeCost(
      costLayers[key] ?? [],
      delta.quantity,
      stockItem.costingMethod,
      stockItem.unitCost.amount,
    );
    costLayers[key] = priced.layers;
    const movementCost = Math.abs(priced.costMinor);
    const perUnit =
      Math.abs(delta.quantity) > 0
        ? Math.round(movementCost / Math.abs(delta.quantity))
        : stockItem.unitCost.amount;

    movements.push({
      id: mint.next("mov"),
      tenantId: branch?.tenantId ?? "tnt_0001",
      locationId,
      locationName: branch?.name ?? { en: "Branch", ar: "الفرع" },
      itemId: delta.itemId,
      itemName: stockItem.name,
      batchId: null,
      movementType: meta.movementType,
      quantity: { value: delta.quantity.toFixed(6), unit: stockItem.baseUnit },
      unitCost: money(perUnit, stockItem.unitCost.currency),
      totalCost: money(movementCost, stockItem.unitCost.currency),
      balanceAfter: { value: after.toFixed(6), unit: stockItem.baseUnit },
      referenceType: meta.referenceType,
      referenceId: meta.referenceId,
      counterpartMovementId: null,
      occurredAt: meta.at,
      recordedAt: meta.at,
      performedBy: operator.id,
      performedByName: operator.name,
      reasonCode: meta.reasonCode ?? null,
      notes: meta.notes ?? null,
    });
  }

  return {
    ...state,
    stock,
    costLayers,
    alerts,
    movements: [...movements, ...state.movements].slice(0, 800),
  };
}

/**
 * FR-MNU-031 — whether an 86'd item has been approved onto this order.
 *
 * An item that is not 86'd at all is trivially sellable; the override only
 * matters for one that is.
 */
export function isOverridden(
  state: LiveState,
  orderId: Id | null,
  menuItemId: Id,
): boolean {
  if (!orderId) return false;
  return state.overrides.some(
    (o) => o.orderId === orderId && o.menuItemId === menuItemId,
  );
}

function depletionFor(line: OrderLine) {
  return expandLineToStock(line, recipeById, modifierMap());
}

/** FR-POS-040 — the item's price for this order, now. */
function priceFor(
  state: LiveState,
  order: Order,
  item: MenuItem,
  variant: MenuItemVariant,
  at: IsoDateTime,
  overrideMinor: number | null,
) {
  const branch = branchById.get(state.branchId)!;
  return resolvePrice(item, variant, {
    orderType: order.orderType,
    branchId: branch.id,
    brandId: branch.brandId,
    minuteOfDay: minuteOfDayFrom(at),
    priceLists,
    overrideMinor,
  });
}

/** The modifiers an item goes on with when nobody chooses: its groups' defaults. */
function defaultModifierIds(item: MenuItem): Id[] {
  return modifierGroupsForItem(item).flatMap((g) => g.modifiers.filter((m) => m.isDefault).map((m) => m.id));
}

function buildLine(
  state: LiveState,
  mint: ReturnType<typeof minter>,
  order: Order,
  input: {
    item: MenuItem;
    variant: MenuItemVariant;
    quantity: number;
    modifierIds: Id[];
    priceRules?: ModifierPriceRules;
    course: number;
    seatNumber: number | null;
    notes: string | null;
    unitPrice: Money;
    priceSource: OrderLinePriceSource;
    combo: OrderLine["combo"];
    sequence: number;
  },
): OrderLine {
  const currency = currencyOf(state);
  const catalogue = modifierMap();
  // FR-POS-022 — the context this line is priced in. The price list is the
  // one that priced the item, so a list that charges for a modifier only
  // where it also changes the item's price stays coherent.
  const priceContext: ModifierPriceContext = {
    orderType: order.orderType,
    branchId: state.branchId,
    priceListId: input.priceSource.priceListId,
  };
  const modifiers: OrderLineModifier[] = input.modifierIds
    .map((id) => catalogue.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => {
      // The rule that priced it is kept on the line, so a receipt query can
      // say why this modifier cost what it did.
      const priced = resolveModifierDelta(m, [...(input.priceRules ?? [])], priceContext);
      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        priceDelta: money(priced.priceDelta.amount, currency),
        priceRuleId: priced.ruleId,
      };
    });

  const recipe = input.variant.recipeId ? recipeById.get(input.variant.recipeId) : undefined;
  const unitCost = recipe?.computedCost.amount ?? 0;

  return {
    id: mint.next("oln"),
    sequence: input.sequence,
    menuItemId: input.item.id,
    variantId: input.variant.id,
    // BR-POS-004 — the name is snapshotted, never re-derived from master data.
    itemNameSnapshot: {
      en: `${input.item.name.en} — ${input.variant.name.en}`,
      ar: `${input.item.name.ar} — ${input.variant.name.ar}`,
    },
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    modifiers,
    modifierTotal: money(0, currency),
    lineDiscount: money(0, currency),
    lineSubtotal: money(0, currency),
    taxAmount: money(0, currency),
    lineTotal: money(0, currency),
    unitCostSnapshot: money(unitCost, currency),
    recipeVersionId: input.variant.recipeId,
    course: input.course,
    seatNumber: input.seatNumber,
    state: "pending",
    stationId: null,
    firedAt: null,
    readyAt: null,
    voidReason: null,
    isComp: false,
    notes: noteForPolicy(input.notes, state.settings),
    // FR-POS-042 — which rule produced the price, kept for audit and reports.
    priceSource: input.priceSource,
    combo: input.combo,
  };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function ticketLineFrom(
  line: OrderLine,
  setup: KdsSetup,
  extras: { at: IsoDateTime; routedAt: IsoDateTime; addedAt: IsoDateTime | null; alsoAt: Localised[] },
): TicketLine {
  const item = menuItemById.get(line.menuItemId);
  return {
    id: line.id,
    name: item?.kitchenName ?? line.itemNameSnapshot,
    quantity: line.quantity,
    modifiers: line.modifiers.map((m) => ({ name: m.name, kind: m.kind })),
    state: line.state,
    notes: line.notes,
    // FR-KDS-029 — set when the till strikes the line off, so the display's
    // visibility window runs from the cancellation.
    cancelledAt: null,
    seatNumber: line.seatNumber,
    // FR-KDS-031 — lets an icon display show the item's picture.
    menuItemId: line.menuItemId,
    // FR-KDS-044 — the item's own target, configured or the recipe's prep time.
    targetSeconds: itemTargetSeconds(setup, line.menuItemId, item?.prepTimeSeconds),
    // FR-KDS-011 — the cook can see the same line is also being made elsewhere.
    alsoAt: extras.alsoAt,
    // FR-KDS-028 — an addition is marked on the line itself, not only on the card.
    addedAt: extras.addedAt,
    // FR-KDS-040 — created when the till fired it, routed when it reached the station.
    timeline: { ...stamp(undefined, "createdAt", extras.at), routedAt: extras.routedAt },
  };
}

/**
 * FR-KDS-012 — how long a packaging station needs. Packing is the last step,
 * so its ticket is released this long before the rest of the order is due.
 */
const PACKAGING_SECONDS = 90;

/**
 * Fires a set of lines: routes each to its station, then either amends the
 * station's open ticket or opens a new one.
 *
 * FR-POS-038 — an addition to a fired order amends the existing ticket. It
 * must never look like a fresh one, or the kitchen makes everything twice.
 */
function fireLines(
  state: LiveState,
  mint: ReturnType<typeof minter>,
  order: Order,
  lineIds: Set<Id>,
  at: IsoDateTime,
  options: { hold?: boolean } = {},
): { state: LiveState; order: Order } {
  const hold = options.hold === true;
  const branchStations = stationsByBranch.get(state.branchId) ?? [];
  const setup = state.kdsSetup ?? normaliseKdsSetup(null);
  const byStation = new Map<Id, OrderLine[]>();
  /** FR-KDS-011 — every station each line went to, primary first. */
  const stationsOfLine = new Map<Id, Id[]>();

  const lines = order.lines.map((line) => {
    if (!lineIds.has(line.id) || line.state !== "pending") return line;
    const item = menuItemById.get(line.menuItemId);
    const station = routeLine(line, item, branchStations);
    const fired: OrderLine = {
      ...line,
      state: "fired",
      firedAt: at,
      stationId: station?.id ?? null,
      held: hold,
    };
    if (station) {
      const targets = [station.id];
      /*
       * FR-KDS-011 — one line, several stations. A burger is cooked on the
       * grill and boxed at packaging; both stations get the line, and the
       * order only counts it ready once every one of them has marked it.
       */
      for (const type of extraStationTypes(setup, line.menuItemId, order.orderType)) {
        const extra = branchStations.find((s) => s.active && s.type === type && s.type !== "pass");
        if (extra && !targets.includes(extra.id)) targets.push(extra.id);
      }
      stationsOfLine.set(line.id, targets);
      for (const stationId of targets) {
        const list = byStation.get(stationId) ?? [];
        list.push(fired);
        byStation.set(stationId, list);
      }
    }
    return fired;
  });

  let next = state;
  const tickets = { ...next.tickets };
  const ticketIds = [...next.ticketIds];

  const stationTarget = (stationId: Id, stationLines: OrderLine[]) => {
    const station = branchStations.find((s) => s.id === stationId);
    if (station?.type === "packaging") return PACKAGING_SECONDS;
    return Math.max(
      ...stationLines.map((l) => itemTargetSeconds(setup, l.menuItemId, menuItemById.get(l.menuItemId)?.prepTimeSeconds)),
    );
  };
  /** FR-KDS-012 — the longest preparation in this firing; everything finishes with it. */
  const batchSeconds = Math.max(0, ...[...byStation.entries()].map(([id, list]) => stationTarget(id, list)));
  const stagger = state.settings.staggeredRelease && !hold;

  for (const [stationId, stationLines] of byStation) {
    const station = branchStations.find((s) => s.id === stationId)!;
    const course = stationLines[0]!.course;
    const targetSeconds = stationTarget(stationId, stationLines);

    /*
     * FR-KDS-012 — staggered release. target_ready = fire_time + the longest
     * prep in the firing, so a ticket with a shorter prep is released that
     * much later. `firedAt` is the release moment — the clock starts then —
     * and the display shows the card as scheduled until it arrives.
     */
    const offset = stagger ? releaseOffsetSeconds(targetSeconds, batchSeconds) : 0;
    const releaseAt = offset > 0 ? new Date(Date.parse(at) + offset * 1000).toISOString() : at;

    /*
     * FR-POS-038 — lines added to a course this station has already been
     * sent go out as their own ticket, marked as an addition, so the printer
     * never reprints the whole order. FR-KDS-028 — the display folds that
     * ticket into the card it amends (`amendsTicketId`) rather than showing
     * the kitchen a second card.
     */
    const amends = ticketIds
      .map((id) => tickets[id]!)
      .find(
        (t) =>
          t.orderId === order.id &&
          t.stationId === stationId &&
          t.course === course &&
          t.state !== "cancelled",
      );
    const amendment = amends !== undefined;

    const id = mint.next("tkt");
    tickets[id] = {
      id,
      branchId: state.branchId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableLabel: order.tableLabel,
      stationId,
      stationName: station.name,
      state: "queued",
      urgency: "on_target",
      course,
      // FR-KDS-027 — the order's own flag, or rush for delivery by default.
      priority: state.priorities?.[order.id] ?? (order.orderType === "delivery" ? "rush" : "normal"),
      firedAt: releaseAt,
      startedAt: null,
      bumpedAt: null,
      cancelReason: null,
      targetSeconds,
      elapsedSeconds: 0,
      lines: stationLines.map((line) =>
        ticketLineFrom(line, setup, {
          at,
          routedAt: releaseAt,
          addedAt: amendment ? at : null,
          alsoAt: (stationsOfLine.get(line.id) ?? [])
            .filter((other) => other !== stationId)
            .map((other) => branchStations.find((s) => s.id === other)?.name)
            .filter((name): name is Localised => Boolean(name)),
        }),
      ),
      held: hold,
      amendment,
      amendsTicketId: amends?.id ?? null,
      // FR-KDS-040 — created at the fire, routed when released to the station.
      timeline: { ...stamp(undefined, "createdAt", at), routedAt: hold ? null : releaseAt },
    };
    ticketIds.unshift(id);
  }

  next = { ...next, tickets, ticketIds };

  // Depletion happens here, at the moment the kitchen is told to produce.
  const deltas = new Map<Id, { quantity: number; costMinor: number }>();
  for (const line of lines) {
    if (!lineIds.has(line.id) || line.firedAt !== at) continue;
    for (const d of depletionFor(line)) {
      const existing = deltas.get(d.itemId);
      deltas.set(d.itemId, {
        quantity: (existing?.quantity ?? 0) + d.quantity,
        costMinor: (existing?.costMinor ?? 0) + d.costMinor,
      });
    }
  }

  next = applyStock(
    next,
    mint,
    [...deltas.entries()].map(([itemId, v]) => ({ itemId, ...v })),
    {
      at,
      movementType: "sale_depletion",
      referenceType: "order",
      referenceId: order.id,
      notes: `Fired on ${order.orderNumber}`,
    },
  );

  const firedOrder: Order = {
    ...order,
    lines,
    state: order.state === "draft" ? "open" : order.state,
    firstFiredAt: order.firstFiredAt ?? at,
  };

  return { state: next, order: firedOrder };
}

/** Marks a line ready on the order behind a ticket, and serves it once every station is done. */
function syncOrderFromTickets(state: LiveState, orderId: Id, at: IsoDateTime): LiveState {
  const order = state.orders[orderId];
  if (!order) return state;

  /*
   * FR-KDS-011 — a line routed to several stations is ready only when every
   * one of them has it ready. Grill finishing the burger does not make it
   * ready while packaging has not boxed it.
   */
  const lineReady = new Map<Id, boolean>();
  for (const id of state.ticketIds) {
    const ticket = state.tickets[id];
    if (!ticket || ticket.orderId !== orderId || ticket.state === "cancelled") continue;
    for (const line of ticket.lines) {
      const ready = line.state === "ready" || line.state === "served" || ticket.state === "bumped";
      lineReady.set(line.id, (lineReady.get(line.id) ?? true) && ready);
    }
  }
  const readyLineIds = new Set([...lineReady.entries()].filter(([, ready]) => ready).map(([id]) => id));

  const lines = order.lines.map((line) =>
    readyLineIds.has(line.id) && (line.state === "fired" || line.state === "preparing")
      ? { ...line, state: "ready" as const, readyAt: at }
      : line,
  );

  return putOrder(state, { ...order, lines });
}

// ---------------------------------------------------------------------------
// Cash session
// ---------------------------------------------------------------------------

function recomputeSession(state: LiveState): LiveState {
  if (!state.session) return state;
  const currency = currencyOf(state);
  const session = state.session;

  let cashSales = 0;
  let cashRefunds = 0;
  let cardSales = 0;
  let otherSales = 0;
  let refundTotal = 0;
  let orderCount = 0;
  let cancelledOrderCount = 0;
  let grossSales = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let serviceChargeTotal = 0;

  for (const id of state.orderIds) {
    const order = state.orders[id];
    if (!order) continue;

    if (order.state === "completed" || order.state === "partially_refunded" || order.state === "refunded") {
      orderCount += 1;
      grossSales += order.subtotal.amount;
      discountTotal += order.discountTotal.amount;
      taxTotal += order.taxTotal.amount;
      serviceChargeTotal += order.serviceChargeTotal.amount;
    } else if (order.state === "cancelled") {
      cancelledOrderCount += 1;
    }

    for (const payment of order.payments) {
      const amount = payment.amount.amount;
      if (amount >= 0) {
        if (payment.tender === "cash") cashSales += amount;
        else if (payment.tender === "card") cardSales += amount;
        else otherSales += amount;
      } else {
        refundTotal += -amount;
        if (payment.tender === "cash") cashRefunds += -amount;
      }
    }
  }

  const netSales = grossSales - discountTotal + serviceChargeTotal;

  const payIns = session.movements
    .filter((m) => m.kind === "pay_in")
    .reduce((s, m) => s + m.amount.amount, 0);
  const payOuts = session.movements
    .filter((m) => m.kind === "pay_out")
    .reduce((s, m) => s + m.amount.amount, 0);
  const safeDrops = session.movements
    .filter((m) => m.kind === "safe_drop")
    .reduce((s, m) => s + m.amount.amount, 0);

  const expected =
    session.openingFloat.amount + cashSales - cashRefunds + payIns - payOuts - safeDrops;

  return {
    ...state,
    session: {
      ...session,
      cashSales: money(cashSales, currency),
      cashRefunds: money(cashRefunds, currency),
      payIns: money(payIns, currency),
      payOuts: money(payOuts, currency),
      safeDrops: money(safeDrops, currency),
      expectedCash: money(expected, currency),
      variance:
        session.countedCash != null
          ? money(session.countedCash.amount - expected, currency)
          : money(0, currency),
      orderCount,
      grossSales: money(grossSales, currency),
      discountTotal: money(discountTotal, currency),
      taxTotal: money(taxTotal, currency),
      serviceChargeTotal: money(serviceChargeTotal, currency),
      netSales: money(netSales, currency),
      cardSales: money(cardSales, currency),
      otherSales: money(otherSales, currency),
      refundTotal: money(refundTotal, currency),
      cancelledOrderCount,
    },
  };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Every action, then promotions brought into line — FR-CRM-027.
 *
 * Promotions are re-evaluated after any action rather than inside each case,
 * so no line, customer, order-type or discount change can leave an order
 * carrying a promotion it no longer qualifies for (or missing one it now
 * does). Evaluation is idempotent: an order whose inputs did not change
 * comes back as the same object.
 */
export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const next = reduceAction(state, action);
  if (next === state || action.type === "TICK") return next;
  return reconcilePromotions(next, action.at);
}

function reconcilePromotions(state: LiveState, at: IsoDateTime): LiveState {
  const book = state.promotionBook;
  const contexts = state.orderPromotions ?? {};
  let orders: LiveState["orders"] | null = null;
  let nextContexts: Record<Id, OrderPromotionState> | null = null;
  let redemptions: ReturnType<typeof redemptionsFor> | null = null;
  const categoryOf = (menuItemId: Id) => menuItemById.get(menuItemId)?.categoryId ?? null;

  for (const orderId of state.orderIds) {
    const order = state.orders[orderId];
    // Once payment has started the bill is fixed: a promotion appearing or
    // lapsing mid-tender would move the balance under the cashier.
    if (!order || !isEditable(order) || order.paidTotal.amount > 0) continue;
    const previous = contexts[orderId];
    if (!previous && order.lines.length === 0) continue;
    redemptions ??= redemptionsFor(book, state.orders, contexts);
    const outcome = reconcileOrderPromotions(order, previous, {
      at,
      saleTime: saleTimeOf(order.openedAt, branchById.get(order.branchId)?.timezone),
      book,
      redemptions,
      policy: state.settings.discountStacking,
      categoryOf,
    });
    if (!outcome) continue;
    nextContexts ??= { ...contexts };
    nextContexts[orderId] = outcome.context;
    if (outcome.order !== order) {
      orders ??= { ...state.orders };
      orders[orderId] = retotal(state, outcome.order);
    }
  }

  if (!orders && !nextContexts) return state;
  return {
    ...state,
    orders: orders ?? state.orders,
    orderPromotions: nextContexts ?? contexts,
  };
}

function reduceAction(state: LiveState, action: LiveAction): LiveState {
  const mint = minter(state);
  const currency = currencyOf(state);
  const pack = packForBranch(state.branchId);

  const commit = (next: LiveState): LiveState => ({ ...next, idSeq: mint.seq });

  switch (action.type) {
    // -----------------------------------------------------------------------
    case "RESET":
      // The kitchen-display setup is configuration, not shift data; it survives a reset.
      return {
        ...initialLiveState(action.branchId ?? state.branchId),
        kdsSetup: state.kdsSetup,
        promotionBook: state.promotionBook,
      };

    case "SET_BRANCH": {
      if (action.branchId === state.branchId) return state;
      const fresh = initialLiveState(action.branchId);
      // Stock, ledger and settings survive a branch change; open work does not.
      return {
        ...fresh,
        stock: state.stock,
        movements: state.movements,
        waste: state.waste,
        audit: state.audit,
        closedSessions: state.closedSessions,
        settings: state.settings,
        unavailable: state.unavailable,
        // Both are keyed by branch, so another branch's rows are simply not shown.
        sections: state.sections,
        approvals: state.approvals,
        kdsSetup: state.kdsSetup,
        promotionBook: state.promotionBook,
        idSeq: state.idSeq,
      };
    }

    case "SET_TERMINAL":
      return { ...state, terminalId: action.terminalId };

    case "SET_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    // --- shift -------------------------------------------------------------
    case "SHIFT_OPEN": {
      if (state.session) return state;
      const employee = employeeById.get(action.employeeId) ?? activeEmployees[0]!;
      const branch = branchById.get(state.branchId)!;
      const terminal = terminals.find((t) => t.id === state.terminalId);
      const id = mint.next("csh");

      const session: LiveCashSession = {
        id,
        tenantId: branch.tenantId,
        branchId: branch.id,
        branchName: branch.name,
        drawerId: state.terminalId,
        drawerName: terminal?.name ?? "Drawer 1",
        terminalName: terminal?.name ?? "POS 1",
        employeeId: employee.id,
        employeeName: employee.name,
        status: "open",
        openedAt: action.at,
        closedAt: null,
        businessDay: state.businessDay,
        openingFloat: money(action.openingFloatMinor, currency),
        cashSales: money(0, currency),
        cashRefunds: money(0, currency),
        payIns: money(0, currency),
        payOuts: money(0, currency),
        safeDrops: money(0, currency),
        expectedCash: money(action.openingFloatMinor, currency),
        countedCash: null,
        variance: money(0, currency),
        varianceApproval: "not_required",
        denominations: [],
        orderCount: 0,
        grossSales: money(0, currency),
        discountTotal: money(0, currency),
        taxTotal: money(0, currency),
        serviceChargeTotal: money(0, currency),
        netSales: money(0, currency),
        cardSales: money(0, currency),
        otherSales: money(0, currency),
        refundTotal: money(0, currency),
        cancelledOrderCount: 0,
        movements: [],
        blindCount: state.settings.blindCount,
      };

      const next = withAudit({ ...state, session }, audit(state, mint, {
        at: action.at,
        action: "cash.session.opened",
        entityType: "cash_session",
        entityId: id,
        after: { openingFloat: action.openingFloatMinor, employee: employee.name.en },
      }));
      return commit(next);
    }

    case "SHIFT_CASH": {
      if (!state.session) return state;
      const record = {
        id: mint.next("csm"),
        kind: action.kind,
        amount: money(action.amountMinor, currency),
        reason: action.reason,
        at: action.at,
      };
      const next = recomputeSession({
        ...state,
        session: { ...state.session, movements: [...state.session.movements, record] },
      });
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: `cash.${action.kind}`,
          entityType: "cash_session",
          entityId: state.session.id,
          after: { amount: action.amountMinor },
          reasonText: action.reason,
        })),
      );
    }

    case "SHIFT_CLOSE": {
      if (!state.session) return state;
      const counted = action.denominations.reduce((sum, d) => sum + d.value * d.count, 0);
      const expected = state.session.expectedCash.amount;
      const variance = counted - expected;
      // FR-POS-096 — a variance past tolerance needs a reason and a manager.
      const tolerance = 2_000;
      const needsApproval = Math.abs(variance) > tolerance;

      const closed: LiveCashSession = {
        ...state.session,
        status: "closed",
        closedAt: action.at,
        countedCash: money(counted, currency),
        variance: money(variance, currency),
        varianceApproval: needsApproval
          ? action.acknowledgedByName
            ? "approved"
            : "pending"
          : "not_required",
        denominations: action.denominations,
      };

      const next: LiveState = {
        ...state,
        session: null,
        closedSessions: [closed, ...state.closedSessions],
      };

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "cash.session.closed",
          entityType: "cash_session",
          entityId: closed.id,
          before: { expected },
          after: { counted, variance },
          reasonText: action.varianceReason,
          approverName: action.acknowledgedByName,
        })),
      );
    }

    // --- orders ------------------------------------------------------------
    case "ORDER_NEW": {
      // FR-POS-090 — no shift, no sales.
      if (!state.session) return state;
      const branch = branchById.get(state.branchId)!;
      const terminal = terminals.find((t) => t.id === state.terminalId);
      const operator = operatorOf(state);
      const id = mint.next("ord");
      const seq = state.numberSeq;
      const table = action.tableId
        ? (state.tableStates[action.tableId] ?? seededTables.find((t) => t.id === action.tableId))
        : null;

      // FR-POS-084 — in restrict mode a table in someone else's section needs
      // a manager to say so. Checked here as well as on the floor, so a stale
      // screen or a second tab cannot open it anyway.
      const section = sectionOfTable(state, action.tableId);
      const outsideSection =
        state.settings.sectionMode === "restrict" &&
        section?.serverId != null &&
        section.serverId !== operator.id;
      if (outsideSection && !approvalOk(state, action.sectionOverride)) return state;

      // FR-POS-007 — the section's server serves the table; otherwise whoever opened it.
      const server =
        section?.serverId && section.serverName
          ? { id: section.serverId, name: section.serverName }
          : operator;

      const order: Order = {
        id,
        tenantId: branch.tenantId,
        branchId: branch.id,
        branchName: branch.name,
        terminalId: state.terminalId,
        terminalName: terminal?.name ?? "POS 1",
        // FR-POS-002 — drawn from this terminal's local block, no server needed.
        orderNumber: `${branch.code}-${String(seq).padStart(4, "0")}`,
        businessDay: state.businessDay,
        orderType: action.orderType,
        channel: "pos",
        state: "draft",
        tableId: action.tableId,
        tableLabel: table?.label ?? null,
        guestCount: action.guestCount,
        customerId: null,
        customerName: null,
        openedBy: operator.id,
        openedByName: operator.name,
        servedBy: server.id,
        servedByName: server.name,
        closedBy: null,
        closedByName: null,
        parked: null,
        currency,
        subtotal: money(0, currency),
        discountTotal: money(0, currency),
        serviceChargeTotal: money(0, currency),
        taxTotal: money(0, currency),
        roundingAdjustment: money(0, currency),
        grandTotal: money(0, currency),
        paidTotal: money(0, currency),
        tipTotal: money(0, currency),
        cogsTotal: money(0, currency),
        lines: [],
        payments: [],
        discounts: [],
        openedAt: action.at,
        firstFiredAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        syncState: "local",
        syncedAt: null,
        aggregatorRef: null,
        notes: null,
        // No server, so no optimistic-concurrency token to carry.
        version: null,
      };

      let next: LiveState = {
        ...state,
        numberSeq: seq + 1,
        orders: { ...state.orders, [id]: order },
        orderIds: [id, ...state.orderIds],
        activeOrderId: id,
      };
      next = setTable(next, action.tableId, {
        state: "seated",
        seatedAt: action.at,
        orderId: id,
        serverId: server.id,
      });

      next = withAudit(next, audit(state, mint, {
        at: action.at,
        action: "order.created",
        entityType: "order",
        entityId: id,
        after: { orderType: action.orderType, tableId: action.tableId, servedBy: server.name.en },
      }));
      if (outsideSection) {
        next = withAudit(next, audit(next, mint, {
          at: action.at,
          action: "floor.section.override",
          entityType: "order",
          entityId: id,
          before: { section: section?.name ?? null, sectionServer: section?.serverName?.en ?? null },
          after: { openedBy: operator.name.en, table: table?.label ?? null },
          approverName: action.sectionOverride?.approverName ?? null,
        }));
      }
      return commit(next);
    }

    case "ORDER_SELECT":
      return { ...state, activeOrderId: action.orderId };

    case "ORDER_SET_GUESTS": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      return putOrder(state, { ...order, guestCount: action.guestCount });
    }

    case "ORDER_NOTE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      // FR-POS-066 — a card number typed into a note never reaches storage.
      return putOrder(state, { ...order, notes: redactOptional(action.note.trim() || null) });
    }

    case "ORDER_SYNC": {
      const order = state.orders[action.orderId];
      if (!order) return state;

      const next = putOrder(state, {
        ...order,
        syncState: action.syncState,
        syncedAt: action.syncedAt !== undefined ? action.syncedAt : order.syncedAt,
      });

      // Only the offline path is activity-worthy — an order settled while
      // online goes straight from "local" to "synced" with nothing in
      // between, and that transition is already covered by `order.created`.
      if (action.syncState === "pending") {
        return commit(
          withAudit(next, audit(state, mint, {
            at: action.at,
            action: "offline.order.created",
            entityType: "order",
            entityId: order.id,
            after: { orderNumber: order.orderNumber, grandTotal: order.grandTotal.amount },
          })),
        );
      }
      if (action.syncState === "synced" && order.syncState === "pending") {
        return commit(
          withAudit(next, audit(state, mint, {
            at: action.at,
            action: "offline.order.synced",
            entityType: "order",
            entityId: order.id,
            after: { orderNumber: order.orderNumber, syncedAt: action.syncedAt ?? action.at },
          })),
        );
      }
      return next;
    }

    /*
      FR-POS-006 — parked, with who parked it, where and when.

      The order lives in the branch's shared store, not on the terminal that
      parked it, so it shows on every till in the branch and anyone signed on
      can pick it up. Parking used to change the state and nothing else: no
      record of who set it aside, no audit entry, and nothing ever dispatched
      a resume — a parked order could be selected but never un-parked.
    */
    case "ORDER_PARK": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || !state.session) return state;
      const operator = operatorOf(state);
      const terminal = terminals.find((t) => t.id === state.terminalId);
      let next = putOrder(state, {
        ...order,
        state: "parked",
        parked: {
          at: action.at,
          by: operator.id,
          byName: operator.name,
          terminalId: state.terminalId,
          terminalName: terminal?.name ?? order.terminalName,
        },
      });
      next = { ...next, activeOrderId: state.activeOrderId === order.id ? null : state.activeOrderId };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.parked",
          entityType: "order",
          entityId: order.id,
          before: { state: order.state },
          after: { state: "parked", terminal: terminal?.name ?? null },
        })),
      );
    }

    case "ORDER_RESUME": {
      const order = state.orders[action.orderId];
      // An authorised user is one signed on to a shift at this branch.
      if (!order || order.state !== "parked" || !state.session) return state;
      const operator = operatorOf(state);
      const terminal = terminals.find((t) => t.id === state.terminalId);
      const resumed: Order = {
        ...order,
        // Back to where it was: part-paid stays part-paid, fired stays open.
        state: order.paidTotal.amount > 0 ? "partially_paid" : order.firstFiredAt ? "open" : "draft",
        parked: null,
        // The order now lives on the till that picked it up.
        terminalId: state.terminalId,
        terminalName: terminal?.name ?? order.terminalName,
      };
      const next = { ...putOrder(state, resumed), activeOrderId: order.id };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.resumed",
          entityType: "order",
          entityId: order.id,
          before: {
            state: "parked",
            parkedBy: order.parked?.byName.en ?? null,
            terminal: order.parked?.terminalName ?? order.terminalName,
          },
          after: {
            state: resumed.state,
            resumedBy: operator.name.en,
            terminal: resumed.terminalName,
            otherUser: order.parked ? order.parked.by !== operator.id : null,
            otherTerminal: order.parked ? order.parked.terminalId !== state.terminalId : null,
          },
        })),
      );
    }

    /** FR-POS-007 — the server can change mid-service; the change is recorded. */
    case "ORDER_SET_SERVER": {
      const order = state.orders[action.orderId];
      const server = employeeById.get(action.serverId);
      if (!order || !server || !worksAt(server, state.branchId)) return state;
      if (["completed", "cancelled", "refunded", "partially_refunded", "merged"].includes(order.state)) return state;
      if (order.servedBy === server.id) return state;
      const next = putOrder(state, { ...order, servedBy: server.id, servedByName: server.name });
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.server.changed",
          entityType: "order",
          entityId: order.id,
          before: { servedBy: order.servedByName?.en ?? null },
          after: { servedBy: server.name.en },
        })),
      );
    }

    case "ORDER_MOVE_TABLE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const target =
        state.tableStates[action.tableId] ?? seededTables.find((t) => t.id === action.tableId);
      if (!target) return state;

      let next = setTable(state, order.tableId, {
        state: "needs_cleaning",
        orderId: null,
        seatedAt: null,
      });
      next = setTable(next, action.tableId, {
        state: "ordered",
        orderId: order.id,
        seatedAt: action.at,
      });
      next = putOrder(next, { ...order, tableId: action.tableId, tableLabel: target.label });

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.table.transferred",
          entityType: "order",
          entityId: order.id,
          before: { table: order.tableLabel },
          after: { table: target.label },
        })),
      );
    }

    /*
      FR-POS-082 — two tables become one bill.

      The source's lines, discounts and guests move onto the target, its
      tables are linked to the target so the floor shows them occupied by it,
      and the kitchen tickets are re-pointed so the runner reads the order
      number the food will be billed under. The source is kept, emptied and
      marked `merged` with a pointer to where its lines went, because an
      order number that simply vanished would be a gap in the sequence.

      Refused once money has been taken on either side: moving a payment
      between bills is a refund and a re-sale, not a merge.
    */
    case "ORDER_MERGE": {
      const target = state.orders[action.targetOrderId];
      const source = state.orders[action.sourceOrderId];
      if (!target || !source || target.id === source.id) return state;
      if (!isEditable(target) || !isEditable(source)) return state;
      if (target.paidTotal.amount > 0 || source.paidTotal.amount > 0) return state;
      if (target.orderType !== "dine_in" || source.orderType !== "dine_in") return state;

      const base = target.lines.length;
      const movedLines = source.lines.map((line, index) => ({ ...line, sequence: base + index + 1 }));
      const linked = [
        ...(target.linkedTableIds ?? []),
        ...tablesOfOrder(source).filter((id) => id !== target.tableId),
      ];

      const merged = retotal(state, {
        ...target,
        lines: [...target.lines, ...movedLines],
        discounts: [...target.discounts, ...source.discounts],
        guestCount: (target.guestCount ?? 0) + (source.guestCount ?? 0) || null,
        customerId: target.customerId ?? source.customerId,
        customerName: target.customerName ?? source.customerName,
        firstFiredAt:
          [target.firstFiredAt, source.firstFiredAt].filter((t): t is string => Boolean(t)).sort()[0] ?? null,
        state: target.firstFiredAt || source.firstFiredAt ? "open" : target.state,
        linkedTableIds: [...new Set(linked)],
      });
      const emptied = retotal(state, {
        ...source,
        lines: [],
        discounts: [],
        state: "merged",
        mergedIntoOrderId: target.id,
        linkedTableIds: [],
      });

      let next = putOrder(putOrder(state, merged), emptied);
      for (const tableId of tablesOfOrder(source)) {
        next = setTable(next, tableId, { orderId: target.id, state: "ordered" });
      }
      const tickets = { ...next.tickets };
      for (const id of next.ticketIds) {
        const ticket = tickets[id];
        if (ticket?.orderId !== source.id) continue;
        tickets[id] = { ...ticket, orderId: target.id, orderNumber: target.orderNumber, tableLabel: target.tableLabel };
      }
      next = {
        ...next,
        tickets,
        activeOrderId: state.activeOrderId === source.id ? target.id : state.activeOrderId,
      };

      next = withAudit(next, audit(state, mint, {
        at: action.at,
        action: "order.tables.merged",
        entityType: "order",
        entityId: target.id,
        before: { target: orderSnapshot(target), source: orderSnapshot(source) },
        after: orderSnapshot(merged),
      }));
      next = withAudit(next, audit(next, mint, {
        at: action.at,
        action: "order.merged.into",
        entityType: "order",
        entityId: source.id,
        before: orderSnapshot(source),
        after: { state: "merged", mergedInto: target.orderNumber },
      }));
      return commit(next);
    }

    /*
      FR-POS-082 — some of a table's lines onto a new check.

      The new check takes the chosen lines with their discounts, at the same
      table (two checks, one table) or at a free one. A combo's components
      travel together — half a meal deal on each bill would reprice neither.
      Kitchen tickets follow their lines: a ticket whose lines all moved is
      re-pointed, and one holding lines from both checks is split in two, so
      the station still shows exactly what it is making and marking a line
      ready still reaches the bill it is on.
    */
    case "ORDER_SPLIT": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || order.paidTotal.amount > 0) return state;

      const chosen = new Set(action.lineIds);
      for (const line of order.lines) {
        if (line.combo && chosen.has(line.id)) {
          for (const sibling of order.lines) {
            if (sibling.combo?.instanceId === line.combo.instanceId) chosen.add(sibling.id);
          }
        }
      }
      const moving = order.lines.filter((l) => chosen.has(l.id) && l.state !== "voided");
      const staying = order.lines.filter((l) => !chosen.has(l.id) || l.state === "voided");
      if (moving.length === 0 || !staying.some((l) => l.state !== "voided")) return state;

      const destination = action.tableId && action.tableId !== order.tableId
        ? (state.tableStates[action.tableId] ?? seededTables.find((t) => t.id === action.tableId))
        : null;
      if (action.tableId && action.tableId !== order.tableId && (!destination || destination.state !== "available")) {
        return state;
      }

      const operator = operatorOf(state);
      const branch = branchById.get(state.branchId)!;
      const newId = mint.next("ord");
      const seq = state.numberSeq;
      const movedIds = new Set(moving.map((l) => l.id));
      const firedAt = moving.map((l) => l.firedAt).filter((t): t is string => Boolean(t)).sort()[0] ?? null;

      const created = retotal(state, {
        ...order,
        id: newId,
        orderNumber: `${branch.code}-${String(seq).padStart(4, "0")}`,
        state: firedAt ? "open" : "draft",
        tableId: destination ? destination.id : order.tableId,
        tableLabel: destination ? destination.label : order.tableLabel,
        linkedTableIds: [],
        guestCount: null,
        customerId: null,
        customerName: null,
        openedBy: operator.id,
        openedByName: operator.name,
        closedBy: null,
        closedByName: null,
        parked: null,
        lines: moving.map((l, i) => ({ ...l, sequence: i + 1 })),
        discounts: order.discounts.filter((d) => d.lineId && movedIds.has(d.lineId)),
        payments: [],
        paidTotal: money(0, currency),
        tipTotal: money(0, currency),
        roundingAdjustment: money(0, currency),
        openedAt: action.at,
        firstFiredAt: firedAt,
        completedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        syncState: "local",
        syncedAt: null,
        splitFromOrderId: order.id,
        mergedIntoOrderId: null,
        notes: null,
      });
      const remaining = retotal(state, {
        ...order,
        lines: staying.map((l, i) => ({ ...l, sequence: i + 1 })),
        discounts: order.discounts.filter((d) => !d.lineId || !movedIds.has(d.lineId)),
      });

      let next: LiveState = {
        ...putOrder(putOrder(state, remaining), created),
        numberSeq: seq + 1,
        orderIds: [newId, ...state.orderIds],
        activeOrderId: newId,
      };
      if (destination) {
        next = setTable(next, destination.id, {
          state: firedAt ? "ordered" : "seated",
          seatedAt: action.at,
          orderId: newId,
          serverId: order.servedBy ?? operator.id,
        });
      }

      const tickets = { ...next.tickets };
      const ticketIds = [...next.ticketIds];
      for (const id of next.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.orderId !== order.id) continue;
        const going = ticket.lines.filter((l) => movedIds.has(l.id));
        if (going.length === 0) continue;
        const retarget = { orderId: newId, orderNumber: created.orderNumber, tableLabel: created.tableLabel };
        if (going.length === ticket.lines.length) {
          tickets[id] = { ...ticket, ...retarget };
        } else {
          tickets[id] = { ...ticket, lines: ticket.lines.filter((l) => !movedIds.has(l.id)) };
          const copyId = mint.next("tkt");
          tickets[copyId] = { ...ticket, ...retarget, id: copyId, lines: going };
          ticketIds.splice(ticketIds.indexOf(id), 0, copyId);
        }
      }
      next = { ...next, tickets, ticketIds };

      next = withAudit(next, audit(state, mint, {
        at: action.at,
        action: "order.split",
        entityType: "order",
        entityId: order.id,
        before: orderSnapshot(order),
        after: { ...orderSnapshot(remaining), splitInto: created.orderNumber },
      }));
      next = withAudit(next, audit(next, mint, {
        at: action.at,
        action: "order.split.created",
        entityType: "order",
        entityId: newId,
        after: { ...orderSnapshot(created), splitFrom: order.orderNumber },
      }));
      return commit(next);
    }

    case "ORDER_CANCEL": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || order.paidTotal.amount > 0) return state;
      // FR-POS-075 — food already made is a void of every line; same rule.
      if (cancelNeedsApproval(order, state.settings) && !approvalOk(state, action.approval)) return state;
      const closer = operatorOf(state);
      const reason = redactCardData(action.reason.trim());
      if (!reason) return state;

      let next = state;
      // Pre-fire lines simply disappear; fired lines already cost us the food.
      const lines = order.lines.map((line) =>
        line.state === "voided" ? line : { ...line, state: "voided" as const, voidReason: reason },
      );

      next = putOrder(
        next,
        retotal(next, {
          ...order,
          lines,
          state: "cancelled",
          cancelledAt: action.at,
          cancelledBy: closer.name,
          cancelReason: reason,
          // FR-POS-007 — a cancelled order is closed too, by whoever cancelled it.
          closedBy: closer.id,
          closedByName: closer.name,
          parked: null,
        }),
      );

      /*
        The food that was already made has to be accounted for.

        Cancelling an order force-voided every line, including ones that had
        been fired, prepared or served — and unlike LINE_VOID it wrote neither
        a stock reversal nor a waste record. The stock had already left at
        fire time, so the loss stayed on the books as unexplained shrinkage,
        showing up later as variance nobody could trace to a cause.

        LINE_VOID asks the cook where the food went, because for a single line
        that is a real question with three answers. A cancelled order is not
        that: the whole ticket is being abandoned, usually mid-service, and
        there is no one standing at the screen to classify each dish. So it is
        recorded as waste under `order_error`, which is what it is, rather
        than being silently dropped or wrongly returned to stock.
      */
      const cooked = order.lines.filter(
        (line) => line.state !== "pending" && line.state !== "voided",
      );

      if (cooked.length > 0) {
        const branch = branchById.get(state.branchId)!;
        const operator = operatorOf(state);
        const wasteReason = wasteReasonByCode.get("order_error")!;
        const currency = currencyOf(state);

        const records: WasteRecord[] = cooked.map((line) => ({
          id: mint.next("wst"),
          tenantId: branch.tenantId,
          locationId: branch.id,
          locationName: branch.name,
          itemId: line.menuItemId,
          itemName: line.itemNameSnapshot,
          quantity: { value: line.quantity.toFixed(3), unit: "pc" },
          reasonCode: wasteReason.code,
          reasonName: wasteReason.name,
          category: wasteReason.category,
          isTrueWaste: wasteReason.isTrueWaste,
          value: money(line.unitCostSnapshot.amount * line.quantity, currency),
          recordedAt: action.at,
          recordedBy: operator.id,
          recordedByName: operator.name,
          stationId: line.stationId,
          approval: "not_required",
          notes: reason,
        }));

        next = { ...next, waste: [...records, ...next.waste].slice(0, 400) };
      }
      next = releaseTables(next, order);
      /*
        Tell the kitchen rather than tidying the ticket away.

        Marking these `bumped` removed the card from the station display the
        instant the till confirmed, which is the one thing a cook must not
        experience: a card cannot disappear from under someone who is halfway
        through cooking it. `cancelled` keeps it on screen, red and
        unmissable, carrying the reason, until a cook acknowledges it — which
        is the moment the kitchen has actually been told.
      */
      const tickets = { ...next.tickets };
      for (const id of next.ticketIds) {
        const ticket = tickets[id];
        if (
          ticket &&
          ticket.orderId === order.id &&
          ticket.state !== "bumped" &&
          ticket.state !== "cancelled"
        ) {
          tickets[id] = {
            ...ticket,
            state: "cancelled",
            cancelReason: reason,
            lines: ticket.lines.map((l) => ({ ...l, state: "voided" as const, cancelledAt: l.cancelledAt ?? action.at })),
          };
        }
      }
      next = { ...next, tickets };
      next = recomputeSession(next);

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.cancelled",
          entityType: "order",
          entityId: order.id,
          // FR-POS-075 — actor (the entry's own), approver, reason, amount, and
          // the whole order either side of the cancellation.
          before: orderSnapshot(order),
          after: { amount: order.grandTotal.amount, ...orderSnapshot(next.orders[order.id]!) },
          reasonText: reason,
          approverName: action.approval?.approverName ?? null,
        })),
      );
    }

    // --- lines -------------------------------------------------------------
    case "LINE_ADD": {
      const order = state.orders[action.orderId];
      const item = menuItemById.get(action.menuItemId);
      if (!order || !item || !isEditable(order)) return state;
      const variant = item.variants.find((v) => v.id === action.variantId);
      if (!variant) return state;

      const price = priceFor(state, order, item, variant, action.at, action.openPriceMinor ?? null);
      const line = buildLine(state, mint, order, {
        item,
        variant,
        quantity: action.quantity,
        modifierIds: action.modifierIds,
        priceRules: action.priceRules,
        course: action.course,
        seatNumber: action.seatNumber,
        notes: action.notes,
        unitPrice: price.price,
        priceSource: {
          rule: price.source,
          priceListId: price.priceListId,
          priceListName: price.priceListName,
        },
        combo: null,
        sequence: order.lines.length + 1,
      });

      let updated: Order = { ...order, lines: [...order.lines, line] };
      let next = putOrder(state, retotal(state, updated));

      // FR-POS-035 — fast-casual mode sends each line as it is entered.
      if (state.settings.autoFire) {
        updated = next.orders[order.id]!;
        const fired = fireLines(next, mint, updated, new Set([line.id]), action.at);
        next = putOrder(fired.state, retotal(fired.state, fired.order));
      }

      return commit(next);
    }

    /*
      FR-POS-030/031/032 — a combo goes on as one line per component.

      Each component keeps its own menu item, so it routes to its own station
      and depletes its own recipe; the combo price is split across them by
      the combo's strategy and allocation basis, and every line says which
      combo it came from. Looked up in the live catalogue array rather than a
      map built at load, so a combo edited in the console this session sells
      at its edited price.
    */
    case "COMBO_ADD": {
      const order = state.orders[action.orderId];
      const combo = combos.find((c) => c.id === action.comboId);
      if (!order || !combo || !combo.active || !isEditable(order)) return state;

      const quote = quoteCombo(combo, action.picks, {
        itemById: (id) => menuItemById.get(id),
        listPrice: (item, variant) => priceFor(state, order, item, variant, action.at, null).price.amount,
        unitCost: (variant) => (variant.recipeId ? (recipeById.get(variant.recipeId)?.computedCost.amount ?? 0) : 0),
      });
      if (!quote.complete) return state;

      const instanceId = mint.next("cmi");
      const added: OrderLine[] = [];
      for (const component of quote.components) {
        added.push(
          buildLine(state, mint, order, {
            item: component.item,
            variant: component.variant,
            quantity: 1,
            modifierIds: action.modifierIds[component.slot.id] ?? defaultModifierIds(component.item),
            priceRules: action.priceRules,
            course: action.course,
            seatNumber: action.seatNumber,
            notes: null,
            unitPrice: money(component.chargedMinor, currency),
            priceSource: { rule: "combo", priceListId: null, priceListName: combo.name.en },
            combo: {
              comboId: combo.id,
              instanceId,
              name: combo.name,
              slotId: component.slot.id,
              slotName: component.slot.name,
              strategy: combo.pricingStrategy,
              listPrice: money(component.listMinor, currency),
              premium: money(component.premiumMinor, currency),
            },
            sequence: order.lines.length + added.length + 1,
          }),
        );
      }

      let next = putOrder(state, retotal(state, { ...order, lines: [...order.lines, ...added] }));
      if (state.settings.autoFire) {
        const fired = fireLines(next, mint, next.orders[order.id]!, new Set(added.map((l) => l.id)), action.at);
        next = putOrder(fired.state, retotal(fired.state, fired.order));
      }
      return commit(next);
    }

    case "LINE_QTY": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const quantity = Math.max(1, Math.min(99, action.quantity));
      const lines = order.lines.map((line) => {
        // A combo component's quantity is the combo's; it changes as a unit.
        if (line.id !== action.lineId || line.state !== "pending" || line.combo) return line;
        const recipe = line.recipeVersionId ? recipeById.get(line.recipeVersionId) : undefined;
        return {
          ...line,
          quantity,
          unitCostSnapshot: money(recipe?.computedCost.amount ?? 0, currency),
        };
      });
      return putOrder(state, retotal(state, { ...order, lines }));
    }

    /*
      FR-POS-025/026 — a kitchen note on a line not yet sent.

      Once a line has fired, the kitchen has its copy; editing the note here
      would change the bill's record without changing the ticket the cook is
      reading, so a fired line's note is left alone.
    */
    case "LINE_NOTE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const notes = noteForPolicy(action.notes, state.settings);
      const lines = order.lines.map((line) =>
        line.id === action.lineId && line.state === "pending" ? { ...line, notes } : line,
      );
      return putOrder(state, { ...order, lines });
    }

    case "LINE_COURSE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const lines = order.lines.map((line) =>
        line.id === action.lineId && line.state === "pending"
          ? { ...line, course: action.course }
          : line,
      );
      return putOrder(state, { ...order, lines });
    }

    case "ORDER_SET_CUSTOMER": {
      const order = state.orders[action.orderId];
      if (!order || order.state === "completed" || order.state === "cancelled") return state;
      return withAudit(
        putOrder(state, { ...order, customerId: action.customerId, customerName: action.customerName }),
        audit(state, mint, {
          at: action.at,
          action: action.customerId ? "order.customer.attached" : "order.customer.detached",
          entityType: "order",
          entityId: order.id,
          before: { customerId: order.customerId },
          after: { customerId: action.customerId },
        }),
      );
    }

    case "PROMOTIONS_SYNC":
      return {
        ...state,
        promotionBook: { promotions: action.promotions, redemptions: action.redemptions, syncedAt: action.at },
      };

    case "ORDER_PROMOTION_CUSTOMER": {
      const order = state.orders[action.orderId];
      if (!order || order.customerId !== action.customer.id) return state;
      const context = state.orderPromotions[order.id] ?? emptyOrderPromotionState();
      return {
        ...state,
        orderPromotions: { ...state.orderPromotions, [order.id]: { ...context, customer: action.customer } },
      };
    }

    case "ORDER_COUPON": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || order.paidTotal.amount > 0) return state;
      const code = action.code.trim().toUpperCase();
      if (!code) return state;
      const context = state.orderPromotions[order.id] ?? emptyOrderPromotionState();
      const others = context.coupons.filter((c) => c.code !== code);
      if (!action.promotionId && others.length === context.coupons.length) return state;
      const coupons = action.promotionId ? [...others, { code, promotionId: action.promotionId }] : others;
      const next = {
        ...state,
        orderPromotions: { ...state.orderPromotions, [order.id]: { ...context, coupons } },
      };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: action.promotionId ? "order.coupon.applied" : "order.coupon.removed",
          entityType: "order",
          entityId: order.id,
          after: { code, promotionId: action.promotionId, orderNumber: order.orderNumber },
        })),
      );
    }

    case "ORDER_PROMOTION_DECLINE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || order.paidTotal.amount > 0) return state;
      const context = state.orderPromotions[order.id] ?? emptyOrderPromotionState();
      if (context.declined.includes(action.promotionId) === action.declined) return state;
      const declined = action.declined
        ? [...context.declined, action.promotionId]
        : context.declined.filter((id) => id !== action.promotionId);
      const next = {
        ...state,
        orderPromotions: { ...state.orderPromotions, [order.id]: { ...context, declined } },
      };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: action.declined ? "order.promotion.declined" : "order.promotion.restored",
          entityType: "order",
          entityId: order.id,
          after: { promotionId: action.promotionId, orderNumber: order.orderNumber },
        })),
      );
    }

    case "ORDER_PROMOTIONS_RECORDED": {
      const context = state.orderPromotions[action.orderId];
      if (!context) return state;
      const field = action.kind === "redeemed" ? "redeemedAt" : "earnedAt";
      if (context[field]) return state;
      return {
        ...state,
        orderPromotions: { ...state.orderPromotions, [action.orderId]: { ...context, [field]: action.at } },
      };
    }

    case "LINE_SEAT": {
      // FR-POS-004 — a seat can be set or corrected until the bill is
      // settled, fired or not: it drives the split, not the kitchen.
      const order = state.orders[action.orderId];
      if (!order || order.state === "completed" || order.state === "cancelled") return state;
      const seat = action.seat === null ? null : Math.max(1, Math.min(99, Math.floor(action.seat)));
      const lines = order.lines.map((line) =>
        line.id === action.lineId && line.state !== "voided" ? { ...line, seatNumber: seat } : line,
      );
      // Keep the kitchen's copy in step, so a runner reading the ticket sees it.
      const tickets = { ...state.tickets };
      for (const id of state.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.orderId !== order.id) continue;
        if (!ticket.lines.some((line) => line.id === action.lineId)) continue;
        tickets[id] = {
          ...ticket,
          lines: ticket.lines.map((line) => (line.id === action.lineId ? { ...line, seatNumber: seat } : line)),
        };
      }
      return putOrder({ ...state, tickets }, { ...order, lines });
    }

    case "LINE_VOID": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const line = order.lines.find((l) => l.id === action.lineId);
      if (!line || line.state === "voided") return state;
      const reason = redactCardData(action.reason.trim());
      if (!reason) return state;

      // A combo's components were priced together, so they are voided
      // together: dropping the drink from a meal deal would leave the burger
      // and fries charged at their share of a combo that no longer exists.
      const targets = line.combo
        ? order.lines.filter((l) => l.combo?.instanceId === line.combo!.instanceId && l.state !== "voided")
        : [line];
      const targetIds = new Set(targets.map((l) => l.id));
      const preFire = targets.every((l) => l.state === "pending");
      // FR-POS-070 — the disposition question is only real for food that exists.
      if (!preFire && !action.disposition) return state;
      // FR-POS-075 — a void the policy covers needs its approver.
      if (voidNeedsApproval(preFire, state.settings) && !approvalOk(state, action.approval)) return state;

      let next = state;
      // Pre-fire: nothing was made, so the lines just leave the order.
      const lines = order.lines
        .filter((l) => !(targetIds.has(l.id) && l.state === "pending"))
        .map((l) => (targetIds.has(l.id) ? { ...l, state: "voided" as const, voidReason: reason } : l))
        .map((l, i) => ({ ...l, sequence: i + 1 }));

      next = putOrder(next, retotal(next, { ...order, lines }));

      // Post-fire: the food exists. FR-POS-071 makes the cook say where it went.
      const cooked = targets.filter((l) => l.state !== "pending");
      for (const made of cooked) {
        const deltas = depletionFor(made);
        if (action.disposition === "returned_to_stock") {
          next = applyStock(
            next,
            mint,
            deltas.map((d) => ({ itemId: d.itemId, quantity: -d.quantity, costMinor: d.costMinor })),
            {
              at: action.at,
              movementType: "sale_reversal",
              referenceType: "order_line",
              referenceId: made.id,
              reasonCode: "void_return",
              notes: reason,
            },
          );
        } else if (action.disposition) {
          const reasonCode = action.disposition === "staff_meal" ? "staff_meal" : "order_error";
          const wasteReason = wasteReasonByCode.get(reasonCode)!;
          const branch = branchById.get(state.branchId)!;
          const operator = operatorOf(state);

          // Stock already left at fire time; this record classifies why, so
          // the loss lands in waste rather than in unexplained variance.
          const record: WasteRecord = {
            id: mint.next("wst"),
            tenantId: branch.tenantId,
            locationId: branch.id,
            locationName: branch.name,
            itemId: made.menuItemId,
            itemName: made.itemNameSnapshot,
            quantity: { value: made.quantity.toFixed(3), unit: "pc" },
            reasonCode: wasteReason.code,
            reasonName: wasteReason.name,
            category: wasteReason.category,
            isTrueWaste: wasteReason.isTrueWaste,
            value: money(made.unitCostSnapshot.amount * made.quantity, currency),
            recordedAt: action.at,
            recordedBy: operator.id,
            recordedByName: operator.name,
            stationId: made.stationId,
            approval: "not_required",
            notes: reason,
          };
          next = { ...next, waste: [record, ...next.waste].slice(0, 400) };
        }
      }

      if (cooked.length > 0) {
        // Strike the lines through on the station display — FR-KDS-029.
        const cookedIds = new Set(cooked.map((l) => l.id));
        const tickets = { ...next.tickets };
        for (const id of next.ticketIds) {
          const ticket = tickets[id];
          if (!ticket || ticket.orderId !== order.id) continue;
          if (!ticket.lines.some((l) => cookedIds.has(l.id))) continue;
          tickets[id] = {
            ...ticket,
            // The visibility window runs from this moment, not from the fire.
            lines: ticket.lines.map((l) =>
              cookedIds.has(l.id) ? { ...l, state: "voided" as const, cancelledAt: action.at } : l,
            ),
          };
        }
        next = { ...next, tickets };
      }

      const after = next.orders[order.id]!;
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: preFire ? "order.line.voided.prefire" : "order.line.voided.postfire",
          entityType: "order_line",
          entityId: line.id,
          // FR-POS-075 — the order either side of the void, with the amount
          // it took off the bill and what happened to the food.
          before: orderSnapshot(order),
          after: {
            amount: order.grandTotal.amount - after.grandTotal.amount,
            voidedLines: targets.map((l) => l.id),
            disposition: action.disposition,
            ...orderSnapshot(after),
          },
          reasonText: reason,
          approverName: action.approval?.approverName ?? null,
        })),
      );
    }

    case "LINE_COMP": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const lines = order.lines.map((l) =>
        l.id === action.lineId ? { ...l, isComp: true } : l,
      );
      const next = putOrder(state, retotal(state, { ...order, lines }));
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.line.comped",
          entityType: "order_line",
          entityId: action.lineId,
          reasonText: action.reason,
        })),
      );
    }

    /*
      FR-POS-045 … FR-POS-051 — one path for a discount on a line or on the
      whole order.

        047  every threshold is judged on what was actually entered, and
             crossing any of them needs an approval stamp the reducer checks
             itself (048) — the sheet asking first is not the control
        049  every discount becomes a record: amount, percentage, reason,
             who applied it, who approved it and how, when, and the order
             as it stood
        051  an exclusive discount, or any discount under best-single, only
             goes on if it beats what it would have to combine with, and the
             ones it beats are marked removed rather than deleted
    */
    case "LINE_DISCOUNT":
    case "ORDER_DISCOUNT": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const line = action.type === "LINE_DISCOUNT" ? order.lines.find((l) => l.id === action.lineId) : null;
      if (action.type === "LINE_DISCOUNT" && (!line || line.state === "voided" || line.isComp)) return state;

      const input = action.discount;
      const base = line
        ? grossOf(line)
        : order.lines.filter((l) => l.state !== "voided" && !l.isComp).reduce((s, l) => s + l.lineSubtotal.amount, 0);
      if (base <= 0) return state;
      const requested =
        input.amountMinor ?? Math.round((base * Math.max(0, Math.min(100, input.percentage ?? 0))) / 100);
      const amountMinor = Math.max(0, Math.min(requested, base));
      if (amountMinor <= 0) return state;

      const operator = operatorOf(state);
      const sessionStart = state.session?.openedAt ?? "";
      const discountsThisShift = Object.values(state.orders)
        .flatMap((o) => o.discounts)
        .filter((d) => d.appliedById === operator.id && d.appliedAt >= sessionStart).length;
      const triggers = discountTriggers(
        {
          percent: (amountMinor / base) * 100,
          amountMinor,
          discountsThisShift,
          paymentStarted: order.paidTotal.amount > 0,
        },
        state.settings,
      );
      if (triggers.length > 0 && !approvalOk(state, input.approval)) return state;

      const active = activeDiscountsOf(order);
      const verdict = resolveStacking(
        active.map((d) => ({ id: d.id, amountMinor: d.amount.amount, exclusive: d.exclusive === true })),
        { amountMinor, exclusive: input.exclusive },
        state.settings.discountStacking,
      );
      if (verdict.outcome === "keep_existing") return state;
      const superseded = new Set(verdict.outcome === "replace" ? verdict.conflictIds : []);

      const record: OrderDiscount = {
        id: mint.next("dsc"),
        reason: input.reason,
        percentage: input.amountMinor == null ? (input.percentage ?? null) : null,
        amount: money(amountMinor, currency),
        appliedBy: operator.name,
        approvedBy: input.approval?.approverName ?? null,
        appliedAt: action.at,
        lineId: line?.id ?? null,
        appliedById: operator.id,
        approvedById: input.approval?.approverId ?? null,
        approvalMethod: input.approval?.method ?? null,
        context: {
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableLabel: order.tableLabel,
          baseAmount: base,
          lineCount: order.lines.filter((l) => l.state !== "voided").length,
          paymentStarted: order.paidTotal.amount > 0,
        },
        presetId: input.presetId,
        exclusive: input.exclusive,
        removedAt: null,
        removedReason: null,
      };

      const discounts = [
        ...order.discounts.map((d) =>
          superseded.has(d.id)
            ? { ...d, removedAt: action.at, removedReason: `Superseded by ${input.reason.en} (FR-POS-051)` }
            : d,
        ),
        record,
      ];

      let next = putOrder(state, retotal(state, { ...order, discounts }));
      next = withAudit(next, audit(state, mint, {
        at: action.at,
        action: "order.discount.applied",
        entityType: line ? "order_line" : "order",
        entityId: line?.id ?? order.id,
        before: { discountTotal: order.discountTotal.amount, grandTotal: order.grandTotal.amount },
        after: {
          amount: amountMinor,
          percentage: record.percentage,
          preset: input.presetId,
          exclusive: input.exclusive,
          triggers,
          approvalMethod: record.approvalMethod,
          superseded: [...superseded],
          orderNumber: order.orderNumber,
          grandTotal: next.orders[order.id]!.grandTotal.amount,
        },
        reasonText: input.reason.en,
        approverName: input.approval?.approverName ?? null,
      }));
      return commit(next);
    }

    /** FR-POS-049 — taken off, not deleted: the record says who removed it and why. */
    case "DISCOUNT_REMOVE":
    case "ORDER_DISCOUNT_CLEAR": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const targets = new Set(
        activeDiscountsOf(order)
          .filter((d) => (action.type === "DISCOUNT_REMOVE" ? d.id === action.discountId : !d.lineId))
          .map((d) => d.id),
      );
      if (targets.size === 0) return state;
      const why = action.type === "DISCOUNT_REMOVE" ? redactCardData(action.reason.trim()) : "Order discounts cleared";
      const discounts = order.discounts.map((d) =>
        targets.has(d.id) ? { ...d, removedAt: action.at, removedReason: why || "Removed" } : d,
      );
      const next = putOrder(state, retotal(state, { ...order, discounts }));
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.discount.removed",
          entityType: "order",
          entityId: order.id,
          before: { discountTotal: order.discountTotal.amount, discounts: [...targets] },
          after: { discountTotal: next.orders[order.id]!.discountTotal.amount },
          reasonText: why,
        })),
      );
    }

    // --- kitchen -----------------------------------------------------------
    case "ORDER_FIRE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      // FR-POS-003 — a dine-in order needs a table before it reaches the kitchen.
      if (order.orderType === "dine_in" && !order.tableId) return state;

      const target = order.lines.filter(
        (l) => l.state === "pending" && (action.course === null || l.course === action.course),
      );
      if (target.length === 0) return state;

      const fired = fireLines(state, mint, order, new Set(target.map((l) => l.id)), action.at, {
        hold: action.hold,
      });
      let next = putOrder(fired.state, retotal(fired.state, fired.order));
      next = setTable(next, order.tableId, { state: "ordered" });

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: action.hold ? "order.course.held" : "order.line.fired",
          entityType: "order",
          entityId: order.id,
          after: { lines: target.length, course: action.course, hold: action.hold === true },
        })),
      );
    }

    case "ORDER_RELEASE_HOLD": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const tickets = { ...state.tickets };
      let released = 0;
      for (const id of state.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.orderId !== order.id || !ticket.held) continue;
        if (action.course !== null && ticket.course !== action.course) continue;
        // The clock starts now: time on hold is not time the kitchen took.
        tickets[id] = {
          ...ticket,
          held: false,
          firedAt: action.at,
          elapsedSeconds: 0,
          urgency: "on_target",
          // FR-KDS-040 — a held ticket reaches the station when it is released.
          timeline: stamp(ticket.timeline, "routedAt", action.at),
          lines: ticket.lines.map((line) => ({ ...line, timeline: stamp(line.timeline, "routedAt", action.at) })),
        };
        released += 1;
      }
      if (released === 0) return state;
      const lines = order.lines.map((line) =>
        line.held && (action.course === null || line.course === action.course) ? { ...line, held: false } : line,
      );
      const next = putOrder({ ...state, tickets }, { ...order, lines });
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.course.released",
          entityType: "order",
          entityId: order.id,
          after: { course: action.course, tickets: released },
        })),
      );
    }

    case "TICKET_START": {
      const ticket = state.tickets[action.ticketId];
      // FR-POS-037 — a held course is not the kitchen's to start.
      if (!ticket || ticket.state !== "queued" || ticket.held) return state;
      // FR-KDS-012 — nor is one the staggered release has not let out yet.
      if (Date.parse(action.at) < Date.parse(ticket.firedAt)) return state;
      return {
        ...state,
        tickets: {
          ...state.tickets,
          // Stamped once and never overwritten: a ticket amended after work
          // began is still work that began when it began.
          [ticket.id]: {
            ...ticket,
            state: "started",
            startedAt: ticket.startedAt ?? action.at,
            // FR-KDS-040
            timeline: stamp(ticket.timeline, "startedAt", action.at),
            lines: ticket.lines.map((line) =>
              line.state === "voided" ? line : { ...line, timeline: stamp(line.timeline, "startedAt", action.at) },
            ),
          },
        },
      };
    }

    // FR-KDS-024 — bump item: one line is ready, the rest of the ticket carries on.
    case "TICKET_BUMP_LINE": {
      const ticket = state.tickets[action.ticketId];
      // Nothing on a cancelled ticket can be marked ready — the food is not
      // going anywhere, and readying a line would re-open it as work.
      if (!ticket || ticket.state === "cancelled" || ticket.held) return state;
      if (Date.parse(action.at) < Date.parse(ticket.firedAt)) return state;
      const lines = ticket.lines.map((l) =>
        l.id === action.lineId && l.state !== "voided" && l.state !== "ready"
          ? {
              ...l,
              state: "ready" as const,
              // FR-KDS-040 — readying a line is also when work on it started,
              // if nobody pressed Start.
              timeline: restamp(stamp(l.timeline, "startedAt", action.at), { readyAt: action.at, bumpedAt: action.at }),
            }
          : l,
      );
      const allReady = lines.every((l) => l.state === "ready" || l.state === "voided");

      let next: LiveState = {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: {
            ...ticket,
            lines,
            state: allReady ? "bumped" : ticket.state === "queued" ? "started" : ticket.state,
            // Readying a line is work, so it starts the clock the same way
            // Start does — otherwise a cook who skips the button loses it.
            startedAt: ticket.startedAt ?? action.at,
            bumpedAt: allReady ? action.at : ticket.bumpedAt,
            timeline: allReady
              ? restamp(stamp(ticket.timeline, "startedAt", action.at), { readyAt: action.at, bumpedAt: action.at })
              : stamp(ticket.timeline, "startedAt", action.at),
          },
        },
        recallable: allReady
          ? recallableAt([{ id: ticket.id, bumpedAt: action.at }, ...state.recallable], action.at)
          : recallableAt(state.recallable, action.at),
      };
      next = syncOrderFromTickets(next, ticket.orderId, action.at);
      return next;
    }

    // FR-KDS-024 — bump all: the whole ticket is ready at once.
    case "TICKET_BUMP": {
      const ticket = state.tickets[action.ticketId];
      // A cancelled ticket leaves via TICKET_ACK_CANCEL. Bumping it would
      // record food as made and served, and make it recallable.
      if (!ticket || ticket.state === "bumped" || ticket.state === "cancelled" || ticket.held) return state;
      if (Date.parse(action.at) < Date.parse(ticket.firedAt)) return state;
      let next: LiveState = {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: {
            ...ticket,
            state: "bumped",
            // Bumped straight from queued: the cook never pressed Start, so
            // the whole wait was pick-up and prep is indistinguishable.
            startedAt: ticket.startedAt,
            bumpedAt: action.at,
            // FR-KDS-040 — ready and bumped are the same moment for bump-all.
            timeline: restamp(ticket.timeline, { readyAt: action.at, bumpedAt: action.at }),
            lines: ticket.lines.map((l) =>
              l.state === "voided"
                ? l
                : l.state === "ready"
                  ? { ...l, timeline: stamp(l.timeline, "bumpedAt", action.at) }
                  : { ...l, state: "ready" as const, timeline: restamp(l.timeline, { readyAt: action.at, bumpedAt: action.at }) },
            ),
          },
        },
        recallable: recallableAt(
          [{ id: ticket.id, bumpedAt: action.at }, ...state.recallable],
          action.at,
        ),
      };
      next = syncOrderFromTickets(next, ticket.orderId, action.at);
      return next;
    }

    case "TICKET_ACK_CANCEL": {
      const ticket = state.tickets[action.ticketId];
      if (!ticket || ticket.state !== "cancelled") return state;
      // Acknowledged, so it leaves the display. It is not made recallable:
      // there is no order left to recall it onto.
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: { ...ticket, state: "bumped", bumpedAt: action.at, timeline: stamp(ticket.timeline, "bumpedAt", action.at) },
        },
      };
    }

    // FR-KDS-025 — a mis-bump is recoverable inside the retention window.
    case "TICKET_RECALL": {
      const ticket = state.tickets[action.ticketId];
      if (!ticket) return state;
      // FR-KDS-025 is a time window. Enforcing it in the reducer rather than
      // only in the KDS list means a stale button, a second tab or a replayed
      // action cannot bring back a ticket that has aged out.
      const open = recallableAt(state.recallable, action.at);
      if (!open.some((entry) => entry.id === ticket.id)) {
        return { ...state, recallable: open };
      }
      const recalledTimeline = (timeline: KitchenTicket["timeline"]) => {
        const base = restamp(timeline, { readyAt: null, bumpedAt: null, servedAt: null });
        return { ...base, recalledAt: [...base.recalledAt, action.at] };
      };
      const next: LiveState = {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: {
            ...ticket,
            state: "recalled",
            // Back on the line, so it is not done any more. `startedAt` keeps
            // its original value: the recall is part of the same work.
            bumpedAt: null,
            // FR-KDS-027 — a remake is a recall the kitchen has to cook again,
            // flagged so it cannot be mistaken for a ticket that was merely
            // bumped early.
            priority: action.remake ? "remake" : ticket.priority,
            remakeCount: action.remake ? (ticket.remakeCount ?? 0) + 1 : ticket.remakeCount,
            // FR-KDS-040 — every recall is kept; ready and bumped re-open.
            timeline: recalledTimeline(ticket.timeline),
            lines: ticket.lines.map((l) =>
              l.state === "voided" ? l : { ...l, state: "fired" as const, timeline: recalledTimeline(l.timeline) },
            ),
          },
        },
        recallable: state.recallable.filter((entry) => entry.id !== ticket.id),
      };
      const order = next.orders[ticket.orderId];
      if (!order) return next;
      const ids = new Set(ticket.lines.map((l) => l.id));
      const restored = putOrder(next, {
        ...order,
        lines: order.lines.map((l) =>
          ids.has(l.id) && (l.state === "ready" || l.state === "served")
            ? { ...l, state: "fired" as const, readyAt: null }
            : l,
        ),
      });
      if (!action.remake) return restored;
      return commit(
        withAudit(restored, audit(state, mint, {
          at: action.at,
          action: "kitchen.ticket.remake",
          entityType: "kitchen_ticket",
          entityId: ticket.id,
          after: { orderNumber: ticket.orderNumber, station: ticket.stationName.en, remakes: (ticket.remakeCount ?? 0) + 1 },
        })),
      );
    }

    // FR-KDS-040 — first viewed, write-once, for every ticket a display has shown.
    case "TICKET_VIEWED": {
      let changed = false;
      const tickets = { ...state.tickets };
      for (const id of action.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.timeline?.firstViewedAt) continue;
        // FR-KDS-012 — a ticket not yet released has not reached the station to be seen.
        if (Date.parse(action.at) < Date.parse(ticket.firedAt)) continue;
        tickets[id] = {
          ...ticket,
          timeline: stamp(ticket.timeline, "firstViewedAt", action.at),
          lines: ticket.lines.map((line) => ({ ...line, timeline: stamp(line.timeline, "firstViewedAt", action.at) })),
        };
        changed = true;
      }
      return changed ? { ...state, tickets } : state;
    }

    // FR-KDS-027 — rush, VIP or remake on one ticket, from the station.
    case "TICKET_PRIORITY": {
      const ticket = state.tickets[action.ticketId];
      if (!ticket || ticket.priority === action.priority) return state;
      const next: LiveState = {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: { ...ticket, priority: action.priority },
        },
      };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "kitchen.ticket.priority",
          entityType: "kitchen_ticket",
          entityId: ticket.id,
          before: { priority: ticket.priority },
          after: { priority: action.priority, orderNumber: ticket.orderNumber },
        })),
      );
    }

    // FR-KDS-027 — rush / VIP on the order: every open ticket, and every later firing.
    case "ORDER_PRIORITY": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const previous = state.priorities?.[order.id] ?? "normal";
      if (previous === action.priority) return state;
      const priorities = { ...(state.priorities ?? {}) };
      if (action.priority === "normal") delete priorities[order.id];
      else priorities[order.id] = action.priority;
      const tickets = { ...state.tickets };
      for (const id of state.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.orderId !== order.id) continue;
        if (ticket.state === "bumped" || ticket.state === "cancelled") continue;
        // A remake stays a remake; the order's flag does not wash it out.
        if (ticket.priority === "remake") continue;
        tickets[id] = { ...ticket, priority: action.priority };
      }
      return commit(
        withAudit({ ...state, priorities, tickets }, audit(state, mint, {
          at: action.at,
          action: "order.priority.changed",
          entityType: "order",
          entityId: order.id,
          before: { priority: previous },
          after: { priority: action.priority },
        })),
      );
    }

    case "KDS_SETUP_SYNC":
      return { ...state, kdsSetup: normaliseKdsSetup(action.setup) };

    /** The expediter passes the order; the floor plan follows. */
    case "ORDER_SERVE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const lines = order.lines.map((l) =>
        l.state === "ready" ? { ...l, state: "served" as const } : l,
      );
      let next = putOrder(state, { ...order, lines });
      // FR-KDS-040 — served, on every ticket of the order and each of its lines.
      const tickets = { ...next.tickets };
      for (const id of next.ticketIds) {
        const ticket = tickets[id];
        if (!ticket || ticket.orderId !== order.id || ticket.state !== "bumped") continue;
        tickets[id] = {
          ...ticket,
          timeline: stamp(ticket.timeline, "servedAt", action.at),
          lines: ticket.lines.map((line) =>
            line.state === "voided" ? line : { ...line, timeline: stamp(line.timeline, "servedAt", action.at) },
          ),
        };
      }
      next = { ...next, tickets };
      next = setTable(next, order.tableId, { state: "food_served" });
      // FR-POS-081/083 — the tables pushed together are served too.
      for (const linked of order.linkedTableIds ?? []) {
        next = setTable(next, linked, { state: "food_served" });
      }
      return next;
    }

    /*
      FR-POS-082 — merge tables, physically.

      Pushing a free table up against a seated party is the other half of
      "merging tables": there is no second bill to fold in, only a second
      table that now belongs to this order. It shows as occupied by the order
      on the floor, it is released with the order, and both directions are
      audited.
    */
    case "ORDER_LINK_TABLE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order) || order.orderType !== "dine_in") return state;
      if (action.tableId === order.tableId || (order.linkedTableIds ?? []).includes(action.tableId)) return state;
      const table = state.tableStates[action.tableId] ?? seededTables.find((t) => t.id === action.tableId);
      if (!table || table.branchId !== state.branchId || table.state !== "available") return state;
      const primary = order.tableId ? (state.tableStates[order.tableId] ?? null) : null;
      let next = putOrder(state, { ...order, linkedTableIds: [...(order.linkedTableIds ?? []), table.id] });
      next = setTable(next, table.id, {
        state: primary?.state && primary.state !== "available" ? primary.state : "seated",
        orderId: order.id,
        seatedAt: primary?.seatedAt ?? action.at,
        serverId: primary?.serverId ?? null,
      });
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.table.linked",
          entityType: "order",
          entityId: order.id,
          before: { table: order.tableLabel, linked: (order.linkedTableIds ?? []).length },
          after: { table: order.tableLabel, joined: table.label },
        })),
      );
    }

    case "ORDER_UNLINK_TABLE": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;
      const linked = order.linkedTableIds ?? [];
      if (!linked.includes(action.tableId)) return state;
      const table = state.tableStates[action.tableId] ?? seededTables.find((t) => t.id === action.tableId);
      let next = putOrder(state, { ...order, linkedTableIds: linked.filter((id) => id !== action.tableId) });
      next = setTable(next, action.tableId, { state: "needs_cleaning", orderId: null, seatedAt: null });
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.table.unlinked",
          entityType: "order",
          entityId: order.id,
          before: { joined: table?.label ?? action.tableId },
          after: { table: order.tableLabel },
        })),
      );
    }

    case "TABLE_STATE":
      return setTable(state, action.tableId, {
        state: action.state,
        ...(action.state === "available" ? { orderId: null, seatedAt: null } : {}),
      });

    case "ITEM_86": {
      const unavailable = { ...state.unavailable };
      if (action.reason) unavailable[action.menuItemId] = action.reason;
      else delete unavailable[action.menuItemId];
      const next = { ...state, unavailable };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: action.reason ? "menu.item.86" : "menu.item.restored",
          entityType: "menu_item",
          entityId: action.menuItemId,
          reasonText: action.reason,
        })),
      );
    }

    case "ITEM_86_OVERRIDE": {
      const approver = activeEmployees.find((e) => e.id === action.approvedBy);
      if (!approver) return state;
      // Re-approving the same item on the same order is a no-op rather than a
      // second audit entry — a double-tap is not a second decision.
      const already = state.overrides.some(
        (o) => o.orderId === action.orderId && o.menuItemId === action.menuItemId,
      );
      if (already) return state;

      const next: LiveState = {
        ...state,
        overrides: [
          {
            orderId: action.orderId,
            menuItemId: action.menuItemId,
            approvedBy: approver.id,
            approvedByName: approver.name,
            at: action.at,
          },
          ...state.overrides,
        ].slice(0, 200),
      };

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "menu.item.86.override",
          entityType: "menu_item",
          entityId: action.menuItemId,
          before: { unavailable: state.unavailable[action.menuItemId] ?? null },
          after: { orderId: action.orderId, approvedBy: approver.id },
          reasonText: state.unavailable[action.menuItemId] ?? null,
        })),
      );
    }

    // --- money -------------------------------------------------------------
    case "ORDER_PAY": {
      const order = state.orders[action.orderId];
      if (!order || !isEditable(order)) return state;

      let working = order;

      // FR-POS-063 — cash settles to the smallest coin in circulation, and
      // the difference is its own ledger amount, not a silent tax change.
      if (action.tender === "cash" && order.roundingAdjustment.amount === 0) {
        const outstanding = balanceOf(order);
        const { adjustment } = roundCash(outstanding, pack);
        if (action.amountMinor >= outstanding.amount + adjustment.amount) {
          working = { ...working, roundingAdjustment: adjustment };
        }
      }

      const remaining = balanceOf(working).amount;
      const applied = Math.min(action.amountMinor, Math.max(0, remaining));
      // Nothing applied against a real balance is a no-op, not a payment. A
      // fully comped order owes nothing and still settles on a zero payment.
      if (applied <= 0 && remaining > 0) return state;
      const tendered = action.tender === "cash" ? (action.tenderedMinor ?? applied) : applied;
      const change = Math.max(0, tendered - applied);

      // FR-POS-066 — the last four, the scheme, the authorisation code and
      // the terminal's reference, and nothing else, whatever was passed in.
      const card =
        action.tender === "card"
          ? retainCardData({
              last4: action.cardLast4,
              scheme: action.cardScheme,
              authorisationCode: action.authorisationCode,
              terminalReference: action.terminalReference,
            })
          : { cardLast4: null, cardScheme: null, authorisationCode: null, terminalReference: null };

      const payment = {
        id: mint.next("pay"),
        tender: action.tender,
        amount: money(applied, currency),
        tenderedAmount: money(tendered, currency),
        changeAmount: money(change, currency),
        tip: money(action.tipMinor, currency),
        cardLast4: card.cardLast4,
        cardScheme: card.cardScheme,
        // The terminal's own code when it gave one. FR-POS-065 — the minted
        // fallback doubles as the idempotency key.
        authorisationCode:
          action.tender === "card" ? (card.authorisationCode ?? `A${mint.next("").slice(-6)}`) : null,
        terminalReference: card.terminalReference,
        capturedAt: action.at,
      };

      const paidTotal = working.paidTotal.amount + applied;
      const settled = paidTotal >= working.grandTotal.amount + working.roundingAdjustment.amount;
      const closer = operatorOf(state);

      working = {
        ...working,
        payments: [...working.payments, payment],
        paidTotal: money(paidTotal, currency),
        tipTotal: money(working.tipTotal.amount + action.tipMinor, currency),
        state: settled ? "completed" : "partially_paid",
        completedAt: settled ? action.at : null,
        // FR-POS-007 — whoever took the settling payment closed the order.
        closedBy: settled ? closer.id : null,
        closedByName: settled ? closer.name : null,
      };

      let next = putOrder(state, working);

      if (settled) {
        // A line that was never sent to the kitchen still has to be accounted
        // for: the customer is paying for food, so it was made. Firing it here
        // routes it and depletes its ingredients, which is what stops a
        // counter sale from leaving the stock ledger untouched
        // (UC-POS-01 step 13).
        const unfired = working.lines.filter((l) => l.state === "pending");
        if (unfired.length > 0) {
          const fired = fireLines(next, mint, working, new Set(unfired.map((l) => l.id)), action.at);
          next = fired.state;
          working = fired.order;
        }

        // Anything still in the kitchen is served by the time the bill is paid.
        next = putOrder(next, {
          ...working,
          lines: working.lines.map((l) =>
            l.state === "voided" ? l : { ...l, state: "served" as const },
          ),
        });
        next = releaseTables(next, working);
        // The order stays selected so the receipt can be read, reprinted or
        // refunded. Starting the next order is what clears it.
      } else {
        next = setTable(next, working.tableId, { state: "payment_in_progress" });
      }

      next = recomputeSession(next);

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: settled ? "order.completed" : "order.payment.captured",
          entityType: "order",
          entityId: working.id,
          after: {
            tender: action.tender,
            amount: applied,
            paidTotal,
            grandTotal: working.grandTotal.amount,
            ...(card.cardLast4 ? { cardLast4: card.cardLast4, cardScheme: card.cardScheme } : {}),
          },
        })),
      );
    }

    case "ORDER_REFUND": {
      const order = state.orders[action.orderId];
      if (!order || !["completed", "partially_refunded"].includes(order.state)) return state;
      // FR-POS-073 — a refund always carries a reason.
      const reason = redactCardData(action.reason.trim());
      if (!reason && !action.reasonCode) return state;

      // FR-POS-072 — refunds may never exceed the original, in aggregate.
      const refundedSoFar = order.payments
        .filter((p) => p.amount.amount < 0)
        .reduce((s, p) => s + -p.amount.amount, 0);
      const refundable = order.paidTotal.amount - refundedSoFar;
      const amount = Math.min(action.amountMinor, Math.max(0, refundable));
      if (amount <= 0) return state;

      // FR-POS-073 — above the threshold, a manager, checked here too.
      if (refundNeedsApproval(amount, state.settings) && !approvalOk(state, action.approval)) return state;

      // FR-POS-074 — back to the original tender unless someone overrides it.
      const original = order.payments.find((p) => p.amount.amount > 0);
      const originalTender = original?.tender ?? "cash";

      const payment = {
        id: mint.next("pay"),
        tender: originalTender,
        amount: money(-amount, currency),
        tenderedAmount: money(-amount, currency),
        changeAmount: money(0, currency),
        tip: money(0, currency),
        // Back to the card it came from: the last four are what the acquirer
        // matches a refund on, and are the only card data a payment keeps.
        cardLast4: original?.cardLast4 ?? null,
        cardScheme: original?.cardScheme ?? null,
        authorisationCode: null,
        terminalReference: null,
        capturedAt: action.at,
      };

      const totalRefunded = refundedSoFar + amount;
      const fully = totalRefunded >= order.paidTotal.amount;

      let next = putOrder(state, {
        ...order,
        payments: [...order.payments, payment],
        state: fully ? "refunded" : "partially_refunded",
      });

      if (action.returnToStock) {
        const deltas = new Map<Id, { quantity: number; costMinor: number }>();
        for (const line of order.lines) {
          if (line.state === "voided") continue;
          for (const d of depletionFor(line)) {
            const existing = deltas.get(d.itemId);
            deltas.set(d.itemId, {
              quantity: (existing?.quantity ?? 0) - d.quantity,
              costMinor: (existing?.costMinor ?? 0) + d.costMinor,
            });
          }
        }
        next = applyStock(
          next,
          mint,
          [...deltas.entries()].map(([itemId, v]) => ({ itemId, ...v })),
          {
            at: action.at,
            movementType: "sale_reversal",
            referenceType: "order",
            referenceId: order.id,
            reasonCode: "refund_return",
            notes: reason,
          },
        );
      }

      next = recomputeSession(next);

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.refunded",
          entityType: "order",
          entityId: order.id,
          // FR-POS-075 — the whole order either side of the refund.
          before: orderSnapshot(order),
          after: {
            amount,
            tender: originalTender,
            returnToStock: action.returnToStock,
            refundedTotal: totalRefunded,
            ...orderSnapshot(next.orders[order.id]!),
          },
          reasonCode: action.reasonCode ?? null,
          reasonText: reason || null,
          approverName: action.approval?.approverName ?? null,
        })),
      );
    }

    // --- approvals — FR-POS-048, FR-SEC-031/032 ------------------------------
    case "APPROVAL_REQUEST": {
      if (!state.session) return state;
      const id = mint.next("apr");
      const request: RemoteApproval = {
        ...action.request,
        reason: redactCardData(action.request.reason),
        id,
        requestedAt: action.at,
        expiresAt: expiryFrom(action.at, state.settings.remoteApprovalMinutes),
        status: "pending",
        decidedBy: null,
        decidedByName: null,
        decidedAt: null,
        comment: null,
        applied: null,
      };
      const next = { ...state, approvals: [request, ...state.approvals].slice(0, 100) };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "approval.requested",
          entityType: "approval_request",
          entityId: id,
          after: {
            kind: request.kind,
            orderNumber: request.orderNumber,
            amount: request.amountMinor,
            to: request.targetApproverName?.en ?? "any manager on duty",
          },
          reasonText: request.reason,
        })),
      );
    }

    /*
      A manager decides. On approval the stored action is replayed with a
      remote stamp — so what is approved is exactly what was asked for, and
      it passes through the same checks as if it had been approved on the
      spot. If the order moved on while the request waited (paid, cancelled,
      outbid by a better discount) the replay changes nothing, and the
      request says so rather than looking like it worked.
    */
    case "APPROVAL_DECIDE": {
      const request = state.approvals.find((r) => r.id === action.requestId);
      if (!request || request.status !== "pending") return state;
      // FR-SEC-016 — nobody approves their own request.
      if (action.deciderId === request.requestedBy) return state;

      const replace = (patch: Partial<RemoteApproval>): LiveState => ({
        ...state,
        approvals: state.approvals.map((r) => (r.id === request.id ? { ...r, ...patch } : r)),
      });

      if (isExpired(request, action.at)) {
        const expired = replace({ status: "expired" });
        return commit(
          withAudit(expired, audit(state, mint, {
            at: action.at,
            action: "approval.expired",
            entityType: "approval_request",
            entityId: request.id,
            after: { orderNumber: request.orderNumber },
          })),
        );
      }

      const decided = replace({
        status: action.decision,
        decidedBy: action.deciderId,
        decidedByName: action.deciderName,
        decidedAt: action.at,
        comment: action.comment ? redactCardData(action.comment) : null,
      });
      let next = commit(
        withAudit(decided, audit(state, mint, {
          at: action.at,
          action: action.decision === "approved" ? "approval.approved" : "approval.rejected",
          entityType: "approval_request",
          entityId: request.id,
          after: { kind: request.kind, orderNumber: request.orderNumber, amount: request.amountMinor },
          reasonText: action.comment,
          approverName: action.deciderName,
        })),
      );
      if (action.decision !== "approved") return next;

      const stamp: ApprovalStamp = {
        approverId: action.deciderId,
        approverName: action.deciderName,
        method: "remote",
        at: action.at,
        requestId: request.id,
      };
      const replay = stampedAction(request.action, stamp, action.at);
      const before = next.audit.length;
      const applied = replay ? liveReducer(next, replay) : next;
      const worked = applied.audit.length > before;
      next = {
        ...applied,
        approvals: applied.approvals.map((r) => (r.id === request.id ? { ...r, applied: worked } : r)),
      };
      return next;
    }

    case "APPROVAL_WITHDRAW": {
      const request = state.approvals.find((r) => r.id === action.requestId);
      if (!request || request.status !== "pending") return state;
      const next: LiveState = {
        ...state,
        approvals: state.approvals.map((r) => (r.id === request.id ? { ...r, status: "withdrawn" } : r)),
      };
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "approval.withdrawn",
          entityType: "approval_request",
          entityId: request.id,
          after: { orderNumber: request.orderNumber },
        })),
      );
    }

    // --- floor — FR-POS-084 ---------------------------------------------------
    case "SECTIONS_SET": {
      const mine = action.sections
        .filter((s) => s.tableIds.length > 0 || s.serverId)
        .map((s) => ({ ...s, branchId: state.branchId }));
      // A table belongs to one section; a later section cannot also claim it.
      const claimed = new Set<Id>();
      const sections = mine.map((s) => {
        const tableIds = s.tableIds.filter((id) => !claimed.has(id));
        tableIds.forEach((id) => claimed.add(id));
        return { ...s, tableIds };
      });

      let next: LiveState = {
        ...state,
        sections: [...state.sections.filter((s) => s.branchId !== state.branchId), ...sections],
      };
      // The table's own `serverId` follows the section, so everything that
      // already reads it — the floor, the tables page — sees the assignment.
      for (const table of tablesOf(state)) {
        const section = sections.find((s) => s.tableIds.includes(table.id));
        next = setTable(next, table.id, { serverId: section?.serverId ?? null });
      }
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "floor.sections.updated",
          entityType: "branch",
          entityId: state.branchId,
          before: {
            sections: state.sections
              .filter((s) => s.branchId === state.branchId)
              .map((s) => ({ name: s.name, server: s.serverName?.en ?? null, tables: s.tableIds.length })),
          },
          after: {
            sections: sections.map((s) => ({ name: s.name, server: s.serverName?.en ?? null, tables: s.tableIds.length })),
          },
        })),
      );
    }

    // --- clock -------------------------------------------------------------
    case "TICK": {
      if (state.ticketIds.length === 0) return state;
      let changed = false;
      const tickets = { ...state.tickets };
      for (const id of state.ticketIds) {
        const ticket = tickets[id];
        // A cancelled ticket's clock is meaningless — nothing is being made.
        if (!ticket || ticket.state === "bumped" || ticket.state === "cancelled" || ticket.held) continue;
        const elapsed = Math.max(
          0,
          Math.floor((action.nowMs - new Date(ticket.firedAt).getTime()) / 1000),
        );
        const urgency = urgencyFor(elapsed, ticket.targetSeconds);
        if (elapsed !== ticket.elapsedSeconds || urgency !== ticket.urgency) {
          tickets[id] = { ...ticket, elapsedSeconds: elapsed, urgency };
          changed = true;
        }
      }
      return changed ? { ...state, tickets } : state;
    }

    default:
      return state;
  }
}

/**
 * The action a remote request asked for, carrying the manager's stamp.
 *
 * Only the actions a till can send for remote approval are replayable; a
 * request for anything else is decided but never executed.
 */
function stampedAction(action: LiveAction, stamp: ApprovalStamp, at: IsoDateTime): LiveAction | null {
  switch (action.type) {
    case "LINE_DISCOUNT":
    case "ORDER_DISCOUNT":
      return { ...action, at, discount: { ...action.discount, approval: stamp } };
    case "ORDER_REFUND":
    case "LINE_VOID":
    case "ORDER_CANCEL":
      return { ...action, at, approval: stamp };
    default:
      return null;
  }
}

function minuteOfDayFrom(iso: IsoDateTime): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

// ---------------------------------------------------------------------------
// Selectors used across the POS, the KDS and the console
// ---------------------------------------------------------------------------

export function openOrdersOf(state: LiveState): Order[] {
  return state.orderIds
    .map((id) => state.orders[id]!)
    .filter((o) => ["draft", "open", "held", "parked", "partially_paid"].includes(o.state));
}

export function completedOrdersOf(state: LiveState): Order[] {
  return state.orderIds
    .map((id) => state.orders[id]!)
    .filter((o) => o.state === "completed" || o.state === "partially_refunded" || o.state === "refunded");
}

export function activeTicketsOf(state: LiveState, stationId?: Id): KitchenTicket[] {
  return state.ticketIds
    .map((id) => state.tickets[id]!)
    .filter((t) => t.state !== "bumped")
    .filter((t) => !stationId || t.stationId === stationId);
}

export function tablesOf(state: LiveState) {
  return seededTables
    .filter((t) => t.branchId === state.branchId)
    .map((t) => state.tableStates[t.id] ?? t);
}

export function menuItemsForBranch(branchId: Id) {
  const brandId = branchById.get(branchId)?.brandId;
  const brandCode = branches.find((b) => b.id === branchId)?.code.split("-")[0];
  return [...menuItemById.values()].filter((item) => {
    const code = menuItemBrandCode.get(item.id);
    return brandId ? code === brandCode : true;
  });
}

/** Live on-hand for one item at the terminal's branch, in base units. */
export function onHandOf(state: LiveState, itemId: Id): number {
  return state.stock[stockKey(state.branchId, itemId)] ?? 0;
}

/**
 * FR-MNU-033 — how many more of an item the branch can actually make, taken
 * as the minimum over its ingredients of (on hand ÷ per-portion need).
 */
export function remainingSellable(state: LiveState, recipeId: Id | null): number | null {
  if (!recipeId) return null;
  const recipe = recipeById.get(recipeId);
  if (!recipe) return null;

  let limit = Infinity;
  for (const line of recipe.lines) {
    if (line.componentType !== "stock_item") continue;
    const need = Number(line.quantity.value) * (1 + line.wastagePercentage / 100);
    if (need <= 0) continue;
    limit = Math.min(limit, Math.floor(onHandOf(state, line.componentId) / need));
  }
  return Number.isFinite(limit) ? Math.max(0, limit) : null;
}

export { DEFAULT_SETTINGS };
