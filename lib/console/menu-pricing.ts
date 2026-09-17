/**
 * Pricing arithmetic — FR-MNU-020, FR-MNU-021, FR-MNU-025, FR-MNU-026.
 *
 * Pure functions only, so the bulk editor, the CSV import, the price editor
 * and the resolution preview cannot disagree about what a price becomes.
 * Money stays in integer minor units throughout; percentages are parsed to
 * basis points before they touch an amount.
 */

import type { Id, Money, OrderType, PriceList, PriceListEntry } from "./types";
import type { PricePointRule } from "./services/menu-pricing";

// ---------------------------------------------------------------------------
// FR-MNU-025 — percentage changes and price points
// ---------------------------------------------------------------------------

/** "7.5" → 750 basis points. Null when it is not a number. */
export function basisPoints(percent: string): number | null {
  const trimmed = percent.trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** `minor × (1 + bp / 10000)`, rounded half away from zero, never negative. */
export function applyBasisPoints(minor: number, bp: number): number {
  const scaled = minor * (10_000 + bp);
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) / 10_000);
  return Math.max(0, rounded);
}

function roundTo(value: number, step: number, direction: "up" | "down" | "nearest"): number {
  if (step <= 0) return value;
  const lower = Math.floor(value / step) * step;
  if (lower === value) return value;
  const upper = lower + step;
  if (direction === "up") return upper;
  if (direction === "down") return lower;
  return value - lower < upper - value ? lower : upper;
}

/**
 * FR-MNU-025 — snap an amount to a configured price point.
 *
 * `ending` works within one major unit (`unit` minor units, 100 for a
 * two-decimal currency): with ending 95, 12.20 goes up to 12.95, down to
 * 11.95, or to whichever is nearer.
 */
export function roundToPricePoint(minor: number, rule: PricePointRule, unit = 100): number {
  if (rule.kind === "none") return minor;
  if (rule.kind === "multiple") return Math.max(0, roundTo(minor, rule.step, rule.direction));

  const ending = ((rule.ending % unit) + unit) % unit;
  const base = Math.floor(minor / unit) * unit + ending;
  if (base === minor) return minor;
  const below = base < minor ? base : base - unit;
  const above = below + unit;
  if (rule.direction === "up") return above;
  if (rule.direction === "down") return Math.max(0, below);
  return minor - below <= above - minor ? Math.max(0, below) : above;
}

export type BulkOperation =
  | { kind: "percent"; bp: number }
  | { kind: "amount"; minor: number }
  | { kind: "set"; minor: number };

export function applyBulk(minor: number, operation: BulkOperation, rule: PricePointRule, unit = 100): number {
  let next = minor;
  if (operation.kind === "percent") next = applyBasisPoints(minor, operation.bp);
  if (operation.kind === "amount") next = Math.max(0, minor + operation.minor);
  if (operation.kind === "set") next = Math.max(0, operation.minor);
  return roundToPricePoint(next, rule, unit);
}

// ---------------------------------------------------------------------------
// FR-MNU-026 — margin warnings
// ---------------------------------------------------------------------------

export interface MarginCheck {
  /** Null when there is no cost to compare against. */
  marginPercent: number | null;
  belowCost: boolean;
  belowThreshold: boolean;
}

/**
 * Contribution margin of a price against a portion cost.
 *
 * Prices are compared as entered. A tax-inclusive menu overstates margin by
 * the tax, which the screen notes; the threshold is a warning, not a block.
 */
export function checkMargin(price: number, cost: number | null, thresholdPercent: number): MarginCheck {
  if (cost === null || cost <= 0) return { marginPercent: null, belowCost: false, belowThreshold: false };
  if (price <= 0) return { marginPercent: null, belowCost: true, belowThreshold: true };
  const marginPercent = ((price - cost) / price) * 100;
  return {
    marginPercent,
    belowCost: price < cost,
    belowThreshold: marginPercent < thresholdPercent,
  };
}

// ---------------------------------------------------------------------------
// FR-MNU-025 — CSV import
// ---------------------------------------------------------------------------

