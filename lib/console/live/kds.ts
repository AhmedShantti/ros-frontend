/**
 * Kitchen display rules — SRS ch.9, the parts that are pure arithmetic.
 *
 * Both kitchen displays (the simulator's and the one on the real backend)
 * sort, count and time tickets the same way, and the reducer routes lines by
 * the same setup the console edits. Keeping all of it here, free of React
 * and storage, is what lets the three agree.
 */

import type {
  Id,
  IsoDateTime,
  KitchenTicket,
  Localised,
  OrderType,
  StationType,
  TicketLine,
  TicketTimeline,
  TicketUrgency,
} from "../types";
import { urgencyFor } from "./engine";

// ---------------------------------------------------------------------------
// Setup — what the console's kitchen-display page edits
// ---------------------------------------------------------------------------

/** FR-KDS-023 — the four orders the SRS names, per station. */
export type KdsSortMode = "fifo" | "target" | "priority" | "course";

export const KDS_SORT_MODES: KdsSortMode[] = ["fifo", "target", "priority", "course"];

export interface KdsStationSetup {
  /** FR-KDS-023 */
  sort: KdsSortMode;
  /**
   * FR-KDS-045 — items the station can clear in fifteen minutes. Null means
   * a quarter of the station's own `capacityPerHour`.
   */
  capacityPer15: number | null;
}

export interface KdsItemSetup {
  /** FR-KDS-044 — null keeps the recipe's `prepTimeSeconds`. */
  targetSeconds: number | null;
  /** FR-KDS-011 — station types this item is also prepared at. */
  alsoStationTypes: StationType[];
}

export interface KdsAlertSetup {
  newTicket: boolean;
  amendment: boolean;
  cancellation: boolean;
  overdue: boolean;
  capacity: boolean;
}

export interface KdsSetup {
  /** FR-KDS-023 — highest priority first; order types not listed come last. */
  orderTypePriority: OrderType[];
  stations: Record<Id, KdsStationSetup>;
  items: Record<Id, KdsItemSetup>;
  /** FR-KDS-011 — every off-premise line also goes to the packaging station. */
  packagingForOffPremise: boolean;
  /** FR-KDS-029 — how long a cancelled line stays struck through; null keeps it until the ticket goes. */
  cancelledLineSeconds: number | null;
  /** FR-KDS-031 — the default for displays in this branch; a screen may override it. */
  iconMode: boolean;
  /** Which events make a sound. */
  alerts: KdsAlertSetup;
  updatedAt: IsoDateTime | null;
}

export const DEFAULT_ORDER_TYPE_PRIORITY: OrderType[] = [
  "delivery",
  "aggregator",
  "drive_thru",
  "pickup",
  "takeaway",
  "dine_in",
];

export const DEFAULT_KDS_SETUP: KdsSetup = {
  orderTypePriority: DEFAULT_ORDER_TYPE_PRIORITY,
  stations: {},
  items: {},
  packagingForOffPremise: true,
  cancelledLineSeconds: 120,
  iconMode: false,
  alerts: { newTicket: true, amendment: true, cancellation: true, overdue: true, capacity: true },
  updatedAt: null,
};

/** Fills a stored setup in over the defaults, so a field added later reads its default. */
export function normaliseKdsSetup(stored: Partial<KdsSetup> | null | undefined): KdsSetup {
  if (!stored || typeof stored !== "object") return DEFAULT_KDS_SETUP;
  return {
    ...DEFAULT_KDS_SETUP,
    ...stored,
    orderTypePriority:
      Array.isArray(stored.orderTypePriority) && stored.orderTypePriority.length > 0
        ? stored.orderTypePriority
        : DEFAULT_ORDER_TYPE_PRIORITY,
    stations: stored.stations ?? {},
    items: stored.items ?? {},
    alerts: { ...DEFAULT_KDS_SETUP.alerts, ...(stored.alerts ?? {}) },
  };
}

export function stationSetupOf(setup: KdsSetup, stationId: Id | null): KdsStationSetup {
  return (stationId ? setup.stations[stationId] : undefined) ?? { sort: "fifo", capacityPer15: null };
}

/** FR-KDS-044 — the configured target, defaulting to the recipe's prep time. */
export function itemTargetSeconds(setup: KdsSetup, menuItemId: Id, recipePrepSeconds: number | undefined): number {
  const configured = setup.items[menuItemId]?.targetSeconds;
  if (typeof configured === "number" && configured > 0) return configured;
  return recipePrepSeconds && recipePrepSeconds > 0 ? recipePrepSeconds : 300;
}

const OFF_PREMISE: OrderType[] = ["takeaway", "delivery", "pickup", "drive_thru", "aggregator"];

/**
 * FR-KDS-011 — the station types a line is prepared at besides its primary one.
 *
 * Item setup names them explicitly ("a burger requiring grill and
 * packaging"); the branch switch adds packaging to every off-premise line.
 */
