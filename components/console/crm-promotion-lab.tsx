"use client";

/**
 * Promotion simulator and conformance table — FR-CRM-026, FR-CRM-027.
 *
 * The simulator builds a cart and runs `services.crm.promotions.evaluate`,
 * which is `evaluatePromotions` over the stored promotions and redemptions —
 * the same function the till is to call offline. Every promotion that did not
 * apply is listed with the reason, including the usage limit that stopped it.
 * "Record redemption" writes the redemptions, so the limits can be exercised
 * end to end: set a per-day limit of 1, record once, evaluate again.
 *
 * The conformance table runs the fixed test vectors in
 * `lib/console/crm-promotion-engine.ts`, each twice with the inputs in
 * reverse order, and shows pass or fail.
 */

import { useMemo, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";

import type { Customer, MenuItem, OrderChannel, OrderType, Promotion } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { ORDER_TYPE } from "@/lib/console/labels";
import {
  runPromotionConformance,
  type PromotionCart,
  type PromotionResult,
} from "@/lib/console/crm-promotion-engine";
import { useConfirm } from "@/components/console/confirm";
import { MoneyInput } from "@/components/console/fields";
import { Badge, Button, Callout, Field, Input, Select, cx } from "@/components/console/ui";

const ORDER_TYPES: OrderType[] = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup", "aggregator"];
const CHANNELS: OrderChannel[] = ["pos", "kiosk", "qr", "aggregator", "phone", "api"];

function localNow(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function PromotionSimulator({ onRedeemed }: { onRedeemed: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("crm.promotion.manage");
  const branches = useBranches(scope);
  const action = useAction();
  const confirm = useConfirm();

  const items = useAsync(
    () =>
      services.catalogue.items
        .list({ limit: 300 })
        .then((page) => page.rows)
        .catch(() => [] as MenuItem[]),
    [],
  );
  const customers = useAsync(
    () =>
      services.crm.customers
        .list({ limit: 200 })
        .then((page) => page.rows)
        .catch(() => [] as Customer[]),
    [],
  );
  const promotions = useAsync(
    () =>
      services.crm.promotions
        .list({ limit: 500 })
        .then((page) => page.rows)
        .catch(() => [] as Promotion[]),
    [],
  );

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [branchId, setBranchId] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [channel, setChannel] = useState<OrderChannel>("pos");
  const [customerId, setCustomerId] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [deliveryFee, setDeliveryFee] = useState<number | null>(0);
  const [at, setAt] = useState(localNow);
  const [result, setResult] = useState<PromotionResult | null>(null);
  const [couponNote, setCouponNote] = useState<string | null>(null);

  const itemById = useMemo(() => new Map((items.data ?? []).map((item) => [item.id, item])), [items.data]);
  const promotionById = useMemo(() => new Map((promotions.data ?? []).map((row) => [row.id, row])), [promotions.data]);

  async function buildCart(): Promise<PromotionCart> {
    const customer = (customers.data ?? []).find((row) => row.id === customerId) ?? null;
    let couponPromotionIds: string[] = [];
    setCouponNote(null);
    if (couponCode.trim()) {
      const coupon = await services.crm.coupons.findByCode(couponCode);
      const valid =
        coupon &&
        coupon.active &&
        (!coupon.expiresOn || coupon.expiresOn >= at.slice(0, 10)) &&
        (coupon.maxRedemptions === null || coupon.redeemedCount < coupon.maxRedemptions) &&
        (!coupon.singleUse || coupon.redeemedCount === 0);
      if (valid) couponPromotionIds = [coupon.promotionId];
      else setCouponNote(t("promo.lab.couponInvalid"));
    }
    return {
      at,
      branchId: branchId || scope.branchId || branches[0]?.id || "",
      orderType,
      channel,
      lines: Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([itemId, quantity]) => {
          const item = itemById.get(itemId);
          return {
            lineId: itemId,
            itemId,
            categoryId: item?.categoryId ?? null,
            quantity,
            unitPriceMinor: item?.variants[0]?.basePrice.amount ?? 0,
          };
        }),
      customer: customer
        ? { id: customer.id, tags: customer.tags, tier: customer.loyaltyTier, orderCount: customer.orderCount }
        : null,
      couponPromotionIds,
      deliveryFeeMinor: orderType === "delivery" ? (deliveryFee ?? 0) : 0,
    };
  }

  async function evaluate() {
    await action.run(async () => services.crm.promotions.evaluate(await buildCart()), { onSuccess: setResult });
  }

  async function record() {
    const ok = await confirm({
      title: t("promo.lab.recordTitle"),
      body: t("promo.lab.recordBody"),
      confirmLabel: t("promo.lab.record"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(async () => services.crm.promotions.redeem({ cart: await buildCart(), orderId: null }), {
      onSuccess: (next) => {
        setResult(null);
        promotions.reload();
        onRedeemed(t("promo.lab.recorded").replace("{n}", String(next.applied.length)));
      },
    });
  }

  const cartLines = Object.entries(quantities).filter(([, q]) => q > 0);
  const subtotal = cartLines.reduce(
    (sum, [itemId, q]) => sum + q * (itemById.get(itemId)?.variants[0]?.basePrice.amount ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("promo.lab.intro")}</Callout>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("promo.lab.when")}>
          <Input type="datetime-local" dir="ltr" value={at} onChange={(event) => setAt(event.target.value)} />
        </Field>
        <Field label={t("common.branch")}>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">—</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pos.orderType")}>
          <Select value={orderType} onChange={(event) => setOrderType(event.target.value as OrderType)}>
            {ORDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {tx(ORDER_TYPE[type].label)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("promo.lab.channel")}>
          <Select value={channel} onChange={(event) => setChannel(event.target.value as OrderChannel)}>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("promo.lab.customer")}>
          <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">{t("promo.lab.anonymous")}</option>
            {(customers.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)} · {row.phone}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("promo.lab.coupon")} error={couponNote}>
          <Input dir="ltr" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} className="font-mono" />
        </Field>
        {orderType === "delivery" ? (
          <Field label={t("promo.lab.deliveryFee")}>
            <MoneyInput value={deliveryFee} currency="EGP" onChange={setDeliveryFee} aria-label={t("promo.lab.deliveryFee")} />
          </Field>
        ) : null}
      </div>

      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("promo.lab.items")}</h3>
        <ul className="border-line divide-line max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
          {(items.data ?? []).map((item) => {
            const quantity = quantities[item.id] ?? 0;
            return (
              <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-fg min-w-0 flex-1 truncate">{tx(item.name)}</span>
                <span className="text-fg-muted font-mono text-xs tabular-nums">
                  {item.variants[0] ? formatMoney(item.variants[0].basePrice, fmt) : "—"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("promo.lab.less")}
                  icon={<Minus size={12} />}
                  disabled={quantity === 0}
                  onClick={() => setQuantities({ ...quantities, [item.id]: Math.max(0, quantity - 1) })}
                />
                <span className={cx("w-6 text-center font-mono tabular-nums", quantity > 0 ? "text-fg" : "text-fg-subtle")}>{quantity}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("promo.lab.more")}
                  icon={<Plus size={12} />}
                  onClick={() => setQuantities({ ...quantities, [item.id]: quantity + 1 })}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={action.pending} disabled={cartLines.length === 0} onClick={() => void evaluate()}>
          {t("promo.lab.evaluate")}
        </Button>
        {canManage && result && result.applied.length > 0 ? (
          <Button loading={action.pending} onClick={() => void record()}>
            {t("promo.lab.record")}
          </Button>
        ) : null}
        <span className="text-fg-muted text-xs">
          {t("promo.lab.subtotal").replace("{amount}", formatMoney(money(subtotal, "EGP"), fmt))}
        </span>
      </div>

      {result ? (
        <section className="space-y-2">
          <div className="border-line rounded-lg border p-3">
            <p className="text-fg text-sm font-semibold">
              {t("promo.lab.discount").replace("{amount}", formatMoney(money(result.discountMinor, "EGP"), fmt))}
              {result.pointsMultiplier > 1 ? ` · ${t("promo.lab.multiplier").replace("{n}", String(result.pointsMultiplier))}` : ""}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {result.applied.map((row) => (
                <li key={row.promotionId} className="flex items-center justify-between gap-2">
                  <span className="text-fg flex items-center gap-1.5">
                    <Check size={12} className="text-good" aria-hidden />
                    {tx(promotionById.get(row.promotionId)?.name) || row.promotionId}
                  </span>
                  <span className="font-mono tabular-nums">
                    {row.pointsMultiplier ? `×${row.pointsMultiplier}` : `−${formatMoney(money(row.discountMinor, "EGP"), fmt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {result.rejected.length > 0 ? (
            <ul className="border-line divide-line divide-y rounded-lg border text-xs">
              {result.rejected.map((row) => (
                <li key={row.promotionId} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-fg-muted">{tx(promotionById.get(row.promotionId)?.name) || row.promotionId}</span>
                  <Badge tone={row.reason.startsWith("limit_") ? "warn" : "muted"}>{t(`promo.reason.${row.reason}` as never)}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function PromotionConformance() {
  const { t, fmt } = useI18n();
  const results = useMemo(() => runPromotionConformance(), []);
  const passed = results.filter((row) => row.passed).length;
  return (
    <div className="space-y-3">
      <Callout tone={passed === results.length ? "good" : "bad"} title={t("promo.conf.summary").replace("{n}", String(passed)).replace("{total}", String(results.length))}>
        {t("promo.conf.body")}
      </Callout>
      <ul className="border-line divide-line divide-y rounded-lg border text-xs">
        {results.map((row) => (
          <li key={row.name} className="flex items-center gap-2 px-3 py-2">
            {row.passed ? <Check size={13} className="text-good" aria-label={t("loy.calc.pass")} /> : <X size={13} className="text-bad" aria-label={t("loy.calc.fail")} />}
            <span className="text-fg min-w-0 flex-1">{row.name}</span>
            <span className={cx("font-mono tabular-nums", row.passed ? "text-fg-muted" : "text-bad")}>
              {formatMoney(money(row.actual.discountMinor, "EGP"), fmt)}
              {row.passed ? "" : ` ≠ ${formatMoney(money(row.expected.discountMinor, "EGP"), fmt)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FR-CRM-026 — how much of each limit a promotion has used. */
export function PromotionUsageSummary({ promotion }: { promotion: Promotion }) {
  const { t } = useI18n();
  const state = useAsync(() => services.crm.promotions.redemptions(promotion.id), [promotion.id]);
  const rows = state.data ?? [];
  const today = localNow().slice(0, 10);
  const usedToday = rows.filter((row) => row.day === today).length;
  const customers = new Map<string, number>();
  for (const row of rows) if (row.customerId) customers.set(row.customerId, (customers.get(row.customerId) ?? 0) + 1);
  const busiest = Math.max(0, ...customers.values());
  const line = (label: string, used: number, limit: number | null) => (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-fg-muted">{label}</span>
      <span className={cx("font-mono tabular-nums", limit !== null && used >= limit ? "text-bad font-semibold" : "text-fg")}>
        {used} / {limit ?? "∞"}
      </span>
    </li>
  );
  return (
    <ul className="border-line divide-line divide-y rounded-lg border text-xs">
      {line(t("promo.totalRedemptions"), rows.length, promotion.usage.totalRedemptions)}
      {line(t("promo.usage.busiestCustomer"), busiest, promotion.usage.perCustomer)}
      {line(t("promo.usage.today"), usedToday, promotion.usage.perDay)}
    </ul>
  );
}