/** RFC 4180 — quoted fields, doubled quotes, CRLF or LF, and a BOM tolerated. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export type ImportProblem =
  | "missing_column"
  | "unknown_variant"
  | "bad_price"
  | "excess_precision"
  | "negative"
  | "duplicate"
  | "bad_date"
  | "past_date";

export type ImportWarning = "no_change" | "below_cost" | "below_threshold" | "large_change";

export interface ImportRow {
  line: number;
  raw: Record<string, string>;
  variantId: Id | null;
  menuItemId: Id | null;
  itemLabel: string;
  current: Money | null;
  next: Money | null;
  effectiveAt: string | null;
  problems: ImportProblem[];
  warnings: ImportWarning[];
  marginPercent: number | null;
}

export interface ImportCatalogueVariant {
  variantId: Id;
  menuItemId: Id;
  label: string;
  /** Codes a sheet may use to name the variant: its id, barcode, the item PLU. */
  codes: string[];
  current: Money | null;
  cost: number | null;
}

export const IMPORT_COLUMNS = ["variant", "price", "effective_from"] as const;

function majorToMinor(raw: string, exponent: number): { minor: number } | { problem: ImportProblem } {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { problem: "bad_price" };
  if (trimmed.startsWith("-")) return { problem: "negative" };
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > exponent) return { problem: "excess_precision" };
  const padded = (fraction + "0".repeat(exponent)).slice(0, exponent);
  return { minor: Number(whole) * 10 ** exponent + Number(padded || "0") };
}

/**
 * Turn a parsed sheet into previewable rows. Nothing is applied here — the
 * preview is the confirm step FR-MNU-025 asks for, so a bad row is reported,
 * never silently skipped.
 */
export function validateImport(
  cells: string[][],
  catalogue: ImportCatalogueVariant[],
  options: { currency: Money["currency"]; exponent: number; thresholdPercent: number; now: Date },
): { rows: ImportRow[]; missingColumns: string[] } {
  const [header = [], ...body] = cells;
  const names = header.map((cell) => cell.trim().toLowerCase());
  const missingColumns = ["variant", "price"].filter((name) => !names.includes(name));
  if (missingColumns.length > 0) return { rows: [], missingColumns };

  const byCode = new Map<string, ImportCatalogueVariant>();
  for (const variant of catalogue) {
    for (const code of variant.codes) if (code) byCode.set(code.trim().toLowerCase(), variant);
  }

  const seen = new Set<string>();
  const rows = body.map((cellsOfRow, index): ImportRow => {
    const raw: Record<string, string> = {};
    names.forEach((name, column) => {
      raw[name] = (cellsOfRow[column] ?? "").trim();
    });

    const problems: ImportProblem[] = [];
    const warnings: ImportWarning[] = [];
    const match = byCode.get((raw.variant ?? "").toLowerCase()) ?? null;
    if (!raw.variant || !raw.price) problems.push("missing_column");
    if (raw.variant && !match) problems.push("unknown_variant");
    if (match) {
      if (seen.has(match.variantId)) problems.push("duplicate");
      seen.add(match.variantId);
    }

    let next: Money | null = null;
    if (raw.price) {
      const parsed = majorToMinor(raw.price, options.exponent);
      if ("problem" in parsed) problems.push(parsed.problem);
      else next = { amount: parsed.minor, currency: options.currency };
    }

    let effectiveAt: string | null = null;
    const effective = raw.effective_from ?? "";
    if (effective) {
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(effective) ? `${effective}T00:00:00` : effective);
      if (Number.isNaN(date.getTime())) problems.push("bad_date");
      else if (date.getTime() < options.now.getTime() - 60_000) problems.push("past_date");
      else effectiveAt = date.toISOString();
    }

    let marginPercent: number | null = null;
    if (match && next) {
      if (match.current && match.current.amount === next.amount) warnings.push("no_change");
      const margin = checkMargin(next.amount, match.cost, options.thresholdPercent);
      marginPercent = margin.marginPercent;
      if (margin.belowCost) warnings.push("below_cost");
      else if (margin.belowThreshold) warnings.push("below_threshold");
      if (match.current && match.current.amount > 0) {
        const change = Math.abs(next.amount - match.current.amount) / match.current.amount;
        if (change > 0.25) warnings.push("large_change");
      }
    }

    return {
      line: index + 2,
      raw,
      variantId: match?.variantId ?? null,
      menuItemId: match?.menuItemId ?? null,
      itemLabel: match?.label ?? raw.variant ?? "",
      current: match?.current ?? null,
      next,
      effectiveAt,
      problems,
      warnings,
      marginPercent,
    };
  });

  return { rows, missingColumns: [] };
}

// ---------------------------------------------------------------------------
// FR-MNU-020 — recurrence
// ---------------------------------------------------------------------------

/** Days are 0 (Sunday) … 6 (Saturday); times are "HH:MM", local to the branch. */
export interface RecurrenceWindow {
  days: number[];
  start: string;
  end: string;
}

