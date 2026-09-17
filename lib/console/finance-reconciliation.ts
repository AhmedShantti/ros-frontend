/**
 * Settlement reconciliation — FR-FIN-011 (card batches), FR-FIN-012
 * (aggregator payouts).
 *
 * Pure matching. The statement side is what the acquirer or aggregator sent;
 * the system side is recomputed from orders every time, so correcting an
 * order changes the reconciliation rather than leaving a stale snapshot.
 *
 * A difference within tolerance is shown but not flagged; anything beyond it
 * is flagged and stays open until someone resolves it with a written note.
 * Unmatched rows on either side are always flagged — a scheme the terminal
 * never settled, or an aggregator order missing from the payout, is exactly
 * the loss the report exists to find, whatever its size.
 */

import type { IsoDate, Order } from "./types";
import type {
  AggregatorTerms,
  CardBatch,
  PayoutStatement,
} from "./services/finance-settlements";
import { UNRECORDED } from "./finance-tenders";

export type MatchSide = "both" | "statement_only" | "system_only";

// ---------------------------------------------------------------------------
// Card batches — FR-FIN-011
// ---------------------------------------------------------------------------

export interface CardMatchRow {
  /** Resolution key: `card:<batchId>:<scheme>`. */
  key: string;
  scheme: string;
  statementCount: number;
  statementAmount: number;
  systemCount: number;
  systemAmount: number;
  /** Statement − system, minor units. */
  difference: number;
  side: MatchSide;
  flagged: boolean;
}

export interface CardMatch {
  batch: CardBatch;
  rows: CardMatchRow[];
  statementTotal: number;
  systemTotal: number;
  difference: number;
  flaggedCount: number;
  /** Orders scanned for this match; when capped the caller should say so. */
  ordersConsidered: number;
}

/** Card payments on a business day, optionally on one terminal, per scheme. */
export function systemCardTotals(
  orders: Order[],
  day: IsoDate,
  terminalName: string | null,
  branchId: string | null,
): Map<string, { count: number; amount: number }> {
  const totals = new Map<string, { count: number; amount: number }>();
  for (const order of orders) {
    if (order.businessDay !== day) continue;
    if (branchId && order.branchId !== branchId) continue;
    if (terminalName && order.terminalName !== terminalName) continue;
    for (const payment of order.payments) {
      if (payment.tender !== "card") continue;
      const scheme = payment.cardScheme?.toLowerCase() ?? UNRECORDED;
      const entry = totals.get(scheme) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += payment.amount.amount;
      totals.set(scheme, entry);
    }
  }
  return totals;
}

export function reconcileCardBatch(batch: CardBatch, orders: Order[], toleranceMinor: number): CardMatch {
  const system = systemCardTotals(orders, batch.businessDay, batch.terminalName, batch.branchId);
  const schemes = new Set<string>([
    ...batch.lines.map((line) => line.scheme.toLowerCase()),
    ...system.keys(),
  ]);

  const rows: CardMatchRow[] = [...schemes].sort().map((scheme) => {
    const lines = batch.lines.filter((line) => line.scheme.toLowerCase() === scheme);
    const onStatement = lines.length > 0;
    const statementCount = lines.reduce((sum, line) => sum + line.count, 0);
    const statementAmount = lines.reduce((sum, line) => sum + line.amountMinor, 0);
    const sys = system.get(scheme);
    const side: MatchSide = onStatement && sys ? "both" : onStatement ? "statement_only" : "system_only";
    const difference = statementAmount - (sys?.amount ?? 0);
    return {
      key: `card:${batch.id}:${scheme}`,
      scheme,
      statementCount,
      statementAmount,
      systemCount: sys?.count ?? 0,
      systemAmount: sys?.amount ?? 0,
      difference,
      side,
      flagged: side !== "both" || Math.abs(difference) > toleranceMinor || statementCount !== (sys?.count ?? 0),
    };
  });

  const statementTotal = rows.reduce((sum, row) => sum + row.statementAmount, 0);
  const systemTotal = rows.reduce((sum, row) => sum + row.systemAmount, 0);
  return {
    batch,
    rows,
    statementTotal,
    systemTotal,
    difference: statementTotal - systemTotal,
    flaggedCount: rows.filter((row) => row.flagged).length,
    ordersConsidered: orders.length,
  };
}

