"use client";

/**
 * Menu Management LIVE workspace — Create / Edit combo.
 *
 * Visual/structural counterpart of the demo workspace's `combo-editor.tsx`
 * (same `.overlay`/`.modal.wide`/`Section`/slot-chip shape, same shared
 * `menu-management.css`), wired to the REAL canonical combo model
 * (COMBO-COMPONENT-IDENTITY-P0, FR-POS-030/031/032) instead of a simulated
 * in-memory one:
 *
 *  - `MenuItem.isCombo` + one directly-priced `MenuItemVariant` — pricing
 *    strategy/discount/allocation basis are DEFINITION metadata only; the
 *    variant's own `basePriceMinor` (computed here from that definition, or
 *    typed directly for "fixed") remains the single source of truth for
 *    what is actually charged.
 *  - Each "part" (the reference's slot) is a real `ModifierGroup`; each
 *    option in it is a real `Modifier` with `linkedVariantId` pointing at an
 *    ACTUAL existing, non-combo `MenuItemVariant` — never a lookalike label.
 *    The first option added to a part is its default (`isDefault: true`);
 *    later ones are alternates, each with an optional `priceDelta` premium.
 *  - `component_price_override` strategy additionally carries a per-default-
 *    option `comboComponentPriceOverride` (that option's own contribution to
 *    the combo's composed price).
 *
 * CONSOLE-COMBO-READ-P0 — passing `existingItem` opens this in EDIT mode: it
 * loads the item's real attached parts via
 * `GET items/:itemId/modifier-groups` (`services.catalogue.
 * listItemModifierGroups`) and lets the caller change:
 *  - basic info (name/description/category) — real `items.update`/`placeItem`.
 *  - pricing strategy/discount/allocation/price — real `updateVariantPrice`.
 *  - an existing part's label — real `modifierGroups.update` (PATCH exists).
 *  - ADDING a brand-new part, or a brand-new alternate option to an existing
 *    part — both real creates (`modifierGroups.create`/`linkModifierGroup`/
 *    `addModifier`).
 * What remains NOT possible, because no backend mutation exists for it: an
 * EXISTING option cannot be removed, its own price/override changed, or its
 * default status changed once saved (no PATCH/DELETE on `Modifier` or
 * `ModifierGroupLink`) — those render read-only rather than as a fake
 * editable control. This is a genuine backend constraint, not a shortcut.
 */

import { useEffect, useMemo, useState } from "react";
import type { Currency, Localised } from "@/lib/console/types";
import { currencyExponent, formatMoney, minorFromInput, signedMinorFromInput, toMajorUnits, type FormatOptions } from "@/lib/console/format";
import { services } from "@/lib/console/services";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
import type { ConsoleKey } from "@/content/console/en";
import { Icon, Section, useEscape, useSaver } from "./common";

type ComboPricingStrategy = "fixed" | "sum_components_minus_discount" | "component_price_override";
type ComboAllocationBasis = "equal" | "list_price" | "cost";

interface Candidate {
  itemId: string;
  variantId: string;
  name: string;
  price: { amount: number; currency: Currency };
}

interface SlotOption {
  key: string;
  candidateItemId: string;
  /** Decimal string, only meaningful on a non-default option. */
  priceDelta: string;
  /** Decimal string, only meaningful on the default option under `component_price_override`. */
  overrideAmount: string;
  /** Already persisted on the backend — read-only here; no per-option edit/delete mutation exists. */
  existing?: boolean;
}

interface SlotForm {
  key: string;
  label: string;
  isRequired: boolean;
  options: SlotOption[];
  /** The real, already-linked ModifierGroup id — undefined for a brand-new part this session. */
  existingGroupId?: string;
}

let seq = 0;
const tempKey = () => `tmp-${++seq}`;

interface LiveComboEditorProps {
  /** Present -> EDIT this real combo item; absent -> create a new one. */
  existingItem?: LiveItem;
  categories: LiveCategory[];
  nonComboItems: LiveItem[];
  defaultCategoryId?: string;
  currency: Currency;
  fmt: FormatOptions;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onClose: () => void;
  onCreated: (message: string) => void;
}