export function extraStationTypes(setup: KdsSetup, menuItemId: Id, orderType: OrderType): StationType[] {
  const types = new Set<StationType>(setup.items[menuItemId]?.alsoStationTypes ?? []);
  if (setup.packagingForOffPremise && OFF_PREMISE.includes(orderType)) types.add("packaging");
  return [...types];
}

// ---------------------------------------------------------------------------
// Timeline — FR-KDS-040
// ---------------------------------------------------------------------------

export function emptyTimeline(): TicketTimeline {
  return {
    createdAt: null,
    routedAt: null,
    firstViewedAt: null,
    startedAt: null,
    readyAt: null,
    bumpedAt: null,
    servedAt: null,
    recalledAt: [],
  };
}

export function timelineOf(value: { timeline?: TicketTimeline }): TicketTimeline {
  return value.timeline ?? emptyTimeline();
}

/** Write-once: a moment already recorded is never overwritten. */
export function stamp(
  timeline: TicketTimeline | undefined,
  field: Exclude<keyof TicketTimeline, "recalledAt">,
  at: IsoDateTime,
): TicketTimeline {
  const base = timeline ?? emptyTimeline();
  return base[field] ? base : { ...base, [field]: at };
}

/** Overwrites — for moments a recall legitimately re-opens (ready, bumped). */
export function restamp(
  timeline: TicketTimeline | undefined,
  patch: Partial<Omit<TicketTimeline, "recalledAt">>,
): TicketTimeline {
  return { ...(timeline ?? emptyTimeline()), ...patch };
}

export const TIMELINE_FIELDS: Exclude<keyof TicketTimeline, "recalledAt">[] = [
  "createdAt",
  "routedAt",
  "firstViewedAt",
  "startedAt",
  "readyAt",
  "bumpedAt",
  "servedAt",
];

// ---------------------------------------------------------------------------
// Staggered release — FR-KDS-012
// ---------------------------------------------------------------------------

/** Seconds until a scheduled ticket is released, or 0 once it is live. */
export function secondsUntilRelease(ticket: KitchenTicket, nowMs: number): number {
  if (!nowMs) return 0;
  const release = Date.parse(ticket.firedAt);
  if (!Number.isFinite(release)) return 0;
  return Math.max(0, Math.ceil((release - nowMs) / 1000));
}

// ---------------------------------------------------------------------------
// Sorting — FR-KDS-023
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<KitchenTicket["priority"], number> = { rush: 0, remake: 1, vip: 2, normal: 3 };

function elapsedOf(ticket: KitchenTicket, nowMs: number): number {
  if (ticket.held || !nowMs) return 0;
  return Math.max(0, Math.floor((nowMs - Date.parse(ticket.firedAt)) / 1000));
}

/**
 * Sorts a station's tickets.
 *
 *   fifo      oldest fired first
 *   target    least time left against the target first (promised time)
 *   priority  rush, remake, VIP, then the configured order-type ranking
 *   course    lowest course first
 *
 * Whatever the mode, a cancelled ticket comes first — it is the one card that
 * saves food rather than sequencing it — and a held or not-yet-released
 * ticket comes last, because nobody can start it. Ties fall back to FIFO.
 */
export function sortTickets(
  tickets: KitchenTicket[],
  mode: KdsSortMode,
  nowMs: number,
  orderTypePriority: OrderType[] = DEFAULT_ORDER_TYPE_PRIORITY,
): KitchenTicket[] {
  const typeRank = (type: OrderType) => {
    const index = orderTypePriority.indexOf(type);
    return index === -1 ? orderTypePriority.length : index;
  };
  const band = (ticket: KitchenTicket) => {
    if (ticket.state === "cancelled") return 0;
    if (ticket.held || secondsUntilRelease(ticket, nowMs) > 0) return 2;
    return 1;
  };
  return [...tickets].sort((a, b) => {
    const bandDiff = band(a) - band(b);
    if (bandDiff !== 0) return bandDiff;
    if (mode === "course" && a.course !== b.course) return a.course - b.course;
    if (mode === "target") {
      const aLeft = a.targetSeconds - elapsedOf(a, nowMs);
      const bLeft = b.targetSeconds - elapsedOf(b, nowMs);
      if (aLeft !== bLeft) return aLeft - bLeft;
    }
    if (mode === "priority") {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      const o = typeRank(a.orderType) - typeRank(b.orderType);
      if (o !== 0) return o;
    }
    return Date.parse(a.firedAt) - Date.parse(b.firedAt);
  });
}

// ---------------------------------------------------------------------------
// Amendments — FR-KDS-028
// ---------------------------------------------------------------------------

export interface TicketGroup {
  ticket: KitchenTicket;
  /** Amendment tickets folded into this card, oldest first. */
  amendments: KitchenTicket[];
}

