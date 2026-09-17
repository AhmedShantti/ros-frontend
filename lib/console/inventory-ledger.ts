"use client";

/**
 * Reading the whole movement ledger, and the reports built on it.
 *
 * The ledger is addressable per item only (`GET /inventory/items/{id}/
 * movements`), so anything tenant-wide — valuation at a date, a
 * reconciliation pass, a batch trace, usage history for reorder — has to fan
 * out one read per item. That is done here once, with a concurrency cap so a
 * three-thousand-item tenant does not open three thousand sockets, and with
 * per-item failures collected rather than failing the whole report: a
 * valuation missing two items and saying so is more use than no valuation.
 *
 * The demo registry answers the same call from its fixtures, so every
 * screen that uses this works identically in both data modes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CostingMethod, Id, Localised, StockItem, StockLevel, StockMovement } from "./types";
import { services } from "./services";
import { replayPosition } from "./inventory-costing";
import { decimalAdd, decimalCompare, decimalSub } from "./stock-units";

export interface LedgerLoad {
  movements: StockMovement[];
  /** Items whose ledger could not be read, with the reason. */
  failures: { itemId: Id; message: string }[];
  /** How many item ledgers were read. */
  itemsRead: number;
}

/** How many ledgers to read at once. */
const CONCURRENCY = 6;
/** Rows asked for per item — the endpoint is unpaged, so this is a ceiling. */
const PER_ITEM_LIMIT = 5000;

export interface LedgerState {
  items: StockItem[];
  ledger: LedgerLoad | null;
  progress: { done: number; total: number };
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Read the item master, then every item's ledger, reporting progress — the
 * shared first step of the valuation, reconciliation, trace and reorder
 * screens. Items the caller does not need can be filtered with `pick`.
 */
export function useLedger(pick?: (item: StockItem) => boolean): LedgerState {
  const [items, setItems] = useState<StockItem[]>([]);
  const [ledger, setLedger] = useState<LedgerLoad | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const page = await services.inventory.items.list({ limit: 5000 });
        if (cancelled) return;
        const chosen = pickRef.current ? page.rows.filter(pickRef.current) : page.rows;
        setItems(page.rows);
        setProgress({ done: 0, total: chosen.length });
        const load = await loadLedger(
          chosen.map((item) => item.id),
          (done, total) => {
            if (!cancelled) setProgress({ done, total });
          },
        );
        if (!cancelled) setLedger(load);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { items, ledger, progress, loading, error, reload };
}

export async function loadLedger(
  itemIds: Id[],
  onProgress?: (done: number, total: number) => void,
): Promise<LedgerLoad> {
  const unique = [...new Set(itemIds)];
  const movements: StockMovement[] = [];
  const failures: LedgerLoad["failures"] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < unique.length) {
      const itemId = unique[cursor]!;
      cursor += 1;
      try {
        const page = await services.inventory.movements.list({ filters: { itemId }, limit: PER_ITEM_LIMIT });
        movements.push(...page.rows);
      } catch (caught) {
        failures.push({ itemId, message: caught instanceof Error ? caught.message : String(caught) });
      }
      done += 1;
      onProgress?.(done, unique.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => worker()));
  return { movements, failures, itemsRead: unique.length - failures.length };
}

/** The latest movement time in a ledger — the honest "as of" for a report. */
export function latestMovementAt(movements: StockMovement[]): string | null {
  let latest: string | null = null;
  for (const row of movements) {
    if (!latest || row.occurredAt > latest) latest = row.occurredAt;
  }
  return latest;
}

const pairKey = (itemId: Id, locationId: Id) => `${itemId}::${locationId}`;

