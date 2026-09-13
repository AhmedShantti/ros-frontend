"use client";

/**
 * The stock item master, create and edit — SRS §11.2, FR-INV-001 … FR-INV-005.
 *
 * Two stores meet here and the form is honest about which is which:
 *
 *   - **The core** (SKU, names, base unit, costing, tracking, storage, shelf
 *     life, standard cost) goes to `services.inventory.items`. Live, the
 *     backend takes it on create and offers no edit afterwards except a
 *     base-unit change, so on a live item those fields are shown locked with
 *     the reason rather than accepting a change that would go nowhere.
 *   - **The profile** (purchase units, barcodes, allergens, density, account
 *     code, min/max) goes to `services.stockProfiles`, which exists for
 *     exactly the attributes the server has no field for.
 *
 * Reorder point and quantity are neither: they have a real endpoint
 * (`POST /inventory/items/{id}/reorder-config`) and are written through it.
 *
 * FR-INV-002 — the base unit locks the moment a movement exists. The check
 * reads the item's movement ledger; if it cannot be read, the unit stays
 * locked, because "we could not tell" must fail towards not rescaling
 * history.
 */

import { useMemo, useState } from "react";
import { ArrowRightLeft, Lock, Plus, ScanBarcode, Trash2 } from "lucide-react";

import type {
  CostingMethod,
  Id,
  Localised,
  StockItem,
  StockLevel,
  StockLocation,
  StorageRequirement,
  Supplier,
  UnitCode,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  emptyProfile,
  newBarcode,
  newPurchaseUnit,
  type ItemBarcode,
  type LocationPolicy,
  type PurchaseUnit,
  type StockItemProfile,
} from "@/lib/console/services/stock-profiles";
import { ALLERGENS } from "@/lib/console/allergens";
import {
  barcodeProblem,
  convert,
  detectBarcodeKind,
  dimensionOf,
  isPositiveDecimal,
  purchaseToBase,
  toScaled,
  type BarcodeKind,
} from "@/lib/console/stock-units";
import { DATA_MODE } from "@/lib/api/config";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { unitLabel } from "@/lib/console/format";
import { COSTING_METHOD, STORAGE } from "@/lib/console/labels";
import type { ConsoleKey } from "@/locales";
import { EMPTY_LOCALISED, LocalisedField, MoneyInput } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  Drawer,
  Field,
  IconButton,
  Input,
  Select,
  Tabs,
  Toggle,
  cx,
} from "@/components/console/ui";

const UNITS: UnitCode[] = ["g", "kg", "ml", "l", "pc", "dozen", "case", "pack", "tray"];
const BARCODE_KINDS: BarcodeKind[] = ["ean13", "ean8", "upca", "code128", "internal"];

type Section = "general" | "units" | "barcodes" | "allergens" | "levels" | "accounting";

interface CoreDraft {
  name: Localised;
  sku: string;
  category: string;
  baseUnit: UnitCode;
  /** Live create only — the backend keys units by UUID and serves no catalogue. */
  baseUnitId: string;
  costingMethod: CostingMethod;
  storage: StorageRequirement;
  shelfLifeDays: string;
  batchTracked: boolean;
  expiryTracked: boolean;
  standardCostMinor: number | null;
  defaultSupplierId: Id | null;
  active: boolean;
}

function coreOf(item: StockItem | null): CoreDraft {
  return {
    name: item?.name ?? { ...EMPTY_LOCALISED },
    sku: item?.sku ?? "",
    category: item ? item.category.en : "",
    baseUnit: item?.baseUnit ?? "g",
    baseUnitId: item?.baseUnitId ?? "",
    costingMethod: item?.costingMethod ?? "weighted_average",
    storage: item?.storage ?? "ambient",
    shelfLifeDays: item?.shelfLifeDays === null || item?.shelfLifeDays === undefined ? "" : String(item.shelfLifeDays),
    batchTracked: item?.batchTracked ?? false,
    expiryTracked: item?.expiryTracked ?? false,
    standardCostMinor: item ? item.unitCost.amount : null,
    defaultSupplierId: item?.defaultSupplierId ?? null,
    active: item?.active ?? true,
  };
}

interface EditorData {
  profile: StockItemProfile;
  locations: StockLocation[];
  levels: StockLevel[];
  suppliers: Supplier[];
  /** Null while unknown; true when any movement exists for the item. */
  hasMovements: boolean | null;
}