/**
 * Folds each amendment into the card it updates.
 *
 * An amendment whose original is still on the display is shown inside that
 * card, never as a card of its own. One whose original has already left (it
 * was bumped before the addition arrived) has nowhere to go, so it stands
 * alone — still marked as an addition.
 */
export function groupAmendments(tickets: KitchenTicket[]): TicketGroup[] {
  const shown = new Set(tickets.map((t) => t.id));
  const children = new Map<Id, KitchenTicket[]>();
  for (const ticket of tickets) {
    if (!ticket.amendment || !ticket.amendsTicketId) continue;
    const root = rootOf(ticket, tickets, shown);
    if (!root) continue;
    const list = children.get(root) ?? [];
    list.push(ticket);
    children.set(root, list);
  }
  const folded = new Set([...children.values()].flat().map((t) => t.id));
  return tickets
    .filter((ticket) => !folded.has(ticket.id))
    .map((ticket) => ({
      ticket,
      amendments: (children.get(ticket.id) ?? []).sort((a, b) => Date.parse(a.firedAt) - Date.parse(b.firedAt)),
    }));
}

function rootOf(ticket: KitchenTicket, tickets: KitchenTicket[], shown: Set<Id>): Id | null {
  let current: KitchenTicket | undefined = ticket;
  let guard = 0;
  while (current?.amendsTicketId && guard < 10) {
    const parentId: Id = current.amendsTicketId;
    if (!shown.has(parentId)) return current === ticket ? null : current.id;
    current = tickets.find((t) => t.id === parentId);
    guard += 1;
  }
  return current && current !== ticket ? current.id : null;
}

// ---------------------------------------------------------------------------
// All-day counts — FR-KDS-030
// ---------------------------------------------------------------------------

export interface AllDayRow {
  key: string;
  name: Localised;
  menuItemId: Id | null;
  /** Outstanding and startable now. */
  now: number;
  /** Held, or waiting on a staggered release. */
  later: number;
  total: number;
}

export function allDayCounts(tickets: KitchenTicket[], nowMs: number): AllDayRow[] {
  const rows = new Map<string, AllDayRow>();
  for (const ticket of tickets) {
    if (ticket.state === "bumped" || ticket.state === "cancelled") continue;
    const waiting = ticket.held === true || secondsUntilRelease(ticket, nowMs) > 0;
    for (const line of ticket.lines) {
      if (line.state === "ready" || line.state === "voided" || line.state === "served") continue;
      const key = line.menuItemId ?? line.name.en;
      const row = rows.get(key) ?? { key, name: line.name, menuItemId: line.menuItemId ?? null, now: 0, later: 0, total: 0 };
      if (waiting) row.later += line.quantity;
      else row.now += line.quantity;
      row.total += line.quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.name.en.localeCompare(b.name.en));
}

// ---------------------------------------------------------------------------
// Capacity — FR-KDS-045
// ---------------------------------------------------------------------------

export interface CapacityReading {
  queuedItems: number;
  capacity15: number;
  over: boolean;
  ratio: number;
}

/**
 * Queued items against what the station can clear in the next fifteen
 * minutes. A station with no throughput configured has no capacity to
 * exceed, so it never warns — it does not guess.
 */
export function capacityReading(
  tickets: KitchenTicket[],
  capacityPerHour: number,
  setup: KdsStationSetup,
): CapacityReading {
  const capacity15 = setup.capacityPer15 ?? Math.floor(Math.max(0, capacityPerHour) / 4);
  let queuedItems = 0;
  for (const ticket of tickets) {
    if (ticket.state === "bumped" || ticket.state === "cancelled") continue;
    for (const line of ticket.lines) {
      if (line.state === "ready" || line.state === "voided" || line.state === "served") continue;
      queuedItems += line.quantity;
    }
  }
  return {
    queuedItems,
    capacity15,
    over: capacity15 > 0 && queuedItems > capacity15,
    ratio: capacity15 > 0 ? queuedItems / capacity15 : 0,
  };
}

// ---------------------------------------------------------------------------
// Per-line timing — FR-KDS-044
// ---------------------------------------------------------------------------

/** A line's own urgency against its own target, while it is still being made. */
export function lineUrgency(line: TicketLine, ticketElapsed: number): TicketUrgency | null {
  if (line.state === "ready" || line.state === "voided" || line.state === "served") return null;
  if (!line.targetSeconds || line.targetSeconds <= 0) return null;
  return urgencyFor(ticketElapsed, line.targetSeconds);
}

/** FR-KDS-029 — whether a struck line is still inside its visibility window. */
export function cancelledLineVisible(line: TicketLine, windowSeconds: number | null, nowMs: number): boolean {
  if (line.state !== "voided" || windowSeconds === null || !line.cancelledAt || !nowMs) return true;
  return nowMs - Date.parse(line.cancelledAt) <= windowSeconds * 1000;
}
