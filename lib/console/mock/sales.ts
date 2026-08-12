/**
 * Sales fixtures — orders, order lines, payments and kitchen tickets.
 * SRS §7.4.1, ch.8, ch.9.
 *
 * Line-level tax, then summed (FR-FIN-034). Item name, price, tax class and
 * unit cost are snapshotted onto the line (BR-POS-004) rather than joined
 * from master data, so a later price change cannot restate history.
 */

import type {
  KitchenTicket,
  Money,
  Order,
  OrderChannel,
  OrderLine,
  OrderLineModifier,
  OrderLineState,
  OrderPayment,
  OrderState,
  OrderType,
  TenderType,
  TicketLine,
  TicketState,
} from "../types";
import { ACTIVE_TENANT_ID, branches, stations, tables, terminals } from "./org";
import { menuItems, recipeById } from "./catalogue";
import { activeEmployees } from "./workforce";
import { chance, createRng, int, pick, seqId } from "./rng";
import { BUSINESS_DAY, dateAgo, minutesAgo, NOW_MS } from "./clock";

const rng = createRng(0x3ea7);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

const TAX_RATE = 0.14; // EG country pack, standard class.

const ORDER_TYPE_POOL: OrderType[] = [
  "dine_in", "dine_in", "dine_in", "takeaway", "takeaway",
  "delivery", "delivery", "aggregator", "aggregator", "pickup", "drive_thru",
];

const CHANNEL_FOR_TYPE: Record<OrderType, OrderChannel[]> = {
  dine_in: ["pos", "pos", "qr"],
  takeaway: ["pos", "kiosk"],
  delivery: ["pos", "phone", "api"],
  drive_thru: ["pos"],
  pickup: ["pos", "qr"],
  aggregator: ["aggregator"],
};

const TENDER_POOL: TenderType[] = [
  "cash", "cash", "cash", "card", "card", "card", "card",
  "wallet", "voucher", "loyalty_points", "aggregator_settled",
];

const CARD_SCHEMES = ["Visa", "Mastercard", "Meeza"];

const AGGREGATORS = ["Talabat", "Elmenus", "Careem", "HungerStation"];

const CUSTOMER_NAMES = [
  { en: "Rana Hosny", ar: "رنا حسني" },
  { en: "Marwan Zaki", ar: "مروان زكي" },
  { en: "Layla Fahmy", ar: "ليلى فهمي" },
  { en: "Sherif Kamal", ar: "شريف كمال" },
  { en: "Yara Nabil", ar: "يارا نبيل" },
];

const VOID_REASONS = [
  "Customer changed their mind",
  "Wrong item entered",
  "Kitchen unable to prepare",
  "Quality issue",
];

const DISCOUNT_REASONS = [
  { en: "Staff discount", ar: "خصم موظفين" },
  { en: "Service recovery", ar: "تعويض خدمة" },
  { en: "Loyalty tier benefit", ar: "ميزة مستوى الولاء" },
  { en: "Promotional campaign", ar: "حملة ترويجية" },
  { en: "Manager goodwill", ar: "مجاملة من المدير" },
];

/** Terminals that can originate an order, grouped per branch. */
const posByBranch = new Map<string, typeof terminals>();
for (const terminal of terminals) {
  if (terminal.kind !== "pos" || terminal.status === "revoked") continue;
  const list = posByBranch.get(terminal.branchId) ?? [];
  list.push(terminal);
  posByBranch.set(terminal.branchId, list);
}

const employeesByBranch = new Map<string, typeof activeEmployees>();
for (const employee of activeEmployees) {
  const list = employeesByBranch.get(employee.homeBranchId) ?? [];
  list.push(employee);
  employeesByBranch.set(employee.homeBranchId, list);
}

const tablesByBranch = new Map<string, typeof tables>();
for (const table of tables) {
  const list = tablesByBranch.get(table.branchId) ?? [];
  list.push(table);
  tablesByBranch.set(table.branchId, list);
}

const stationsByBranch = new Map<string, typeof stations>();
for (const station of stations) {
  const list = stationsByBranch.get(station.branchId) ?? [];
  list.push(station);
  stationsByBranch.set(station.branchId, list);
}

/** Unit cost for a variant, from its published recipe. Zero when incomplete. */
function unitCostFor(variantRecipeId: string | null): number {
  if (!variantRecipeId) return 0;
  return recipeById.get(variantRecipeId)?.computedCost.amount ?? 0;
}

