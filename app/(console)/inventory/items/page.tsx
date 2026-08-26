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
import { Plus } from "lucide-react";
import type { StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, unitLabel } from "@/lib/console/format";
import { COSTING_METHOD, STORAGE, labelOf } from "@/lib/console/labels";
import { supplierById } from "@/lib/console/mock/purchasing";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";
import { RecordDrawer } from "@/components/console/record-drawer";

export default function StockItemsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <StockItemsScreen />
    </Gate>
  );
}

function StockItemsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<StockItem>(
    (query) => services.inventory.items.list(query),
    { scope, initialSort: "sku", pageSize: 25 },
  );

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
        render: (row) => <span className="text-fg-muted text-xs">{tx(row.category)}</span>,
      },
      {
        key: "baseUnit",
        header: t("inv.baseUnit"),
        render: (row) => (
          <span className="font-mono text-xs">{unitLabel(row.baseUnit, fmt.locale)}</span>
        ),
      },
      {
        key: "purchaseUnit",
        header: t("inv.purchaseUnit"),
        secondary: true,
        render: (row) => (
          <span className="text-fg-muted font-mono text-xs" dir="ltr">
            1 {unitLabel(row.purchaseUnit, fmt.locale)} ={" "}
            {formatNumber(row.purchaseConversion, fmt)} {unitLabel(row.baseUnit, fmt.locale)}
          </span>
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
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("inv.itemsTitle")}
        subtitle={t("inv.itemsSubtitle")}
        spec="FR-INV-001"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
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

      <ItemDrawer item={selected} onClose={() => setSelected(null)} />
      <RecordDrawer
        open={creating}
        title={t("inv.newItem")}
        note={t("inv.newItemUnitNote")}
        fields={[
          { name: "name", label: t("common.name"), required: true, maxLength: 120 },
          { name: "sku", label: t("inv.sku"), required: true, maxLength: 40, ltr: true },
          {
            name: "baseUnitId",
            label: t("inv.baseUnitId"),
            hint: t("inv.baseUnitIdHint"),
            required: true,
            ltr: true,
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
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.inventory.items.create({
            name: { en: values.name.trim(), ar: values.name.trim() },
            sku: values.sku.trim(),
            // The API keys units by id and publishes no unit catalogue, so
            // the id is typed rather than picked. See BACKEND_INTEGRATION.md.
            baseUnit: values.baseUnitId.trim() as never,
            costingMethod: values.costingMethod as never,
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("inv.itemCreated"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ItemDrawer({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!item) return null;

  const storage = labelOf(STORAGE, item.storage);
  const costing = labelOf(COSTING_METHOD, item.costingMethod);
  const supplier = item.defaultSupplierId ? supplierById.get(item.defaultSupplierId) : null;

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
          <DescRow label={t("common.category")}>{tx(item.category)}</DescRow>
          <DescRow label={t("inv.baseUnit")} mono>
            {unitLabel(item.baseUnit, fmt.locale)}
          </DescRow>
          <DescRow label={t("inv.purchaseUnit")} mono>
            <span dir="ltr">
              1 {unitLabel(item.purchaseUnit, fmt.locale)} ={" "}
              {formatNumber(item.purchaseConversion, fmt)}{" "}
              {unitLabel(item.baseUnit, fmt.locale)}
            </span>
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
            {supplier ? tx(supplier.tradingName) : t("common.none")}
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={item.active ? "good" : "muted"} dot>
              {item.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
        </DescList>

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
