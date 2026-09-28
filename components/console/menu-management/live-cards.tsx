"use client";

/**
 * Menu Management LIVE workspace — item and combo rows in the list.
 *
 * Visual/structural counterpart of the demo workspace's `cards.tsx`
 * (`ItemCard`/`ComboCard`), reusing the SAME `.item-card` class family from
 * `menu-management.css` (already token-based/dark-mode-safe — see that
 * file's own `.dark` block), but built against the LIVE `LiveItem`/
 * `MenuItem` types and the LIVE availability model (available / manually
 * 86'd / deactivated — there is no "hidden" status; that is a demo-only
 * concept with no backend counterpart).
 *
 * Deliberately does NOT offer "Duplicate": no canonical backend endpoint
 * clones an item, so exposing that action would be a fake affordance.
 */

import { useState } from "react";
import type { Currency, Localised, Money } from "@/lib/console/types";
import { formatMoney, type FormatOptions } from "@/lib/console/format";
import type { LiveItem } from "@/lib/console/menu-management/live-adapter";
import type { ConsoleKey } from "@/content/console/en";
import { Icon } from "./common";

/** A real linked component's resolved availability/price, keyed by its
 * MenuItemVariant id — built once from the full item list so combo cards can
 * show the reference's slot summary / "can't be ordered" / savings badge
 * using only real data, never a fabricated number. */
export type VariantIndex = Map<string, { available: boolean; price: Money; name: string }>;

/**
 * Reference-style dropdown row menu (`.dots-wrap`/`.row-menu`/`.row-menu-
 * sep`/`.danger` — the SAME classes and interaction pattern `common.tsx`'s
 * demo-only `RowMenu` already uses), populated with ONLY the actions this
 * backend genuinely supports for a live item/combo:
 *  - Edit.
 *  - Mark unavailable (86) / Restore — the real binary availability model
 *    (no "hidden" state exists here — that is a demo-only third status).
 *  - Deactivate — the real `items.remove()` soft-deactivation (there is no
 *    hard-delete endpoint; a click-to-confirm mirrors the reference's own
 *    delete-confirm pattern for the closest real equivalent).
 * Deliberately no Duplicate — no clone endpoint exists.
 */
