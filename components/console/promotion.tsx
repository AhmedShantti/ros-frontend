"use client";

/**
 * The promotion builder — FR-CRM-025 … FR-CRM-030.
 *
 * Conditions on the left, effect on the right, and a sentence underneath
 * that says in plain language what the two together will do. That sentence
 * is the whole design: a rules engine you cannot read back is a rules engine
 * whose output surprises you, and the place it surprises you is the P&L.
 *
 * Coupons live in the same drawer rather than a screen of their own, because
 * a coupon without its promotion is meaningless and making people navigate
 * between the two is how codes end up attached to the wrong offer.
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Ticket, Trash2 } from "lucide-react";

import type {
  Coupon,
  Id,
  OrderType,
  Promotion,
  PromotionEffectType,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, money } from "@/lib/console/format";
import { ORDER_TYPE } from "@/lib/console/labels";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField, MoneyInput, PercentInput } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Drawer,
  Field,
  Input,
  Select,
  Tabs,
  Toggle,
  cx,
} from "@/components/console/ui";

const EFFECTS: PromotionEffectType[] = [
  "percent_off_order",
  "percent_off_items",
  "amount_off_order",
  "free_item",
  "buy_x_get_y",
  "cheapest_free",
  "bundle_price",
  "free_delivery",
  "points_multiplier",
];

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function emptyPromotion(tenantId: Id): Promotion {
  return {
    id: "",
    tenantId,
    name: { ...EMPTY_LOCALISED },
    description: { ...EMPTY_LOCALISED },
    kind: "promotion",
    conditions: {
      startsAt: null,
      endsAt: null,
      daysOfWeek: [],
      branchIds: [],
      orderTypes: [],
      channels: [],
      minimumOrderMinor: null,
      itemIds: [],
      categoryIds: [],
      stockItemIds: [],
      minimumQuantity: null,
      customerTags: [],
      customerTiers: [],
      firstOrderOnly: false,
      nthOrder: null,
      requiresCoupon: false,
    },
    effect: {
      type: "percent_off_order",
      value: 10,
      targetItemId: null,
      buyQuantity: null,
      getQuantity: null,
    },
    usage: { totalRedemptions: null, perCustomer: null, perDay: null },
    stackable: false,
    priority: 100,
    active: false,
    startsOn: null,
    endsOn: null,
    createdAt: new Date().toISOString(),
    redemptions: 0,
    discountCost: money(0, "EGP"),
    attributedRevenue: money(0, "EGP"),
  };
}

export function PromotionDrawer({
  promotion,
  open,
  creating,
  canManage,
  onClose,
  onDelete,
  onSaved,
}: {
  promotion: Promotion | null;
  open: boolean;
  creating: boolean;
  canManage: boolean;
  onClose: () => void;
  onDelete: (promotion: Promotion) => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { scope } = useSession();
  const action = useAction();
  const branches = useBranches(scope);
  const [tab, setTab] = useState<"rules" | "limits" | "coupons" | "performance">("rules");

  const [draft, setDraft] = useState<Promotion>(
    () => promotion ?? emptyPromotion(scope.tenantId),
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(promotion ?? emptyPromotion(scope.tenantId));
    setDirty(false);
    setTab("rules");
  }, [promotion?.id, creating, scope.tenantId]);

  const categories = useAsync(
    () => services.catalogue.categories.list({ limit: 200 }).then((page) => page.rows),
    [],
  );
  const items = useAsync(
    () => services.catalogue.items.list({ limit: 300 }).then((page) => page.rows),
    [],
  );

  function patch(part: Partial<Promotion>) {
    setDraft((current) => ({ ...current, ...part }));
    setDirty(true);
  }

  function patchConditions(part: Partial<Promotion["conditions"]>) {
    setDraft((current) => ({
      ...current,
      conditions: { ...current.conditions, ...part },
    }));
    setDirty(true);
  }

  function patchEffect(part: Partial<Promotion["effect"]>) {
    setDraft((current) => ({ ...current, effect: { ...current.effect, ...part } }));
    setDirty(true);
  }

  function toggleIn<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  // -- The sentence ---------------------------------------------------------

  /**
   * Plain language, regenerated on every keystroke.
   *
   * Deliberately assembled from the same fields the engine reads, so it
   * cannot drift into describing a promotion that is not the one configured.
   */
  const summary = useMemo(() => {
    const parts: string[] = [];
    const effect = draft.effect;

    const effectText =
      effect.type === "percent_off_order"
        ? t("promo.say.percentOrder").replace("{n}", String(effect.value))
        : effect.type === "percent_off_items"
          ? t("promo.say.percentItems").replace("{n}", String(effect.value))
          : effect.type === "amount_off_order"
            ? t("promo.say.amountOrder").replace(
                "{amount}",
                formatMoney(money(effect.value, "EGP"), fmt),
              )
            : effect.type === "free_item"
              ? t("promo.say.freeItem")
              : effect.type === "buy_x_get_y"
                ? t("promo.say.bxgy")
                    .replace("{x}", String(effect.buyQuantity ?? 1))
                    .replace("{y}", String(effect.getQuantity ?? 1))
                : effect.type === "cheapest_free"
                  ? t("promo.say.cheapestFree")
                  : effect.type === "bundle_price"
                    ? t("promo.say.bundle").replace(
                        "{amount}",
                        formatMoney(money(effect.value, "EGP"), fmt),
                      )
                    : effect.type === "free_delivery"
                      ? t("promo.say.freeDelivery")
                      : t("promo.say.points").replace("{n}", String(effect.value));

    parts.push(effectText);

    const c = draft.conditions;
    if (c.minimumOrderMinor) {
      parts.push(
        t("promo.say.minOrder").replace(
          "{amount}",
          formatMoney(money(c.minimumOrderMinor, "EGP"), fmt),
        ),
      );
    }
    if (c.minimumQuantity) {
      parts.push(t("promo.say.minQty").replace("{n}", String(c.minimumQuantity)));
    }
    if (c.orderTypes.length > 0) {
      parts.push(
        t("promo.say.orderTypes").replace(
          "{types}",
          c.orderTypes.map((type) => tx(ORDER_TYPE[type].label)).join(", "),
        ),
      );
    }
    if (c.branchIds.length > 0) {
      parts.push(t("promo.say.branches").replace("{n}", String(c.branchIds.length)));
    }
    if (c.daysOfWeek.length > 0 && c.daysOfWeek.length < 7) {
      parts.push(
        t("promo.say.days").replace(
          "{days}",
          c.daysOfWeek.map((day) => t(`common.weekday.${day}` as never)).join(", "),
        ),
      );
    }
    if (c.customerTags.length > 0) {
      parts.push(t("promo.say.tags").replace("{tags}", c.customerTags.join(", ")));
    }
    if (c.firstOrderOnly) parts.push(t("promo.say.firstOrder"));
    if (c.nthOrder) parts.push(t("promo.say.nthOrder").replace("{n}", String(c.nthOrder)));
    if (c.requiresCoupon) parts.push(t("promo.say.coupon"));
    if (draft.startsOn || draft.endsOn) {
      parts.push(
        t("promo.say.window")
          .replace("{from}", draft.startsOn ? formatDate(draft.startsOn, fmt) : t("promo.say.today"))
          .replace("{to}", draft.endsOn ? formatDate(draft.endsOn, fmt) : t("common.never")),
      );
    }

    return parts.join(" · ");
  }, [draft, t, tx, fmt]);

  // -- Validation -----------------------------------------------------------

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!draft.name.en.trim() && !draft.name.ar.trim()) list.push(t("promo.needName"));
    if (draft.effect.value <= 0 && draft.effect.type !== "free_delivery") {
      list.push(t("promo.needValue"));
    }
    if (
      (draft.effect.type === "percent_off_order" || draft.effect.type === "percent_off_items") &&
      draft.effect.value > 100
    ) {
      list.push(t("promo.percentRange"));
    }
    if (draft.effect.type === "free_item" && !draft.effect.targetItemId) {
      list.push(t("promo.needTargetItem"));
    }
    if (draft.startsOn && draft.endsOn && draft.startsOn > draft.endsOn) {
      list.push(t("promo.badWindow"));
    }
    return list;
  }, [draft, t]);

  async function save() {
    if (problems.length > 0) return;
    await action.run(
      () =>
        creating || !promotion
          ? services.crm.promotions.create(draft)
          : services.crm.promotions.update(promotion.id, draft),
      { onSuccess: () => onSaved(creating ? t("promo.created") : t("promo.saved")) },
    );
  }

  if (!open) return null;

  const isPercent =
    draft.effect.type === "percent_off_order" || draft.effect.type === "percent_off_items";
  const isAmount =
    draft.effect.type === "amount_off_order" || draft.effect.type === "bundle_price";

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? t("promo.newPromotion") : tx(draft.name) || t("promo.untitled")}
      subtitle="FR-CRM-025"
      footer={
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Button
              variant="primary"
              loading={action.pending}
              disabled={problems.length > 0 || (!dirty && !creating)}
              onClick={save}
            >
              {creating ? t("common.create") : t("common.save")}
            </Button>
          ) : null}
          {canManage && promotion && !creating ? (
            <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => onDelete(promotion)}>
              {t("common.delete")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="accent" title={t("promo.summaryTitle")}>
          {summary || t("promo.summaryEmpty")}
        </Callout>

        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "rules" as const, label: t("promo.tabRules") },
            { value: "limits" as const, label: t("promo.tabLimits") },
            { value: "coupons" as const, label: t("promo.tabCoupons") },
            ...(promotion && !creating
              ? [{ value: "performance" as const, label: t("promo.tabPerformance") }]
              : []),
          ]}
        />

        {tab === "rules" ? (
          <div className="space-y-5">
            <LocalisedField
              label={t("common.name")}
              required
              value={draft.name}
              onChange={(name) => patch({ name })}
            />
            <LocalisedField
              label={t("common.description")}
              hint={t("promo.descriptionHint")}
              multiline
              value={draft.description}
              onChange={(description) => patch({ description })}
            />

            {/* -- Effect -------------------------------------------------- */}
            <section>
              <h3 className="text-fg mb-2 text-sm font-semibold">{t("promo.effect")}</h3>

              <Field label={t("promo.effectType")}>
                <Select
                  value={draft.effect.type}
                  disabled={!canManage}
                  onChange={(event) =>
                    patchEffect({ type: event.target.value as PromotionEffectType })
                  }
                >
                  {EFFECTS.map((effect) => (
                    <option key={effect} value={effect}>
                      {t(`promo.effect.${effectKeySuffix(effect)}` as never)}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {isPercent ? (
                  <Field label={t("promo.percentValue")} required>
                    <PercentInput
                      value={String(draft.effect.value)}
                      disabled={!canManage}
                      onChange={(next) => patchEffect({ value: Number(next) || 0 })}
                      aria-label={t("promo.percentValue")}
                    />
                  </Field>
                ) : null}

                {isAmount ? (
                  <Field label={t("promo.amountValue")} required>
                    <MoneyInput
                      value={draft.effect.value}
                      currency="EGP"
                      disabled={!canManage}
                      onChange={(minor) => patchEffect({ value: minor ?? 0 })}
                      aria-label={t("promo.amountValue")}
                    />
                  </Field>
                ) : null}

                {draft.effect.type === "points_multiplier" ? (
                  <Field label={t("promo.multiplier")} required>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      disabled={!canManage}
                      value={String(draft.effect.value)}
                      onChange={(event) => patchEffect({ value: Number(event.target.value) || 0 })}
                      className="text-end font-mono tabular-nums"
                    />
                  </Field>
                ) : null}

                {draft.effect.type === "buy_x_get_y" ? (
                  <>
                    <Field label={t("promo.buyQuantity")} required>
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        disabled={!canManage}
                        value={String(draft.effect.buyQuantity ?? 1)}
                        onChange={(event) =>
                          patchEffect({ buyQuantity: Number(event.target.value) || 1 })
                        }
                        className="text-end font-mono tabular-nums"
                      />
                    </Field>
                    <Field label={t("promo.getQuantity")} required>
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        disabled={!canManage}
                        value={String(draft.effect.getQuantity ?? 1)}
                        onChange={(event) =>
                          patchEffect({ getQuantity: Number(event.target.value) || 1 })
                        }
                        className="text-end font-mono tabular-nums"
                      />
                    </Field>
                  </>
                ) : null}

                {draft.effect.type === "free_item" || draft.effect.type === "buy_x_get_y" ? (
                  <Field label={t("promo.targetItem")} required={draft.effect.type === "free_item"}>
                    <Select
                      value={draft.effect.targetItemId ?? ""}
                      disabled={!canManage}
                      onChange={(event) =>
                        patchEffect({ targetItemId: event.target.value || null })
                      }
                    >
                      <option value="">—</option>
                      {(items.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {tx(item.name)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            </section>

            {/* -- Conditions ---------------------------------------------- */}
            <section>
              <h3 className="text-fg mb-2 text-sm font-semibold">{t("promo.conditions")}</h3>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("range.from")}>
                    <Input
                      type="date"
                      dir="ltr"
                      disabled={!canManage}
                      value={draft.startsOn ?? ""}
                      onChange={(event) => patch({ startsOn: event.target.value || null })}
                    />
                  </Field>
                  <Field label={t("range.to")} hint={t("promo.endHint")}>
                    <Input
                      type="date"
                      dir="ltr"
                      disabled={!canManage}
                      value={draft.endsOn ?? ""}
                      onChange={(event) => patch({ endsOn: event.target.value || null })}
                    />
                  </Field>
                </div>

                <Field label={t("promo.daysOfWeek")} hint={t("promo.daysHint")}>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const on = draft.conditions.daysOfWeek.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          disabled={!canManage}
                          onClick={() =>
                            patchConditions({
                              daysOfWeek: toggleIn(draft.conditions.daysOfWeek, day),
                            })
                          }
                          className={cx(
                            "rounded-lg border px-2.5 py-1.5 text-xs",
                            on
                              ? "border-accent bg-accent-soft text-accent font-medium"
                              : "border-line bg-raised text-fg-muted",
                          )}
                        >
                          {t(`common.weekday.${day}` as never)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label={t("promo.orderTypes")}>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(ORDER_TYPE) as OrderType[]).map((type) => {
                      const on = draft.conditions.orderTypes.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={on}
                          disabled={!canManage}
                          onClick={() =>
                            patchConditions({
                              orderTypes: toggleIn(draft.conditions.orderTypes, type),
                            })
                          }
                          className={cx(
                            "rounded-lg border px-2.5 py-1.5 text-xs",
                            on
                              ? "border-accent bg-accent-soft text-accent font-medium"
                              : "border-line bg-raised text-fg-muted",
                          )}
                        >
                          {tx(ORDER_TYPE[type].label)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label={t("promo.branches")} hint={t("promo.branchesHint")}>
                  <div className="flex flex-wrap gap-1.5">
                    {branches.map((branch) => {
                      const on = draft.conditions.branchIds.includes(branch.id);
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          aria-pressed={on}
                          disabled={!canManage}
                          onClick={() =>
                            patchConditions({
                              branchIds: toggleIn(draft.conditions.branchIds, branch.id),
                            })
                          }
                          className={cx(
                            "rounded-lg border px-2.5 py-1.5 text-xs",
                            on
                              ? "border-accent bg-accent-soft text-accent font-medium"
                              : "border-line bg-raised text-fg-muted",
                          )}
                        >
                          {tx(branch.name)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("promo.minimumOrder")}>
                    <MoneyInput
                      value={draft.conditions.minimumOrderMinor}
                      currency="EGP"
                      disabled={!canManage}
                      onChange={(minimumOrderMinor) => patchConditions({ minimumOrderMinor })}
                      aria-label={t("promo.minimumOrder")}
                    />
                  </Field>
                  <Field label={t("promo.minimumQuantity")}>
                    <Input
                      dir="ltr"
                      inputMode="numeric"
                      disabled={!canManage}
                      value={
                        draft.conditions.minimumQuantity === null
                          ? ""
                          : String(draft.conditions.minimumQuantity)
                      }
                      onChange={(event) =>
                        patchConditions({
                          minimumQuantity: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                      className="text-end font-mono tabular-nums"
                    />
                  </Field>
                </div>

                <Field label={t("promo.categories")} hint={t("promo.categoriesHint")}>
                  <div className="flex flex-wrap gap-1.5">
                    {(categories.data ?? []).map((category) => {
                      const on = draft.conditions.categoryIds.includes(category.id);
                      return (
                        <button
                          key={category.id}
                          type="button"
                          aria-pressed={on}
                          disabled={!canManage}
                          onClick={() =>
                            patchConditions({
                              categoryIds: toggleIn(draft.conditions.categoryIds, category.id),
                            })
                          }
                          className={cx(
                            "rounded-lg border px-2.5 py-1.5 text-xs",
                            on
                              ? "border-accent bg-accent-soft text-accent font-medium"
                              : "border-line bg-raised text-fg-muted",
                          )}
                        >
                          {tx(category.name)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label={t("promo.customerTags")} hint={t("promo.customerTagsHint")}>
                  <Input
                    disabled={!canManage}
                    value={draft.conditions.customerTags.join(", ")}
                    onChange={(event) =>
                      patchConditions({
                        customerTags: event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>

                <Toggle
                  checked={draft.conditions.firstOrderOnly}
                  disabled={!canManage}
                  onChange={(firstOrderOnly) => patchConditions({ firstOrderOnly })}
                  label={t("promo.firstOrderOnly")}
                  hint={t("promo.firstOrderOnlyHint")}
                />

                <Field label={t("promo.nthOrder")} hint={t("promo.nthOrderHint")}>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    disabled={!canManage}
                    value={draft.conditions.nthOrder === null ? "" : String(draft.conditions.nthOrder)}
                    onChange={(event) =>
                      patchConditions({
                        nthOrder: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    className="text-end font-mono tabular-nums"
                  />
                </Field>

                <Toggle
                  checked={draft.conditions.requiresCoupon}
                  disabled={!canManage}
                  onChange={(requiresCoupon) => patchConditions({ requiresCoupon })}
                  label={t("promo.requiresCoupon")}
                  hint={t("promo.requiresCouponHint")}
                />
              </div>
            </section>

            {problems.length > 0 ? (
              <ul className="text-bad space-y-0.5 text-xs">
                {problems.map((problem) => (
                  <li key={problem}>• {problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {tab === "limits" ? (
          <div className="space-y-4">
            <Callout tone="muted">{t("promo.limitsNote")}</Callout>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("promo.totalRedemptions")}>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  disabled={!canManage}
                  value={draft.usage.totalRedemptions === null ? "" : String(draft.usage.totalRedemptions)}
                  placeholder={t("common.none")}
                  onChange={(event) =>
                    patch({
                      usage: {
                        ...draft.usage,
                        totalRedemptions: event.target.value ? Number(event.target.value) : null,
                      },
                    })
                  }
                  className="text-end font-mono tabular-nums"
                />
              </Field>
              <Field label={t("promo.perCustomer")}>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  disabled={!canManage}
                  value={draft.usage.perCustomer === null ? "" : String(draft.usage.perCustomer)}
                  placeholder={t("common.none")}
                  onChange={(event) =>
                    patch({
                      usage: {
                        ...draft.usage,
                        perCustomer: event.target.value ? Number(event.target.value) : null,
                      },
                    })
                  }
                  className="text-end font-mono tabular-nums"
                />
              </Field>
              <Field label={t("promo.perDay")}>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  disabled={!canManage}
                  value={draft.usage.perDay === null ? "" : String(draft.usage.perDay)}
                  placeholder={t("common.none")}
                  onChange={(event) =>
                    patch({
                      usage: {
                        ...draft.usage,
                        perDay: event.target.value ? Number(event.target.value) : null,
                      },
                    })
                  }
                  className="text-end font-mono tabular-nums"
                />
              </Field>
            </div>

            <Toggle
              checked={draft.stackable}
              disabled={!canManage}
              onChange={(stackable) => patch({ stackable })}
              label={t("promo.stackable")}
              hint={t("promo.stackableHint")}
            />

            <Field label={t("promo.priority")} hint={t("promo.priorityHint")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                disabled={!canManage}
                value={String(draft.priority)}
                onChange={(event) => patch({ priority: Number(event.target.value) || 0 })}
                className="text-end font-mono tabular-nums"
              />
            </Field>

            <Toggle
              checked={draft.active}
              disabled={!canManage}
              onChange={(active) => patch({ active })}
              label={t("promo.active")}
              hint={t("promo.activeHint")}
            />
          </div>
        ) : null}

        {tab === "coupons" ? (
          <CouponsTab
            promotionId={promotion?.id ?? null}
            canManage={canManage}
            onChanged={onSaved}
          />
        ) : null}

        {tab === "performance" && promotion ? (
          <div className="space-y-3">
            <Callout tone="muted">{t("promo.performanceNote")}</Callout>
            <ul className="border-line divide-line divide-y rounded-lg border">
              <PerfRow label={t("promo.redemptions")} value={formatNumber(promotion.redemptions, fmt)} />
              <PerfRow label={t("promo.cost")} value={formatMoney(promotion.discountCost, fmt)} />
              <PerfRow
                label={t("promo.attributedRevenue")}
                value={formatMoney(promotion.attributedRevenue, fmt)}
              />
              <PerfRow
                label={t("promo.marginImpact")}
                value={formatMoney(
                  money(
                    promotion.attributedRevenue.amount - promotion.discountCost.amount,
                    promotion.discountCost.currency,
                  ),
                  fmt,
                )}
              />
            </ul>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

function PerfRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-fg font-mono tabular-nums">{value}</span>
    </li>
  );
}

function effectKeySuffix(effect: PromotionEffectType): string {
  return {
    percent_off_order: "percentOrder",
    percent_off_items: "percentItems",
    amount_off_order: "amountOrder",
    free_item: "freeItem",
    buy_x_get_y: "bxgy",
    cheapest_free: "cheapestFree",
    bundle_price: "bundle",
    free_delivery: "freeDelivery",
    points_multiplier: "points",
  }[effect];
}

// ---------------------------------------------------------------------------
// Coupons — FR-CRM-028
// ---------------------------------------------------------------------------

function CouponsTab({
  promotionId,
  canManage,
  onChanged,
}: {
  promotionId: Id | null;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const confirm = useConfirm();
  const [count, setCount] = useState("20");
  const [singleUse, setSingleUse] = useState(true);

  const coupons = useAsync<Coupon[]>(
    () =>
      promotionId
        ? services.crm.coupons.list({ filters: { promotionId }, limit: 500 }).then((p) => p.rows)
        : Promise.resolve([]),
    [promotionId],
  );

  if (!promotionId) {
    return <Callout tone="muted">{t("promo.saveBeforeCoupons")}</Callout>;
  }

  async function generate() {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric < 1) return;
    await action.run(
      () => services.crm.coupons.generate(promotionId!, numeric, { singleUse }),
      {
        onSuccess: () => {
          coupons.reload();
          onChanged(t("promo.couponsGenerated").replace("{n}", String(numeric)));
        },
      },
    );
  }

  async function removeAll() {
    const ok = await confirm({
      title: t("promo.deleteCoupons"),
      body: t("promo.deleteCouponsBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    for (const coupon of coupons.data ?? []) {
      await services.crm.coupons.remove(coupon.id);
    }
    coupons.reload();
    onChanged(t("promo.couponsDeleted"));
  }

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Callout tone="muted">{t("promo.couponsNote")}</Callout>

      {canManage ? (
        <div className="border-line space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("promo.howMany")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={count}
                onChange={(event) => setCount(event.target.value)}
                className="text-end font-mono tabular-nums"
              />
            </Field>
            <div className="flex items-end">
              <Toggle
                checked={singleUse}
                onChange={setSingleUse}
                label={t("promo.singleUse")}
                hint={t("promo.singleUseHint")}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Ticket size={12} />} loading={action.pending} onClick={generate}>
              {t("promo.generate")}
            </Button>
            {(coupons.data ?? []).length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => void removeAll()}>
                {t("promo.deleteCoupons")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <AsyncPanel
        state={coupons}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("promo.noCoupons")}</Callout>}
      >
        {(rows) => (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {rows.map((coupon) => (
              <li key={coupon.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <code className="text-fg font-mono text-sm" dir="ltr">
                  {coupon.code}
                </code>
                <Badge tone={coupon.singleUse ? "muted" : "accent"}>
                  {coupon.singleUse ? t("promo.singleUse") : t("promo.multiUse")}
                </Badge>
                <span className="text-fg-subtle min-w-0 flex-1 truncate">
                  {coupon.redeemedCount > 0
                    ? t("promo.redeemedTimes").replace("{n}", formatNumber(coupon.redeemedCount, fmt))
                    : t("promo.unredeemed")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.copy")}
                  icon={<Copy size={12} />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(coupon.code);
                    onChanged(t("common.copied"));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>
    </div>
  );
}