export function StockItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: StockItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();

  const data = useAsync<EditorData>(async () => {
    const [profile, locations, levels, suppliers, movements] = await Promise.all([
      item ? services.stockProfiles.get(item.id) : Promise.resolve(emptyProfile("")),
      services.organisation.locations().catch(() => [] as StockLocation[]),
      item
        ? services.inventory.levels
            .list({ limit: 500 })
            .then((page) => page.rows.filter((row) => row.itemId === item.id))
            .catch(() => [] as StockLevel[])
        : Promise.resolve([] as StockLevel[]),
      services.purchasing.suppliers
        .list({ limit: 300 })
        .then((page) => page.rows)
        .catch(() => [] as Supplier[]),
      item
        ? services.inventory.movements
            .list({ filters: { itemId: item.id }, limit: 1 })
            .then((page) => page.total > 0 || page.rows.length > 0)
            .catch(() => null)
        : Promise.resolve(false),
    ]);
    return { profile, locations, levels, suppliers, hasMovements: movements };
  }, [item?.id]);

  if (!data.data) {
    return (
      <Drawer open onClose={onClose} title={item ? item.sku : t("inv.newItem")}>
        {data.error ? (
          <Callout tone="bad">{data.error.message}</Callout>
        ) : (
          <p className="text-fg-muted text-sm">{t("state.loadingData")}</p>
        )}
      </Drawer>
    );
  }

  return <EditorForm key={item?.id ?? "new"} item={item} data={data.data} onClose={onClose} onSaved={onSaved} />;
}

