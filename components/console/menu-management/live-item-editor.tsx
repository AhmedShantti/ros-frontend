"use client";

/**
 * Menu Management LIVE workspace — Add / Edit item.
 *
 * Visual/structural counterpart of the demo workspace's `item-editor.tsx`
 * (same `.overlay`/`.drawer`/`Section` shape, same shared
 * `menu-management.css`), rewired to the LIVE canonical API and the CURRENT
 * direct-pricing model:
 *
 *  - Pricing is ALWAYS `basePriceMinor` + `currency`, entered once, in this
 *    SAME form — there is no Price List, no per-channel/per-size pricing
 *    (the reference's "channel"/"size" modes do not exist here on purpose).
 *  - Creating an item creates it AND its one priced variant atomically, in
 *    one call (`services.catalogue.items.create`) — never a second
 *    "add variant" step just to make it sellable.
 *  - Availability visually reuses the reference's three-way `.radio-grid`/
 *    `.radio-card` status picker, but mapped to the three REAL states this
 *    backend has — Available, 86'd (FR-MNU-030, always requires a reason),
 *    Deactivated (`isActive=false`, a distinct master-data lifecycle state,
 *    never conflated with 86) — never the reference's fictional "hidden"
 *    status. `isActive` and `unavailableReason` are independent booleans, so
 *    an item can be BOTH deactivated and still carry a stale 86 rule;
 *    reaching "Available" from there sends both real mutations explicitly
 *    rather than faking a single instant transition.
 *  - Attaching a customization group to THIS item has no read/update/unlink
 *    endpoint at all (`POST /catalogue/items/:id/modifier-groups` is
 *    write-only) — see `live-menu-management.tsx`'s own docblock. This
 *    section stays a link to the shared Customizations catalogue rather than
 *    a fake "attached groups" picker.
 */

import { useRef, useState } from "react";
import type { Currency } from "@/lib/console/types";
import { currencyExponent, excessPrecision, formatDateTime, formatMoney, minorFromInput, toMajorUnits, type FormatOptions } from "@/lib/console/format";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { services } from "@/lib/console/services";
import { useTaxClasses } from "@/components/console/catalogue/tax-class-field";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
import type { ConsoleKey } from "@/content/console/en";
import { itemStatus } from "./live-cards";
import { Icon, Section, useEscape, useSaver } from "./common";

interface LiveItemEditorProps {
  item: LiveItem | null;
  defaultCategoryId?: string;
  categories: LiveCategory[];
  branchId: string | null;
  currency: Currency;
  canManage: boolean;
  canToggleAvailability: boolean;
  canChangePrice: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
  onOpenCustomizations: () => void;
}

