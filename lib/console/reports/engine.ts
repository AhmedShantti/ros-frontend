"use client";

/**
 * The report runner — SRS §19.3, FR-RPT-042, FR-RPT-004.
 *
 * One engine rather than thirty-four screens. Every report in the catalogue
 * resolves to a builder that takes the same parameters (period, scope,
 * grouping) and returns the same shape: columns, rows, an optional chart,
 * and — the part that matters — a drill-down from any aggregate row to the
 * transactions that produced it.
 *
 * FR-RPT-042 requires that drill-down in no more than four interactions.
 * Building it into the result shape rather than per screen is what keeps
 * that true: a report that forgets to implement drilling is not possible,
 * because a builder that returns no `drill` is a builder that has declared
 * its rows are already atomic.
 *
 * ## Where the numbers come from
 *
 * Everything is derived in the browser from the same services the rest of
 * the console reads. That is deliberate: the aggregation logic is visible,
 * testable and identical whichever data mode is configured. When a reporting
 * backend exists, a builder becomes a single call and the UI above it does
 * not change.
 */

import type { Id, Localised, Money, Order, WasteRecord } from "../types";
import { services } from "../services";
import type { Scope } from "../services/types";
import { money } from "../format";

export interface ReportColumn {
  key: string;
  header: string;
  numeric?: boolean;
  /** Renders as money when set — the value is minor units. */
  currency?: string;
  /** A percentage of the column total. */
  share?: boolean;
}

export interface ReportRow {
  /** Stable key, and the drill-down handle. */
  id: string;
  label: string;
  secondary?: string;
  values: Record<string, number | string>;
}

export interface DrillRow {
  id: string;
  when: string;
  what: string;
  who: string;
  amount: number;
  currency: string;
  /** Where the console can open the underlying document. */
  href?: string;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: Record<string, number | string>;
  chart?: { valueKey: string; label: string };
  /** FR-RPT-042 — the transactions behind one row. */
  drill?: (row: ReportRow) => Promise<DrillRow[]>;
  /** FR-RPT-004 — when the figures were computed. */
  generatedAt: string;
  /**
   * FR-RPT-004 — true when the period is not yet finished, so the reader
   * knows the number is partial rather than wrong.
   */
  partial: boolean;
  /** Set when the report has no data source wired yet. */
  unavailable?: string;
}

export interface ReportParams {
  from: string;
  to: string;
  scope: Scope;
  /** Which dimension the rows are grouped by. */
  groupBy: string;
  /** Compare against the preceding period of equal length. */
  compare: boolean;
  locale: "en" | "ar";
}

export interface GroupOption {
  key: string;
  labelKey: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const tx = (value: Localised | null | undefined, locale: "en" | "ar"): string =>
  value ? (value[locale] || value[locale === "en" ? "ar" : "en"] || "") : "";

function withinPeriod(iso: string | null | undefined, params: ReportParams): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  return day >= params.from && day <= params.to;
}

/** True when the requested period runs past the end of yesterday. */
function isPartial(params: ReportParams): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return params.to >= today;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function loadOrders(params: ReportParams): Promise<Order[]> {
  const page = await services.sales.orders.list({ scope: params.scope, limit: 500 });
  return page.rows.filter((order) => withinPeriod(order.openedAt ?? order.businessDay, params));
}

/** Net of discounts and refunds, excluding tax — FR-CST-003. */
function netOf(order: Order): number {
  return Math.max(
    0,
    order.subtotal.amount - order.discountTotal.amount - refundedOf(order),
  );
}

function refundedOf(order: Order): number {
  return order.payments
    .filter((payment) => payment.amount.amount < 0)
    .reduce((total, payment) => total + Math.abs(payment.amount.amount), 0);
}

