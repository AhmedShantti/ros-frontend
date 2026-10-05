"use client";

/**
 * Stock items — SRS §11.2.
 *
 * The item master, as opposed to the balances in /inventory/levels. An item
 * here is a definition: what it is, how it is measured, how it is costed and
 * how it is stored.
 *
 * The base unit is the one field that cannot be changed once any movement
 * exists (BR-INV-002). Every quantity in the ledger is denominated in it, so
 * changing it would silently rescale history. The purchase unit is separate
 * and carries a conversion — suppliers sell cases, kitchens consume grams.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PurchaseUnit, StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, unitLabel } from "@/lib/console/format";
import { COSTING_METHOD, STORAGE, labelOf } from "@/lib/console/labels";
import { supplierById } from "@/lib/console/mock/purchasing";
import { DATA_MODE } from "@/lib/api/config";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ErrorPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
} from "@/components/console/ui";
import { RecordDrawer } from "@/components/console/record-drawer";
import { useAction } from "@/lib/console/actions";

export default function StockItemsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <StockItemsScreen />
    </Gate>
  );
}

export function StockItemsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<StockItem>(
    (query) => services.inventory.items.list(query),
    { scope, initialSort: "sku", pageSize: 25 },
  );

  // FR-INV-001 — the unit catalogue the "New stock item" drawer picks a base
  // unit from. Creation stays disabled until this has loaded successfully
  // with at least one row: there is no UUID text field to fall back to.
  const uomsQuery = useAsync(() => services.inventory.unitsOfMeasure(), []);
  const uoms = useMemo(() => uomsQuery.data ?? [], [uomsQuery.data]);
  const uomOptions = useMemo(
    () => uoms.map((uom) => ({ value: uom.id, label: uom.name })),
    [uoms],
  );
  const canCreateItem = !uomsQuery.loading && !uomsQuery.error && uoms.length > 0;

  // Categories come from the loaded rows rather than a fixed list, so a new
  // category appears in the filter the moment an item uses it. Reading the
  // fixtures here offered categories no live item belongs to.
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of collection.rows) {
      if (!seen.has(item.category.en)) seen.set(item.category.en, tx(item.category));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [collection.rows, tx]);

  // FR-INV-001 — the category catalogue a stock item's categoryId is chosen
  // from and, on read, resolved back to a name against — client-side, since
  // the backend never joins a category's name onto a stock item row.
  const categoriesQuery = useAsync(() => services.inventory.categories(), []);
  const categoryList = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const categoryOptions = useMemo(
    () => categoryList.map((c) => ({ value: c.id, label: c.name })),
    [categoryList],
  );
  const categoryNameById = useMemo(
    () => new Map(categoryList.map((c) => [c.id, c.name])),
    [categoryList],
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      batchTracked: rows.filter((row) => row.batchTracked).length,
      inactive: rows.filter((row) => !row.active).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<StockItem>[]>(
    () => [
      {
        key: "sku",
        header: t("inv.sku"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={<span className="font-mono">{row.sku}</span>}
          />
        ),
      },
      {
        key: "category",
        header: t("common.category"),
        secondary: true,
        render: (row) => (
          <span className="text-fg-muted text-xs">
            {row.categoryId
              ? (categoryNameById.get(row.categoryId) ?? t("common.unknown"))
              : t("common.uncategorised")}
          </span>
        ),
      },
      {
        key: "baseUnit",
        header: t("inv.baseUnit"),
        render: (row) => (
          <span className="font-mono text-xs">{unitLabel(row.baseUnit, fmt.locale)}</span>
        ),
      },
      {
        key: "storage",
        header: t("inv.storage"),
        render: (row) => {
          const storage = labelOf(STORAGE, row.storage);
          return <Badge tone={storage.tone}>{tx(storage.label)}</Badge>;
        },
      },
      {
        key: "unitCost",
        header: t("inv.unitCost"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.unitCost, fmt),
      },
      {
        key: "tracking",
        header: t("inv.batchTracked"),
        secondary: true,
        render: (row) => (
          <span className="flex flex-wrap gap-1">
            {row.batchTracked ? <Badge tone="accent">{t("inv.batchTracked")}</Badge> : null}
            {row.expiryTracked ? <Badge tone="warn">{t("inv.expiryTracked")}</Badge> : null}
            {!row.batchTracked && !row.expiryTracked ? (
              <span className="text-fg-subtle">—</span>
            ) : null}
          </span>
        ),
      },
    ],
    [t, tx, fmt, categoryNameById],
  );

  return (
    <>
      <PageHeader
        title={t("inv.itemsTitle")}
        subtitle={t("inv.itemsSubtitle")}
        spec="FR-INV-001"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            loading={uomsQuery.loading}
            disabled={!canCreateItem}
            onClick={() => setCreating(true)}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        {uomsQuery.error ? (
          <ErrorPanel error={uomsQuery.error} onRetry={uomsQuery.reload} compact />
        ) : !uomsQuery.loading && uoms.length === 0 ? (
          <Callout tone="warn">{t("inv.noUnitsConfigured")}</Callout>
        ) : null}

        <TileGrid columns={3}>
          <MetricTile label={t("inv.itemsTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("inv.batchTracked")}
            value={formatNumber(totals.batchTracked, fmt)}
          />
          <MetricTile label={t("common.inactive")} value={formatNumber(totals.inactive, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("inv.searchPlaceholder")}
          filters={[
            { key: "category", label: t("common.category"), options: categories },
            {
              key: "storage",
              label: t("inv.storage"),
              options: Object.entries(STORAGE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "costingMethod",
              label: t("inv.costingMethod"),
              options: Object.entries(COSTING_METHOD).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "batchTracked",
              label: t("inv.batchTracked"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("inv.itemsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ItemDrawer
        item={selected}
        categoryNameById={categoryNameById}
        onClose={() => setSelected(null)}
        onMessage={setMessage}
      />
      <RecordDrawer
        open={creating}
        title={t("inv.newItem")}
        note={t("inv.newItemUnitNote")}
        fields={[
          { name: "name", label: t("common.name"), required: true, maxLength: 120 },
          { name: "sku", label: t("inv.sku"), required: true, maxLength: 40, ltr: true },
          {
            name: "baseUnitId",
            label: t("inv.baseUnit"),
            kind: "select",
            required: true,
            options: uomOptions,
          },
          {
            name: "costingMethod",
            label: t("inv.costingMethod"),
            kind: "select",
            required: true,
            options: [
              { value: "weighted_average", label: t("inv.costingWeighted") },
              { value: "fifo", label: t("inv.costingFifo") },
              { value: "standard", label: t("inv.costingStandard") },
            ],
          },
          {
            // FR-INV-001 — optional: a stock item is valid with no category.
            // `initial` is forced to "" — a `select` field otherwise defaults
            // to its first option, which would silently assign a category
            // nobody chose.
            name: "categoryId",
            label: t("common.category"),
            kind: "select",
            initial: "",
            options: categoryOptions,
          },
          {
            // D-INV-03 / ck_standard_cost_present — standard costing needs a
            // declared cost up front; only shown (and only required) when
            // that method is selected, so weighted_average/fifo are unaffected.
            name: "standardCost",
            label: t("inv.standardCost"),
            kind: "money",
            required: true,
            visibleWhen: (all) => all.costingMethod === "standard",
          },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.inventory.items.create({
            name: { en: values.name.trim(), ar: values.name.trim() },
            sku: values.sku.trim(),
            baseUnitId: values.baseUnitId,
            categoryId: values.categoryId ? values.categoryId : null,
            costingMethod: values.costingMethod as never,
            // Only sent for standard costing — switching away from Standard
            // never carries a stale cost into the request. `standardCost` is
            // the money field's own minor-unit integer string, passed
            // through exactly as RecordDrawer produced it — never re-parsed
            // through a JS Number, so it can never lose precision (the wire
            // contract accepts up to 18 digits, well past
            // Number.MAX_SAFE_INTEGER). `as never` smuggles it past
            // Partial<StockItem>, same as `costingMethod` above; it is not a
            // StockItem field, only a create-time-only write.
            ...(values.costingMethod === "standard"
              ? { standardCost: values.standardCost as never }
              : {}),
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("inv.itemCreated"));
          collection.reload();
        }}
      >
        <InlineCategoryCreate
          options={categoryOptions}
          onCreated={() => categoriesQuery.reload()}
        />
      </RecordDrawer>

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-001 — the minimum write path a stock item's category needs: a name
 * and an optional parent, nothing else. Not a category management page —
 * there is no rename/re-parent/delete here, only enough to make a category
 * exist so the "New stock item" drawer's category select is not permanently
 * empty on a fresh tenant.
 */
