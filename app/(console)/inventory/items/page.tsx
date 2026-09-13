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
import { Plus, ScanBarcode } from "lucide-react";
import type { StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useAction } from "@/lib/console/actions";
import { formatMoney, formatNumber, unitLabel } from "@/lib/console/format";
import { COSTING_METHOD, STORAGE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Input, Toast } from "@/components/console/ui";
import { StockItemEditor } from "@/components/console/stock-item-editor";

export default function StockItemsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <StockItemsScreen />
    </Gate>
  );
}

function StockItemsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, can } = useSession();
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [scan, setScan] = useState("");
  const finder = useAction(setMessage);
  const canManage = can("inventory.item.manage");

  /**
   * FR-INV-005 — a barcode off a delivery or a shelf resolves to its item.
   * Supplier and case barcodes live on the item profile, so this asks the
   * profile store rather than the SKU search.
   */
  async function findByBarcode() {
    const code = scan.trim();
    if (!code) return;
    await finder.run(async () => {
      const hit = await services.stockProfiles.findByBarcode(code);
      if (!hit) {
        setMessage(t("inv.barcodeNotFound").replace("{code}", code));
        return;
      }
      const item = await services.inventory.items.get(hit.itemId);
      if (item) {
        setSelected(item);
        setScan("");
      }
    });
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
              <ScanBarcode
                size={14}
                aria-hidden
                className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3"
              />
              <Input
                dir="ltr"
                value={scan}
                onChange={(event) => setScan(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void findByBarcode();
                  }
                }}
                placeholder={t("inv.findByBarcode")}
                aria-label={t("inv.findByBarcode")}
                className="ps-9 font-mono text-xs"
              />
            </div>
            {canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("common.new")}
              </Button>
            ) : null}
          </div>
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

      {selected || creating ? (
        <StockItemEditor
          item={creating ? null : selected}
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSaved={(text) => {
            setSelected(null);
            setCreating(false);
            setMessage(text);
            collection.reload();
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}