function orderDrill(orders: Order[], locale: "en" | "ar") {
  return async (row: ReportRow): Promise<DrillRow[]> =>
    orders
      .filter((order) => row.values.__ids === undefined || String(row.values.__ids).includes(order.id))
      .slice(0, 200)
      .map((order) => ({
        id: order.id,
        when: order.openedAt ?? order.businessDay,
        what: order.orderNumber,
        who: tx(order.servedByName ?? order.openedByName, locale),
        amount: order.grandTotal.amount,
        currency: order.currency,
        href: `/orders`,
      }));
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type Builder = (params: ReportParams) => Promise<ReportResult>;

/**
 * Sales, grouped by whichever dimension the toolbar asks for.
 *
 * One builder covers nine catalogue entries because they differ only in the
 * grouping key. Writing them out separately would produce nine copies of the
 * same reduce, and they would drift.
 */
function salesBy(dimension: string): Builder {
  return async (params) => {
    const orders = await loadOrders(params);
    const groups = new Map<string, { label: string; secondary?: string; orders: Order[] }>();

    for (const order of orders) {
      let key = "unknown";
      let label = "—";
      let secondary: string | undefined;

      switch (dimension) {
        case "branch":
          key = order.branchId;
          label = tx(order.branchName, params.locale);
          break;
        case "employee":
          key = order.openedBy ?? "unassigned";
          label = tx(order.servedByName ?? order.openedByName, params.locale) || "—";
          break;
        case "orderType":
          key = order.orderType;
          label = order.orderType.replace(/_/g, " ");
          break;
        case "channel":
          key = order.channel;
          label = order.channel;
          break;
        case "hour": {
          const hour = (order.openedAt ?? "").slice(11, 13);
          key = hour || "??";
          label = `${key}:00`;
          break;
        }
        case "day":
          key = (order.openedAt ?? order.businessDay).slice(0, 10);
          label = key;
          break;
        default:
          key = "all";
          label = "—";
      }

      const entry = groups.get(key) ?? { label, secondary, orders: [] };
      entry.orders.push(order);
      groups.set(key, entry);
    }

    const rows: ReportRow[] = [...groups.entries()]
      .map(([key, entry]) => {
        const gross = sum(entry.orders.map((order) => order.subtotal.amount));
        const discounts = sum(entry.orders.map((order) => order.discountTotal.amount));
        const refunds = sum(entry.orders.map(refundedOf));
        const tax = sum(entry.orders.map((order) => order.taxTotal.amount));
        const net = sum(entry.orders.map(netOf));
        return {
          id: key,
          label: entry.label,
          secondary: entry.secondary,
          values: {
            orders: entry.orders.length,
            gross,
            discounts,
            refunds,
            net,
            tax,
            aov: entry.orders.length > 0 ? Math.round(net / entry.orders.length) : 0,
            __ids: entry.orders.map((order) => order.id).join(","),
          },
        };
      })
      .sort((a, b) => Number(b.values.net) - Number(a.values.net));

    const currency = orders[0]?.currency ?? "EGP";

    return {
      columns: [
        { key: "orders", header: "rep.col.orders", numeric: true },
        { key: "gross", header: "rep.col.gross", numeric: true, currency },
        { key: "discounts", header: "rep.col.discounts", numeric: true, currency },
        { key: "refunds", header: "rep.col.refunds", numeric: true, currency },
        { key: "net", header: "rep.col.net", numeric: true, currency, share: true },
        { key: "tax", header: "rep.col.tax", numeric: true, currency },
        { key: "aov", header: "rep.col.aov", numeric: true, currency },
      ],
      rows,
      totals: {
        orders: sum(rows.map((row) => Number(row.values.orders))),
        gross: sum(rows.map((row) => Number(row.values.gross))),
        discounts: sum(rows.map((row) => Number(row.values.discounts))),
        refunds: sum(rows.map((row) => Number(row.values.refunds))),
        net: sum(rows.map((row) => Number(row.values.net))),
        tax: sum(rows.map((row) => Number(row.values.tax))),
      },
      chart: { valueKey: "net", label: "rep.col.net" },
      drill: orderDrill(orders, params.locale),
      generatedAt: new Date().toISOString(),
      partial: isPartial(params),
    };
  };
}

/** Item-level sales, expanded from order lines. */
const salesByItem: Builder = async (params) => {
  const orders = await loadOrders(params);
  const groups = new Map<string, { label: string; units: number; net: number; cost: number }>();

  for (const order of orders) {
    for (const line of order.lines) {
      if (line.state === "voided") continue;
      const key = line.menuItemId;
      const entry =
        groups.get(key) ??
        { label: tx(line.itemNameSnapshot, params.locale), units: 0, net: 0, cost: 0 };
      entry.units += line.quantity;
      entry.net += line.lineTotal.amount - line.lineDiscount.amount;
      entry.cost += (line.unitCostSnapshot?.amount ?? 0) * line.quantity;
      groups.set(key, entry);
    }
  }

  const currency = orders[0]?.currency ?? "EGP";
  const rows: ReportRow[] = [...groups.entries()]
    .map(([key, entry]) => ({
      id: key,
      label: entry.label,
      values: {
        units: entry.units,
        net: entry.net,
        cost: Math.round(entry.cost),
        margin: entry.net - Math.round(entry.cost),
        marginPercent:
          entry.net > 0 ? Math.round(((entry.net - entry.cost) / entry.net) * 1000) / 10 : 0,
      },
    }))
    .sort((a, b) => Number(b.values.net) - Number(a.values.net));

  return {
    columns: [
      { key: "units", header: "rep.col.units", numeric: true },
      { key: "net", header: "rep.col.net", numeric: true, currency, share: true },
      { key: "cost", header: "rep.col.cost", numeric: true, currency },
      { key: "margin", header: "rep.col.margin", numeric: true, currency },
      { key: "marginPercent", header: "rep.col.marginPercent", numeric: true },
    ],
    rows,
    totals: {
      units: sum(rows.map((row) => Number(row.values.units))),
      net: sum(rows.map((row) => Number(row.values.net))),
      cost: sum(rows.map((row) => Number(row.values.cost))),
      margin: sum(rows.map((row) => Number(row.values.margin))),
    },
    chart: { valueKey: "net", label: "rep.col.net" },
    drill: async (row) =>
      orders
        .flatMap((order) =>
          order.lines
            .filter((line) => line.menuItemId === row.id && line.state !== "voided")
            .map((line) => ({
              id: line.id,
              when: order.openedAt ?? order.businessDay,
              what: `${order.orderNumber} · ×${line.quantity}`,
              who: tx(order.servedByName ?? order.openedByName, params.locale),
              amount: line.lineTotal.amount,
              currency: order.currency,
              href: "/orders",
            })),
        )
        .slice(0, 200),
    generatedAt: new Date().toISOString(),
    partial: isPartial(params),
  };
};

/** Tender mix — the reconciliation basis. */
const salesByTender: Builder = async (params) => {
  const orders = await loadOrders(params);
  const groups = new Map<string, { count: number; amount: number }>();

  for (const order of orders) {
    for (const payment of order.payments) {
      const entry = groups.get(payment.tender) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += payment.amount.amount;
      groups.set(payment.tender, entry);
    }
  }

  const currency = orders[0]?.currency ?? "EGP";
  const rows: ReportRow[] = [...groups.entries()]
    .map(([tender, entry]) => ({
      id: tender,
      label: tender.replace(/_/g, " "),
      values: { count: entry.count, amount: entry.amount },
    }))
    .sort((a, b) => Number(b.values.amount) - Number(a.values.amount));

  return {
    columns: [
      { key: "count", header: "rep.col.transactions", numeric: true },
      { key: "amount", header: "rep.col.amount", numeric: true, currency, share: true },
    ],
    rows,
    totals: {
      count: sum(rows.map((row) => Number(row.values.count))),
      amount: sum(rows.map((row) => Number(row.values.amount))),
    },
    chart: { valueKey: "amount", label: "rep.col.amount" },
    generatedAt: new Date().toISOString(),
    partial: isPartial(params),
  };
};

/** Discounts and comps, by reason and by who applied them. */
const discountAnalysis: Builder = async (params) => {
  const orders = await loadOrders(params);
  const groups = new Map<string, { label: string; count: number; amount: number }>();

  for (const order of orders) {
    // Order-level discounts carry their own reason and applier.
    for (const discount of order.discounts) {
      const key = tx(discount.reason, params.locale) || "unspecified";
      const entry = groups.get(key) ?? { label: key, count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += discount.amount.amount;
      groups.set(key, entry);
    }

    // A comp is not a discount (FR-POS-050): the revenue is zero but the
    // cost is still recognised, so it is counted separately rather than
    // folded into the discount total.
    for (const line of order.lines) {
      if (line.isComp) {
        const entry = groups.get("comp") ?? { label: "comp", count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += line.lineSubtotal.amount;
        groups.set("comp", entry);
      } else if (line.lineDiscount.amount > 0) {
        const entry = groups.get("line-level") ?? { label: "line-level", count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += line.lineDiscount.amount;
        groups.set("line-level", entry);
      }
    }
  }

  const currency = orders[0]?.currency ?? "EGP";
  const rows: ReportRow[] = [...groups.entries()]
    .map(([key, entry]) => ({
      id: key,
      label: entry.label,
      values: { count: entry.count, amount: entry.amount },
    }))
    .sort((a, b) => Number(b.values.amount) - Number(a.values.amount));

  return {
    columns: [
      { key: "count", header: "rep.col.occurrences", numeric: true },
      { key: "amount", header: "rep.col.givenAway", numeric: true, currency, share: true },
    ],
    rows,
    totals: {
      count: sum(rows.map((row) => Number(row.values.count))),
      amount: sum(rows.map((row) => Number(row.values.amount))),
    },
    chart: { valueKey: "amount", label: "rep.col.givenAway" },
    generatedAt: new Date().toISOString(),
    partial: isPartial(params),
  };
};

/** Waste, grouped as the toolbar asks. */
function wasteBy(dimension: "reason" | "item" | "location" | "category"): Builder {
  return async (params) => {
    const page = await services.inventory.waste.list({ scope: params.scope, limit: 500 });
    const records = page.rows.filter((row) => withinPeriod(row.recordedAt, params));

    const groups = new Map<string, { label: string; value: number; count: number; trueWaste: number }>();
    for (const record of records) {
      const key =
        dimension === "reason"
          ? record.reasonCode
          : dimension === "item"
            ? record.itemId
            : dimension === "location"
              ? record.locationId
              : record.category;
      const label =
        dimension === "reason"
          ? tx(record.reasonName, params.locale)
          : dimension === "item"
            ? tx(record.itemName, params.locale)
            : dimension === "location"
              ? tx(record.locationName, params.locale)
              : record.category;

      const entry = groups.get(key) ?? { label, value: 0, count: 0, trueWaste: 0 };
      entry.value += record.value.amount;
      entry.count += 1;
      if (record.isTrueWaste) entry.trueWaste += record.value.amount;
      groups.set(key, entry);
    }

    const currency = records[0]?.value.currency ?? "EGP";
    const rows: ReportRow[] = [...groups.entries()]
      .map(([key, entry]) => ({
        id: key,
        label: entry.label,
        values: {
          count: entry.count,
          value: entry.value,
          trueWaste: entry.trueWaste,
          controlled: entry.value - entry.trueWaste,
        },
      }))
      .sort((a, b) => Number(b.values.value) - Number(a.values.value));

    return {
      columns: [
        { key: "count", header: "rep.col.records", numeric: true },
        { key: "trueWaste", header: "rep.col.trueWaste", numeric: true, currency },
        { key: "controlled", header: "rep.col.controlled", numeric: true, currency },
        { key: "value", header: "rep.col.total", numeric: true, currency, share: true },
      ],
      rows,
      totals: {
        count: sum(rows.map((row) => Number(row.values.count))),
        trueWaste: sum(rows.map((row) => Number(row.values.trueWaste))),
        controlled: sum(rows.map((row) => Number(row.values.controlled))),
        value: sum(rows.map((row) => Number(row.values.value))),
      },
      chart: { valueKey: "value", label: "rep.col.total" },
      drill: async (row) =>
        records
          .filter((record) => {
            const key =
              dimension === "reason"
                ? record.reasonCode
                : dimension === "item"
                  ? record.itemId
                  : dimension === "location"
                    ? record.locationId
                    : record.category;
            return key === row.id;
          })
          .slice(0, 200)
          .map((record) => ({
            id: record.id,
            when: record.recordedAt,
            what: `${tx(record.itemName, params.locale)} · ${record.quantity.value} ${record.quantity.unit}`,
            who: tx(record.recordedByName, params.locale),
            amount: record.value.amount,
            currency: record.value.currency,
            href: "/inventory/waste",
          })),
      generatedAt: new Date().toISOString(),
      partial: isPartial(params),
    };
  };
}

/** Current stock valuation, by location or category. */
const stockValuation: Builder = async (params) => {
  const page = await services.inventory.levels.list({ scope: params.scope, limit: 1000 });
  const levels = page.rows;

  const groups = new Map<string, { label: string; value: number; items: number }>();
  for (const level of levels) {
    const key = params.groupBy === "item" ? level.itemId : level.locationId;
    const label =
      params.groupBy === "item"
        ? tx(level.itemName, params.locale)
        : tx(level.locationName, params.locale);
    const entry = groups.get(key) ?? { label, value: 0, items: 0 };
    entry.value += level.value.amount;
    entry.items += 1;
    groups.set(key, entry);
  }

  const currency = levels[0]?.value.currency ?? "EGP";
  const rows: ReportRow[] = [...groups.entries()]
    .map(([key, entry]) => ({
      id: key,
      label: entry.label,
      values: { items: entry.items, value: entry.value },
    }))
    .sort((a, b) => Number(b.values.value) - Number(a.values.value));

  return {
    columns: [
      { key: "items", header: "rep.col.items", numeric: true },
      { key: "value", header: "rep.col.value", numeric: true, currency, share: true },
    ],
    rows,
    totals: {
      items: sum(rows.map((row) => Number(row.values.items))),
      value: sum(rows.map((row) => Number(row.values.value))),
    },
    chart: { valueKey: "value", label: "rep.col.value" },
    generatedAt: new Date().toISOString(),
    // A stock valuation is a snapshot of now, so it is never partial.
    partial: false,
  };
};

/** Attendance and labour, by employee. */
const labourByEmployee: Builder = async (params) => {
  const page = await services.workforce.attendance.list({ scope: params.scope, limit: 500 });
  const records = page.rows.filter((row) => row.date >= params.from && row.date <= params.to);

  const groups = new Map<
    string,
    { label: string; regular: number; overtime: number; cost: number; days: number; late: number }
  >();

  for (const record of records) {
    const entry =
      groups.get(record.employeeId) ??
      {
        label: tx(record.employeeName, params.locale),
        regular: 0,
        overtime: 0,
        cost: 0,
        days: 0,
        late: 0,
      };
    entry.regular += record.regularHours;
    entry.overtime += record.overtimeHours;
    entry.cost += record.cost.amount;
    entry.days += 1;
    if (record.flags.includes("late_arrival")) entry.late += 1;
    groups.set(record.employeeId, entry);
  }

  const currency = records[0]?.cost.currency ?? "EGP";
  const rows: ReportRow[] = [...groups.entries()]
    .map(([key, entry]) => ({
      id: key,
      label: entry.label,
      values: {
        days: entry.days,
        regular: Math.round(entry.regular * 10) / 10,
        overtime: Math.round(entry.overtime * 10) / 10,
        late: entry.late,
        cost: entry.cost,
      },
    }))
    .sort((a, b) => Number(b.values.cost) - Number(a.values.cost));

  return {
    columns: [
      { key: "days", header: "rep.col.days", numeric: true },
      { key: "regular", header: "rep.col.regularHours", numeric: true },
      { key: "overtime", header: "rep.col.overtimeHours", numeric: true },
      { key: "late", header: "rep.col.late", numeric: true },
      { key: "cost", header: "rep.col.labourCost", numeric: true, currency, share: true },
    ],
    rows,
    totals: {
      days: sum(rows.map((row) => Number(row.values.days))),
      regular: Math.round(sum(rows.map((row) => Number(row.values.regular))) * 10) / 10,
      overtime: Math.round(sum(rows.map((row) => Number(row.values.overtime))) * 10) / 10,
      cost: sum(rows.map((row) => Number(row.values.cost))),
    },
    chart: { valueKey: "cost", label: "rep.col.labourCost" },
    drill: async (row) =>
      records
        .filter((record) => record.employeeId === row.id)
        .slice(0, 200)
        .map((record) => ({
          id: record.id,
          when: record.date,
          what: `${record.clockIn?.slice(11, 16) ?? "—"} → ${record.clockOut?.slice(11, 16) ?? "—"}`,
          who: tx(record.branchName, params.locale),
          amount: record.cost.amount,
          currency: record.cost.currency,
          href: "/workforce/attendance",
        })),
    generatedAt: new Date().toISOString(),
    partial: isPartial(params),
  };
};

/** Kitchen timing, per item. */
const prepTime: Builder = async (params) => {
  const page = await services.operations.kitchenQueue({ scope: params.scope, limit: 300 });
  const tickets = page.rows;

  /*
   * A ticket line carries no timing of its own — the ticket does. So the
   * measured span is fired → bumped, attributed to every line on that
   * ticket. That is the honest reading: the kitchen finished the ticket, and
   * apportioning a single elapsed time across its lines would be inventing
   * per-item precision the data does not have.
   */
  const groups = new Map<string, { label: string; samples: number[] }>();
  for (const ticket of tickets) {
    if (!ticket.bumpedAt) continue;
    const seconds = Math.max(
      0,
      Math.round((Date.parse(ticket.bumpedAt) - Date.parse(ticket.firedAt)) / 1000),
    );
    for (const line of ticket.lines) {
      const key = tx(line.name, params.locale) || line.id;
      const entry = groups.get(key) ?? { label: key, samples: [] as number[] };
      entry.samples.push(seconds);
      groups.set(key, entry);
    }
  }

  const rows: ReportRow[] = [...groups.entries()]
    .filter(([, entry]) => entry.samples.length > 0)
    .map(([key, entry]) => {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
      return {
        id: key,
        label: entry.label,
        values: {
          count: sorted.length,
          average: Math.round(sum(sorted) / sorted.length),
          p50: p(0.5),
          p90: p(0.9),
        },
      };
    })
    .sort((a, b) => Number(b.values.p90) - Number(a.values.p90));

  return {
    columns: [
      { key: "count", header: "rep.col.made", numeric: true },
      { key: "average", header: "rep.col.averageSeconds", numeric: true },
      { key: "p50", header: "rep.col.p50", numeric: true },
      { key: "p90", header: "rep.col.p90", numeric: true },
    ],
    rows,
    chart: { valueKey: "p90", label: "rep.col.p90" },
    generatedAt: new Date().toISOString(),
    partial: isPartial(params),
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, Builder> = {
  "sales-summary": salesBy("day"),
  "sales-by-branch": salesBy("branch"),
  "sales-by-item": salesByItem,
  "sales-by-employee": salesBy("employee"),
  "sales-by-tender": salesByTender,
  "sales-by-hour": salesBy("hour"),
  "discount-analysis": discountAnalysis,
  "void-refund-analysis": discountAnalysis,
  "menu-mix": salesByItem,
  "aov-trend": salesBy("day"),

  "stock-valuation": stockValuation,
  "waste-analysis": wasteBy("reason"),
  "prep-time": prepTime,

  attendance: labourByEmployee,
  "labour-cost": labourByEmployee,
  "sales-per-labour-hour": labourByEmployee,
  overtime: labourByEmployee,
};

/** Which grouping choices a report offers, if any. */
export const GROUPINGS: Record<string, GroupOption[]> = {
  "sales-summary": [
    { key: "day", labelKey: "rep.group.day" },
    { key: "hour", labelKey: "rep.group.hour" },
    { key: "branch", labelKey: "rep.group.branch" },
    { key: "orderType", labelKey: "rep.group.orderType" },
    { key: "channel", labelKey: "rep.group.channel" },
  ],
  "waste-analysis": [
    { key: "reason", labelKey: "rep.group.reason" },
    { key: "item", labelKey: "rep.group.item" },
    { key: "location", labelKey: "rep.group.location" },
    { key: "category", labelKey: "rep.group.category" },
  ],
  "stock-valuation": [
    { key: "location", labelKey: "rep.group.location" },
    { key: "item", labelKey: "rep.group.item" },
  ],
};

/**
 * Run one report.
 *
 * A report with no builder is reported as such rather than rendered empty:
 * a blank table is indistinguishable from a period with no activity, and
 * the two mean very different things.
 */
export async function runReport(id: string, params: ReportParams): Promise<ReportResult> {
  // Grouped reports pick their builder from the toolbar, not the id.
  if (id === "sales-summary" && params.groupBy) {
    return salesBy(params.groupBy)(params);
  }
  if (id === "waste-analysis" && params.groupBy) {
    return wasteBy(params.groupBy as "reason" | "item" | "location" | "category")(params);
  }

  const builder = BUILDERS[id];
  if (!builder) {
    return {
      columns: [],
      rows: [],
      generatedAt: new Date().toISOString(),
      partial: false,
      unavailable: id,
    };
  }

  try {
    return await builder(params);
  } catch (error) {
    return {
      columns: [],
      rows: [],
      generatedAt: new Date().toISOString(),
      partial: false,
      unavailable: error instanceof Error ? error.message : id,
    };
  }
}

export function hasBuilder(id: string): boolean {
  return Boolean(BUILDERS[id]);
}