function buildLine(index: number, seq: number, state: OrderLineState): OrderLine {
  const menuItem = menuItems[(index * 13 + seq * 7) % menuItems.length]!;
  const variant = menuItem.variants[int(rng, 0, menuItem.variants.length - 1)]!;
  const quantity = chance(rng, 0.78) ? 1 : int(rng, 2, 4);

  const modifiers: OrderLineModifier[] = [];
  if (chance(rng, 0.34)) {
    modifiers.push({
      id: `olm_${index}_${seq}_a`,
      name: { en: "Extra cheese", ar: "جبنة إضافية" },
      kind: "addition",
      priceDelta: EGP(1000),
    });
  }
  if (chance(rng, 0.18)) {
    modifiers.push({
      id: `olm_${index}_${seq}_r`,
      name: { en: "No onion", ar: "بدون بصل" },
      kind: "removal",
      priceDelta: EGP(0),
    });
  }

  const unitPrice = variant.basePrice.amount;
  const modifierTotal = modifiers.reduce((s, m) => s + m.priceDelta.amount, 0);
  const gross = unitPrice * quantity + modifierTotal;
  const lineDiscount = chance(rng, 0.1) ? Math.round(gross * 0.1) : 0;
  const subtotal = gross - lineDiscount;
  // Tax-inclusive pricing per the EG pack: back the tax out of the price.
  const tax = Math.round(subtotal - subtotal / (1 + TAX_RATE));

  const isComp = state === "comped";

  return {
    id: `oln_${index}_${seq}`,
    sequence: seq,
    menuItemId: menuItem.id,
    variantId: variant.id,
    itemNameSnapshot: {
      en: `${menuItem.name.en} — ${variant.name.en}`,
      ar: `${menuItem.name.ar} — ${variant.name.ar}`,
    },
    quantity,
    unitPrice: variant.basePrice,
    modifiers,
    modifierTotal: EGP(modifierTotal),
    lineDiscount: EGP(lineDiscount),
    lineSubtotal: EGP(subtotal),
    taxAmount: EGP(tax),
    lineTotal: EGP(isComp ? 0 : subtotal),
    // Cost is recognised even on a comp — FR-POS-050.
    unitCostSnapshot: EGP(unitCostFor(variant.recipeId) * quantity),
    recipeVersionId: variant.recipeId,
    course: chance(rng, 0.3) ? int(rng, 1, 3) : 1,
    seatNumber: chance(rng, 0.25) ? int(rng, 1, 6) : null,
    state,
    stationId: null,
    firedAt: state === "pending" ? null : minutesAgo(int(rng, 2, 90)),
    readyAt: ["ready", "served"].includes(state) ? minutesAgo(int(rng, 1, 40)) : null,
    voidReason: state === "voided" ? pick(rng, VOID_REASONS) : null,
    isComp,
    notes: chance(rng, 0.12) ? "Well done, no salt." : null,
  };
}

const STATE_POOL: OrderState[] = [
  "completed", "completed", "completed", "completed", "completed", "completed",
  "completed", "completed", "completed", "completed",
  "open", "open", "partially_paid", "held", "parked",
  "cancelled", "refunded", "partially_refunded", "draft",
];

