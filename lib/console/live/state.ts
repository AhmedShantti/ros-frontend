/**
 * The live state — everything the running restaurant changes during a shift.
 *
 * The fixtures under `lib/console/mock/` are the world as it was when the
 * terminal booted: the menu, the recipes, the branches, yesterday's ledger.
 * They never change. This module holds the part that does — open orders,
 * kitchen tickets, table states, stock on hand, the cash drawer — and it is
 * the only state that any action in the POS or the KDS can write to.
 *
 * It lives in the browser. There is no server in this build, so the store is
 * seeded deterministically on the server render and rehydrated from
 * localStorage after mount. Anything non-deterministic here (a random id, a
 * `Date.now()`) would show up as a hydration mismatch, so ids come from a
 * counter and timestamps are always passed in by the caller.
 */

import type {
  AuditEntry,
  CashSession,
  Id,
  IsoDate,
  IsoDateTime,
  KitchenTicket,
  Localised,
  Money,
  Order,
  RestaurantTable,
  StockMovement,
  UnitCode,
  WasteRecord,
} from "../types";
import { branches, tables, terminals } from "../mock/org";
import { stockLevels } from "../mock/inventory";
import { stockItemById } from "../mock/stock-items";
import { BUSINESS_DAY, NOW_ISO } from "../mock/clock";

export const LIVE_STORAGE_KEY = "ros.live.v1";
export const LIVE_STATE_VERSION = 6;

/** Mid-shift drawer operations — FR-POS-091. */
export interface CashMovementRecord {
  id: Id;
  kind: "pay_in" | "pay_out" | "safe_drop";
  amount: Money;
  reason: string;
  at: IsoDateTime;
}

export interface LiveCashSession extends CashSession {
  movements: CashMovementRecord[];
  /** FR-POS-095 — the expected figure stays hidden until the count is entered. */
  blindCount: boolean;
}

export interface LiveSettings {
  /** FR-POS-055 — dine-in service charge, percentage. */
  serviceChargePercent: number;
  /** FR-POS-058 — whether the country pack taxes the service charge. */
  serviceChargeTaxable: boolean;
  /** FR-POS-035 — fast-casual fires on entry, table service fires on demand. */
  autoFire: boolean;
  /** FR-POS-095 — blind count is the default for a reason. */
  blindCount: boolean;
  /** FR-POS-092 — prompt for a safe drop above this drawer balance, minor units. */
  drawerLimitMinor: number;
  /** FR-POS-047 — discount percentage a cashier may apply unapproved. */
  discountApprovalThreshold: number;
  /** FR-KDS-012 — hold short items back so the order finishes together. */
  staggeredRelease: boolean;
}

export const DEFAULT_SETTINGS: LiveSettings = {
  serviceChargePercent: 12,
  serviceChargeTaxable: true,
  autoFire: false,
  blindCount: true,
  drawerLimitMinor: 500_000,
  discountApprovalThreshold: 10,
  staggeredRelease: true,
};

/** A void that produced food — FR-POS-071 forces the disposition to be named. */
export type VoidDisposition = "returned_to_stock" | "wasted" | "staff_meal";

/**
 * FR-KDS-025 — how long a bumped ticket stays recallable.
 *
 * This used to be a count: the last twenty tickets, regardless of when they
 * were bumped. That is the documented behaviour inverted in both directions
 * — in a slow period a mis-bump stayed recallable all afternoon, and in a
 * rush it fell out of reach in under a minute.
 */
export const RECALL_WINDOW_MS = 30 * 60 * 1000;

/**
 * Something the running restaurant noticed and a manager needs to see.
 *
 * The dashboard's alert rail was fed entirely from a static fixture, so the
 * two events the site documents as raising an alert — stock driven negative
 * by a fire, and a ticket past its critical threshold — produced nothing at
 * all. These are raised by the reducer as they happen and merged into that
 * rail ahead of the fixtures.
 *
 * `key` is what makes an alert idempotent: the same item going further
 * negative on the next fire updates the existing alert rather than stacking
 * a new one on top of it.
 */
export type LiveAlertKind = "negative_stock" | "ticket_delayed";

