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
import type { Currency, Localised } from "@/lib/console/types";
import { formatMoney, type FormatOptions } from "@/lib/console/format";
import type { LiveItem } from "@/lib/console/menu-management/live-adapter";
import type { ConsoleKey } from "@/content/console/en";
import { Icon, useEscape } from "./common";

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
  useEscape(open, close);
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
              <button onClick={act(onToggle86)}>
                <Icon name={available ? "ban" : "eye"} size={15} /> {toggleLabel}
              </button>
            ) : null}
            {onDeactivate && canManage ? (
              <>
                <div className="row-menu-sep"></div>
                {confirm ? (
                  <button className="danger" onClick={act(onDeactivate)}>
                    <Icon name="ban" size={15} /> {t("menu.rowMenuConfirmDeactivate")}
                  </button>
                ) : (
                  <button className="danger" onClick={() => setConfirm(true)}>
                    <Icon name="ban" size={15} /> {t("menu.rowMenuDeactivate")}
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

export function LiveStatusBadge({
  item,
  t,
}: {
  item: Pick<LiveItem, "available" | "unavailableReason">;
  t: (key: ConsoleKey) => string;
}) {
  const label = !item.available
    ? item.unavailableReason
      ? t("menu.eightySixed")
      : t("menu.unavailable")
    : t("menu.available");
  return <span className={`availability ${item.available ? "available" : "unavailable"}`}>{label}</span>;
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
    <div className={`item-card status-${item.available ? "available" : "unavailable"}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{tx(item.name)}</h3>
            <LiveStatusBadge item={item} t={t} />
            {showCategory && categoryName ? <span className="category-badge">{categoryName}</span> : null}
          </div>
          <p>{tx(item.description) || t("menu.noDescriptionAdded")}</p>
        </div>
      </div>
      <div className="item-price">
        {item.variants.length > 0 ? formatMoney(item.variants[0]!.basePrice, fmt) : formatMoney({ amount: 0, currency }, fmt)}
      </div>
      <button className="edit-item" aria-label={`${t("common.edit")} ${tx(item.name)}`} onClick={onEdit}>
        <Icon name="edit" size={15} /> {t("common.edit")}
      </button>
      <LiveRowMenu
        available={item.available}
        canToggleAvailability={canToggleAvailability}
        canManage={canManage}
        onEdit={onEdit}
        onToggle86={onToggle86}
        onDeactivate={onDeactivate}
        toggleLabel={item.available ? t("menu.toggle86") : t("menu.toggleAvailable")}
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
  return (
    <div className={`item-card status-${item.available ? "available" : "unavailable"}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{tx(item.name)}</h3>
            <LiveStatusBadge item={item} t={t} />
            {showCategory && categoryName ? <span className="category-badge">{categoryName}</span> : null}
          </div>
          <p>{tx(item.description) || strategyLabel}</p>
        </div>
      </div>
      <div className="item-price">{variant ? formatMoney(variant.basePrice, fmt) : "—"}</div>
      <button className="edit-item" aria-label={`${t("common.edit")} ${tx(item.name)}`} onClick={onEdit}>
        <Icon name="edit" size={15} /> {t("common.edit")}
      </button>
      <LiveRowMenu
        available={item.available}
        canToggleAvailability={canToggleAvailability}
        canManage={canManage}
        onEdit={onEdit}
        onToggle86={onToggle86}
        onDeactivate={onDeactivate}
        toggleLabel={item.available ? t("menu.toggle86") : t("menu.toggleAvailable")}
        t={t}
      />
    </div>
  );
}