export const orders: Order[] = (() => {
  const out: Order[] = [];
  const sequenceByBranch = new Map<string, number>();

  for (let i = 1; i <= 260; i += 1) {
    const branch = branches[i % branches.length]!;
    const pos = posByBranch.get(branch.id) ?? [];
    if (pos.length === 0) continue;
    const terminal = pos[i % pos.length]!;
    const staff = employeesByBranch.get(branch.id) ?? activeEmployees;
    const opener = staff[(i * 3) % staff.length]!;
    const server = staff[(i * 5) % staff.length]!;

    const state = STATE_POOL[(i - 1) % STATE_POOL.length]!;
    let orderType = ORDER_TYPE_POOL[(i * 3) % ORDER_TYPE_POOL.length]!;
    // A cloud kitchen has no dining room.
    if (branch.seats === 0 && (orderType === "dine_in" || orderType === "drive_thru")) {
      orderType = "aggregator";
    }
    const channel = pick(rng, CHANNEL_FOR_TYPE[orderType]);

    // Most orders sit on the anchor business day; a tail spreads back a month.
    const ageMinutes = i <= 90 ? int(rng, 4, 700) : int(rng, 700, 60 * 24 * 30);
    const openedAt = minutesAgo(ageMinutes);
    const businessDay = ageMinutes < 700 ? BUSINESS_DAY : dateAgo(Math.floor(ageMinutes / 1440));

    const seq = (sequenceByBranch.get(branch.id) ?? 0) + 1;
    sequenceByBranch.set(branch.id, seq);

    const lineCount = int(rng, 1, 6);
    const lineStates: OrderLineState[] =
      state === "completed"
        ? ["served"]
        : state === "draft"
          ? ["pending"]
          : state === "cancelled"
            ? ["voided"]
            : ["fired", "preparing", "ready", "served"];

    const lines = Array.from({ length: lineCount }, (_, li) => {
      let lineState = pick(rng, lineStates);
      if (state === "completed" && chance(rng, 0.04)) lineState = "voided";
      if (state === "completed" && chance(rng, 0.02)) lineState = "comped";
      return buildLine(i, li + 1, lineState);
    });

    // Route each line to a station — FR-KDS-010.
    const branchStations = stationsByBranch.get(branch.id) ?? [];
    for (const line of lines) {
      const menuItem = menuItems.find((m) => m.id === line.menuItemId);
      const match = branchStations.find((s) => s.type === menuItem?.stationType);
      line.stationId = (match ?? branchStations[0])?.id ?? null;
    }

    const active = lines.filter((l) => l.state !== "voided");
    const subtotal = active.reduce((s, l) => s + l.lineSubtotal.amount, 0);
    const taxTotal = active.reduce((s, l) => s + l.taxAmount.amount, 0);
    const lineDiscounts = lines.reduce((s, l) => s + l.lineDiscount.amount, 0);
    const compValue = active.filter((l) => l.isComp).reduce((s, l) => s + l.lineSubtotal.amount, 0);

    const orderDiscount = chance(rng, 0.14) ? Math.round(subtotal * 0.1) : 0;
    const serviceCharge = orderType === "dine_in" && branch.seats > 0 ? Math.round(subtotal * 0.12) : 0;
    const grand = subtotal + serviceCharge - orderDiscount - compValue;
    // FR-POS-063 / BR-FIN-004 — cash rounding is its own ledger amount.
    const rounding = chance(rng, 0.2) ? pick(rng, [-25, -10, 0, 10, 25]) : 0;
    const grandTotal = grand + rounding;

    const paid =
      state === "completed" || state === "refunded" || state === "partially_refunded"
        ? grandTotal
        : state === "partially_paid"
          ? Math.round(grandTotal * 0.5)
          : 0;

    const payments: OrderPayment[] = [];
    if (paid > 0) {
      const tender = orderType === "aggregator" ? "aggregator_settled" : pick(rng, TENDER_POOL);
      const split = chance(rng, 0.12);
      const first = split ? Math.round(paid * 0.6) : paid;
      payments.push({
        id: `pay_${i}_1`,
        tender,
        amount: EGP(first),
        tip: tender === "card" && chance(rng, 0.3) ? EGP(int(rng, 500, 4000)) : EGP(0),
        cardLast4: tender === "card" ? String(1000 + int(rng, 0, 8999)) : null,
        cardScheme: tender === "card" ? pick(rng, CARD_SCHEMES) : null,
        authorisationCode: tender === "card" ? `A${String(100000 + i * 37)}` : null,
        capturedAt: minutesAgo(Math.max(1, ageMinutes - 3)),
      });
      if (split) {
        payments.push({
          id: `pay_${i}_2`,
          tender: "cash",
          amount: EGP(paid - first),
          tip: EGP(0),
          cardLast4: null,
          cardScheme: null,
          authorisationCode: null,
          capturedAt: minutesAgo(Math.max(1, ageMinutes - 2)),
        });
      }
    }

    const tipTotal = payments.reduce((s, p) => s + p.tip.amount, 0);
    const cogsTotal = active.reduce((s, l) => s + l.unitCostSnapshot.amount, 0);

    const useTable = orderType === "dine_in" && branch.seats > 0;
    const branchTables = tablesByBranch.get(branch.id) ?? [];
    const table = useTable && branchTables.length > 0 ? branchTables[i % branchTables.length]! : null;

    const hasCustomer = chance(rng, 0.35);
    const customer = hasCustomer ? pick(rng, CUSTOMER_NAMES) : null;

    out.push({
      id: seqId("ord", i),
      tenantId: ACTIVE_TENANT_ID,
      branchId: branch.id,
      branchName: branch.name,
      terminalId: terminal.id,
      terminalName: terminal.name,
      orderNumber: `${branch.code}-${String(seq).padStart(4, "0")}`,
      businessDay,
      orderType,
      channel,
      state,
      tableId: table?.id ?? null,
      tableLabel: table?.label ?? null,
      guestCount: useTable ? int(rng, 1, 6) : null,
      customerId: hasCustomer ? seqId("cus", int(rng, 1, 400)) : null,
      customerName: customer,
      openedBy: opener.id,
      openedByName: opener.name,
      servedByName: useTable ? server.name : null,
      currency: "EGP",
      subtotal: EGP(subtotal),
      discountTotal: EGP(orderDiscount + lineDiscounts),
      serviceChargeTotal: EGP(serviceCharge),
      taxTotal: EGP(taxTotal),
      roundingAdjustment: EGP(rounding),
      grandTotal: EGP(grandTotal),
      paidTotal: EGP(paid),
      tipTotal: EGP(tipTotal),
      cogsTotal: EGP(cogsTotal),
      lines,
      payments,
      discounts:
        orderDiscount > 0
          ? [
              {
                id: `dsc_${i}`,
                reason: pick(rng, DISCOUNT_REASONS),
                percentage: 10,
                amount: EGP(orderDiscount),
                appliedBy: opener.name,
                approvedBy: chance(rng, 0.6) ? server.name : null,
                appliedAt: minutesAgo(Math.max(1, ageMinutes - 5)),
              },
            ]
          : [],
      openedAt,
      firstFiredAt: state === "draft" ? null : minutesAgo(Math.max(1, ageMinutes - 1)),
      completedAt:
        state === "completed" || state === "refunded" || state === "partially_refunded"
          ? minutesAgo(Math.max(1, ageMinutes - int(rng, 5, 45)))
          : null,
      syncState: chance(rng, 0.94)
        ? "synced"
        : pick(rng, ["pending", "local", "conflicted"] as const),
      aggregatorRef:
        orderType === "aggregator" ? `${pick(rng, AGGREGATORS)}-${String(700000 + i * 13)}` : null,
      notes: chance(rng, 0.08) ? "Ring the bell on delivery." : null,
    });
  }

  return out.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
})();