function InlineCategoryCreate({
  options,
  onCreated,
}: {
  options: { value: string; label: string }[];
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {t("inv.addCategory")}
      </Button>
    );
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await action.run(
      () => services.inventory.createCategory({ name: trimmed, parentId: parentId || undefined }),
      {
        onSuccess: () => {
          setName("");
          setParentId("");
          setOpen(false);
          onCreated();
        },
      },
    );
  }

  return (
    <div className="border-line space-y-2 rounded-lg border p-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Field label={t("inv.categoryName")} required>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Field>
      {options.length > 0 ? (
        <Field label={t("inv.parentCategory")}>
          <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={action.pending}
          disabled={!name.trim()}
          onClick={create}
        >
          {t("inv.addCategory")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

function ItemDrawer({
  item,
  categoryNameById,
  onClose,
  onMessage,
}: {
  item: StockItem | null;
  categoryNameById: Map<string, string>;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!item) return null;

  const categoryName = item.categoryId
    ? (categoryNameById.get(item.categoryId) ?? t("common.unknown"))
    : t("common.uncategorised");

  const storage = labelOf(STORAGE, item.storage);
  const costing = labelOf(COSTING_METHOD, item.costingMethod);
  /*
   * Purchasing has no endpoint on this backend, so there is no directory to
   * resolve a supplier id against. In demo mode the fixture is the record
   * and naming the supplier is correct; live, the id is all that is known,
   * and printing a fixture's trading name beside it would attach a real
   * item to a supplier that does not exist in the tenant.
   */
  const supplier =
    DATA_MODE === "http" || !item.defaultSupplierId
      ? null
      : (supplierById.get(item.defaultSupplierId) ?? null);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(item.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {item.sku}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.category")}>{categoryName}</DescRow>
          <DescRow label={t("inv.baseUnit")} mono>
            {unitLabel(item.baseUnit, fmt.locale)}
          </DescRow>
          <DescRow label={t("inv.costingMethod")}>
            <Badge tone={costing.tone}>{tx(costing.label)}</Badge>
          </DescRow>
          <DescRow label={t("inv.unitCost")} mono>
            {formatMoney(item.unitCost, fmt)}
          </DescRow>
          <DescRow label={t("inv.storage")}>
            <Badge tone={storage.tone}>{tx(storage.label)}</Badge>
          </DescRow>
          <DescRow label={t("inv.shelfLife")} mono>
            {item.shelfLifeDays === null
              ? "—"
              : `${formatNumber(item.shelfLifeDays, fmt)} ${t("inv.days")}`}
          </DescRow>
          <DescRow label={t("inv.batchTracked")}>
            {item.batchTracked ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("inv.expiryTracked")}>
            {item.expiryTracked ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("inv.defaultSupplier")}>
            {supplier ? (
              tx(supplier.tradingName)
            ) : item.defaultSupplierId ? (
              <span className="font-mono text-xs" dir="ltr">
                {item.defaultSupplierId}
              </span>
            ) : (
              t("common.none")
            )}
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={item.active ? "good" : "muted"} dot>
              {item.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
        </DescList>

        <PurchaseUnitsSection item={item} onMessage={onMessage} />

        {item.allergens.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.allergens")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {item.allergens.map((allergen) => (
                <Badge key={allergen} tone="warn">
                  {allergen}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <Callout tone="muted">{t("inv.baseUnitNote")}</Callout>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Purchase units — FR-INV-003
//
// A stock item's own item-specific purchase units (e.g. "Case 12", "Case
// 24"), each with an independent conversion factor to its base unit — a
// real COLLECTION read from `services.inventory.listPurchaseUnits`, not the
// fake single base-unit-times-one stand-in this section replaced. No
// supplier field: no real, backend-integrated supplier catalogue exists on
// the frontend yet (see `unsupportedPurchasing` in `services/http.ts`), and
// a raw UUID picker or a fabricated name would be worse than leaving every
// unit this UI creates supplier-neutral.
// ---------------------------------------------------------------------------

/** Decimal(20,6) text, validated as text only — never parsed through
 *  `Number()`, which could round a value past double precision. */
const CONVERSION_FACTOR_PATTERN = /^\d+(\.\d{1,6})?$/;

function isZeroConversionText(text: string): boolean {
  return /^0+(\.0*)?$/.test(text);
}

type ConversionFactorError = "required" | "invalid" | "notPositive";

function conversionFactorErrorKey(raw: string): ConversionFactorError | null {
  const text = raw.trim();
  if (!text) return "required";
  if (!CONVERSION_FACTOR_PATTERN.test(text)) return "invalid";
  if (isZeroConversionText(text)) return "notPositive";
  return null;
}

/** "12.000000" -> "12", "1.500000" -> "1.5" — trims trailing zeros without
 *  ever parsing the Decimal(20,6) string as a number. */
function trimConversionFactor(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

function PurchaseUnitsSection({
  item,
  onMessage,
}: {
  item: StockItem;
  onMessage: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const { canAny } = useSession();
  const [formOpen, setFormOpen] = useState<"create" | PurchaseUnit | null>(null);
  const canMutate = canAny(["inventory.adjust"]);

  const query = useAsync(() => services.inventory.listPurchaseUnits(item.id), [item.id]);
  const rows = query.data ?? [];
  const baseUnitLabel = unitLabel(item.baseUnit, fmt.locale);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-fg text-sm font-semibold">{t("inv.purchaseUnits")}</h3>
        {canMutate ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setFormOpen("create")}
          >
            {t("inv.addPurchaseUnit")}
          </Button>
        ) : null}
      </div>

      {query.loading ? (
        <Callout tone="muted">{t("state.loading")}</Callout>
      ) : query.error ? (
        <ErrorPanel error={query.error} onRetry={query.reload} compact />
      ) : rows.length === 0 ? (
        <Callout tone="muted">{t("inv.noPurchaseUnitsConfigured")}</Callout>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <PurchaseUnitRow
              key={row.id}
              item={item}
              row={row}
              baseUnitLabel={baseUnitLabel}
              canMutate={canMutate}
              onEdit={() => setFormOpen(row)}
              onDeleted={() => {
                onMessage(t("inv.purchaseUnitDeleted"));
                query.reload();
              }}
            />
          ))}
        </ul>
      )}

      {formOpen ? (
        <PurchaseUnitFormDrawer
          item={item}
          existing={formOpen === "create" ? null : formOpen}
          onClose={() => setFormOpen(null)}
          onDone={(wasCreate) => {
            setFormOpen(null);
            onMessage(wasCreate ? t("inv.purchaseUnitCreated") : t("inv.purchaseUnitUpdated"));
            query.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function PurchaseUnitRow({
  item,
  row,
  baseUnitLabel,
  canMutate,
  onEdit,
  onDeleted,
}: {
  item: StockItem;
  row: PurchaseUnit;
  baseUnitLabel: string;
  canMutate: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [conflict, setConflict] = useState(false);

  async function remove() {
    setConflict(false);
    await action.run(() => services.inventory.deletePurchaseUnit(item.id, row.id), {
      onSuccess: onDeleted,
      onError: (error) => setConflict(error.status === 409),
    });
  }

  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-fg text-sm font-medium">{row.name}</p>
          <p className="text-fg-muted font-mono text-xs" dir="ltr">
            1 {row.name} = {trimConversionFactor(row.conversionFactorToBase)} {baseUnitLabel}
          </p>
        </div>
        {canMutate ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              loading={action.pending}
              onClick={() => void remove()}
            >
              {t("common.delete")}
            </Button>
          </div>
        ) : null}
      </div>
      {action.error ? (
        <Callout tone="bad" className="mt-2" title={conflict ? t("inv.purchaseUnitInUse") : undefined}>
          {action.error}
        </Callout>
      ) : null}
    </li>
  );
}

function PurchaseUnitFormDrawer({
  item,
  existing,
  onClose,
  onDone,
}: {
  item: StockItem;
  existing: PurchaseUnit | null;
  onClose: () => void;
  onDone: (wasCreate: boolean) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState(existing?.name ?? "");
  const [conversionFactorToBase, setConversionFactorToBase] = useState(
    existing ? trimConversionFactor(existing.conversionFactorToBase) : "",
  );
  const [touched, setTouched] = useState(false);

  const conversionErrorKey = conversionFactorErrorKey(conversionFactorToBase);
  const conversionErrorMessage =
    conversionErrorKey &&
    t(
      (conversionErrorKey === "required"
        ? "inv.purchaseUnitConversionRequired"
        : conversionErrorKey === "notPositive"
          ? "inv.purchaseUnitConversionPositive"
          : "inv.purchaseUnitConversionInvalid") as never,
    );
  const valid = name.trim() !== "" && conversionErrorKey === null;

  async function submit() {
    setTouched(true);
    if (!valid) return;
    const input = { name: name.trim(), conversionFactorToBase: conversionFactorToBase.trim() };
    await action.run(
      () =>
        existing
          ? services.inventory.updatePurchaseUnit(item.id, existing.id, input)
          : services.inventory.createPurchaseUnit(item.id, input),
      { onSuccess: () => onDone(!existing) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={existing ? t("inv.editPurchaseUnit") : t("inv.addPurchaseUnit")}
      footer={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            loading={action.pending}
            disabled={!valid}
            onClick={() => void submit()}
          >
            {existing ? t("common.save") : t("common.create")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("common.name")} required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder={t("inv.purchaseUnitNamePlaceholder")}
          />
        </Field>

        <Field
          label={t("inv.purchaseUnitConversion")}
          required
          hint={t("inv.purchaseUnitConversionHint")}
          error={touched ? (conversionErrorMessage ?? undefined) : undefined}
        >
          <Input
            dir="ltr"
            value={conversionFactorToBase}
            onChange={(event) => setConversionFactorToBase(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
