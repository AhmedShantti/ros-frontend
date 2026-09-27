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

  const comboIds = comboItems.map((c) => c.id).join(",");
  const [comboGroups, setComboGroups] = useState<Map<string, ModifierGroup[]>>(new Map());

  useEffect(() => {
    if (comboItems.length === 0) return;
    let cancelled = false;
    Promise.all(
      comboItems.map((combo) =>
        services.catalogue
          .listItemModifierGroups(combo.id)
          .then((groups) => [combo.id, groups] as const)
          .catch(() => [combo.id, [] as ModifierGroup[]] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setComboGroups(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboIds]);

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
                  const groups = comboGroups.get(combo.id) ?? [];
                  return (
                    <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={combo.id}>
                      <div className="customer-food-copy">
                        <div>
                          <h4>{tx(combo.name)}</h4>
                          <strong>{formatMoney(price, fmt)}</strong>
                        </div>
                        {soldOut ? <span className="sold-tag">{t("menu.previewSoldOut")}</span> : null}
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
                      return (
                        <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={item.id}>
                          <div className="customer-food-copy">
                            <div>
                              <h4>{tx(item.name)}</h4>
                              <strong>{formatMoney(price, fmt)}</strong>
                            </div>
                            {soldOut ? <span className="sold-tag">{t("menu.previewSoldOut")}</span> : null}
                            {tx(item.description) ? <p>{tx(item.description)}</p> : null}
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