export function groupByPair(movements: StockMovement[]): Map<string, StockMovement[]> {
  const out = new Map<string, StockMovement[]>();
  for (const row of movements) {
    const key = pairKey(row.itemId, row.locationId);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// FR-INV-015 — valuation at a date, from the ledger
// ---------------------------------------------------------------------------

export interface ValuationRow {
  itemId: Id;
  itemName: Localised;
  sku: string;
  category: Localised;
  locationId: Id;
  locationName: Localised;
  costingMethod: CostingMethod;
  quantity: number;
  unit: string;
  valueMinor: number;
  unitCostMinor: number;
  movementCount: number;
  uncostedIssues: number;
}

/**
 * Stock value per (item, location) at the end of `asOf`, replaying each
 * pair's movements under the item's own costing method (FR-INV-012).
 *
 * Pairs with no movement on or before the date are left out — they held
 * nothing then, as far as the ledger knows.
 */
export function valuationAt(
  movements: StockMovement[],
  items: StockItem[],
  asOf: string,
): ValuationRow[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const cutoff = new Date(asOf).getTime();
  const rows: ValuationRow[] = [];

  for (const list of groupByPair(movements).values()) {
    const first = list[0]!;
    const before = list.filter((row) => new Date(row.occurredAt).getTime() <= cutoff);
    if (before.length === 0) continue;
    const item = itemById.get(first.itemId);
    const method = item?.costingMethod ?? "weighted_average";
    const standard = item?.unitCost.amount ?? first.unitCost.amount;
    const position = replayPosition(before, method, standard);

    rows.push({
      itemId: first.itemId,
      itemName: item?.name ?? first.itemName,
      sku: item?.sku ?? "",
      category: item?.category ?? { en: "", ar: "" },
      locationId: first.locationId,
      locationName: first.locationName,
      costingMethod: method,
      quantity: position.quantity,
      unit: item?.baseUnit ?? first.quantity.unit,
      valueMinor: position.valueMinor,
      unitCostMinor: Math.round(position.unitCostMinor),
      movementCount: before.length,
      uncostedIssues: position.uncostedIssues,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// FR-INV-051 — the ledger against the projection, checked in the browser
// ---------------------------------------------------------------------------

export type ReconciliationFinding =
  /** Movements agree with each other and with the level. */
  | "ok"
  /** A movement's balance-after is not the previous balance plus its quantity. */
  | "chain_break"
  /** The last balance-after disagrees with the stock level projection. */
  | "projection_mismatch"
  /** A level exists with no movement behind it at all. */
  | "no_ledger"
  /** Movements exist but no level row does. */
  | "no_projection";

export interface ReconciliationCheckRow {
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  finding: ReconciliationFinding;
  /** Σ quantity over every movement read. */
  movementSum: string;
  /** Balance after the latest movement, as the ledger records it. */
  ledgerBalance: string | null;
  /** On hand per the `stock_levels` projection. */
  projected: string | null;
  /** First movement whose balance-after does not follow; null when none. */
  firstBreakId: Id | null;
  movementCount: number;
  unit: string;
}

/**
 * Compare, per (item, location):
 *
 *   1. the chain — each movement's `balanceAfter` must equal the previous
 *      one's plus its own quantity; and
 *   2. the end of the chain against the level projection.
 *
 * Σ movements alone cannot be compared to the level when the ledger read is
 * not the complete history (an opening balance loaded before the ledger
 * existed, say); the chain check does not need the full history, which is
 * why it is the primary test here. The server job (`GET /inventory/
 * reconciliation`) has the whole ledger and compares the sum directly.
 */
export function reconcileInBrowser(movements: StockMovement[], levels: StockLevel[]): ReconciliationCheckRow[] {
  const rows: ReconciliationCheckRow[] = [];
  const byPair = groupByPair(movements);
  const levelByPair = new Map(levels.map((level) => [pairKey(level.itemId, level.locationId), level]));

  for (const [key, list] of byPair) {
    const ordered = [...list].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt),
    );
    const first = ordered[0]!;
    let sum = "0";
    let firstBreakId: Id | null = null;
    for (let index = 0; index < ordered.length; index += 1) {
      const row = ordered[index]!;
      sum = decimalAdd(sum, row.quantity.value);
      if (index > 0 && firstBreakId === null) {
        const expected = decimalAdd(ordered[index - 1]!.balanceAfter.value, row.quantity.value);
        if (decimalCompare(expected, row.balanceAfter.value) !== 0) firstBreakId = row.id;
      }
    }
    const last = ordered[ordered.length - 1]!;
    const level = levelByPair.get(key);
    const projected = level ? level.onHand.value : null;

    let finding: ReconciliationFinding = "ok";
    if (firstBreakId) finding = "chain_break";
    else if (projected === null) finding = "no_projection";
    else if (decimalCompare(last.balanceAfter.value, projected) !== 0) finding = "projection_mismatch";

    rows.push({
      itemId: first.itemId,
      itemName: first.itemName,
      locationId: first.locationId,
      locationName: first.locationName,
      finding,
      movementSum: sum,
      ledgerBalance: last.balanceAfter.value,
      projected,
      firstBreakId,
      movementCount: ordered.length,
      unit: first.quantity.unit,
    });
  }

  for (const [key, level] of levelByPair) {
    if (byPair.has(key)) continue;
    // A zero level with no movements is simply an item never stocked there.
    if (decimalCompare(level.onHand.value, "0") === 0) continue;
    rows.push({
      itemId: level.itemId,
      itemName: level.itemName,
      locationId: level.locationId,
      locationName: level.locationName,
      finding: "no_ledger",
      movementSum: "0",
      ledgerBalance: null,
      projected: level.onHand.value,
      firstBreakId: null,
      movementCount: 0,
      unit: level.onHand.unit,
    });
  }
  return rows;
}

/** The size of a disagreement, for sorting the worst first. */
export function divergenceOf(row: ReconciliationCheckRow): string {
  if (row.projected === null || row.ledgerBalance === null) return row.projected ?? row.ledgerBalance ?? "0";
  return decimalSub(row.ledgerBalance, row.projected);
}
