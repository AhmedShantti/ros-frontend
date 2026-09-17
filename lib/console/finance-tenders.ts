/**
 * Tender totals per session and per day — FR-FIN-010.
 *
 * Cash, each card scheme, each wallet, gift card, voucher, on-account and
 * aggregator-settled, kept apart. Card is split by `OrderPayment.cardScheme`
 * because a batch settles per scheme and a reconciliation that lumps Visa
 * with Mada cannot find the missing one. A payment record carries no wallet
 * provider, so wallets fall into one "provider not recorded" bucket rather
 * than an invented split.
 *
 * ## Attribution to a session
 *
 * Payments do not carry a cash-session id. They are attributed by terminal
 * and time: a payment captured on the session's terminal between its open
 * and its close (or now, while open) belongs to it. Two sessions cannot be
 * open on one drawer at once (FR-FIN-001), so the window is unambiguous —
 * but it is an attribution, and the screen says so.
 */

import type { Currency, IsoDate, IsoDateTime, Order, TenderType } from "./types";

export interface TenderBucket {
  /** `card:visa`, `wallet:unrecorded`, `cash`… */
  key: string;
  tender: TenderType;
  /** Card scheme or wallet provider; null when the tender has no sub-type. */
  sub: string | null;
  count: number;
  /** Net of refunds, minor units. */
  amount: number;
  refunds: number;
}

export const UNRECORDED = "unrecorded";

function subOf(tender: TenderType, scheme: string | null): string | null {
  if (tender === "card") return scheme ? scheme.toLowerCase() : UNRECORDED;
  if (tender === "wallet") return UNRECORDED;
  return null;
}

/** Stable report order: cash first, then the rest as the SRS lists them. */
const ORDER: TenderType[] = [
  "cash",
  "card",
  "wallet",
  "gift_card",
  "voucher",
  "on_account",
  "aggregator_settled",
  "loyalty_points",
  "store_credit",
  "bank_transfer",
];

export function tenderTotals(
  orders: Order[],
  accept: (order: Order, capturedAt: IsoDateTime) => boolean = () => true,
): { rows: TenderBucket[]; total: number; currency: Currency | null } {
  const map = new Map<string, TenderBucket>();
  let currency: Currency | null = null;

  for (const order of orders) {
    for (const payment of order.payments) {
      if (!accept(order, payment.capturedAt)) continue;
      currency = payment.amount.currency;
      const sub = subOf(payment.tender, payment.cardScheme);
      const key = sub ? `${payment.tender}:${sub}` : payment.tender;
      const bucket = map.get(key) ?? {
        key,
        tender: payment.tender,
        sub,
        count: 0,
        amount: 0,
        refunds: 0,
      };
      bucket.count += 1;
      bucket.amount += payment.amount.amount;
      if (payment.amount.amount < 0) bucket.refunds += -payment.amount.amount;
      map.set(key, bucket);
    }
  }

  const rows = [...map.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.tender) - ORDER.indexOf(b.tender) || (a.sub ?? "").localeCompare(b.sub ?? ""),
  );
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0), currency };
}

export interface SessionWindow {
  terminalName: string;
  openedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/** FR-FIN-010 — per session, by terminal and capture window. */
export function sessionTenderTotals(orders: Order[], session: SessionWindow, now = new Date()) {
  const from = session.openedAt;
  const to = session.closedAt ?? now.toISOString();
  return tenderTotals(
    orders,
    (order, at) => order.terminalName === session.terminalName && at >= from && at <= to,
  );
}

/** FR-FIN-010 — per business day. */
export function dailyTenderTotals(orders: Order[]): { day: IsoDate; totals: ReturnType<typeof tenderTotals> }[] {
  const days = new Map<IsoDate, Order[]>();
  for (const order of orders) {
    const list = days.get(order.businessDay) ?? [];
    list.push(order);
    days.set(order.businessDay, list);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => ({ day, totals: tenderTotals(list) }));
}