// ---------------------------------------------------------------------------
// Aggregator payouts — FR-FIN-012
// ---------------------------------------------------------------------------

export interface PayoutOrderRow {
  /** Resolution key: `payout:<statementId>:order:<ref>`. */
  key: string;
  ref: string;
  orderNumber: string | null;
  statementGross: number | null;
  systemGross: number | null;
  difference: number;
  side: MatchSide;
  flagged: boolean;
}

export interface PayoutMatch {
  statement: PayoutStatement;
  terms: AggregatorTerms | null;
  orderCount: number;
  systemGross: number;
  expectedCommission: number;
  expectedFees: number;
  /** Gross − commission − fixed fees; statement adjustments are shown apart. */
  expectedNet: number;
  /** Statement net − expected net. */
  netDifference: number;
  commissionDifference: number;
  grossDifference: number;
  /** Resolution key for the statement total: `payout:<statementId>:total`. */
  totalKey: string;
  totalFlagged: boolean;
  orders: PayoutOrderRow[];
  flaggedCount: number;
}

export function isAggregatorOrder(order: Order): boolean {
  return order.orderType === "aggregator" || order.channel === "aggregator";
}

function counted(order: Order): boolean {
  return order.state !== "cancelled" && order.state !== "merged" && order.state !== "draft";
}