export interface LiveAlert {
  id: Id;
  key: string;
  kind: LiveAlertKind;
  severity: "medium" | "high";
  at: IsoDateTime;
  /** Filled in by the consumer from the fixtures; stored as ids to stay serialisable. */
  subjectId: Id;
  subjectName: Localised;
  /** The number that made it an alert — a negative balance, or seconds late. */
  value: number;
  unit: string | null;
  acknowledged: boolean;
}

/** Newest first, one per key, and bounded so a long shift cannot grow forever. */
export function upsertAlert(alerts: LiveAlert[], next: LiveAlert): LiveAlert[] {
  const rest = alerts.filter((a) => a.key !== next.key);
  const previous = alerts.find((a) => a.key === next.key);
  // An alert a manager already dismissed does not come back for the same
  // key unless it got worse.
  const acknowledged =
    previous?.acknowledged === true && Math.abs(next.value) <= Math.abs(previous.value);
  return [{ ...next, acknowledged }, ...rest].slice(0, 40);
}

export interface LiveState {
  version: number;

  // --- where this terminal is standing -------------------------------------
  branchId: Id;
  terminalId: Id;
  businessDay: IsoDate;

  /** FR-POS-002 — the locally-held block this terminal draws numbers from. */
  numberSeq: number;
  /** Monotonic counter behind every id this store mints. */
  idSeq: number;

  // --- the running restaurant ----------------------------------------------
  orders: Record<Id, Order>;
  orderIds: Id[];
  activeOrderId: Id | null;

  tickets: Record<Id, KitchenTicket>;
  ticketIds: Id[];
  /**
   * Bumped tickets kept for the recall window — FR-KDS-025.
   *
   * The bump time travels with the id because the window is measured in
   * minutes, not in tickets, and the ticket itself may have been recalled,
   * re-bumped or evicted by the time anything asks.
   */
  recallable: RecallEntry[];

  /** Table overrides, keyed by table id. Absent means "as seeded". */
  tableStates: Record<Id, RestaurantTable>;

  /** On-hand quantity in base units, keyed `locationId::itemId`. */
  stock: Record<string, number>;
  movements: StockMovement[];
  waste: WasteRecord[];

  session: LiveCashSession | null;
  closedSessions: LiveCashSession[];

  audit: AuditEntry[];

  /** FR-MNU-030 — 86'd items and why. */
  unavailable: Record<Id, string>;

  /**
   * FR-MNU-031 — a manager's one-time override of an 86'd item.
   *
   * Scoped to a single order rather than lifting the 86 for everyone, which
   * is what "Restore" does and why it was the wrong control to reach for.
   */
  overrides: EightySixOverride[];

  /** Raised by the running restaurant, read by the dashboard's alert rail. */
  alerts: LiveAlert[];

  /** FR-INV-042 — cost layers per `locationId::itemId`, oldest first. */
  costLayers: Record<string, CostLayer[]>;

  settings: LiveSettings;
}

export interface EightySixOverride {
  orderId: Id;
  menuItemId: Id;
  approvedBy: Id;
  approvedByName: Localised;
  at: IsoDateTime;
}

/**
 * FR-INV-042 — what a unit of stock actually cost, in the order it arrived.
 *
 * `costingMethod` was a label with nothing behind it: every movement priced
 * off the item's single static `unitCost`, so choosing FIFO, weighted average
 * or standard changed the word on the screen and nothing else.
 *
 * A layer is one arrival at one price. FIFO consumes them oldest-first;
 * weighted average pools them; standard ignores them and keeps using the
 * catalogue cost. Storing arrivals rather than a running number is what
 * makes all three derivable from the same record.
 */
export interface CostLayer {
  /** Base units remaining in this layer. */
  qty: number;
  /** Minor units per base unit. */
  costMinor: number;
}

export interface RecallEntry {
  id: Id;
  bumpedAt: IsoDateTime;
}

/**
 * Those still inside the window, measured against the caller's clock.
 *
 * Takes either an ISO stamp or epoch milliseconds because the two callers
 * hold different things: the reducer is given `action.at` as ISO, while the
 * KDS ticks on a millisecond counter it already uses for elapsed times.
 *
 * An entry with an unparseable stamp is kept rather than dropped — losing a
 * recallable ticket is worse than holding one a few minutes too long.
 */
