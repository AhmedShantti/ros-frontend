"use client";

/**
 * Menu Management LIVE workspace — read-only Customer Preview.
 *
 * Visual counterpart of the demo workspace's `menu-preview.tsx` (same
 * `.preview-overlay`/`.preview-window`/`.customer-*` shape, same shared
 * `menu-management.css`), rendered PURELY from already-loaded/read canonical
 * data — no new backend contract, no write of any kind.
 *
 * No channel switcher: the current direct-pricing model has exactly one
 * price per variant, with no per-channel price to switch between (the
 * reference's channel toggle has no live counterpart on purpose).
 *
 * CONSOLE-COMBO-READ-P0 — a combo's real parts/options ARE shown, read via
 * the same `GET items/:itemId/modifier-groups`
 * (`services.catalogue.listItemModifierGroups`) `live-combo-editor.tsx` uses
 * to reopen a combo for editing. A linked option resolves to its real item's
 * name via the already-loaded `items` prop — never a fabricated label.
 */

import { useEffect, useState } from "react";
import type { Currency, Localised, ModifierGroup } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { formatMoney, type FormatOptions } from "@/lib/console/format";
import { services } from "@/lib/console/services";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
import { Icon } from "./common";

interface LiveMenuPreviewProps {
  menuName: string;
  categories: LiveCategory[];
  items: LiveItem[];
  currency: Currency;
  fmt: FormatOptions;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onClose: () => void;
}

/** "Required · choose 1" / "Optional · up to N" — the reference's own rule summary, over the real minSelections/maxSelections/required fields. */
function ruleText(group: Pick<ModifierGroup, "required" | "maxSelections">, t: (key: ConsoleKey) => string): string {
  const need = group.required ? t("menu.previewRuleRequired") : t("menu.previewRuleOptional");
  const pick = group.maxSelections > 1 ? t("menu.previewRuleUpTo").replace("{n}", String(group.maxSelections)) : t("menu.previewRuleChooseOne");
  return `${need} · ${pick}`;
}

