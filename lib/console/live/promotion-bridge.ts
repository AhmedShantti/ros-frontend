"use client";

/**
 * The till's side of the CRM service — FR-CRM-016, FR-CRM-026, FR-CRM-027.
 *
 * The reducer is pure, so everything that talks to `services.crm` happens
 * here, and only ever as a consequence of state the reducer has already
 * settled:
 *
 *   1. **Mirror** the console's promotions and recorded redemptions into the
 *      store (`PROMOTIONS_SYNC`), on mount, on a slow interval, when another
 *      tab writes them, and after this till records a redemption.
 *   2. **Profile** the attached customer (tags, tier, visit count) so the
 *      customer conditions can be judged (`ORDER_PROMOTION_CUSTOMER`).
 *   3. **Redeem**: a closed sale's applied promotions are recorded with
 *      `crm.promotions.redeem`, so the usage limits count them. The service
 *      refuses a second write for the same order, and the store remembers
 *      it was done, so neither a retry nor a reload records twice.
 *   4. **Earn**: a closed sale with a customer posts its loyalty points with
 *      `crm.loyalty.earnForSale`, the promotion's points multiplier passed
 *      through. Also idempotent per order on both sides.
 *
 * NFR-USA-005 — the training sandbox evaluates promotions (so practice looks
 * like the real till) but never records a redemption or posts a point.
 */

import { useEffect, useRef } from "react";
import type { Id, Order } from "../types";
import { crmService } from "../services/crm";
import type { Dispatchable } from "./store";
import type { LiveState } from "./state";
import { earnInputOf, promotionCartOf } from "./promotions";
import { menuItemById } from "../mock/catalogue";
import { branchById } from "../mock/org";
import { countryPacks } from "../mock/platform";

export const PROMOTIONS_CHANGED_EVENT = "ros:promotions-changed";

const categoryOf = (menuItemId: Id) => menuItemById.get(menuItemId)?.categoryId ?? null;

async function loadBook() {
  const [page, redemptions] = await Promise.all([
    crmService.promotions.list({ limit: 10_000 }),
    crmService.promotions.redemptions(),
  ]);
  return {
    promotions: [...page.rows].sort((a, b) => a.id.localeCompare(b.id)),
    redemptions: redemptions
      .map(({ promotionId, customerId, day, orderId }) => ({ promotionId, customerId, day, orderId }))
      .sort((a, b) => `${a.promotionId}|${a.orderId}|${a.day}`.localeCompare(`${b.promotionId}|${b.orderId}|${b.day}`)),
  };
}

export function usePromotionBridge(
  state: LiveState,
  send: (action: Dispatchable) => void,
  options: { ready: boolean; training: boolean },
): void {
  const { ready, training } = options;
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef(new Set<string>());

  // 1. Mirror.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const book = await loadBook();
        if (cancelled) return;
        const current = stateRef.current.promotionBook;
        if (
          JSON.stringify(book.promotions) === JSON.stringify(current.promotions) &&
          JSON.stringify(book.redemptions) === JSON.stringify(current.redemptions)
        ) {
          return;
        }
        send({ type: "PROMOTIONS_SYNC", at: new Date().toISOString(), ...book });
      } catch {
        // An unreadable promotion store must never take the till down; the
        // last mirrored copy stays in force.
      }
    };
    void sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key?.endsWith(".promotions") || event.key?.endsWith(".promotion-redemptions")) void sync();
    };
    const timer = window.setInterval(() => void sync(), 30_000);
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROMOTIONS_CHANGED_EVENT, sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROMOTIONS_CHANGED_EVENT, sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 2–4. Profiles, redemptions, earning.
  useEffect(() => {
    if (!ready) return;
    for (const orderId of state.orderIds) {
      const order = state.orders[orderId];
      const context = state.orderPromotions[orderId];
      if (!order) continue;

      if (order.customerId && order.state !== "completed" && context?.customer?.id !== order.customerId) {
        run(`profile:${orderId}:${order.customerId}`, async () => {
          const customer = await crmService.customers.get(order.customerId!);
          if (!customer) return;
          send({
            type: "ORDER_PROMOTION_CUSTOMER",
            orderId,
            at: new Date().toISOString(),
            customer: { id: customer.id, tags: customer.tags, tier: customer.loyaltyTier, orderCount: customer.orderCount },
          });
        });
      }

      // Only orders the promotion engine has seen: a sale closed before this
      // existed is never redeemed or earned for retroactively.
      if (training || order.state !== "completed" || !context) continue;

      if (!context.redeemedAt && context.applied.length > 0) {
        run(`redeem:${orderId}`, async () => {
          await crmService.promotions.redeem({
            cart: promotionCartOf(order, context, { at: context.at, categoryOf }),
            orderId,
            applied: context.applied,
            couponCodes: context.coupons.map((c) => c.code),
          });
          send({ type: "ORDER_PROMOTIONS_RECORDED", orderId, kind: "redeemed", at: new Date().toISOString() });
          window.dispatchEvent(new Event(PROMOTIONS_CHANGED_EVENT));
        });
      }

      if (!context.earnedAt && order.customerId) {
        run(`earn:${orderId}`, async () => {
          await crmService.loyalty.earnForSale({
            customerId: order.customerId!,
            orderId,
            sale: earnInputOf(order, context, { taxInclusive: taxInclusive(order), minorPerMajor: 100 }),
          });
          send({ type: "ORDER_PROMOTIONS_RECORDED", orderId, kind: "earned", at: new Date().toISOString() });
        });
      }
    }

    function run(key: string, task: () => Promise<void>) {
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      task()
        // Keys stay marked for the session, done or failed, so nothing is
        // retried in a loop on every render; the store's recorded flags stop
        // a done task, and the next session retries a failed one, with the
        // service's own per-order check keeping that retry from counting twice.
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, training, state.orders, state.orderPromotions]);
}

function taxInclusive(order: Order): boolean {
  const branch = branchById.get(order.branchId);
  const pack = countryPacks.find((p) => p.code === branch?.countryCode);
  return pack?.pricingMode === "tax_inclusive";
}