export function recallableAt(
  entries: RecallEntry[],
  now: IsoDateTime | number,
): RecallEntry[] {
  const ms = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(ms) || ms === 0) return entries;
  return entries.filter((entry) => {
    const at = Date.parse(entry.bumpedAt);
    return Number.isNaN(at) || ms - at < RECALL_WINDOW_MS;
  });
}

export function stockKey(locationId: Id, itemId: Id): string {
  return `${locationId}::${itemId}`;
}

/** The branch a fresh terminal opens in: the first that actually has seats. */
export function defaultBranchId(): Id {
  return branches.find((b) => b.seats > 0)?.id ?? branches[0]!.id;
}

export function defaultTerminalId(branchId: Id): Id {
  const pos = terminals.filter(
    (t) => t.branchId === branchId && t.kind === "pos" && t.status !== "revoked",
  );
  return pos[0]?.id ?? terminals[0]!.id;
}

/**
 * How the fixture's on-hand figure is read as a base-unit quantity.
 *
 * The stock fixtures store costs and recipes in base units — grams and
 * millilitres — but their on-hand figures were generated at the scale a
 * human writes on a stock sheet, which is kilograms and litres. Taken
 * literally, a branch holds 400 g of chicken and can sell one sandwich
 * before every item on the grid reads "0 left". Multiplying by the unit's
 * own conversion is what makes the branch a trading restaurant rather than
 * an empty one.
 */
const ONHAND_SCALE: Partial<Record<UnitCode, number>> = { g: 1000, ml: 1000 };

/**
 * Seeds the live state from the fixtures.
 *
 * Stock starts where the fixture ledger left it, so the first sale of the
 * shift moves a real number rather than one invented at boot. Tables start
 * available: the fixture table states describe a busy afternoon that has
 * nothing to do with the orders this terminal is about to take, and leaving
 * them occupied would mean half the floor plan could never be used.
 */
export function initialLiveState(branchId: Id = defaultBranchId()): LiveState {
  const stock: Record<string, number> = {};
  const reference = new Map<Id, number>();

  for (const level of stockLevels) {
    const scale = ONHAND_SCALE[level.onHand.unit] ?? 1;
    const onHand = Number(level.onHand.value) * scale;
    stock[stockKey(level.locationId, level.itemId)] = onHand;
    if (!reference.has(level.itemId) && onHand > 0) reference.set(level.itemId, onHand);
  }

  // The fixtures give each branch a subset of the catalogue, which leaves a
  // recipe ingredient with no row at all and an item permanently unsellable.
  // A branch that stocks the item at a quarter of the reference holding is a
  // truer starting point than one that has never heard of it.
  for (const branch of branches) {
    for (const [itemId, onHand] of reference) {
      const key = stockKey(branch.id, itemId);
      if (stock[key] === undefined) stock[key] = Math.round(onHand * 0.25);
    }
  }

  // The opening balance is one arrival at the catalogue cost. Without it,
  // the first depletion of the shift would find no layers and fall back to
  // standard costing on an item configured for FIFO.
  const costLayers: Record<string, CostLayer[]> = {};
  for (const [key, qty] of Object.entries(stock)) {
    if (qty <= 0) continue;
    const itemId = key.split("::")[1] ?? "";
    const unitCost = stockItemById.get(itemId)?.unitCost.amount;
    if (unitCost === undefined) continue;
    costLayers[key] = [{ qty, costMinor: unitCost }];
  }

  const tableStates: Record<Id, RestaurantTable> = {};
  for (const table of tables) {
    tableStates[table.id] = {
      ...table,
      state: "available",
      seatedAt: null,
      orderId: null,
      serverId: null,
    };
  }

  return {
    version: LIVE_STATE_VERSION,
    branchId,
    terminalId: defaultTerminalId(branchId),
    businessDay: BUSINESS_DAY,
    numberSeq: 1,
    idSeq: 1,
    orders: {},
    orderIds: [],
    activeOrderId: null,
    tickets: {},
    ticketIds: [],
    recallable: [],
    tableStates,
    stock,
    movements: [],
    waste: [],
    session: null,
    closedSessions: [],
    audit: [],
    unavailable: {},
    overrides: [],
    alerts: [],
    costLayers,
    settings: DEFAULT_SETTINGS,
  };
}

/** Where the seeded audit chain hands over to the live one. */
export const LIVE_AUDIT_ANCHOR = NOW_ISO;