export function serialiseRecurrence(window: RecurrenceWindow | null): string | null {
  if (!window || window.days.length === 0) return null;
  return JSON.stringify({ days: [...window.days].sort(), start: window.start, end: window.end });
}

/** Null when there is none; `"opaque"` when it exists but was not authored here. */
export function parseRecurrence(recurrence: string | null): RecurrenceWindow | "opaque" | null {
  if (!recurrence) return null;
  try {
    const parsed = JSON.parse(recurrence) as Partial<RecurrenceWindow>;
    if (
      Array.isArray(parsed.days) &&
      parsed.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      typeof parsed.start === "string" &&
      typeof parsed.end === "string" &&
      /^\d{2}:\d{2}$/.test(parsed.start) &&
      /^\d{2}:\d{2}$/.test(parsed.end)
    ) {
      return { days: parsed.days, start: parsed.start, end: parsed.end };
    }
  } catch {
    // Not JSON — text such as "Daily from sunset".
  }
  return "opaque";
}

function minutesOf(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** A window that ends before it starts runs past midnight: 22:00–02:00. */
export function inRecurrence(window: RecurrenceWindow, at: Date): boolean {
  const minutes = at.getHours() * 60 + at.getMinutes();
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const day = at.getDay();
  if (start === end) return window.days.includes(day);
  if (start < end) return window.days.includes(day) && minutes >= start && minutes < end;
  if (minutes >= start) return window.days.includes(day);
  return window.days.includes((day + 6) % 7) && minutes < end;
}

// ---------------------------------------------------------------------------
// FR-MNU-020/021 — which list prices this sale
// ---------------------------------------------------------------------------

export interface ResolutionContext {
  variantId: Id;
  orderType: OrderType;
  brandId: Id | null;
  branchId: Id | null;
  at: Date;
}

export type ExclusionReason =
  | "inactive"
  | "no_entry"
  | "order_type"
  | "scope"
  | "not_started"
  | "ended"
  | "outside_recurrence";

export interface ResolutionCandidate {
  list: PriceList;
  entry: PriceListEntry | null;
  excluded: ExclusionReason[];
  /** Recurrence text the console cannot evaluate. The list is kept, and flagged. */
  opaqueRecurrence: boolean;
}

export interface Resolution {
  winner: ResolutionCandidate | null;
  candidates: ResolutionCandidate[];
  /** Two eligible lists at the same top priority: the answer is not deterministic. */
  tie: boolean;
}

function isoDayOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Highest priority among the lists in force for this variant, order type,
 * scope and moment. Every excluded list says why, because "why is delivery
 * charging the dine-in price?" is the question this answers.
 */
export function resolvePrice(
  lists: { list: PriceList; entries: PriceListEntry[] }[],
  context: ResolutionContext,
): Resolution {
  const day = isoDayOf(context.at);
  const candidates = lists.map(({ list, entries }): ResolutionCandidate => {
    const entry = entries.find((row) => row.variantId === context.variantId) ?? null;
    const excluded: ExclusionReason[] = [];
    if (!list.active) excluded.push("inactive");
    if (!entry) excluded.push("no_entry");
    // FR-MNU-021 — a list naming no order type applies to all of them.
    if (list.orderTypes.length > 0 && !list.orderTypes.includes(context.orderType)) excluded.push("order_type");
    if (list.scope === "brand" && list.scopeId && list.scopeId !== context.brandId) excluded.push("scope");
    if (list.scope === "branch" && list.scopeId && list.scopeId !== context.branchId) excluded.push("scope");
    if (list.validFrom && day < list.validFrom) excluded.push("not_started");
    if (list.validTo && day > list.validTo) excluded.push("ended");
    const recurrence = parseRecurrence(list.recurrence);
    if (recurrence && recurrence !== "opaque" && !inRecurrence(recurrence, context.at)) {
      excluded.push("outside_recurrence");
    }
    return { list, entry, excluded, opaqueRecurrence: recurrence === "opaque" };
  });

  const eligible = candidates
    .filter((candidate) => candidate.excluded.length === 0)
    .sort((a, b) => b.list.priority - a.list.priority);
  const winner = eligible[0] ?? null;
  const tie = Boolean(winner && eligible[1] && eligible[1].list.priority === winner.list.priority);

  return {
    winner,
    candidates: [...candidates].sort((a, b) => b.list.priority - a.list.priority),
    tie,
  };
}

/** Minor units per major unit for a currency exponent. */
export function unitOf(exponent: number): number {
  return 10 ** exponent;
}
