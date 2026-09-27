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
 *  - Availability is the real FR-MNU-030 86/restore flow (a reason is
 *    required to 86), not the reference's instant three-way status picker —
 *    there is no "hidden" status on this backend. `isActive=false` with no
 *    manual 86 in effect (deactivation) is a DISTINCT master-data lifecycle
 *    state, never conflated with 86.
 *  - Attaching a customization group to THIS item has no read/update/unlink
 *    endpoint at all (`POST /catalogue/items/:id/modifier-groups` is
 *    write-only) — see `live-menu-management.tsx`'s own docblock. This
 *    section stays a link to the shared Customizations catalogue rather than
 *    a fake "attached groups" picker.
 */

import { useState } from "react";
import type { Currency } from "@/lib/console/types";
import { currencyExponent, excessPrecision, formatDateTime, formatMoney, minorFromInput } from "@/lib/console/format";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { services } from "@/lib/console/services";
import { useTaxClasses } from "@/components/console/catalogue/tax-class-field";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
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
  const [price, setPrice] = useState("");
  const [pending86, setPending86] = useState(false);
  const { taxClasses } = useTaxClasses(branchId);

  const exponent = currencyExponent(currency);
  const priceTooPrecise = excessPrecision(price, exponent);

  let problem = "";
  if (!name.trim()) problem = t("menu.addAnItemName");
  else if (categories.length === 0) problem = t("menu.createCategoryFirst");
  else if (!categoryId) problem = t("menu.chooseACategory");
  else if (!item && (!price.trim() || priceTooPrecise)) problem = t("menu.addAPrice");

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

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
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
              {t("common.name")}
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

          <Section title={t("menu.availability")}>
            {item ? (
              <>
                {item.unavailableReason ? (
                  <>
                    <h4 className="warn-title">{t("menu.unavailable")}</h4>
                    <p className="warn-text">{t("menu.eightySixedNotice")}</p>
                    {item.autoReenableAt ? (
                      <p className="warn-text">{t("menu.autoReenableActive").replace("{time}", formatDateTime(item.autoReenableAt, fmt))}</p>
                    ) : null}
                  </>
                ) : !item.available ? (
                  <>
                    <h4>{t("menu.deactivated")}</h4>
                    <p className="section-help">{t("menu.deactivatedNotice")}</p>
                  </>
                ) : (
                  <p className="section-help">{t("menu.available")}</p>
                )}
                {canToggleAvailability ? (
                  item.available && !item.unavailableReason ? (
                    <button className="secondary" onClick={() => setPending86(true)}>
                      <Icon name="ban" size={15} /> {t("menu.toggle86")}
                    </button>
                  ) : item.unavailableReason ? (
                    <button className="primary small" onClick={() => setAvailability(true)}>
                      <Icon name="eye" size={15} /> {t("menu.toggleAvailable")}
                    </button>
                  ) : null
                ) : null}
              </>
            ) : (
              <p className="section-help">{t("menu.newItemsAvailableNote")}</p>
            )}
          </Section>

          <Section title={t("menu.pricingSectionTitle")}>
            {!item ? (
              <label>
                {t("menu.price")}
                <div className="price-field">
                  <span>{currency}</span>
                  <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" disabled={!canManage} />
                </div>
              </label>
            ) : (
              <div className="size-prices">
                <div className="size-head">
                  <span>{t("menu.variantColumn")}</span>
                  <span>{t("menu.price")}</span>
                  <span></span>
                </div>
                {item.variants.length === 0 ? (
                  <p className="section-help">{t("menu.noVariants")}</p>
                ) : (
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
                )}
              </div>
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
          <div>{item && canManage ? <button className="delete" onClick={deactivate}>{t("common.deactivate")}</button> : null}</div>
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
        <Eighty6Prompt onCancel={() => setPending86(false)} onConfirm={(reason, autoReenableAt) => setAvailability(false, reason, autoReenableAt)} />
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
      <span>{variantName}</span>
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
      ) : null}
    </div>
  );
}

function Eighty6Prompt({
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
