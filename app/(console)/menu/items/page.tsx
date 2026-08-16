"use client";

/**
 * Menu items — SRS §10.2, §10.5.
 *
 * Three names per item is not redundancy (FR-MNU-005). The guest reads one
 * name on the menu, the line cook reads a short one on the ticket, and the
 * receipt carries a third that has to fit the paper width. Collapsing them
 * into one field is how kitchens end up with "Grilled Chicken Shawarma
 * Sandwich — Large" on a 40-column ticket.
 *
 * "86" is a first-class state (FR-MNU-030): it carries a reason, it is
 * reversible, and it is what the POS reads to grey a tile. `remainingSellable`
 * (FR-MNU-033) is the other half — the count derived from the recipe against
 * live stock, which is why an item can be available and still be nearly out.
 */

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Plus } from "lucide-react";
import type { MenuItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDuration, formatMoney, formatNumber } from "@/lib/console/format";
import { STATION_TYPE, TAX_CLASS, labelOf } from "@/lib/console/labels";
import { menuCategories } from "@/lib/console/mock/catalogue";
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
  Field,
  Modal,
  Textarea,
  Toast,
  cx,
} from "@/components/console/ui";

export default function MenuItemsPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <MenuItemsScreen />
    </Gate>
  );
}

function MenuItemsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canToggle = usePermission("menu.availability.toggle");

  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [pending86, setPending86] = useState<MenuItem | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<MenuItem>(
    (query) => services.catalogue.items.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      unavailable: rows.filter((row) => !row.available).length,
      lowStock: rows.filter(
        (row) => row.remainingSellable !== null && row.remainingSellable <= 5,
      ).length,
    };
  }, [collection.rows]);

  /** FR-MNU-030 — bringing an item back needs no reason; taking it off does. */
  async function setAvailability(item: MenuItem, available: boolean, reason?: string) {
    try {
      await services.catalogue.toggleAvailability(item.id, available, reason);
      setMessage(available ? t("menu.restored") : t("menu.eightySixed"));
      setSelected(null);
      setPending86(null);
      collection.reload();
    } catch {
      setMessage(t("state.errorTitle"));
    }
  }

  const columns = useMemo<Column<MenuItem>[]>(
    () => [
      {
        key: "name",
        header: t("menu.itemName"),
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="text-base leading-none">
              {row.imageEmoji}
            </span>
            <CellStack primary={tx(row.name)} secondary={tx(row.kitchenName)} />
          </div>
        ),
      },
      {
        key: "category",
        header: t("common.category"),
        secondary: true,
        render: (row) => {
          const category = menuCategories.find((c) => c.id === row.categoryId);
          return category ? (
            <span className="text-fg-muted text-xs">{tx(category.name)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          );
        },
      },
      {
        key: "price",
        header: t("menu.price"),
        sortable: true,
        numeric: true,
        render: (row) => <VariantPrice item={row} />,
      },
      {
        key: "station",
        header: t("menu.station"),
        secondary: true,
        render: (row) => {
          const station = labelOf(STATION_TYPE, row.stationType);
          return <Badge tone={station.tone}>{tx(station.label)}</Badge>;
        },
      },
      {
        key: "prepTimeSeconds",
        header: t("menu.prepTime"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatDuration(row.prepTimeSeconds, fmt),
      },
      {
        key: "remainingSellable",
        header: t("menu.remainingSellable"),
        numeric: true,
        hint: t("menu.remainingHint"),
        render: (row) =>
          row.remainingSellable === null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span
              className={cx(
                row.remainingSellable === 0 && "text-bad font-semibold",
                row.remainingSellable > 0 && row.remainingSellable <= 5 && "text-warn",
              )}
            >
              {formatNumber(row.remainingSellable, fmt)}
            </span>
          ),
      },
      {
        key: "available",
        header: t("menu.availability"),
        render: (row) => (
          <Badge tone={row.available ? "good" : "bad"} dot>
            {row.available ? t("menu.available") : t("menu.unavailable")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("menu.itemsTitle")}
        subtitle={t("menu.itemsSubtitle")}
        spec="FR-MNU-005"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("menu.itemsTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("menu.unavailable")}
            value={formatNumber(totals.unavailable, fmt)}
            spec="FR-MNU-030"
          />
          <MetricTile
            label={t("menu.lowRemaining")}
            value={formatNumber(totals.lowStock, fmt)}
            spec="FR-MNU-033"
            hint={t("menu.remainingHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("menu.searchPlaceholder")}
          filters={[
            {
              key: "categoryId",
              label: t("common.category"),
              options: menuCategories.map((category) => ({
                value: category.id,
                label: tx(category.name),
              })),
            },
            {
              key: "available",
              label: t("menu.availability"),
              options: [
                { value: "true", label: t("menu.available") },
                { value: "false", label: t("menu.unavailable") },
              ],
            },
            {
              key: "stationType",
              label: t("menu.station"),
              options: Object.entries(STATION_TYPE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "taxClass",
              label: t("menu.taxClass"),
              options: Object.entries(TAX_CLASS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("menu.itemsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ItemDrawer
        item={selected}
        canToggle={canToggle}
        onClose={() => setSelected(null)}
        onRestore={(item) => setAvailability(item, true)}
        onRequest86={(item) => setPending86(item)}
      />

      <Eighty6Modal
        item={pending86}
        onCancel={() => setPending86(null)}
        onConfirm={(item, reason) => setAvailability(item, false, reason)}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Items are priced per variant; the list shows the range, not the first one. */
function VariantPrice({ item }: { item: MenuItem }) {
  const { t, fmt } = useI18n();

  if (item.isOpenPrice) return <span className="text-fg-muted text-xs">{t("menu.openPrice")}</span>;
  if (item.variants.length === 0) return <span className="text-fg-subtle">—</span>;

  const amounts = item.variants.map((variant) => variant.basePrice.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const currency = item.variants[0]!.basePrice.currency;

  if (low === high) return <>{formatMoney({ amount: low, currency }, fmt)}</>;

  return (
    <span className="whitespace-nowrap">
      {formatMoney({ amount: low, currency }, fmt)} –{" "}
      {formatMoney({ amount: high, currency }, fmt)}
    </span>
  );
}

// ---------------------------------------------------------------------------

function ItemDrawer({
  item,
  canToggle,
  onClose,
  onRestore,
  onRequest86,
}: {
  item: MenuItem | null;
  canToggle: boolean;
  onClose: () => void;
  onRestore: (item: MenuItem) => void;
  onRequest86: (item: MenuItem) => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!item) return null;

  const tax = labelOf(TAX_CLASS, item.taxClass);
  const station = labelOf(STATION_TYPE, item.stationType);

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${item.imageEmoji} ${tx(item.name)}`}
      subtitle={tx(item.description) || undefined}
      footer={
        canToggle ? (
          item.available ? (
            <Button variant="danger" icon={<Ban size={14} />} onClick={() => onRequest86(item)}>
              {t("menu.toggle86")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<CheckCircle2 size={14} />}
              onClick={() => onRestore(item)}
            >
              {t("menu.toggleAvailable")}
            </Button>
          )
        ) : null
      }
    >
      <div className="space-y-5">
        {!item.available && item.unavailableReason ? (
          <Callout tone="bad" title={t("menu.unavailable")}>
            {item.unavailableReason}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("menu.kitchenName")}>{tx(item.kitchenName)}</DescRow>
          <DescRow label={t("menu.receiptName")}>{tx(item.receiptName)}</DescRow>
          <DescRow label={t("menu.station")}>
            <Badge tone={station.tone}>{tx(station.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.taxClass")}>
            <Badge tone={tax.tone}>{tx(tax.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.prepTime")} mono>
            {formatDuration(item.prepTimeSeconds, fmt)}
          </DescRow>
          <DescRow label={t("menu.remainingSellable")} mono>
            {item.remainingSellable === null
              ? "—"
              : formatNumber(item.remainingSellable, fmt)}
          </DescRow>
          <DescRow label={t("menu.sortOrder")} mono>
            {formatNumber(item.sortOrder, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.variants")}</h3>
          <ul className="divide-line divide-y">
            {item.variants.map((variant) => (
              <li key={variant.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-fg truncate text-sm">{tx(variant.name)}</p>
                  {variant.barcode ? (
                    <p className="text-fg-subtle mt-0.5 font-mono text-xs" dir="ltr">
                      {variant.barcode}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!variant.available ? <Badge tone="bad">{t("menu.unavailable")}</Badge> : null}
                  <span className="text-fg font-mono text-sm tabular-nums">
                    {formatMoney(variant.basePrice, fmt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

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

        <div className="flex flex-wrap gap-1.5">
          {item.isCombo ? <Badge tone="accent">{t("nav.combos")}</Badge> : null}
          {item.isOpenPrice ? <Badge tone="muted">{t("menu.openPrice")}</Badge> : null}
          {item.isWeighed ? <Badge tone="muted">{t("menu.weighed")}</Badge> : null}
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** An 86 without a reason is untraceable an hour later, so the reason is required. */
function Eighty6Modal({
  item,
  onCancel,
  onConfirm,
}: {
  item: MenuItem | null;
  onCancel: () => void;
  onConfirm: (item: MenuItem, reason: string) => void;
}) {
  const { t, tx } = useI18n();
  const [reason, setReason] = useState("");

  if (!item) return null;

  const trimmed = reason.trim();

  return (
    <Modal
      open
      onClose={onCancel}
      title={`${t("menu.toggle86")} — ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={trimmed.length === 0}
            onClick={() => {
              onConfirm(item, trimmed);
              setReason("");
            }}
          >
            {t("menu.toggle86")}
          </Button>
        </>
      }
    >
      <Field label={t("menu.86Reason")} required>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("menu.86Placeholder")}
        />
      </Field>
    </Modal>
  );
}