function LiveRowMenu({
  available,
  canToggleAvailability,
  canManage,
  onEdit,
  onToggle86,
  onDeactivate,
  toggleLabel,
  t,
}: {
  available: boolean;
  canToggleAvailability: boolean;
  canManage: boolean;
  onEdit: () => void;
  onToggle86: () => void;
  onDeactivate?: () => void;
  toggleLabel: string;
  t: (key: ConsoleKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = () => {
    setOpen(false);
    setConfirm(false);
  };
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  if (!canToggleAvailability && !onDeactivate) return null;
  return (
    <div className="dots-wrap">
      <button className="dots" aria-label={t("menu.rowMenuMoreActions")} onClick={() => setOpen((o) => !o)}>
        <Icon name="dots" size={17} />
      </button>
      {open ? (
        <>
          <div className="menu-backdrop" onClick={close}></div>
          <div className="row-menu">
            <button onClick={act(onEdit)}>
              <Icon name="edit" size={15} /> {t("common.edit")}
            </button>
            {canToggleAvailability ? (
              <>
                <div className="row-menu-label">{t("menu.rowMenuShowAs")}</div>
                <button onClick={act(onToggle86)}>
                  <Icon name={available ? "ban" : "eye"} size={15} /> {toggleLabel}
                </button>
              </>
            ) : null}
            {onDeactivate && canManage ? (
              <>
                <div className="row-menu-sep"></div>
                {confirm ? (
                  <button className="danger" onClick={act(onDeactivate)}>
                    <Icon name="trash" size={15} /> {t("menu.rowMenuConfirmDeactivate")}
                  </button>
                ) : (
                  <button className="danger" onClick={() => setConfirm(true)}>
                    <Icon name="trash" size={15} /> {t("menu.rowMenuDeactivate")}
                  </button>
                )}
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The three REAL, distinct states — never conflated. `isActive` (master-data
 * lifecycle) takes priority over `unavailableReason` (a manual 86): an item
 * can be BOTH deactivated and still carry a stale 86 rule (deactivating does
 * not clear one), and in that compound case it is truthfully "deactivated",
 * not "86'd" — restoring the 86 rule alone would never make it sellable
 * again. There is no "hidden" status on this backend.
 */
export function itemStatus(item: Pick<LiveItem, "isActive" | "unavailableReason">): "available" | "unavailable" | "deactivated" {
  if (!item.isActive) return "deactivated";
  return item.unavailableReason ? "unavailable" : "available";
}

export function LiveStatusBadge({
  item,
  t,
}: {
  item: Pick<LiveItem, "isActive" | "unavailableReason">;
  t: (key: ConsoleKey) => string;
}) {
  const status = itemStatus(item);
  const label = status === "available" ? t("menu.available") : status === "unavailable" ? t("menu.eightySixed") : t("menu.deactivated");
  return <span className={`availability ${status}`}>{label}</span>;
}

export function LiveItemCard({
  item,
  categoryName,
  showCategory,
  currency,
  fmt,
  tx,
  t,
  onEdit,
  onToggle86,
  onDeactivate,
  canToggleAvailability,
  canManage,
}: {
  item: LiveItem;
  categoryName?: string;
  showCategory?: boolean;
  currency: Currency;
  fmt: FormatOptions;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onEdit: () => void;
  onToggle86: () => void;
  onDeactivate?: () => void;
  canToggleAvailability: boolean;
  canManage: boolean;
}) {
  return (
    <div className={`item-card status-${itemStatus(item)}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{tx(item.name)}</h3>
            <LiveStatusBadge item={item} t={t} />
            {showCategory && categoryName ? <span className="category-badge">{categoryName}</span> : null}
          </div>
          <p>{tx(item.description) || t("menu.noDescriptionAdded")}</p>
          {item.modifierGroups.length > 0 ? (
            <div className="modifier-chips">
              {item.modifierGroups.map((group) => (
                <span key={group.id}>{tx(group.name)}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="item-price">
        {item.variants.length > 0 ? formatMoney(item.variants[0]!.basePrice, fmt) : formatMoney({ amount: 0, currency }, fmt)}
      </div>
      <button className="edit-item" aria-label={`Edit ${tx(item.name)}`} onClick={onEdit}>
        <Icon name="edit" size={15} /> {t("common.edit")}
      </button>
      <LiveRowMenu
        available={item.available}
        canToggleAvailability={canToggleAvailability}
        canManage={canManage}
        onEdit={onEdit}
        onToggle86={onToggle86}
        onDeactivate={onDeactivate}
        toggleLabel={itemStatus(item) === "available" ? t("menu.toggle86") : itemStatus(item) === "unavailable" ? t("menu.toggleAvailable") : t("common.activate")}
        t={t}
      />
    </div>
  );
}

export function LiveComboCard({
  item,
  categoryName,
  showCategory,
  fmt,
  tx,
  t,
  variantIndex,
  onEdit,
  onToggle86,
  onDeactivate,
  canToggleAvailability,
  canManage,
}: {
  item: LiveItem;
  categoryName?: string;
  showCategory?: boolean;
  fmt: FormatOptions;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  variantIndex: VariantIndex;
  onEdit: () => void;
  onToggle86: () => void;
  onDeactivate?: () => void;
  canToggleAvailability: boolean;
  canManage: boolean;
}) {
  const variant = item.variants[0];
  const strategyLabel =
    variant?.comboPricingStrategy === "sum_components_minus_discount"
      ? t("menu.strategySumMinusDiscount")
      : variant?.comboPricingStrategy === "component_price_override"
        ? t("menu.strategyComponentOverride")
        : t("menu.fixedPriceLabel");

  // Real slot/option detail, read via CONSOLE-COMBO-READ-P0 — the reference's
  // slot-summary line, "can't be ordered" warning, and savings badge, but
  // computed from the real modifier-group/linked-variant graph, never faked.
  const slots = item.modifierGroups.map((group) => {
    const options = group.modifiers.map((modifier) => ({
      modifier,
      linked: modifier.linkedVariantId ? variantIndex.get(modifier.linkedVariantId) : undefined,
    }));
    const blocked = options.length > 0 && options.every((o) => o.linked && !o.linked.available);
    return { group, options, blocked };
  });
  const blockedSlots = slots.filter((s) => s.blocked);
  const slotSummary = slots
    .map((s) => `${tx(s.group.name)}: ${s.options.map((o) => o.linked?.name ?? tx(o.modifier.name)).join(" / ") || "—"}`)
    .join("  ·  ");
  const status = itemStatus(item);
  const defaultsTotal = slots.reduce((sum, s) => {
    const def = s.options.find((o) => o.modifier.isDefault) ?? s.options[0];
    if (!def) return sum;
    const amount = def.linked?.price.amount ?? def.modifier.comboComponentPriceOverride?.amount ?? def.modifier.priceDelta.amount ?? 0;
    return sum + amount;
  }, 0);
  const saving = variant ? defaultsTotal - variant.basePrice.amount : 0;

  return (
    <div className={`item-card status-${status}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{tx(item.name)}</h3>
            <LiveStatusBadge item={item} t={t} />
            {status === "available" && blockedSlots.length > 0 ? <span className="warn-badge">{t("menu.comboCantBeOrdered")}</span> : null}
            {showCategory && categoryName ? <span className="category-badge">{categoryName}</span> : null}
          </div>
          <p>{slotSummary || tx(item.description) || strategyLabel}</p>
          {status === "available" && blockedSlots.length > 0 ? (
            <p className="warn-text">
              {t("menu.comboNoAvailableItemIn")} {blockedSlots.map((s) => tx(s.group.name)).join(", ")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="item-price">
        {variant ? formatMoney(variant.basePrice, fmt) : "—"}
        {variant && saving > 0 ? <small className="saving">{t("menu.comboSaveLabel")} {formatMoney({ amount: saving, currency: variant.basePrice.currency }, fmt)}</small> : null}
      </div>
      <button className="edit-item" aria-label={`Edit ${tx(item.name)}`} onClick={onEdit}>
        <Icon name="edit" size={15} /> {t("common.edit")}
      </button>
      <LiveRowMenu
        available={item.available}
        canToggleAvailability={canToggleAvailability}
        canManage={canManage}
        onEdit={onEdit}
        onToggle86={onToggle86}
        onDeactivate={onDeactivate}
        toggleLabel={status === "available" ? t("menu.toggle86") : status === "unavailable" ? t("menu.toggleAvailable") : t("common.activate")}
        t={t}
      />
    </div>
  );
}