export const orderById = new Map(orders.map((o) => [o.id, o]));

export const openOrders = orders.filter((o) =>
  ["open", "held", "parked", "partially_paid", "draft"].includes(o.state),
);

export const completedOrders = orders.filter((o) => o.state === "completed");

export const todayOrders = orders.filter((o) => o.businessDay === BUSINESS_DAY);

// Point each table at whichever open order sits on it.
for (const table of tables) {
  const match = openOrders.find((o) => o.tableId === table.id);
  if (match) {
    table.orderId = match.id;
  }
}

// ---------------------------------------------------------------------------
// Kitchen tickets — SRS ch.9
// ---------------------------------------------------------------------------

const TICKET_STATE_POOL: TicketState[] = ["queued", "queued", "started", "started", "ready"];

export const kitchenTickets: KitchenTicket[] = (() => {
  const out: KitchenTicket[] = [];
  let n = 0;

  for (const order of openOrders) {
    const byStation = new Map<string, OrderLine[]>();
    for (const line of order.lines) {
      if (!line.stationId || line.state === "voided" || line.state === "pending") continue;
      const list = byStation.get(line.stationId) ?? [];
      list.push(line);
      byStation.set(line.stationId, list);
    }

    for (const [stationId, lines] of byStation) {
      n += 1;
      const station = stations.find((s) => s.id === stationId)!;
      const firedAt = lines[0]!.firedAt ?? minutesAgo(int(rng, 2, 30));
      const elapsed = Math.round((NOW_MS - new Date(firedAt).getTime()) / 1000);
      const target = Math.max(
        180,
        Math.max(...lines.map((l) => menuItems.find((m) => m.id === l.menuItemId)?.prepTimeSeconds ?? 300)),
      );
      const ratio = elapsed / target;

      const ticketLines: TicketLine[] = lines.map((line) => ({
        id: `tkl_${line.id}`,
        name: line.itemNameSnapshot,
        quantity: line.quantity,
        modifiers: line.modifiers.map((m) => ({ name: m.name, kind: m.kind })),
        state: line.state,
        notes: line.notes,
      }));

      out.push({
        id: seqId("tkt", n),
        branchId: order.branchId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tableLabel: order.tableLabel,
        stationId,
        stationName: station.name,
        state: lines.every((l) => l.state === "ready" || l.state === "served")
          ? "ready"
          : pick(rng, TICKET_STATE_POOL),
        // FR-KDS-022 — colour-coded by elapsed time against target.
        urgency:
          ratio > 1.6 ? "critical" : ratio > 1 ? "exceeded" : ratio > 0.75 ? "approaching" : "on_target",
        course: lines[0]!.course,
        priority: chance(rng, 0.08)
          ? pick(rng, ["rush", "vip", "remake"] as const)
          : "normal",
        firedAt,
        targetSeconds: target,
        elapsedSeconds: Math.max(0, elapsed),
        lines: ticketLines,
      });
    }
  }

  return out.sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
})();

export const delayedTickets = kitchenTickets.filter(
  (t) => t.urgency === "exceeded" || t.urgency === "critical",
);