export default function LiveMenuPreview({ menuName, categories, items, currency, fmt, tx, t, onClose }: LiveMenuPreviewProps) {
  const comboItems = items.filter((item) => item.isCombo);
  const categoriesWithItems = categories
    .map((category) => ({
      category,
      items: items.filter((item) => !item.isCombo && item.placements.some((p) => p.categoryId === category.id)),
    }))
    .filter((row) => row.items.length > 0);

  /** Every non-combo item's every variant, to resolve a linked option's real name/price/availability. */
  const variantLookup = new Map<
    string,
    { name: string; price: { amount: number; currency: Currency }; available: boolean }
  >();
  for (const item of items) {
    if (item.isCombo) continue;
    for (const variant of item.variants) {
      variantLookup.set(variant.id, { name: tx(item.name), price: variant.basePrice, available: item.available && variant.available });
    }
  }

  // Every item's real attached groups — combos show their slot detail, and
  // (matching the reference's own `groupsFor`) regular items with real
  // customizations show them too, both from the SAME read contract.
  const allIds = items.map((i) => i.id).join(",");
  const [itemGroups, setItemGroups] = useState<Map<string, ModifierGroup[]>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    Promise.all(
      items.map((item) =>
        services.catalogue
          .listItemModifierGroups(item.id)
          .then((groups) => [item.id, groups] as const)
          .catch(() => [item.id, [] as ModifierGroup[]] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setItemGroups(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds]);

  return (
    <div className="preview-overlay">
      <div className="preview-window">
        <div className="preview-topbar">
          <div>
            <span className="preview-kicker">{t("menu.previewKicker")}</span>
            <h2>{menuName}</h2>
          </div>
          <div className="preview-tools">
            <button className="icon-btn" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className="customer-menu">
          <div className="customer-hero">
            <span>{t("menu.previewOurMenu")}</span>
            <h1>{menuName}</h1>
          </div>

          {comboItems.length > 0 ? (
            <section className="customer-category">
              <h3>{t("menu.previewCombosHeading")}</h3>
              <div className="customer-items">
                {comboItems.map((combo) => {
                  const soldOut = !combo.available;
                  const price = combo.variants[0]?.basePrice ?? { amount: 0, currency };
                  const groups = itemGroups.get(combo.id) ?? [];
                  // The reference's "regular price" — sum of each slot's
                  // real default option, from the same already-loaded data.
                  const regularAmount = groups.reduce((sum, group) => {
                    const def = group.modifiers.find((m) => m.isDefault) ?? group.modifiers[0];
                    if (!def) return sum;
                    const linked = def.linkedVariantId ? variantLookup.get(def.linkedVariantId) : undefined;
                    return sum + (linked?.price.amount ?? def.comboComponentPriceOverride?.amount ?? def.priceDelta.amount ?? 0);
                  }, 0);
                  const saving = regularAmount - price.amount;
                  return (
                    <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={combo.id}>
                      <div className="customer-food-copy">
                        <div>
                          <h4>{tx(combo.name)}</h4>
                          <strong>{formatMoney(price, fmt)}</strong>
                        </div>
                        {soldOut ? (
                          <span className="sold-tag">{t("menu.previewSoldOut")}</span>
                        ) : saving > 0 ? (
                          <span className="save-tag">
                            {t("menu.comboSaveLabel")} {formatMoney({ amount: saving, currency: price.currency }, fmt)}
                          </span>
                        ) : null}
                        {tx(combo.description) ? <p>{tx(combo.description)}</p> : null}
                        {groups.length > 0 ? (
                          <ul className="combo-lines">
                            {groups.map((group) => (
                              <li key={group.id}>
                                {tx(group.name)}
                                {group.required ? "" : t("menu.previewOptional")}: {" "}
                                {group.modifiers
                                  .map((modifier) => {
                                    const linked = modifier.linkedVariantId ? variantLookup.get(modifier.linkedVariantId) : undefined;
                                    const optionName = linked?.name ?? tx(modifier.name);
                                    const delta = modifier.priceDelta.amount;
                                    const unavailable = linked ? !linked.available : false;
                                    const suffix = unavailable
                                      ? t("menu.previewUnavailable")
                                      : !modifier.isDefault && delta
                                        ? ` (+${formatMoney({ amount: delta, currency }, fmt)})`
                                        : "";
                                    return `${optionName}${suffix}`;
                                  })
                                  .join(", ")}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {categoriesWithItems.length > 0
            ? categoriesWithItems.map(({ category, items: rows }) => (
                <section className="customer-category" key={category.id}>
                  <h3>{tx(category.name)}</h3>
                  <div className="customer-items">
                    {rows.map((item) => {
                      const soldOut = !item.available;
                      const price = item.variants[0]?.basePrice ?? { amount: 0, currency };
                      const groups = (itemGroups.get(item.id) ?? []).filter((g) => g.modifiers.length > 0);
                      return (
                        <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={item.id}>
                          <div className="customer-food-copy">
                            <div>
                              <h4>{tx(item.name)}</h4>
                              <strong>{formatMoney(price, fmt)}</strong>
                            </div>
                            {soldOut ? <span className="sold-tag">{t("menu.previewSoldOut")}</span> : null}
                            {tx(item.description) ? <p>{tx(item.description)}</p> : null}
                            {groups.map((group) => (
                              <small className="mod-line" key={group.id}>
                                <b>{tx(group.name)}</b> ({ruleText(group, t)}):{" "}
                                {group.modifiers
                                  .map((modifier) => (modifier.priceDelta.amount > 0 ? `${tx(modifier.name)} +${formatMoney(modifier.priceDelta, fmt)}` : tx(modifier.name)))
                                  .join(", ")}
                              </small>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))
            : comboItems.length === 0 && <div className="customer-empty">{t("menu.previewNothingToShow")}</div>}
        </div>

        <div className="preview-footer">
          <span>{t("menu.previewFooterNote")}</span>
          <button className="secondary" onClick={onClose}>
            {t("menu.previewClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