export default function LiveItemEditor({
  item,
  defaultCategoryId,
  categories,
  branchId,
  currency,
  canManage,
  canToggleAvailability,
  canChangePrice,
  onClose,
  onChanged,
  onOpenCustomizations,
}: LiveItemEditorProps) {
  const { t, tx, fmt } = useI18n();
  const { saving, error, run, setError } = useSaver(t("mm.somethingWrong"));
  useEscape(!saving, onClose);
  const [name, setName] = useState(item ? tx(item.name) : "");
  const [kitchenName, setKitchenName] = useState(item ? tx(item.kitchenName) : "");
  const [description, setDescription] = useState(item ? tx(item.description) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId || defaultCategoryId || "");
  const [taxClassId, setTaxClassId] = useState(item?.taxClassId ?? "");
  // The reference's single "Price" field, ported literally — for a NEW item
  // it seeds the one variant created atomically; for an EXISTING item it
  // shows/edits the default (first) real variant's real price directly, in
  // the same visual position, via the same `updateVariantPrice` mutation the
  // "Variant prices" disclosure below uses per row — never a second,
  // parallel piece of local price state.
  const primaryVariant = item?.variants[0] ?? null;
  const [price, setPrice] = useState(primaryVariant ? String(toMajorUnits(primaryVariant.basePrice)) : "");
  // Mirrors the reference's own default — collapsed only when there's
  // nothing real to disclose yet (a brand-new item); an item that already
  // carries real variant prices opens with them visible, matching the
  // reference's own default for an item whose pricing mode isn't "single".
  const [pricesOpen, setPricesOpen] = useState(Boolean(item));
  // Unsaved CREATE-mode availability choice — the create DTO cannot set
  // isActive/86 atomically (confirmed against http.ts's `items.create`, which
  // sends no availability field at all), so this stays local form state and
  // is applied as a real, separate canonical mutation inside the SAME Save
  // action once the item exists, never faked as persisted before then.
  const [createStatus, setCreateStatus] = useState<"available" | "unavailable" | "deactivated">("available");
  const [createUnavailableReason, setCreateUnavailableReason] = useState("");
  const [createAutoReenableAt, setCreateAutoReenableAt] = useState("");
  // Shaped exactly like the real fields `AvailabilityPicker`/`itemStatus`
  // read off a saved `LiveItem`, so the SAME picker renders identically pre-
  // and post-save — no separate create-mode component.
  const createDraftAvailability = {
    isActive: createStatus !== "deactivated",
    unavailableReason: createStatus === "unavailable" ? createUnavailableReason : null,
    autoReenableAt: createAutoReenableAt || null,
  };
  const [pending86, setPending86] = useState(false);
  // Selecting text inside the drawer and releasing the mouse outside it must
  // not close the drawer — only a press that STARTED on the backdrop does.
  const pressedOutside = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { taxClasses } = useTaxClasses(branchId);

  const exponent = currencyExponent(currency);
  const priceTooPrecise = excessPrecision(price, exponent);

  let problem = "";
  if (!name.trim()) problem = t("menu.addAnItemName");
  else if (categories.length === 0) problem = t("menu.createCategoryFirst");
  else if (!categoryId) problem = t("menu.chooseACategory");
  else if ((!item || primaryVariant) && (!price.trim() || priceTooPrecise)) problem = t("menu.addAPrice");

  async function save() {
    if (problem) return;
    if (!item) {
      const minorAmount = minorFromInput(price, exponent);
      if (minorAmount === null) return;
      await run(async () => {
        const created = await services.catalogue.items.create({
          name: { en: name.trim(), ar: name.trim() },
          kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
          description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
          taxClassId: taxClassId || undefined,
          variants: [{ name: { en: name.trim(), ar: name.trim() }, price: { amount: minorAmount, currency } }],
        });
        if (categoryId) await services.catalogue.placeItem(created.id, categoryId);
        // The item is created active/available by default (the create DTO
        // never sends an availability field) — if the user picked a
        // different state in the picker above, apply the SAME real mutation
        // an existing item would use, right here, inside this one Save.
        if (createStatus === "unavailable") {
          await services.catalogue.toggleAvailability(created.id, false, createUnavailableReason, createAutoReenableAt || undefined);
        } else if (createStatus === "deactivated") {
          await services.catalogue.items.remove(created.id);
        }
        onChanged(t("menu.itemCreated"));
        onClose();
      });
      return;
    }
    await run(async () => {
      await services.catalogue.items.update(item.id, {
        name: { en: name.trim(), ar: name.trim() },
        kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
        description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
        taxClassId: taxClassId || undefined,
      });
      if (categoryId && categoryId !== item.categoryId) {
        await services.catalogue.placeItem(item.id, categoryId);
      }
      // The primary Price field is real `updateVariantPrice` on the default
      // variant, bundled into this SAME save — not a second, fake local copy
      // of what the "Variant prices" rows below already edit for themselves.
      if (primaryVariant && canChangePrice) {
        const minorAmount = minorFromInput(price, exponent);
        if (minorAmount !== null && minorAmount !== primaryVariant.basePrice.amount) {
          await services.catalogue.updateVariantPrice(primaryVariant.id, { amount: minorAmount, currency });
        }
      }
      onChanged(t("menu.itemPlaced"));
      onClose();
    });
  }

  async function deactivate() {
    if (!item) return;
    await run(async () => {
      await services.catalogue.items.remove(item.id);
      onChanged(t("common.deactivate"));
      onClose();
    });
  }

  async function setAvailability(available: boolean, reason?: string, autoReenableAt?: string) {
    if (!item) return;
    try {
      await services.catalogue.toggleAvailability(item.id, available, reason, autoReenableAt);
      setPending86(false);
      onChanged(available ? t("menu.restored") : reason ? `${t("menu.eightySixed")} — ${reason}` : t("menu.eightySixed"));
      onClose();
    } catch (e) {
      setError((e instanceof Error && e.message) || t("mm.somethingWrong"));
    }
  }

  /**
   * The visual three-way status picker's click handler. Each target maps to
   * the ONE real transition it needs — never a fake instant flip:
   *   → unavailable: opens the reason prompt (a genuine 86 always requires
   *     one); the actual mutation happens in `setAvailability` above.
   *   → deactivated: `items.remove()` (existing `deactivate`).
   *   → available: reaches Available from WHEREVER the item currently is,
   *     which can take two canonical mutations in the compound case (already
   *     deactivated AND still carrying a stale 86 rule) — both are sent
   *     explicitly, never faked as one.
   */
  async function setStatus(target: "available" | "unavailable" | "deactivated") {
    if (!item) {
      // CREATE mode: nothing exists to mutate yet — stays local draft state
      // until Save (see the create branch of `save()` above).
      if (createStatus === target) return;
      if (target === "unavailable") {
        setPending86(true);
        return;
      }
      setCreateStatus(target);
      setCreateUnavailableReason("");
      setCreateAutoReenableAt("");
      return;
    }
    if (itemStatus(item) === target) return;
    if (target === "unavailable") {
      setPending86(true);
      return;
    }
    if (target === "deactivated") {
      await deactivate();
      return;
    }
    await run(async () => {
      if (!item.isActive) {
        await services.catalogue.items.update(item.id, { available: true });
      }
      if (item.unavailableReason) {
        await services.catalogue.toggleAvailability(item.id, true, undefined, undefined);
      }
      onChanged(t("menu.itemActivated"));
      onClose();
    });
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { pressedOutside.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget && !saving) onClose();
        pressedOutside.current = false;
      }}
    >
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <span className="small-label">{item ? t("mm.editItemLabel") : t("mm.newItemLabel")}</span>
            <h2>{item ? tx(item.name) : t("menu.newItem")}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <Section title={t("menu.basicInfo")}>
            <label>
              {t("menu.itemNameLabel")}
              <input autoFocus={!item} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mm.placeholderItemName")} disabled={!canManage} />
            </label>
            <label>
              {t("menu.kitchenName")}
              <input value={kitchenName} onChange={(e) => setKitchenName(e.target.value)} placeholder={t("mm.placeholderKitchenName")} disabled={!canManage} />
            </label>
            <label>
              {t("common.category")}
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canManage}>
                <option value="">—</option>
                {categories.length === 0 && <option value="">{t("mm.noCategoriesTitle")}</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {tx(c.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("common.description")}
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("mm.placeholderDescription")} disabled={!canManage} />
            </label>
            <label>
              {t("menu.taxClass")}
              <select value={taxClassId} onChange={(e) => setTaxClassId(e.target.value)} disabled={!canManage}>
                <option value="">{t("menu.taxClassNotConfigured")}</option>
                {taxClasses.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.names.en || tc.code}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title={t("menu.availabilitySectionTitle")}>
            {item ? <p className="section-help">{t("menu.availabilitySectionHelp")}</p> : null}
            <AvailabilityPicker
              item={item ?? createDraftAvailability}
              canManage={canManage}
              canToggleAvailability={canToggleAvailability}
              fmt={fmt}
              t={t}
              onSetStatus={setStatus}
            />
            {!item ? <p className="section-help">{t("menu.newItemsAvailableNote")}</p> : null}
          </Section>

          <Section title={t("menu.pricingSectionTitle")}>
            {item && item.variants.length === 0 ? (
              <p className="section-help">{t("menu.noVariants")}</p>
            ) : (
              <>
                <label>
                  {t("menu.price")}
                  <div className="price-field">
                    <span>{currency}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      disabled={item ? !canChangePrice : !canManage}
                    />
                  </div>
                </label>

                <button className={pricesOpen ? "advanced-row open" : "advanced-row"} onClick={() => setPricesOpen((o) => !o)}>
                  <span>
                    <strong>{t("menu.variants")}</strong>
                    <small>{t("menu.variantPricesCount").replace("{n}", String(item ? item.variants.length : 1))}</small>
                  </span>
                  <span className="chev">
                    <Icon name="chevron" size={16} />
                  </span>
                </button>

                {pricesOpen ? (
                  <div className="prices-panel">
                    <div className="size-prices">
                      <div className="size-head">
                        <span>{t("menu.variantColumn")}</span>
                        <span>{t("menu.price")}</span>
                        <span></span>
                      </div>
                      {item ? (
                        item.variants.map((variant) => (
                          <LivePriceRow
                            key={variant.id}
                            variantId={variant.id}
                            variantName={tx(variant.name)}
                            currentPrice={variant.basePrice}
                            currency={currency}
                            canChangePrice={canChangePrice}
                            onSaved={() => onChanged(t("menu.priceSaved"))}
                          />
                        ))
                      ) : (
                        // Not a second variant — the SAME unsaved create price,
                        // shown in the reference's row shell. Bound to the
                        // identical `price` state as the primary field above,
                        // so editing either stays in sync by construction.
                        <div className="size-row">
                          <div className="static-price">{t("menu.defaultVariant")}</div>
                          <div className="price-field">
                            <span>{currency}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                              placeholder="0.00"
                              disabled={!canManage}
                            />
                          </div>
                          <span></span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {priceTooPrecise ? <p className="warn-text">{t("menu.priceTooPrecise").replace("{currency}", currency)}</p> : null}
          </Section>

          <Section title={t("menu.customizations")}>
            <p className="section-help">{t("menu.customizationsPerItemNote")}</p>
            <button className="link-button" onClick={onOpenCustomizations}>
              {t("menu.openCustomizationsCatalogue")}
            </button>
          </Section>
        </div>

        <div className="drawer-footer">
          <div>
            {item && canManage ? (
              deleteConfirm ? (
                <span className="delete-confirm">
                  {t("menu.deactivateConfirmPrompt")}{" "}
                  <button className="delete" onClick={deactivate}>
                    {t("menu.deactivateConfirmYes")}
                  </button>
                  <button onClick={() => setDeleteConfirm(false)}>{t("common.keep")}</button>
                </span>
              ) : (
                <button className="delete" onClick={() => setDeleteConfirm(true)}>
                  {t("menu.deactivateItemButton")}
                </button>
              )
            ) : null}
          </div>
          <div className="footer-right">
            {error ? <span className="footer-hint error">{error}</span> : problem && <span className="footer-hint">{problem}</span>}
            <button className="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            {canManage ? (
              <button className="primary" disabled={Boolean(problem) || saving} onClick={save}>
                {saving ? `${t("common.saving")}…` : item ? t("menu.saveItemButton") : t("menu.addItemButton")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {pending86 ? (
        <Eighty6Prompt
          onCancel={() => setPending86(false)}
          onConfirm={(reason, autoReenableAt) => {
            if (!item) {
              setCreateStatus("unavailable");
              setCreateUnavailableReason(reason);
              setCreateAutoReenableAt(autoReenableAt ?? "");
              setPending86(false);
              return;
            }
            setAvailability(false, reason, autoReenableAt);
          }}
        />
      ) : null}
    </div>
  );
}

/** One variant's direct price, editable inline — no Price List, no separate pricing workspace. */
function LivePriceRow({
  variantId,
  variantName,
  currentPrice,
  currency,
  canChangePrice,
  onSaved,
}: {
  variantId: string;
  variantName: string;
  currentPrice: { amount: number; currency: Currency };
  currency: Currency;
  canChangePrice: boolean;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const exponent = currencyExponent(currency);
  const tooPrecise = excessPrecision(amount, exponent);

  async function save() {
    if (tooPrecise) return;
    const minorAmount = minorFromInput(amount, exponent);
    if (minorAmount === null) return;
    await action.run(() => services.catalogue.updateVariantPrice(variantId, { amount: minorAmount, currency }), {
      onSuccess: () => {
        setEditing(false);
        setAmount("");
        onSaved();
      },
    });
  }

  return (
    <div className="size-row">
      <div className="static-price">{variantName}</div>
      {editing ? (
        <div className="price-field">
          <span>{currency}</span>
          <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      ) : (
        <div className="static-price">{formatMoney(currentPrice, fmt)}</div>
      )}
      {canChangePrice ? (
        editing ? (
          <button className="row-remove" aria-label={t("mm.savePrice")} onClick={save} disabled={action.pending}>
            <Icon name="check" size={14} />
          </button>
        ) : (
          <button className="row-remove" aria-label={t("mm.editPrice")} onClick={() => { setAmount(""); setEditing(true); }}>
            <Icon name="edit" size={14} />
          </button>
        )
      ) : (
        <span></span>
      )}
    </div>
  );
}

/**
 * The three-way real-state availability picker — shared between the item
 * editor and the combo editor (a combo is a real `MenuItem` with exactly the
 * same `isActive`/`unavailableReason` fields as any other item). `isActive`
 * takes priority over `unavailableReason`: an item can be BOTH deactivated
 * and still carry a stale 86 rule, and in that compound case it is
 * truthfully "deactivated", never "86'd".
 */
export function AvailabilityPicker({
  item,
  canManage,
  canToggleAvailability,
  fmt,
  t,
  onSetStatus,
}: {
  item: Pick<LiveItem, "isActive" | "unavailableReason" | "autoReenableAt">;
  canManage: boolean;
  canToggleAvailability: boolean;
  fmt: FormatOptions;
  t: (key: ConsoleKey) => string;
  onSetStatus: (target: "available" | "unavailable" | "deactivated") => void;
}) {
  const status = itemStatus(item);
  // Reaching "available" from here can need BOTH permissions at once in the
  // compound case (deactivated AND still 86'd) — gate on whichever
  // mutations that specific transition would actually send, never on a
  // single blanket permission.
  const canReachAvailable = (item.isActive || canManage) && (!item.unavailableReason || canToggleAvailability);
  return (
    <>
      <div className="radio-grid three">
        <button
          className={status === "available" ? "radio-card chosen" : "radio-card"}
          disabled={status === "available" || !canReachAvailable}
          onClick={() => onSetStatus("available")}
        >
          <b>
            <Icon name="eye" size={14} /> {t("menu.available")}
          </b>
          <small>{t("menu.availabilityAvailableHelp")}</small>
        </button>
        <button
          className={status === "unavailable" ? "radio-card chosen" : "radio-card"}
          disabled={status === "unavailable" || !canToggleAvailability}
          onClick={() => onSetStatus("unavailable")}
        >
          <b>
            <Icon name="ban" size={14} /> {t("menu.unavailable")}
          </b>
          <small>{t("menu.availabilityUnavailableHelp")}</small>
        </button>
        <button
          className={status === "deactivated" ? "radio-card chosen" : "radio-card"}
          disabled={status === "deactivated" || !canManage}
          onClick={() => onSetStatus("deactivated")}
        >
          <b>
            <Icon name="trash" size={14} /> {t("menu.deactivated")}
          </b>
          <small>{t("menu.availabilityDeactivatedHelp")}</small>
        </button>
      </div>
      {item.unavailableReason ? (
        <>
          <p className="warn-text">{t("menu.eightySixedNotice")}</p>
          {item.autoReenableAt ? (
            <p className="warn-text">{t("menu.autoReenableActive").replace("{time}", formatDateTime(item.autoReenableAt, fmt))}</p>
          ) : null}
        </>
      ) : null}
      {status === "deactivated" ? <p className="section-help">{t("menu.deactivatedNotice")}</p> : null}
    </>
  );
}

export function Eighty6Prompt({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason: string, autoReenableAt?: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [autoReenableAt, setAutoReenableAt] = useState("");
  const trimmed = reason.trim();

  function confirm() {
    const iso = autoReenableAt ? new Date(autoReenableAt).toISOString() : undefined;
    onConfirm(trimmed, iso);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="drawer-head">
          <div>
            <span className="small-label">{t("menu.toggle86")}</span>
            <h2>{t("menu.86Reason")}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <Section title={t("menu.toggle86")}>
            <label>
              {t("menu.86Reason")}
              <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("menu.86Placeholder")} />
              <small>{t("menu.86ReasonHint")}</small>
            </label>
            <label>
              {t("menu.autoReenableAt")}
              <input type="datetime-local" value={autoReenableAt} onChange={(e) => setAutoReenableAt(e.target.value)} />
              <small>{t("menu.autoReenableHint")}</small>
            </label>
          </Section>
        </div>
        <div className="drawer-footer">
          <div></div>
          <div className="footer-right">
            <button className="secondary" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button className="primary" disabled={!trimmed} onClick={confirm}>
              {t("menu.toggle86")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
