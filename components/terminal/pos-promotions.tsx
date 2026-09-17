"use client";

/**
 * Promotions on the order panel — FR-CRM-025 … FR-CRM-030.
 *
 * Nothing here decides anything. The reducer re-evaluates the order with
 * `evaluatePromotions` after every change (lines, customer, order type,
 * coupons) and writes the outcome to `state.orderPromotions`; this panel
 * only shows it:
 *
 *   - what applies, and what it takes off (or the points multiplier);
 *   - a promotion that applied earlier and no longer does, with the engine's
 *     reason — "Total limit reached", "Below minimum order" — so a total that
 *     just went up is explained rather than a surprise;
 *   - FR-CRM-028 coupon entry, validated against the CRM service's codes;
 *   - taking an auto-applied promotion off this order, and putting it back.
 */

import { useState } from "react";
import { BadgePercent, X } from "lucide-react";

import type { Order } from "@/lib/console/types";
import type { ConsoleKey } from "@/locales";
import { crmService } from "@/lib/console/services/crm";
import { formatMoney, money } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { lapsedPromotions, type LapseReason } from "@/lib/console/live/promotions";
import { isEditable } from "@/lib/console/live/reducer";
import { Button, Input } from "@/components/console/ui";

function reasonKey(reason: LapseReason): ConsoleKey {
  if (reason === "manual_discount" || reason === "declined") return `pos.promo.reason.${reason}` as ConsoleKey;
  return `promo.reason.${reason}` as ConsoleKey;
}

export function PromotionPanel({ order }: { order: Order }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const context = state.orderPromotions?.[order.id];
  const book = state.promotionBook;
  const byId = new Map(book.promotions.map((p) => [p.id, p]));
  const editable = isEditable(order) && order.paidTotal.amount === 0;
  const couponsOffered = book.promotions.some((p) => p.active && p.conditions.requiresCoupon);

  const applied = context?.applied ?? [];
  const lapsed = context ? lapsedPromotions(context) : [];
  const coupons = context?.coupons ?? [];
  if (applied.length === 0 && lapsed.length === 0 && coupons.length === 0 && !(editable && couponsOffered)) {
    return null;
  }

  const nameOf = (id: string) => {
    const promotion = byId.get(id);
    return promotion ? tx(promotion.name) : id;
  };

  async function applyCoupon() {
    const entered = code.trim();
    if (!entered) return;
    setChecking(true);
    setNote(null);
    try {
      const coupon = await crmService.coupons.findByCode(entered);
      const day = (context?.at || order.openedAt).slice(0, 10);
      // The same checks the console's simulator makes before a code counts.
      const valid =
        coupon &&
        coupon.active &&
        (!coupon.expiresOn || coupon.expiresOn >= day) &&
        (coupon.maxRedemptions === null || coupon.redeemedCount < coupon.maxRedemptions) &&
        (!coupon.singleUse || coupon.redeemedCount === 0) &&
        (!coupon.customerId || coupon.customerId === order.customerId);
      if (!coupon) setNote(t("pos.promo.couponNotFound"));
      else if (!valid) setNote(t("promo.lab.couponInvalid"));
      else {
        dispatch({ type: "ORDER_COUPON", orderId: order.id, code: coupon.code, promotionId: coupon.promotionId });
        setCode("");
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="border-line border-b py-1.5" data-testid="pos-promotions">
      <p className="text-fg-muted mb-1 flex items-center gap-1 text-[0.7rem] font-semibold">
        <BadgePercent size={12} aria-hidden />
        {t("pos.promo.title")}
      </p>
      <ul className="space-y-1">
        {applied.map((row) => (
          <li key={row.promotionId} className="flex items-baseline justify-between gap-2 text-[0.7rem] leading-snug">
            <span className="text-fg min-w-0 truncate">{nameOf(row.promotionId)}</span>
            <span className="flex shrink-0 items-center gap-2">
              {row.pointsMultiplier !== null ? (
                <span className="text-good font-mono tabular-nums">
                  {t("pos.promo.pointsMultiplier").replace("{n}", String(row.pointsMultiplier))}
                </span>
              ) : (
                <span className="text-bad font-mono tabular-nums">
                  −{formatMoney(money(row.discountMinor, order.currency), fmt, true)}
                </span>
              )}
              {editable ? (
                <button
                  type="button"
                  className="text-fg-subtle hover:text-fg underline"
                  onClick={() =>
                    dispatch({ type: "ORDER_PROMOTION_DECLINE", orderId: order.id, promotionId: row.promotionId, declined: true })
                  }
                >
                  {t("common.remove")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {lapsed.map((row) => (
          <li key={row.promotionId} className="flex items-baseline justify-between gap-2 text-[0.7rem] leading-snug opacity-70">
            <span className="text-fg-muted min-w-0">
              <span className="line-through">{nameOf(row.promotionId)}</span>
              {" · "}
              {t("pos.promo.stopped").replace("{reason}", t(reasonKey(row.reason)))}
            </span>
            {editable && row.reason === "declined" ? (
              <button
                type="button"
                className="text-fg-subtle hover:text-fg shrink-0 underline"
                onClick={() =>
                  dispatch({ type: "ORDER_PROMOTION_DECLINE", orderId: order.id, promotionId: row.promotionId, declined: false })
                }
              >
                {t("pos.promo.restore")}
              </button>
            ) : null}
          </li>
        ))}
        {coupons.map((coupon) => {
          const used = applied.some((row) => row.promotionId === coupon.promotionId);
          return (
            <li key={coupon.code} className="text-fg-subtle flex items-center justify-between gap-2 text-[0.7rem]">
              <span className="min-w-0 truncate font-mono">
                {t(used ? "pos.promo.couponApplied" : "pos.promo.couponUnused").replace("{code}", coupon.code)}
              </span>
              {editable ? (
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  className="hover:text-fg shrink-0"
                  onClick={() => dispatch({ type: "ORDER_COUPON", orderId: order.id, code: coupon.code, promotionId: null })}
                >
                  <X size={12} aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editable && couponsOffered ? (
        <form
          className="mt-1.5 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void applyCoupon();
          }}
        >
          <Input
            dir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t("pos.promo.couponCode")}
            aria-label={t("pos.promo.couponCode")}
            className="h-8 font-mono text-xs"
          />
          <Button size="sm" type="submit" loading={checking} disabled={!code.trim()}>
            {t("pos.promo.applyCoupon")}
          </Button>
        </form>
      ) : null}
      {note ? <p className="text-bad mt-1 text-[0.7rem]">{note}</p> : null}
      {!editable && order.paidTotal.amount > 0 && isEditable(order) ? (
        <p className="text-fg-subtle mt-1 text-[0.7rem]">{t("pos.promo.frozen")}</p>
      ) : null}
    </div>
  );
}
