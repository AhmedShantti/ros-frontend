/**
 * Daily sales rollup for the demo — SRS FR-RPT-002.
 *
 * The SRS wants pre-aggregated rollups (hourly, daily, weekly, monthly) so a
 * year-on-year comparison never scans a year of orders. The mock order set
 * only reaches back a month, so this builds the daily rollup a real backend
 * would hold:
 *
 *   - Days the orders cover are aggregated from those orders, with exactly the
 *     formulas the report runner uses, so the two never disagree.
 *   - Older days, back roughly two years, are generated around the level the
 *     orders imply: a weekly rhythm (busier Thursday–Saturday), a gentle
 *     seasonal swing, steady year-on-year growth and some seeded noise.
 *
 * Deterministic: seeded RNG and the fixed clock anchor, nothing else — see
 * the note in PROGRESS.md about hydration.
 */

import type { Order } from "../types";
import { branches } from "./org";
import { orders } from "./sales";
import { createRng, float } from "./rng";
import { BUSINESS_DAY, dateAgo } from "./clock";

export interface DailySalesRow {
  /** Business day, YYYY-MM-DD. */
  date: string;
  branchId: string;
  brandId: string;
  branchName: { en: string; ar: string };
  orders: number;
  /** Minor units. */
  gross: number;
  discounts: number;
  refunds: number;
  net: number;
  tax: number;
}

const HISTORY_DAYS = 800;
/** Days the mock orders cover. */
const ORDER_WINDOW_DAYS = 30;

function refundedOf(order: Order): number {
  return order.payments
    .filter((payment) => payment.amount.amount < 0)
    .reduce((total, payment) => total + Math.abs(payment.amount.amount), 0);
}

function netOf(order: Order): number {
  return Math.max(0, order.subtotal.amount - order.discountTotal.amount - refundedOf(order));
}

const dayOf = (order: Order): string => (order.openedAt ?? order.businessDay).slice(0, 10);

function build(): { rows: DailySalesRow[]; currency: string } {
  const currency = orders[0]?.currency ?? "EGP";
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const rows: DailySalesRow[] = [];

  // -- Real days, from the orders ------------------------------------------
  const real = new Map<string, DailySalesRow>();
  for (const order of orders) {
    const branch = branchById.get(order.branchId);
    if (!branch) continue;
    const key = `${dayOf(order)}|${order.branchId}`;
    const row =
      real.get(key) ??
      {
        date: dayOf(order),
        branchId: branch.id,
        brandId: branch.brandId,
        branchName: branch.name,
        orders: 0,
        gross: 0,
        discounts: 0,
        refunds: 0,
        net: 0,
        tax: 0,
      };
    row.orders += 1;
    row.gross += order.subtotal.amount;
    row.discounts += order.discountTotal.amount;
    row.refunds += refundedOf(order);
    row.net += netOf(order);
    row.tax += order.taxTotal.amount;
    real.set(key, row);
  }
  rows.push(...real.values());

  // -- Level the older days are generated around ----------------------------
  const perBranch = new Map<string, { orders: number; gross: number; discounts: number; refunds: number; net: number; tax: number }>();
  // The anchor day is left out of the level: the demo piles most of its open
  // orders onto it, and a whole history built around one busy day would
  // overstate every ordinary day.
  for (const row of real.values()) {
    if (row.date === BUSINESS_DAY) continue;
    const acc = perBranch.get(row.branchId) ?? { orders: 0, gross: 0, discounts: 0, refunds: 0, net: 0, tax: 0 };
    acc.orders += row.orders;
    acc.gross += row.gross;
    acc.discounts += row.discounts;
    acc.refunds += row.refunds;
    acc.net += row.net;
    acc.tax += row.tax;
    perBranch.set(row.branchId, acc);
  }

  // Thu / Fri / Sat are the busy days; Sunday–Wednesday are quieter.
  const WEEKDAY = [0.92, 0.85, 0.88, 0.9, 1.05, 1.22, 1.18];

  branches.forEach((branch, branchIndex) => {
    const acc = perBranch.get(branch.id);
    if (!acc || acc.orders === 0) return;
    const ordersPerDay = acc.orders / (ORDER_WINDOW_DAYS - 1);
    const aov = acc.net / acc.orders;
    const discountRatio = acc.gross > 0 ? acc.discounts / acc.gross : 0;
    const refundRatio = acc.gross > 0 ? acc.refunds / acc.gross : 0;
    const taxRatio = acc.gross > 0 ? acc.tax / acc.gross : 0;

    for (let age = ORDER_WINDOW_DAYS; age <= HISTORY_DAYS; age += 1) {
      const date = dateAgo(age);
      const rng = createRng(7919 * (age + 1) + 104729 * (branchIndex + 1));
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      const dayOfYear = Math.floor(
        (Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) -
          Date.UTC(+date.slice(0, 4), 0, 0)) /
          86_400_000,
      );

      const seasonal = 1 + 0.1 * Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);
      // About 14% a year: older days sit lower, so year-on-year reads as growth.
      const growth = 1 / (1 + 0.14 * (age / 365));
      const noise = float(rng, 0.88, 1.12, 3);

      const count = Math.max(1, Math.round(ordersPerDay * WEEKDAY[weekday]! * seasonal * growth * noise));
      const basket = aov * float(rng, 0.94, 1.06, 3) * (0.94 + 0.06 * growth);
      const net = Math.round(count * basket);
      const gross = Math.round(net / Math.max(0.2, 1 - discountRatio - refundRatio));

      rows.push({
        date,
        branchId: branch.id,
        brandId: branch.brandId,
        branchName: branch.name,
        orders: count,
        gross,
        discounts: Math.round(gross * discountRatio),
        refunds: Math.round(gross * refundRatio),
        net,
        tax: Math.round(gross * taxRatio),
      });
    }
  });

  rows.sort((a, b) => (a.date === b.date ? a.branchId.localeCompare(b.branchId) : a.date.localeCompare(b.date)));
  return { rows, currency };
}

const built = build();

export const salesRollup: DailySalesRow[] = built.rows;
export const salesRollupCurrency: string = built.currency;
