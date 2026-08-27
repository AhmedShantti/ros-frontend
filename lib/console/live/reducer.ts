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
  CostingMethod,
  AuditEntry,
  DenominationCount,
  Id,
  IsoDateTime,
  KitchenTicket,
  Localised,
  Money,
  Order,
  OrderLine,
  OrderLineModifier,
  OrderType,
  StockMovement,
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
import {
  balanceOf,
  computeLine,
  computeOrderTotals,
  expandLineToStock,
  passStation,
  resolvePrice,
  roundCash,
  routeLine,
  urgencyFor,
} from "./engine";
import {
  DEFAULT_SETTINGS,
  initialLiveState,
  recallableAt,
  type CostLayer,
  stockKey,
  upsertAlert,
  type LiveCashSession,
  type LiveState,
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

const modifierById = new Map(
  modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)),
);

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
  approvedByName: Localised | null;
}

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
    }
  | { type: "ORDER_SELECT"; at: IsoDateTime; orderId: Id | null }
  | { type: "ORDER_SET_GUESTS"; at: IsoDateTime; orderId: Id; guestCount: number }
  | { type: "ORDER_PARK"; at: IsoDateTime; orderId: Id }
  | { type: "ORDER_RESUME"; at: IsoDateTime; orderId: Id }
  | { type: "ORDER_CANCEL"; at: IsoDateTime; orderId: Id; reason: string }
  | { type: "ORDER_MOVE_TABLE"; at: IsoDateTime; orderId: Id; tableId: Id }
  | { type: "ORDER_NOTE"; at: IsoDateTime; orderId: Id; note: string }
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
    }
  | { type: "LINE_QTY"; at: IsoDateTime; orderId: Id; lineId: Id; quantity: number }
  | { type: "LINE_NOTE"; at: IsoDateTime; orderId: Id; lineId: Id; notes: string | null }
  /** FR-POS-036 — lines are grouped into courses and fired independently. */
  | { type: "LINE_COURSE"; at: IsoDateTime; orderId: Id; lineId: Id; course: number }
  | {
      type: "LINE_VOID";
      at: IsoDateTime;
      orderId: Id;
      lineId: Id;
      reason: string;
      disposition: VoidDisposition | null;
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
  | { type: "ORDER_DISCOUNT_CLEAR"; at: IsoDateTime; orderId: Id }
  | { type: "ORDER_FIRE"; at: IsoDateTime; orderId: Id; course: number | null }
  | {
      type: "ORDER_PAY";
      at: IsoDateTime;
      orderId: Id;
      tender: TenderType;
      amountMinor: number;
      tipMinor: number;
      cardLast4?: string | null;
      cardScheme?: string | null;
    }
  | {
      type: "ORDER_REFUND";
      at: IsoDateTime;
      orderId: Id;
      amountMinor: number;
      reason: string;
      returnToStock: boolean;
    }
  | { type: "TICKET_START"; at: IsoDateTime; ticketId: Id }
  | { type: "TICKET_BUMP_LINE"; at: IsoDateTime; ticketId: Id; lineId: Id }
  | { type: "TICKET_BUMP"; at: IsoDateTime; ticketId: Id }
  | { type: "TICKET_RECALL"; at: IsoDateTime; ticketId: Id }
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
  const withLines = {
    ...order,
    lines: order.lines.map((line) => {
      const item = menuItemById.get(line.menuItemId);
      return computeLine(line, item?.taxClass ?? "standard", pack);
    }),
  };
  const orderDiscount = withLines.discounts.reduce((sum, d) => sum + d.amount.amount, 0);
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
  return expandLineToStock(line, recipeById, modifierById);
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function ticketLineFrom(line: OrderLine): TicketLine {
  return {
    id: line.id,
    name: menuItemById.get(line.menuItemId)?.kitchenName ?? line.itemNameSnapshot,
    quantity: line.quantity,
    modifiers: line.modifiers.map((m) => ({ name: m.name, kind: m.kind })),
    state: line.state,
    notes: line.notes,
  };
}

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
): { state: LiveState; order: Order } {
  const branchStations = stationsByBranch.get(state.branchId) ?? [];
  const byStation = new Map<Id, OrderLine[]>();

  const lines = order.lines.map((line) => {
    if (!lineIds.has(line.id) || line.state !== "pending") return line;
    const item = menuItemById.get(line.menuItemId);
    const station = routeLine(line, item, branchStations);
    const fired: OrderLine = {
      ...line,
      state: "fired",
      firedAt: at,
      stationId: station?.id ?? null,
    };
    if (station) {
      const list = byStation.get(station.id) ?? [];
      list.push(fired);
      byStation.set(station.id, list);
    }
    return fired;
  });

  let next = state;
  const tickets = { ...next.tickets };
  const ticketIds = [...next.ticketIds];

  for (const [stationId, stationLines] of byStation) {
    const station = branchStations.find((s) => s.id === stationId)!;
    const course = stationLines[0]!.course;
    const targetSeconds = Math.max(
      ...stationLines.map((l) => menuItemById.get(l.menuItemId)?.prepTimeSeconds ?? 300),
    );

    const openTicket = ticketIds
      .map((id) => tickets[id]!)
      .find(
        (t) =>
          t.orderId === order.id &&
          t.stationId === stationId &&
          t.course === course &&
          (t.state === "queued" || t.state === "started"),
      );

    if (openTicket) {
      tickets[openTicket.id] = {
        ...openTicket,
        lines: [...openTicket.lines, ...stationLines.map(ticketLineFrom)],
        // The amendment is visually distinct on the station display, and the
        // elapsed clock keeps running from the original fire.
        priority: openTicket.priority === "normal" ? "remake" : openTicket.priority,
      };
      continue;
    }

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
      priority: order.orderType === "delivery" ? "rush" : "normal",
      firedAt: at,
      startedAt: null,
      bumpedAt: null,
      cancelReason: null,
      targetSeconds,
      elapsedSeconds: 0,
      lines: stationLines.map(ticketLineFrom),
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

  const readyLineIds = new Set<Id>();
  for (const id of state.ticketIds) {
    const ticket = state.tickets[id];
    if (!ticket || ticket.orderId !== orderId) continue;
    for (const line of ticket.lines) {
      if (line.state === "ready" || ticket.state === "bumped") readyLineIds.add(line.id);
    }
  }

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
  let orderCount = 0;

  for (const id of state.orderIds) {
    const order = state.orders[id];
    if (!order) continue;
    if (order.state === "completed" || order.state === "partially_refunded" || order.state === "refunded") {
      orderCount += 1;
    }
    for (const payment of order.payments) {
      if (payment.tender !== "cash") continue;
      if (payment.amount.amount >= 0) cashSales += payment.amount.amount;
      else cashRefunds += -payment.amount.amount;
    }
  }

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
    },
  };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const mint = minter(state);
  const currency = currencyOf(state);
  const pack = packForBranch(state.branchId);

  const commit = (next: LiveState): LiveState => ({ ...next, idSeq: mint.seq });

  switch (action.type) {
    // -----------------------------------------------------------------------
    case "RESET":
      return initialLiveState(action.branchId ?? state.branchId);

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
        servedByName: operator.name,
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
        syncState: "local",
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
        serverId: operator.id,
      });

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
      return putOrder(state, { ...order, notes: action.note || null });
    }

    case "ORDER_PARK": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const next = putOrder(state, { ...order, state: "parked" });
      return { ...next, activeOrderId: null };
    }

    case "ORDER_RESUME": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const next = putOrder(state, {
        ...order,
        state: order.firstFiredAt ? "open" : "draft",
      });
      return { ...next, activeOrderId: order.id };
    }

    case "ORDER_MOVE_TABLE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
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

    case "ORDER_CANCEL": {
      const order = state.orders[action.orderId];
      if (!order) return state;

      let next = state;
      // Pre-fire lines simply disappear; fired lines already cost us the food.
      const lines = order.lines.map((line) =>
        line.state === "pending"
          ? { ...line, state: "voided" as const, voidReason: action.reason }
          : line.state === "voided"
            ? line
            : { ...line, state: "voided" as const, voidReason: action.reason },
      );

      next = putOrder(next, retotal(next, { ...order, lines, state: "cancelled" }));

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
        const reason = wasteReasonByCode.get("order_error")!;
        const currency = currencyOf(state);

        const records: WasteRecord[] = cooked.map((line) => ({
          id: mint.next("wst"),
          tenantId: branch.tenantId,
          locationId: branch.id,
          locationName: branch.name,
          itemId: line.menuItemId,
          itemName: line.itemNameSnapshot,
          quantity: { value: line.quantity.toFixed(3), unit: "pc" },
          reasonCode: reason.code,
          reasonName: reason.name,
          category: reason.category,
          isTrueWaste: reason.isTrueWaste,
          value: money(line.unitCostSnapshot.amount, currency),
          recordedAt: action.at,
          recordedBy: operator.id,
          recordedByName: operator.name,
          stationId: line.stationId,
          approval: "not_required",
          notes: action.reason,
        }));

        next = { ...next, waste: [...records, ...next.waste].slice(0, 400) };
      }
      next = setTable(next, order.tableId, {
        state: "needs_cleaning",
        orderId: null,
        seatedAt: null,
      });
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
            cancelReason: action.reason,
            lines: ticket.lines.map((l) => ({ ...l, state: "voided" as const })),
          };
        }
      }
      next = { ...next, tickets };

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.cancelled",
          entityType: "order",
          entityId: order.id,
          before: { state: order.state, total: order.grandTotal.amount },
          after: { state: "cancelled" },
          reasonText: action.reason,
        })),
      );
    }

    // --- lines -------------------------------------------------------------
    case "LINE_ADD": {
      const order = state.orders[action.orderId];
      const item = menuItemById.get(action.menuItemId);
      if (!order || !item) return state;
      const variant = item.variants.find((v) => v.id === action.variantId);
      if (!variant) return state;

      const branch = branchById.get(state.branchId)!;
      const minuteOfDay = minuteOfDayFrom(action.at);
      const price = resolvePrice(item, variant, {
        orderType: order.orderType,
        branchId: branch.id,
        brandId: branch.brandId,
        minuteOfDay,
        priceLists,
        overrideMinor: action.openPriceMinor ?? null,
      });

      const modifiers: OrderLineModifier[] = action.modifierIds
        .map((id) => modifierById.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          priceDelta: m.priceDelta,
        }));

      const recipe = variant.recipeId ? recipeById.get(variant.recipeId) : undefined;
      const unitCost = recipe?.computedCost.amount ?? 0;
      const sequence = order.lines.length + 1;

      const line: OrderLine = {
        id: mint.next("oln"),
        sequence,
        menuItemId: item.id,
        variantId: variant.id,
        // BR-POS-004 — the name is snapshotted, never re-derived from master data.
        itemNameSnapshot: {
          en: `${item.name.en} — ${variant.name.en}`,
          ar: `${item.name.ar} — ${variant.name.ar}`,
        },
        quantity: action.quantity,
        unitPrice: price.price,
        modifiers,
        modifierTotal: money(0, currency),
        lineDiscount: money(0, currency),
        lineSubtotal: money(0, currency),
        taxAmount: money(0, currency),
        lineTotal: money(0, currency),
        unitCostSnapshot: money(unitCost * action.quantity, currency),
        recipeVersionId: variant.recipeId,
        course: action.course,
        seatNumber: action.seatNumber,
        state: "pending",
        stationId: null,
        firedAt: null,
        readyAt: null,
        voidReason: null,
        isComp: false,
        notes: action.notes,
      };

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

    case "LINE_QTY": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const quantity = Math.max(1, Math.min(99, action.quantity));
      const lines = order.lines.map((line) => {
        if (line.id !== action.lineId || line.state !== "pending") return line;
        const recipe = line.recipeVersionId ? recipeById.get(line.recipeVersionId) : undefined;
        return {
          ...line,
          quantity,
          unitCostSnapshot: money((recipe?.computedCost.amount ?? 0) * quantity, currency),
        };
      });
      return putOrder(state, retotal(state, { ...order, lines }));
    }

    case "LINE_NOTE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const lines = order.lines.map((line) =>
        line.id === action.lineId ? { ...line, notes: action.notes } : line,
      );
      return putOrder(state, { ...order, lines });
    }

    case "LINE_COURSE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const lines = order.lines.map((line) =>
        line.id === action.lineId && line.state === "pending"
          ? { ...line, course: action.course }
          : line,
      );
      return putOrder(state, { ...order, lines });
    }

    case "LINE_VOID": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const line = order.lines.find((l) => l.id === action.lineId);
      if (!line || line.state === "voided") return state;

      const preFire = line.state === "pending";
      let next = state;

      // Pre-fire: nothing was made, so the line just leaves the order.
      const lines = preFire
        ? order.lines.filter((l) => l.id !== line.id).map((l, i) => ({ ...l, sequence: i + 1 }))
        : order.lines.map((l) =>
            l.id === line.id
              ? { ...l, state: "voided" as const, voidReason: action.reason }
              : l,
          );

      next = putOrder(next, retotal(next, { ...order, lines }));

      // Post-fire: the food exists. FR-POS-071 makes the cook say where it went.
      if (!preFire) {
        const deltas = depletionFor(line);
        if (action.disposition === "returned_to_stock") {
          next = applyStock(
            next,
            mint,
            deltas.map((d) => ({ itemId: d.itemId, quantity: -d.quantity, costMinor: d.costMinor })),
            {
              at: action.at,
              movementType: "sale_reversal",
              referenceType: "order_line",
              referenceId: line.id,
              reasonCode: "void_return",
              notes: action.reason,
            },
          );
        } else if (action.disposition) {
          const reasonCode = action.disposition === "staff_meal" ? "staff_meal" : "order_error";
          const reason = wasteReasonByCode.get(reasonCode)!;
          const branch = branchById.get(state.branchId)!;
          const operator = operatorOf(state);
          const value = line.unitCostSnapshot.amount;

          // Stock already left at fire time; this record classifies why, so
          // the loss lands in waste rather than in unexplained variance.
          const record: WasteRecord = {
            id: mint.next("wst"),
            tenantId: branch.tenantId,
            locationId: branch.id,
            locationName: branch.name,
            itemId: line.menuItemId,
            itemName: line.itemNameSnapshot,
            quantity: { value: line.quantity.toFixed(3), unit: "pc" },
            reasonCode: reason.code,
            reasonName: reason.name,
            category: reason.category,
            isTrueWaste: reason.isTrueWaste,
            value: money(value, currency),
            recordedAt: action.at,
            recordedBy: operator.id,
            recordedByName: operator.name,
            stationId: line.stationId,
            approval: "not_required",
            notes: action.reason,
          };
          next = { ...next, waste: [record, ...next.waste].slice(0, 400) };
        }

        // Strike the line through on the station display — FR-KDS-029.
        const tickets = { ...next.tickets };
        for (const id of next.ticketIds) {
          const ticket = tickets[id];
          if (!ticket || ticket.orderId !== order.id) continue;
          if (!ticket.lines.some((l) => l.id === line.id)) continue;
          tickets[id] = {
            ...ticket,
            lines: ticket.lines.map((l) =>
              l.id === line.id ? { ...l, state: "voided" as const } : l,
            ),
          };
        }
        next = { ...next, tickets };
      }

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: preFire ? "order.line.voided.prefire" : "order.line.voided.postfire",
          entityType: "order_line",
          entityId: line.id,
          before: { state: line.state, total: line.lineTotal.amount },
          after: { state: "voided", disposition: action.disposition },
          reasonText: action.reason,
        })),
      );
    }

    case "LINE_COMP": {
      const order = state.orders[action.orderId];
      if (!order) return state;
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

    case "LINE_DISCOUNT": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const lines = order.lines.map((line) => {
        if (line.id !== action.lineId) return line;
        const gross =
          (line.unitPrice.amount +
            line.modifiers.reduce((s, m) => s + m.priceDelta.amount, 0)) *
          line.quantity;
        const amount =
          action.discount.amountMinor ??
          Math.round((gross * (action.discount.percentage ?? 0)) / 100);
        return { ...line, lineDiscount: money(Math.min(amount, gross), currency) };
      });

      const next = putOrder(state, retotal(state, { ...order, lines }));
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.discount.applied",
          entityType: "order_line",
          entityId: action.lineId,
          after: {
            percentage: action.discount.percentage,
            amount: action.discount.amountMinor,
          },
          reasonText: action.discount.reason.en,
          approverName: action.discount.approvedByName,
        })),
      );
    }

    case "ORDER_DISCOUNT": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const operator = operatorOf(state);
      const base = order.lines
        .filter((l) => l.state !== "voided" && !l.isComp)
        .reduce((s, l) => s + l.lineSubtotal.amount, 0);
      const amount =
        action.discount.amountMinor ??
        Math.round((base * (action.discount.percentage ?? 0)) / 100);

      const discount = {
        id: mint.next("dsc"),
        reason: action.discount.reason,
        percentage: action.discount.percentage,
        amount: money(Math.min(amount, base), currency),
        appliedBy: operator.name,
        approvedBy: action.discount.approvedByName,
        appliedAt: action.at,
      };

      const next = putOrder(
        state,
        retotal(state, { ...order, discounts: [...order.discounts, discount] }),
      );
      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.discount.applied",
          entityType: "order",
          entityId: order.id,
          after: { amount: discount.amount.amount, percentage: action.discount.percentage },
          reasonText: action.discount.reason.en,
          approverName: action.discount.approvedByName,
        })),
      );
    }

    case "ORDER_DISCOUNT_CLEAR": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      return putOrder(state, retotal(state, { ...order, discounts: [] }));
    }

    // --- kitchen -----------------------------------------------------------
    case "ORDER_FIRE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      // FR-POS-003 — a dine-in order needs a table before it reaches the kitchen.
      if (order.orderType === "dine_in" && !order.tableId) return state;

      const target = order.lines.filter(
        (l) => l.state === "pending" && (action.course === null || l.course === action.course),
      );
      if (target.length === 0) return state;

      const fired = fireLines(state, mint, order, new Set(target.map((l) => l.id)), action.at);
      let next = putOrder(fired.state, retotal(fired.state, fired.order));
      next = setTable(next, order.tableId, { state: "ordered" });

      return commit(
        withAudit(next, audit(state, mint, {
          at: action.at,
          action: "order.line.fired",
          entityType: "order",
          entityId: order.id,
          after: { lines: target.length, course: action.course },
        })),
      );
    }

    case "TICKET_START": {
      const ticket = state.tickets[action.ticketId];
      if (!ticket || ticket.state !== "queued") return state;
      return {
        ...state,
        tickets: {
          ...state.tickets,
          // Stamped once and never overwritten: a ticket amended after work
          // began is still work that began when it began.
          [ticket.id]: { ...ticket, state: "started", startedAt: ticket.startedAt ?? action.at },
        },
      };
    }

    case "TICKET_BUMP_LINE": {
      const ticket = state.tickets[action.ticketId];
      // Nothing on a cancelled ticket can be marked ready — the food is not
      // going anywhere, and readying a line would re-open it as work.
      if (!ticket || ticket.state === "cancelled") return state;
      const lines = ticket.lines.map((l) =>
        l.id === action.lineId && l.state !== "voided" ? { ...l, state: "ready" as const } : l,
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
          },
        },
        recallable: allReady
          ? recallableAt([{ id: ticket.id, bumpedAt: action.at }, ...state.recallable], action.at)
          : recallableAt(state.recallable, action.at),
      };
      next = syncOrderFromTickets(next, ticket.orderId, action.at);
      return next;
    }

    case "TICKET_BUMP": {
      const ticket = state.tickets[action.ticketId];
      // A cancelled ticket leaves via TICKET_ACK_CANCEL. Bumping it would
      // record food as made and served, and make it recallable.
      if (!ticket || ticket.state === "bumped" || ticket.state === "cancelled") return state;
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
            lines: ticket.lines.map((l) =>
              l.state === "voided" ? l : { ...l, state: "ready" as const },
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
          [ticket.id]: { ...ticket, state: "bumped", bumpedAt: action.at },
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
            lines: ticket.lines.map((l) =>
              l.state === "voided" ? l : { ...l, state: "fired" as const },
            ),
          },
        },
        recallable: state.recallable.filter((entry) => entry.id !== ticket.id),
      };
      const order = next.orders[ticket.orderId];
      if (!order) return next;
      const ids = new Set(ticket.lines.map((l) => l.id));
      return putOrder(next, {
        ...order,
        lines: order.lines.map((l) =>
          ids.has(l.id) && l.state === "ready"
            ? { ...l, state: "fired" as const, readyAt: null }
            : l,
        ),
      });
    }

    case "TICKET_PRIORITY": {
      const ticket = state.tickets[action.ticketId];
      if (!ticket) return state;
      return {
        ...state,
        tickets: {
          ...state.tickets,
          [ticket.id]: { ...ticket, priority: action.priority },
        },
      };
    }

    /** The expediter passes the order; the floor plan follows. */
    case "ORDER_SERVE": {
      const order = state.orders[action.orderId];
      if (!order) return state;
      const lines = order.lines.map((l) =>
        l.state === "ready" ? { ...l, state: "served" as const } : l,
      );
      let next = putOrder(state, { ...order, lines });
      next = setTable(next, order.tableId, { state: "food_served" });
      return next;
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
      if (!order) return state;

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

      const payment = {
        id: mint.next("pay"),
        tender: action.tender,
        amount: money(applied, currency),
        tip: money(action.tipMinor, currency),
        cardLast4: action.cardLast4 ?? null,
        cardScheme: action.cardScheme ?? null,
        // FR-POS-065 — the reference doubles as the idempotency key.
        authorisationCode: action.tender === "card" ? `A${mint.next("").slice(-6)}` : null,
        capturedAt: action.at,
      };

      const paidTotal = working.paidTotal.amount + applied;
      const settled = paidTotal >= working.grandTotal.amount + working.roundingAdjustment.amount;

      working = {
        ...working,
        payments: [...working.payments, payment],
        paidTotal: money(paidTotal, currency),
        tipTotal: money(working.tipTotal.amount + action.tipMinor, currency),
        state: settled ? "completed" : "partially_paid",
        completedAt: settled ? action.at : null,
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
        next = setTable(next, working.tableId, {
          state: "needs_cleaning",
          orderId: null,
          seatedAt: null,
        });
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
          },
        })),
      );
    }

    case "ORDER_REFUND": {
      const order = state.orders[action.orderId];
      if (!order) return state;

      // FR-POS-072 — refunds may never exceed the original, in aggregate.
      const refundedSoFar = order.payments
        .filter((p) => p.amount.amount < 0)
        .reduce((s, p) => s + -p.amount.amount, 0);
      const refundable = order.paidTotal.amount - refundedSoFar;
      const amount = Math.min(action.amountMinor, Math.max(0, refundable));
      if (amount <= 0) return state;

      // FR-POS-074 — back to the original tender unless someone overrides it.
      const originalTender = order.payments[0]?.tender ?? "cash";

      const payment = {
        id: mint.next("pay"),
        tender: originalTender,
        amount: money(-amount, currency),
        tip: money(0, currency),
        cardLast4: null,
        cardScheme: null,
        authorisationCode: null,
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
            notes: action.reason,
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
          before: { paidTotal: order.paidTotal.amount },
          after: { refunded: amount, returnToStock: action.returnToStock },
          reasonText: action.reason,
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
        if (!ticket || ticket.state === "bumped" || ticket.state === "cancelled") continue;
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