export default function LiveComboEditor({
  existingItem,
  categories,
  nonComboItems,
  defaultCategoryId,
  currency,
  fmt,
  tx,
  t,
  onClose,
  onCreated,
}: LiveComboEditorProps) {
  const { saving, error, run } = useSaver(t("mm.somethingWrong"));
  useEscape(!saving, onClose);
  const isEdit = !!existingItem;

  // The picker needs every candidate's REAL variant + price, which the item
  // list view does not carry for free (see `LiveItem.variants`, populated by
  // `live-adapter.ts`'s own `listItemsWithPlacements` fan-out) — already
  // resolved by the time this editor opens, so this is a pure derivation,
  // never a fetch of its own. Keyed by itemId (its FIRST variant only — the
  // common single-variant case; a multi-variant standalone item is a known
  // limitation, unchanged from create mode).
  const candidates = useMemo<Candidate[]>(
    () =>
      nonComboItems
        .filter((item) => item.variants.length > 0)
        .map((item) => ({
          itemId: item.id,
          variantId: item.variants[0]!.id,
          name: tx(item.name),
          price: item.variants[0]!.basePrice,
        })),
    [nonComboItems, tx],
  );
  const candidateById = useMemo(() => new Map(candidates.map((c) => [c.itemId, c])), [candidates]);

  /** EVERY variant of every standalone item, for resolving an EXISTING option's linkedVariantId back to a real item — unlike `candidates` above, not limited to each item's first variant. */
  const variantLookup = useMemo(() => {
    const lookup = new Map<string, Candidate>();
    for (const item of nonComboItems) {
      for (const variant of item.variants) {
        lookup.set(variant.id, { itemId: item.id, variantId: variant.id, name: tx(item.name), price: variant.basePrice });
      }
    }
    return lookup;
  }, [nonComboItems, tx]);

  const existingVariant = existingItem?.variants[0];
  const originalCategoryId = existingItem?.placements[0]?.categoryId ?? "";

  const [name, setName] = useState(existingItem ? tx(existingItem.name) : "");
  const [description, setDescription] = useState(existingItem ? tx(existingItem.description) : "");
  const [categoryId, setCategoryId] = useState(originalCategoryId || defaultCategoryId || categories[0]?.id || "");
  const [strategy, setStrategy] = useState<ComboPricingStrategy>(existingVariant?.comboPricingStrategy ?? "fixed");
  const [fixedPrice, setFixedPrice] = useState(
    existingVariant && (existingVariant.comboPricingStrategy ?? "fixed") === "fixed"
      ? String(toMajorUnits(existingVariant.basePrice))
      : "",
  );
  const [discountPercent, setDiscountPercent] = useState(
    existingVariant?.comboDiscountBps ? String(existingVariant.comboDiscountBps / 100) : "10",
  );
  const [allocationBasis, setAllocationBasis] = useState<ComboAllocationBasis>(
    existingVariant?.comboAllocationBasis ?? "equal",
  );
  const [slots, setSlots] = useState<SlotForm[]>(
    existingItem
      ? []
      : [
          { key: tempKey(), label: t("mm.partMain"), isRequired: true, options: [] },
          { key: tempKey(), label: t("mm.partSide"), isRequired: true, options: [] },
          { key: tempKey(), label: t("mm.partDrink"), isRequired: true, options: [] },
        ],
  );
  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!existingItem) return;
    let cancelled = false;
    services.catalogue
      .listItemModifierGroups(existingItem.id)
      .then((groups) => {
        if (cancelled) return;
        const loaded: SlotForm[] = groups.map((group) => {
          // The real default first, always — every positional convention
          // below ("options[0] is the default") depends on this.
          const sorted = [...group.modifiers].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
          return {
            key: tempKey(),
            existingGroupId: group.id,
            label: tx(group.name),
            isRequired: group.required,
            options: sorted.map((modifier) => {
              const linked = modifier.linkedVariantId ? variantLookup.get(modifier.linkedVariantId) : undefined;
              return {
                key: tempKey(),
                candidateItemId: linked?.itemId ?? "",
                priceDelta: modifier.priceDelta.amount ? String(toMajorUnits(modifier.priceDelta)) : "",
                overrideAmount: modifier.comboComponentPriceOverride
                  ? String(toMajorUnits(modifier.comboComponentPriceOverride))
                  : "",
                existing: true,
              };
            }),
          };
        });
        setSlots(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("mm.comboLoadError"));
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch only when the combo being edited changes — `variantLookup`/`tx`
    // are stable derivations of the same already-loaded workspace data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingItem?.id]);

  const exponent = currencyExponent(currency);

  function updateSlot(key: string, patch: Partial<SlotForm>) {
    setSlots((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function addOption(slotKey: string, candidateItemId: string) {
    setSlots((cur) =>
      cur.map((s) =>
        s.key === slotKey
          ? { ...s, options: [...s.options, { key: tempKey(), candidateItemId, priceDelta: "", overrideAmount: "" }] }
          : s,
      ),
    );
  }
  function removeOption(slotKey: string, optionKey: string) {
    setSlots((cur) => cur.map((s) => (s.key === slotKey ? { ...s, options: s.options.filter((o) => o.key !== optionKey) } : s)));
  }
  function updateOption(slotKey: string, optionKey: string, patch: Partial<SlotOption>) {
    setSlots((cur) =>
      cur.map((s) =>
        s.key === slotKey ? { ...s, options: s.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) } : s,
      ),
    );
  }

  const filledSlots = slots.filter((s) => s.options.length > 0);
  const hasAnyOption = filledSlots.length > 0;

  function candidateFor(option: SlotOption): Candidate | undefined {
    return candidateById.get(option.candidateItemId) ?? variantLookup.get(option.candidateItemId);
  }

  // Sum of DEFAULT options' own list prices — the "buy separately" reference
  // point, and the basis for `sum_components_minus_discount`.
  const defaultsTotalMinor = filledSlots.reduce((sum, slot) => {
    const first = slot.options[0];
    const c = first ? candidateFor(first) : undefined;
    return sum + (c?.price.amount ?? 0);
  }, 0);

  const overridesValid =
    strategy !== "component_price_override" ||
    filledSlots.every((slot) => minorFromInput(slot.options[0]?.overrideAmount ?? "", exponent) !== null);

  const computedPriceMinor =
    strategy === "fixed"
      ? minorFromInput(fixedPrice, exponent)
      : strategy === "sum_components_minus_discount"
        ? Math.round((defaultsTotalMinor * (10000 - (Number(discountPercent) || 0) * 100)) / 10000)
        : overridesValid
          ? filledSlots.reduce((sum, slot) => sum + (minorFromInput(slot.options[0]?.overrideAmount ?? "0", exponent) ?? 0), 0)
          : null;

  let problem = "";
  if (loadingExisting) problem = t("menu.loadingThisCombo");
  else if (!name.trim()) problem = t("menu.addAComboName");
  else if (!categoryId) problem = t("menu.chooseACategory");
  else if (!hasAnyOption) problem = t("menu.addAtLeastOneItem");
  else if (strategy === "fixed" && (computedPriceMinor === null || computedPriceMinor <= 0)) problem = t("menu.setComboPrice");
  else if (strategy === "sum_components_minus_discount" && !(Number(discountPercent) > 0 && Number(discountPercent) < 100))
    problem = t("menu.discountRangeError");
  else if (strategy === "component_price_override" && !overridesValid) problem = t("menu.setEveryPartDefaultPrice");

  async function save() {
    if (problem || computedPriceMinor === null || computedPriceMinor <= 0) return;
    await run(async () => {
      let comboItemId: string;
      if (existingItem) {
        comboItemId = existingItem.id;
        const variantId = existingItem.variants[0]!.id;
        await services.catalogue.items.update(comboItemId, {
          name: { en: name.trim(), ar: name.trim() },
          description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
        });
        if (categoryId && categoryId !== originalCategoryId) {
          await services.catalogue.placeItem(comboItemId, categoryId);
        }
        await services.catalogue.updateVariantPrice(variantId, { amount: computedPriceMinor, currency }, {
          comboPricingStrategy: strategy,
          comboDiscountBps: strategy === "sum_components_minus_discount" ? Math.round((Number(discountPercent) || 0) * 100) : undefined,
          comboAllocationBasis: allocationBasis,
        });
      } else {
        const created = await services.catalogue.items.create({
          name: { en: name.trim(), ar: name.trim() },
          description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
          isCombo: true,
          variants: [
            {
              name: { en: name.trim(), ar: name.trim() },
              price: { amount: computedPriceMinor, currency },
              comboPricingStrategy: strategy,
              comboDiscountBps: strategy === "sum_components_minus_discount" ? Math.round((Number(discountPercent) || 0) * 100) : undefined,
              comboAllocationBasis: allocationBasis,
            },
          ],
        });
        comboItemId = created.id;
        await services.catalogue.placeItem(comboItemId, categoryId);
      }

      for (const slot of filledSlots) {
        let groupId = slot.existingGroupId;
        if (groupId) {
          // The part's own label/required-ness CAN be updated for real
          // (`PATCH modifier-groups/:groupId`) — synced every save, harmless
          // when unchanged.
          await services.catalogue.modifierGroups.update(groupId, {
            name: { en: slot.label.trim() || t("mm.choice"), ar: slot.label.trim() || t("mm.choice") },
            required: slot.isRequired,
            minSelections: slot.isRequired ? 1 : 0,
            maxSelections: 1,
          });
        } else {
          const group = await services.catalogue.modifierGroups.create({
            name: { en: slot.label.trim() || t("mm.choice"), ar: slot.label.trim() || t("mm.choice") },
            minSelections: slot.isRequired ? 1 : 0,
            maxSelections: 1,
            required: slot.isRequired,
            allowRepeat: false,
          });
          groupId = group.id;
          await services.catalogue.linkModifierGroup(comboItemId, groupId);
        }

        for (const [index, option] of slot.options.entries()) {
          // Already persisted — no per-option edit/delete mutation exists.
          if (option.existing) continue;
          const candidate = candidateFor(option);
          if (!candidate) continue;
          // For an EXISTING part, index 0 is always its real (immutable)
          // default (guaranteed by the load-time sort above) — a NEWLY added
          // option can therefore never land at index 0 on such a part, so
          // this positional check stays correct for both brand-new AND
          // existing parts without needing a separate explicit flag.
          const isDefault = index === 0;
          await services.catalogue.addModifier(groupId, {
            name: { en: candidate.name, ar: candidate.name },
            kind: "addition",
            isDefault,
            linkedVariantId: candidate.variantId,
            priceDelta: isDefault ? { amount: 0, currency } : { amount: signedMinorFromInput(option.priceDelta, exponent) ?? 0, currency },
            comboComponentPriceOverride:
              isDefault && strategy === "component_price_override"
                ? { amount: minorFromInput(option.overrideAmount, exponent) ?? 0, currency }
                : undefined,
          });
        }
      }

      onCreated(existingItem ? t("menu.comboUpdated") : t("menu.comboCreated"));
    });
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal wide">
        <div className="drawer-head">
          <div>
            <span className="small-label">{t("menu.comboLabel")}</span>
            <h2>{existingItem ? t("menu.editCombo") : t("menu.createCombo")}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <Section title={t("menu.basicInfo")}>
            <label>
              {t("menu.comboName")}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mm.placeholderComboName")} />
            </label>
            <label>
              {t("common.description")}
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("mm.placeholderComboDescription")} />
            </label>
            <label>
              {t("common.category")}
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {tx(c.name)}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title={t("menu.whatsInCombo")}>
            {loadError ? <p className="warn-text">{loadError}</p> : null}
            <p className="section-help">
              {t("menu.comboPartsHelp")}
              {existingItem ? ` ${t("menu.comboPartsHelpEdit")}` : ` ${t("menu.comboPartsHelpCreate")}`}
            </p>
            {candidates.length === 0 ? (
              <p className="warn-text">{t("menu.noStandaloneItemsWarning")}</p>
            ) : null}
            {loadingExisting ? (
              <p className="section-help">{t("menu.loadingComboParts")}</p>
            ) : (
              slots.map((slot, idx) => (
                <div className="combo-slot" key={slot.key}>
                  <div className="combo-slot-head">
                    <span className="slot-num">{idx + 1}</span>
                    <input value={slot.label} onChange={(e) => updateSlot(slot.key, { label: e.target.value })} placeholder={t("mm.placeholderPartName")} />
                    {!slot.existingGroupId ? (
                      <button className="row-remove" aria-label={t("menu.removePart")} onClick={() => setSlots((cur) => cur.filter((s) => s.key !== slot.key))}>
                        ×
                      </button>
                    ) : null}
                  </div>
                  <div className="slot-items">
                    {slot.options.length === 0 && <span className="muted">{t("menu.emptyPartNote")}</span>}
                    {slot.options.map((option, optIdx) => {
                      const candidate = candidateFor(option);
                      const name = candidate?.name ?? t("menu.itemNoLongerAvailable");
                      const priceLabel = candidate ? formatMoney(candidate.price, fmt) : "";
                      return (
                        <span key={option.key} className="slot-chip">
                          {name} {priceLabel ? <em>{priceLabel}</em> : null}
                          {optIdx === 0 ? (
                            <b>{t("menu.default")}</b>
                          ) : option.existing ? (
                            <em>+{option.priceDelta || "0"}</em>
                          ) : (
                            <input
                              className="chip-delta"
                              style={{ width: 64 }}
                              value={option.priceDelta}
                              onChange={(e) => updateOption(slot.key, option.key, { priceDelta: e.target.value })}
                              placeholder="+0.00"
                            />
                          )}
                          {optIdx === 0 && strategy === "component_price_override" ? (
                            option.existing ? (
                              <em>{option.overrideAmount || "0"}</em>
                            ) : (
                              <input
                                className="chip-delta"
                                style={{ width: 64 }}
                                value={option.overrideAmount}
                                onChange={(e) => updateOption(slot.key, option.key, { overrideAmount: e.target.value })}
                                placeholder={t("mm.placeholderPrice")}
                              />
                            )
                          ) : null}
                          {!option.existing ? (
                            <button aria-label={`${t("mm.remove")} ${name}`} onClick={() => removeOption(slot.key, option.key)}>
                              ×
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addOption(slot.key, e.target.value);
                    }}
                  >
                    <option value="">{t("menu.addItemToPart").replace("{part}", slot.label || t("menu.thisPart"))}</option>
                    {candidates
                      .filter((c) => !slot.options.some((o) => o.candidateItemId === c.itemId))
                      .map((c) => (
                        <option key={c.itemId} value={c.itemId}>
                          {c.name} — {formatMoney(c.price, fmt)}
                        </option>
                      ))}
                  </select>
                </div>
              ))
            )}
            {!loadingExisting ? (
              <button className="link-button" onClick={() => setSlots((cur) => [...cur, { key: tempKey(), label: "", isRequired: true, options: [] }])}>
                {t("menu.addAnotherPart")}
              </button>
            ) : null}
          </Section>

          <Section title={t("menu.pricingSectionTitle")}>
            <div className="radio-grid">
              <button className={strategy === "fixed" ? "radio-card chosen" : "radio-card"} onClick={() => setStrategy("fixed")}>
                <b>{t("menu.fixedPriceLabel")}</b>
                <small>{t("menu.fixedPriceHelp")}</small>
              </button>
              <button
                className={strategy === "sum_components_minus_discount" ? "radio-card chosen" : "radio-card"}
                onClick={() => setStrategy("sum_components_minus_discount")}
              >
                <b>{t("menu.discountPercentLabel")}</b>
                <small>{t("menu.discountPercentHelp")}</small>
              </button>
              <button
                className={strategy === "component_price_override" ? "radio-card chosen" : "radio-card"}
                onClick={() => setStrategy("component_price_override")}
              >
                <b>{t("menu.componentOverrideLabel")}</b>
                <small>{t("menu.componentOverrideHelp")}</small>
              </button>
            </div>

            {strategy === "fixed" ? (
              <label>
                {t("menu.comboPriceLabel")}
                <div className="price-field">
                  <span>{currency}</span>
                  <input type="number" min="0" step="0.01" value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)} placeholder="0.00" />
                </div>
              </label>
            ) : strategy === "sum_components_minus_discount" ? (
              <label>
                {t("menu.discountLabel")}
                <div className="price-field">
                  <span>%</span>
                  <input type="number" min="1" max="99" step="1" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="10" />
                </div>
              </label>
            ) : (
              <p className="section-help">{t("menu.setDefaultPricesNote")}</p>
            )}

            <label>
              {t("menu.revenueAllocationLabel")}
              <select value={allocationBasis} onChange={(e) => setAllocationBasis(e.target.value as ComboAllocationBasis)}>
                <option value="equal">{t("menu.allocationEqual")}</option>
                <option value="list_price">{t("menu.allocationListPrice")}</option>
                <option value="cost">{t("menu.allocationCost")}</option>
              </select>
            </label>

            {hasAnyOption ? (
              <div className="combo-summary">
                <div>
                  <span>{t("menu.itemsBoughtSeparately")}</span>
                  <b>{formatMoney({ amount: defaultsTotalMinor, currency }, fmt)}</b>
                </div>
                <div>
                  <span>{t("menu.comboPriceLabel")}</span>
                  <b>{computedPriceMinor !== null && computedPriceMinor > 0 ? formatMoney({ amount: computedPriceMinor, currency }, fmt) : "—"}</b>
                </div>
              </div>
            ) : (
              <p className="section-help summary-hint">{t("menu.addItemsToSeePrice")}</p>
            )}
          </Section>
        </div>
        <div className="drawer-footer">
          <div></div>
          <div className="footer-right">
            {error ? <span className="footer-hint error">{error}</span> : problem ? <span className="footer-hint">{problem}</span> : null}
            <button className="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button className="primary" disabled={Boolean(problem) || saving} onClick={save}>
              {saving ? `${t("common.saving")}…` : existingItem ? t("menu.saveChangesButton") : t("menu.createCombo")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