function EditorForm({
  item,
  data,
  onClose,
  onSaved,
}: {
  item: StockItem | null;
  data: EditorData;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, locale } = useI18n();
  const { can, session, tenant } = useSession();
  const action = useAction();
  const live = DATA_MODE === "http";
  const canManage = can("inventory.item.manage");
  const creating = item === null;

  const [section, setSection] = useState<Section>("general");
  const [core, setCore] = useState<CoreDraft>(() => coreOf(item));
  const [profile, setProfile] = useState<StockItemProfile>(() => ({
    ...data.profile,
    allergens: data.profile.allergens.length > 0 ? data.profile.allergens : (item?.allergens ?? []),
    categoryPath: data.profile.categoryPath.length > 0 ? data.profile.categoryPath : item ? [item.category.en] : [],
  }));
  const [policies, setPolicies] = useState<LocationPolicy[]>(() =>
    data.locations.map((location) => {
      const saved = data.profile.locationPolicies.find((row) => row.locationId === location.id);
      const level = data.levels.find((row) => row.locationId === location.id);
      return {
        locationId: location.id,
        minimum: saved?.minimum ?? "",
        maximum: saved?.maximum ?? "",
        reorderPoint: saved?.reorderPoint ?? (level && level.reorderPoint > 0 ? String(level.reorderPoint) : ""),
        reorderQuantity: saved?.reorderQuantity ?? (level && level.reorderQuantity > 0 ? String(level.reorderQuantity) : ""),
      };
    }),
  );
  const [scan, setScan] = useState("");

  const setC = (patch: Partial<CoreDraft>) => setCore((current) => ({ ...current, ...patch }));
  const setP = (patch: Partial<StockItemProfile>) => setProfile((current) => ({ ...current, ...patch }));

  // FR-INV-002 — unknown counts as locked.
  const baseLocked = !creating && data.hasMovements !== false;
  // Live, the core is create-only (no PATCH on the backend).
  const coreLocked = !canManage || (!creating && live);

  // ---------------------------------------------------------------- problems
  const problems = useMemo(() => {
    const out: { section: Section; message: string }[] = [];
    if (!core.name.en.trim() && !core.name.ar.trim()) out.push({ section: "general", message: t("loc.bothEmpty") });
    if (!core.sku.trim()) out.push({ section: "general", message: t("inv.skuRequired") });
    if (creating && live && !core.baseUnitId.trim()) out.push({ section: "units", message: t("inv.baseUnitIdRequired") });
    if (core.shelfLifeDays.trim() && !/^\d+$/.test(core.shelfLifeDays.trim())) {
      out.push({ section: "general", message: t("inv.shelfLifeInvalid") });
    }
    if (core.expiryTracked && !core.shelfLifeDays.trim()) {
      out.push({ section: "general", message: t("inv.shelfLifeNeeded") });
    }
    if (core.costingMethod === "standard" && (core.standardCostMinor === null || core.standardCostMinor <= 0)) {
      out.push({ section: "general", message: t("inv.standardCostNeeded") });
    }
    for (const unit of profile.purchaseUnits) {
      if (!isPositiveDecimal(unit.conversion)) {
        out.push({ section: "units", message: t("inv.conversionInvalid").replace("{unit}", unitLabel(unit.unit, locale)) });
      }
    }
    if (profile.densityGPerMl && !isPositiveDecimal(profile.densityGPerMl)) {
      out.push({ section: "units", message: t("inv.densityInvalid") });
    }
    const codes = new Set<string>();
    for (const barcode of profile.barcodes) {
      const problem = barcodeProblem(barcode.code, barcode.kind);
      if (problem) {
        out.push({ section: "barcodes", message: `${barcode.code || "—"}: ${t(`inv.barcode.${problem}` as ConsoleKey)}` });
      }
      if (codes.has(barcode.code.trim())) out.push({ section: "barcodes", message: t("inv.barcodeDuplicate").replace("{code}", barcode.code) });
      codes.add(barcode.code.trim());
    }
    for (const policy of policies) {
      const min = policy.minimum ? toScaled(policy.minimum) : null;
      const max = policy.maximum ? toScaled(policy.maximum) : null;
      const bad = [policy.minimum, policy.maximum, policy.reorderPoint, policy.reorderQuantity].some(
        (value) => value.trim() !== "" && toScaled(value) === null,
      );
      const location = data.locations.find((row) => row.id === policy.locationId);
      if (bad) out.push({ section: "levels", message: t("inv.policyNumber").replace("{location}", tx(location?.name)) });
      else if (min !== null && max !== null && min > max) {
        out.push({ section: "levels", message: t("inv.minAboveMax").replace("{location}", tx(location?.name)) });
      }
    }
    return out;
  }, [core, profile, policies, creating, live, locale, t, tx, data.locations]);

  // -------------------------------------------------------------------- save
  async function save() {
    await action.run(
      async () => {
        const categoryPath = core.category
          .split(">")
          .map((part) => part.trim())
          .filter(Boolean);
        const leaf = categoryPath.at(-1) ?? "";

        let saved: StockItem;
        if (creating) {
          saved = await services.inventory.items.create({
            sku: core.sku.trim(),
            name: core.name,
            category: { en: leaf, ar: leaf },
            baseUnit: (live ? core.baseUnitId.trim() : core.baseUnit) as UnitCode,
            costingMethod: core.costingMethod,
            storage: core.storage,
            shelfLifeDays: core.shelfLifeDays.trim() ? Number(core.shelfLifeDays) : null,
            batchTracked: core.batchTracked,
            expiryTracked: core.expiryTracked,
            unitCost:
              core.standardCostMinor !== null
                ? { amount: core.standardCostMinor, currency: tenant.baseCurrency }
                : undefined,
            defaultSupplierId: core.defaultSupplierId,
            allergens: profile.allergens,
            purchaseUnit: profile.purchaseUnits.find((row) => row.isDefault)?.unit ?? core.baseUnit,
            purchaseConversion: Number(profile.purchaseUnits.find((row) => row.isDefault)?.conversion ?? 1),
          });
        } else if (!live && canManage) {
          const patch: Partial<StockItem> = {
            name: core.name,
            sku: core.sku.trim(),
            category: { en: leaf, ar: leaf },
            costingMethod: core.costingMethod,
            storage: core.storage,
            shelfLifeDays: core.shelfLifeDays.trim() ? Number(core.shelfLifeDays) : null,
            batchTracked: core.batchTracked,
            expiryTracked: core.expiryTracked,
            unitCost: { amount: core.standardCostMinor ?? 0, currency: item!.unitCost.currency },
            defaultSupplierId: core.defaultSupplierId,
            active: core.active,
            allergens: profile.allergens,
            purchaseUnit: profile.purchaseUnits.find((row) => row.isDefault)?.unit ?? item!.purchaseUnit,
            purchaseConversion: Number(
              profile.purchaseUnits.find((row) => row.isDefault)?.conversion ?? item!.purchaseConversion,
            ),
          };
          if (!baseLocked && core.baseUnit !== item!.baseUnit) patch.baseUnit = core.baseUnit;
          saved = await services.inventory.items.update(item!.id, patch);
        } else if (live && canManage && !baseLocked && core.baseUnitId.trim() && core.baseUnitId.trim() !== item!.baseUnitId) {
          saved = await services.inventory.items.update(item!.id, { baseUnit: core.baseUnitId.trim() as UnitCode });
        } else {
          saved = item!;
        }

        // Reorder point / quantity — the real endpoint, only where changed.
        const previous = new Map(data.profile.locationPolicies.map((row) => [row.locationId, row]));
        for (const policy of policies) {
          if (!policy.reorderPoint.trim() || !policy.reorderQuantity.trim()) continue;
          const before = previous.get(policy.locationId);
          const level = data.levels.find((row) => row.locationId === policy.locationId);
          const unchanged =
            (before && before.reorderPoint === policy.reorderPoint && before.reorderQuantity === policy.reorderQuantity) ||
            (!before && level && String(level.reorderPoint) === policy.reorderPoint && String(level.reorderQuantity) === policy.reorderQuantity);
          if (unchanged) continue;
          await services.inventory.setReorderConfig(saved.id, {
            locationId: policy.locationId,
            reorderPoint: policy.reorderPoint.trim(),
            reorderQuantity: policy.reorderQuantity.trim(),
          });
        }

        await services.stockProfiles.save({
          ...profile,
          itemId: saved.id,
          categoryPath,
          locationPolicies: policies.filter(
            (row) => row.minimum || row.maximum || row.reorderPoint || row.reorderQuantity,
          ),
          updatedBy: session?.user.email ?? null,
        });
        return saved;
      },
      { onSuccess: () => onSaved(creating ? t("inv.itemCreated") : t("inv.itemSaved")) },
    );
  }

  const sectionProblems = (id: Section) => problems.filter((row) => row.section === id).length;

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? t("inv.newItem") : tx(item!.name)}
      subtitle={
        creating ? undefined : (
          <span className="font-mono text-xs" dir="ltr">
            {item!.sku}
          </span>
        )
      }
      footer={
        canManage ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
              {creating ? t("common.create") : t("common.save")}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!canManage ? <Callout tone="muted">{t("inv.readOnlyMaster")}</Callout> : null}
        {!creating && live && canManage ? <Callout tone="warn">{t("inv.liveCoreLocked")}</Callout> : null}

        <Tabs<Section>
          value={section}
          onChange={setSection}
          label={t("inv.itemsTitle")}
          options={(["general", "units", "barcodes", "allergens", "levels", "accounting"] as Section[]).map((id) => ({
            value: id,
            label: t(`inv.section.${id}` as ConsoleKey),
            count: sectionProblems(id) > 0 ? sectionProblems(id) : undefined,
          }))}
        />

        {problems.length > 0 && canManage ? (
          <Callout tone="warn">
            <ul className="list-disc space-y-0.5 ps-4">
              {problems.slice(0, 5).map((row) => (
                <li key={row.message}>{row.message}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <fieldset disabled={!canManage} className="space-y-4">
          {section === "general" ? (
            <GeneralSection core={core} setC={setC} locked={coreLocked} suppliers={data.suppliers} currency={tenant.baseCurrency} />
          ) : null}

          {section === "units" ? (
            <UnitsSection
              core={core}
              setC={setC}
              profile={profile}
              setP={setP}
              creating={creating}
              live={live}
              baseLocked={baseLocked}
              movementsKnown={data.hasMovements !== null}
              suppliers={data.suppliers}
            />
          ) : null}

          {section === "barcodes" ? (
            <BarcodesSection profile={profile} setP={setP} suppliers={data.suppliers} scan={scan} setScan={setScan} />
          ) : null}

          {section === "allergens" ? (
            <div className="space-y-3">
              <p className="text-fg-muted text-xs leading-relaxed">{t("inv.allergensHint")}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {ALLERGENS.map((allergen) => {
                  const on = profile.allergens.includes(allergen.code);
                  return (
                    <button
                      key={allergen.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setP({
                          allergens: on
                            ? profile.allergens.filter((code) => code !== allergen.code)
                            : [...profile.allergens, allergen.code],
                        })
                      }
                      className={cx(
                        "rounded-lg border px-3 py-2 text-start text-sm transition-colors",
                        on ? "border-warn bg-warn-soft text-warn font-medium" : "border-line bg-raised text-fg-muted hover:text-fg",
                      )}
                    >
                      {tx(allergen.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {section === "levels" ? (
            <LevelsSection
              policies={policies}
              setPolicies={setPolicies}
              locations={data.locations}
              baseUnit={core.baseUnit}
            />
          ) : null}

          {section === "accounting" ? (
            <div className="space-y-4">
              <Field label={t("inv.accountCode")} hint={t("inv.accountCodeHint")}>
                <Input dir="ltr" value={profile.accountCode} maxLength={40} onChange={(event) => setP({ accountCode: event.target.value })} className="font-mono" />
              </Field>
              <Toggle
                checked={profile.sellableDirectly}
                onChange={(next) => setP({ sellableDirectly: next })}
                label={t("inv.sellableDirectly")}
                hint={t("inv.sellableDirectlyHint")}
              />
              <Toggle
                checked={profile.produced}
                onChange={(next) => setP({ produced: next })}
                label={t("inv.produced")}
                hint={t("inv.producedHint")}
              />
              {!creating && !live ? (
                <Toggle checked={core.active} onChange={(next) => setC({ active: next })} label={t("common.active")} />
              ) : null}
            </div>
          ) : null}
        </fieldset>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function GeneralSection({
  core,
  setC,
  locked,
  suppliers,
  currency,
}: {
  core: CoreDraft;
  setC: (patch: Partial<CoreDraft>) => void;
  locked: boolean;
  suppliers: Supplier[];
  currency: StockItem["unitCost"]["currency"];
}) {
  const { t, tx } = useI18n();
  return (
    <fieldset disabled={locked} className="space-y-4">
      <LocalisedField label={t("common.name")} value={core.name} onChange={(name) => setC({ name })} required maxLength={120} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("inv.sku")} required hint={t("inv.skuHint")}>
          <Input dir="ltr" value={core.sku} maxLength={40} onChange={(event) => setC({ sku: event.target.value })} className="font-mono" />
        </Field>
        <Field label={t("common.category")} hint={t("inv.categoryPathHint")}>
          <Input value={core.category} maxLength={120} onChange={(event) => setC({ category: event.target.value })} placeholder="Food > Protein > Poultry" />
        </Field>
        <Field label={t("inv.costingMethod")}>
          <Select value={core.costingMethod} onChange={(event) => setC({ costingMethod: event.target.value as CostingMethod })}>
            {Object.entries(COSTING_METHOD).map(([value, entry]) => (
              <option key={value} value={value}>
                {tx(entry.label)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={core.costingMethod === "standard" ? t("inv.standardCost") : t("inv.unitCost")} hint={core.costingMethod === "standard" ? t("inv.standardCostHint") : undefined}>
          <MoneyInput value={core.standardCostMinor} currency={currency} onChange={(minor) => setC({ standardCostMinor: minor })} />
        </Field>
        <Field label={t("inv.storage")} hint={t("inv.storageHint")}>
          <Select value={core.storage} onChange={(event) => setC({ storage: event.target.value as StorageRequirement })}>
            {Object.entries(STORAGE).map(([value, entry]) => (
              <option key={value} value={value}>
                {tx(entry.label)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("inv.shelfLife")} hint={t("inv.shelfLifeHint")}>
          <Input dir="ltr" inputMode="numeric" value={core.shelfLifeDays} onChange={(event) => setC({ shelfLifeDays: event.target.value })} className="font-mono" />
        </Field>
      </div>
      <Toggle checked={core.batchTracked} onChange={(next) => setC({ batchTracked: next })} label={t("inv.batchTracked")} hint={t("inv.batchTrackedHint")} />
      <Toggle checked={core.expiryTracked} onChange={(next) => setC({ expiryTracked: next })} label={t("inv.expiryTracked")} hint={t("inv.expiryTrackedHint")} />
      <Field label={t("inv.defaultSupplier")}>
        <Select value={core.defaultSupplierId ?? ""} onChange={(event) => setC({ defaultSupplierId: event.target.value || null })}>
          <option value="">{t("common.none")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {tx(supplier.tradingName)}
            </option>
          ))}
        </Select>
      </Field>
    </fieldset>
  );
}

function UnitsSection({
  core,
  setC,
  profile,
  setP,
  creating,
  live,
  baseLocked,
  movementsKnown,
  suppliers,
}: {
  core: CoreDraft;
  setC: (patch: Partial<CoreDraft>) => void;
  profile: StockItemProfile;
  setP: (patch: Partial<StockItemProfile>) => void;
  creating: boolean;
  live: boolean;
  baseLocked: boolean;
  movementsKnown: boolean;
  suppliers: Supplier[];
}) {
  const { t, tx, locale } = useI18n();
  const [tryValue, setTryValue] = useState("1");
  const [tryFrom, setTryFrom] = useState<UnitCode>("l");
  const [tryTo, setTryTo] = useState<UnitCode>("kg");

  const base = core.baseUnit;
  const result = convert(tryValue, tryFrom, tryTo, profile.densityGPerMl);

  function updateUnit(id: Id, patch: Partial<PurchaseUnit>) {
    setP({
      purchaseUnits: profile.purchaseUnits.map((row) =>
        row.id === id ? { ...row, ...patch } : patch.isDefault ? { ...row, isDefault: false } : row,
      ),
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {live && creating ? (
          <Field label={t("inv.baseUnitId")} hint={t("inv.baseUnitIdHint")} required>
            <Input dir="ltr" value={core.baseUnitId} onChange={(event) => setC({ baseUnitId: event.target.value })} className="font-mono text-xs" />
          </Field>
        ) : live ? (
          <Field label={t("inv.baseUnit")} hint={baseLocked ? undefined : t("inv.baseUnitIdHint")}>
            <Input
              dir="ltr"
              value={core.baseUnitId}
              disabled={baseLocked}
              onChange={(event) => setC({ baseUnitId: event.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        ) : (
          <Field label={t("inv.baseUnit")}>
            <Select value={base} disabled={baseLocked} onChange={(event) => setC({ baseUnit: event.target.value as UnitCode })}>
              {UNITS.filter((unit) => unit !== "case" && unit !== "pack" && unit !== "tray").map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit, locale)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {baseLocked ? (
          <Callout tone="warn" icon={<Lock size={14} />}>
            {movementsKnown ? t("inv.baseLocked") : t("inv.baseLockedUnknown")}
          </Callout>
        ) : (
          <p className="text-fg-subtle text-xs">{t("inv.baseUnitNote")}</p>
        )}

        <Field label={t("inv.recipeUnit")} hint={t("inv.recipeUnitHint")}>
          <Select
            value={profile.recipeUnit ?? ""}
            onChange={(event) => setP({ recipeUnit: (event.target.value || null) as UnitCode | null })}
          >
            <option value="">{t("inv.sameAsBase")}</option>
            {UNITS.filter((unit) => dimensionOf(unit) === dimensionOf(base) && unit !== base).map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-fg text-sm font-semibold">{t("inv.purchaseUnits")}</h3>
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setP({ purchaseUnits: [...profile.purchaseUnits, { ...newPurchaseUnit(), isDefault: profile.purchaseUnits.length === 0 }] })}>
            {t("inv.addPurchaseUnit")}
          </Button>
        </div>
        <p className="text-fg-subtle text-xs">{t("inv.purchaseUnitsHint")}</p>
        {profile.purchaseUnits.length === 0 ? (
          <p className="border-line text-fg-subtle rounded-lg border border-dashed p-3 text-center text-xs">{t("inv.noPurchaseUnits")}</p>
        ) : (
          <ul className="space-y-2">
            {profile.purchaseUnits.map((unit) => {
              const holds = purchaseToBase("1", unit.conversion);
              return (
                <li key={unit.id} className="border-line bg-sunken/40 space-y-2 rounded-lg border p-3">
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-end gap-2">
                    <Field label={t("inv.unit")}>
                      <Select value={unit.unit} onChange={(event) => updateUnit(unit.id, { unit: event.target.value as UnitCode })}>
                        {UNITS.map((code) => (
                          <option key={code} value={code}>
                            {unitLabel(code, locale)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("inv.holds").replace("{unit}", unitLabel(base, locale))}>
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        value={unit.conversion}
                        onChange={(event) => updateUnit(unit.id, { conversion: event.target.value })}
                        className="font-mono tabular-nums"
                      />
                    </Field>
                    <IconButton
                      label={t("common.remove")}
                      icon={<Trash2 size={14} />}
                      onClick={() => setP({ purchaseUnits: profile.purchaseUnits.filter((row) => row.id !== unit.id) })}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={t("inv.supplier")}>
                      <Select value={unit.supplierId ?? ""} onChange={(event) => updateUnit(unit.id, { supplierId: event.target.value || null })}>
                        <option value="">{t("inv.anySupplier")}</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {tx(supplier.tradingName)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("inv.supplierCode")} hint={t("inv.supplierCodeHint")}>
                      <Input dir="ltr" value={unit.supplierCode} maxLength={40} onChange={(event) => updateUnit(unit.id, { supplierCode: event.target.value })} className="font-mono text-xs" />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-fg-muted text-xs" dir="ltr">
                      {holds && isPositiveDecimal(unit.conversion)
                        ? `1 ${unitLabel(unit.unit, locale)} = ${holds} ${unitLabel(base, locale)}`
                        : "—"}
                    </span>
                    <label className="text-fg-muted flex items-center gap-1.5 text-xs">
                      <input
                        type="radio"
                        name="default-purchase-unit"
                        checked={unit.isDefault}
                        onChange={() => updateUnit(unit.id, { isDefault: true })}
                        className="accent-accent"
                      />
                      {t("inv.defaultPurchaseUnit")}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="border-line space-y-3 rounded-lg border p-3">
        <h3 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
          <ArrowRightLeft size={14} aria-hidden /> {t("inv.density")}
        </h3>
        <Field label={t("inv.densityLabel")} hint={t("inv.densityHint")}>
          <Input
            dir="ltr"
            inputMode="decimal"
            value={profile.densityGPerMl ?? ""}
            onChange={(event) => setP({ densityGPerMl: event.target.value.trim() ? event.target.value : null })}
            placeholder="0.92"
            className="font-mono tabular-nums"
          />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-end gap-2">
          <Field label={t("inv.tryConvert")}>
            <Input dir="ltr" inputMode="decimal" value={tryValue} onChange={(event) => setTryValue(event.target.value)} className="font-mono" />
          </Field>
          <Select aria-label={t("range.from")} value={tryFrom} onChange={(event) => setTryFrom(event.target.value as UnitCode)}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit, locale)}
              </option>
            ))}
          </Select>
          <Select aria-label={t("range.to")} value={tryTo} onChange={(event) => setTryTo(event.target.value as UnitCode)}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit, locale)}
              </option>
            ))}
          </Select>
        </div>
        {result.ok ? (
          <p className="text-fg font-mono text-sm tabular-nums" dir="ltr">
            = {result.value} {unitLabel(tryTo, locale)}
          </p>
        ) : (
          <Callout tone={result.reason === "no_density" ? "warn" : "muted"}>
            {t(`inv.convert.${result.reason}` as ConsoleKey)}
          </Callout>
        )}
      </section>
    </div>
  );
}

function BarcodesSection({
  profile,
  setP,
  suppliers,
  scan,
  setScan,
}: {
  profile: StockItemProfile;
  setP: (patch: Partial<StockItemProfile>) => void;
  suppliers: Supplier[];
  scan: string;
  setScan: (value: string) => void;
}) {
  const { t, tx, locale } = useI18n();

  function update(id: Id, patch: Partial<ItemBarcode>) {
    setP({ barcodes: profile.barcodes.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  }

  function addScanned() {
    const code = scan.trim();
    if (!code) return;
    setP({ barcodes: [...profile.barcodes, { ...newBarcode(code), kind: detectBarcodeKind(code) }] });
    setScan("");
  }

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-xs leading-relaxed">{t("inv.barcodesHint")}</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode size={14} aria-hidden className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3" />
          <Input
            dir="ltr"
            value={scan}
            onChange={(event) => setScan(event.target.value)}
            onKeyDown={(event) => {
              // Scanners type the code and press Enter; so should people.
              if (event.key === "Enter") {
                event.preventDefault();
                addScanned();
              }
            }}
            placeholder={t("inv.scanPlaceholder")}
            aria-label={t("inv.scanPlaceholder")}
            className="ps-9 font-mono"
          />
        </div>
        <Button icon={<Plus size={13} />} onClick={addScanned} disabled={!scan.trim()}>
          {t("common.add")}
        </Button>
      </div>

      {profile.barcodes.length === 0 ? (
        <p className="border-line text-fg-subtle rounded-lg border border-dashed p-3 text-center text-xs">{t("inv.noBarcodes")}</p>
      ) : (
        <ul className="space-y-2">
          {profile.barcodes.map((barcode) => {
            const problem = barcodeProblem(barcode.code, barcode.kind);
            return (
              <li key={barcode.id} className="border-line bg-sunken/40 space-y-2 rounded-lg border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2">
                  <Field label={t("inv.barcodeCode")} error={problem ? t(`inv.barcode.${problem}` as ConsoleKey) : null}>
                    <Input dir="ltr" value={barcode.code} onChange={(event) => update(barcode.id, { code: event.target.value })} className="font-mono" />
                  </Field>
                  <Field label={t("inv.barcodeKind")}>
                    <Select value={barcode.kind} onChange={(event) => update(barcode.id, { kind: event.target.value as BarcodeKind })}>
                      {BARCODE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`inv.barcodeKind.${kind}` as ConsoleKey)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <IconButton
                    label={t("common.remove")}
                    icon={<Trash2 size={14} />}
                    onClick={() => setP({ barcodes: profile.barcodes.filter((row) => row.id !== barcode.id) })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={t("inv.barcodeOwner")}>
                    <Select value={barcode.supplierId ?? ""} onChange={(event) => update(barcode.id, { supplierId: event.target.value || null })}>
                      <option value="">{t("inv.ownBarcode")}</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {tx(supplier.tradingName)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("inv.identifies")}>
                    <Select value={barcode.purchaseUnitId ?? ""} onChange={(event) => update(barcode.id, { purchaseUnitId: event.target.value || null })}>
                      <option value="">{t("inv.singleUnit")}</option>
                      {profile.purchaseUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {`${unitLabel(unit.unit, locale)} × ${unit.conversion || "?"}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LevelsSection({
  policies,
  setPolicies,
  locations,
  baseUnit,
}: {
  policies: LocationPolicy[];
  setPolicies: (next: LocationPolicy[]) => void;
  locations: StockLocation[];
  baseUnit: UnitCode;
}) {
  const { t, tx, locale } = useI18n();

  if (locations.length === 0) {
    return <Callout tone="muted">{t("inv.noLocations")}</Callout>;
  }

  function update(locationId: Id, patch: Partial<LocationPolicy>) {
    setPolicies(policies.map((row) => (row.locationId === locationId ? { ...row, ...patch } : row)));
  }

  const cell = (policy: LocationPolicy, key: keyof Omit<LocationPolicy, "locationId">, label: string) => (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={label}
      value={policy[key]}
      onChange={(event) => update(policy.locationId, { [key]: event.target.value })}
      className="px-2 py-1.5 text-end font-mono text-xs tabular-nums"
    />
  );

  return (
    <div className="space-y-3">
      <p className="text-fg-muted text-xs leading-relaxed">
        {t("inv.levelsHint").replace("{unit}", unitLabel(baseUnit, locale))}
      </p>
      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-sunken/60">
            <tr>
              <th className="text-fg-muted px-2 py-2 text-start font-medium">{t("inv.location")}</th>
              <th className="text-fg-muted px-2 py-2 text-end font-medium">{t("inv.minimum")}</th>
              <th className="text-fg-muted px-2 py-2 text-end font-medium">{t("inv.maximum")}</th>
              <th className="text-fg-muted px-2 py-2 text-end font-medium">{t("inv.reorderPoint")}</th>
              <th className="text-fg-muted px-2 py-2 text-end font-medium">{t("inv.reorderQty")}</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {policies.map((policy) => {
              const location = locations.find((row) => row.id === policy.locationId);
              return (
                <tr key={policy.locationId}>
                  <td className="px-2 py-1.5">
                    <span className="text-fg block">{tx(location?.name)}</span>
                    <Badge tone="muted">{location?.kind}</Badge>
                  </td>
                  <td className="w-24 px-1 py-1.5">{cell(policy, "minimum", t("inv.minimum"))}</td>
                  <td className="w-24 px-1 py-1.5">{cell(policy, "maximum", t("inv.maximum"))}</td>
                  <td className="w-24 px-1 py-1.5">{cell(policy, "reorderPoint", t("inv.reorderPoint"))}</td>
                  <td className="w-24 px-1 py-1.5">{cell(policy, "reorderQuantity", t("inv.reorderQty"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-fg-subtle text-xs">{t("inv.reorderIsLive")}</p>
    </div>
  );
}