export function reconcilePayout(
  statement: PayoutStatement,
  orders: Order[],
  terms: AggregatorTerms | null,
  toleranceMinor: number,
): PayoutMatch {
  const prefix = terms?.refPrefix?.trim().toLowerCase() || null;
  const candidates = orders.filter(
    (order) =>
      isAggregatorOrder(order) &&
      counted(order) &&
      order.businessDay >= statement.periodFrom &&
      order.businessDay <= statement.periodTo &&
      (!statement.branchId || order.branchId === statement.branchId) &&
      (!prefix || (order.aggregatorRef ?? "").toLowerCase().startsWith(prefix)),
  );

  const byRef = new Map<string, Order>();
  for (const order of candidates) if (order.aggregatorRef) byRef.set(order.aggregatorRef, order);

  const rows: PayoutOrderRow[] = [];
  const seen = new Set<string>();
  const statementId = statement.id;

  if (statement.orderRefs.length > 0) {
    for (const ref of statement.orderRefs) {
      seen.add(ref.ref);
      const order = byRef.get(ref.ref) ?? null;
      const systemGross = order ? order.grandTotal.amount : null;
      const difference = ref.grossMinor - (systemGross ?? 0);
      rows.push({
        key: `payout:${statementId}:order:${ref.ref}`,
        ref: ref.ref,
        orderNumber: order?.orderNumber ?? null,
        statementGross: ref.grossMinor,
        systemGross,
        difference,
        side: order ? "both" : "statement_only",
        flagged: !order || Math.abs(difference) > toleranceMinor,
      });
    }
    for (const order of candidates) {
      const ref = order.aggregatorRef ?? order.orderNumber;
      if (seen.has(ref)) continue;
      rows.push({
        key: `payout:${statementId}:order:${ref}`,
        ref,
        orderNumber: order.orderNumber,
        statementGross: null,
        systemGross: order.grandTotal.amount,
        difference: -order.grandTotal.amount,
        side: "system_only",
        flagged: true,
      });
    }
  }

  const systemGross = candidates.reduce((sum, order) => sum + order.grandTotal.amount, 0);
  const expectedCommission = terms ? Math.round((systemGross * terms.commissionPercent) / 100) : 0;
  const expectedFees = terms ? terms.fixedFeeMinor * candidates.length : 0;
  const expectedNet = systemGross - expectedCommission - expectedFees;
  // Statement adjustments (refund clawbacks, promotions) are the aggregator's
  // own lines; they are compared as part of net, and shown separately.
  const netDifference = statement.netPayoutMinor - expectedNet;
  const totalFlagged = !terms || Math.abs(netDifference) > toleranceMinor;

  return {
    statement,
    terms,
    orderCount: candidates.length,
    systemGross,
    expectedCommission,
    expectedFees,
    expectedNet,
    netDifference,
    commissionDifference: statement.commissionMinor - expectedCommission,
    grossDifference: statement.grossMinor - systemGross,
    totalKey: `payout:${statementId}:total`,
    totalFlagged,
    orders: rows,
    flaggedCount: rows.filter((row) => row.flagged).length + (totalFlagged ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

/** Major-unit decimal text → minor units, or null when it is not a number. */
export function minorFromText(text: string, exponent = 2): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 10 ** exponent);
}

export interface CsvIssue {
  row: number;
  message: string;
}

export const CARD_CSV_COLUMNS = ["batch_number", "business_day", "scheme", "count", "amount"] as const;
export const CARD_CSV_OPTIONAL = ["acquirer", "terminal", "fees"] as const;

export interface ParsedCardCsv {
  batches: {
    batchNumber: string;
    businessDay: string;
    acquirer: string;
    terminalName: string | null;
    feesMinor: number;
    lines: { scheme: string; count: number; amountMinor: number }[];
  }[];
  issues: CsvIssue[];
  missingColumns: string[];
}

/** One row per scheme line; rows sharing a batch number are grouped. */
export function parseCardCsv(text: string, defaultAcquirer: string): ParsedCardCsv {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const missingColumns = CARD_CSV_COLUMNS.filter((column) => !header.includes(column));
  const issues: CsvIssue[] = [];
  if (missingColumns.length > 0) return { batches: [], issues, missingColumns };

  const col = (name: string) => header.indexOf(name);
  const grouped = new Map<string, ParsedCardCsv["batches"][number]>();

  table.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? "").trim() : "");
    const batchNumber = get("batch_number");
    const businessDay = get("business_day");
    const scheme = get("scheme").toLowerCase();
    const count = Number(get("count"));
    const amountMinor = minorFromText(get("amount"));
    const fees = get("fees") ? minorFromText(get("fees")) : 0;

    if (!batchNumber) return issues.push({ row: rowNumber, message: "batch_number is empty" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDay)) {
      return issues.push({ row: rowNumber, message: "business_day must be YYYY-MM-DD" });
    }
    if (!scheme) return issues.push({ row: rowNumber, message: "scheme is empty" });
    if (!Number.isInteger(count) || count < 0) return issues.push({ row: rowNumber, message: "count must be a whole number" });
    if (amountMinor === null) return issues.push({ row: rowNumber, message: "amount is not a number" });
    if (fees === null) return issues.push({ row: rowNumber, message: "fees is not a number" });

    const acquirer = get("acquirer") || defaultAcquirer;
    const groupKey = `${acquirer}|${batchNumber}`;
    const batch = grouped.get(groupKey) ?? {
      batchNumber,
      businessDay,
      acquirer,
      terminalName: get("terminal") || null,
      feesMinor: 0,
      lines: [],
    };
    if (batch.businessDay !== businessDay) {
      return issues.push({ row: rowNumber, message: "rows of one batch carry different business days" });
    }
    batch.feesMinor += fees;
    batch.lines.push({ scheme, count, amountMinor });
    grouped.set(groupKey, batch);
    return undefined;
  });

  return { batches: [...grouped.values()], issues, missingColumns };
}

export const PAYOUT_CSV_COLUMNS = ["order_ref", "gross"] as const;

/** An aggregator statement's order lines: `order_ref,gross`. */
export function parsePayoutCsv(text: string): {
  refs: { ref: string; grossMinor: number }[];
  issues: CsvIssue[];
  missingColumns: string[];
} {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const missingColumns = PAYOUT_CSV_COLUMNS.filter((column) => !header.includes(column));
  const issues: CsvIssue[] = [];
  if (missingColumns.length > 0) return { refs: [], issues, missingColumns };
  const refIndex = header.indexOf("order_ref");
  const grossIndex = header.indexOf("gross");
  const refs: { ref: string; grossMinor: number }[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, index) => {
    const ref = (cells[refIndex] ?? "").trim();
    const gross = minorFromText(cells[grossIndex] ?? "");
    if (!ref) return issues.push({ row: index + 2, message: "order_ref is empty" });
    if (gross === null) return issues.push({ row: index + 2, message: "gross is not a number" });
    if (seen.has(ref)) return issues.push({ row: index + 2, message: `order_ref ${ref} appears twice` });
    seen.add(ref);
    refs.push({ ref, grossMinor: gross });
    return undefined;
  });
  return { refs, issues, missingColumns };
}
