"use client";

/**
 * Price lists — SRS §10.4, FR-POS-040.
 *
 * Price resolution is a precedence problem, not a lookup. Several lists can
 * cover the same item at the same moment — a tenant base list, a delivery
 * uplift, a weekday happy hour — and the POS takes the highest priority among
 * those currently in force. That is why priority, validity and recurrence are
 * the three columns given the most room: together they *are* the price.
 *
 * The drawer shows the previous price beside the current one where the list
 * carries it, because a price change nobody can see the size of is a price
 * change nobody can review (FR-MNU-025).
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { PriceList, PriceListEntry } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { ORDER_TYPE, PRICE_LIST_SCOPE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
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
  cx,
} from "@/components/console/ui";

export default function MenuPricingPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <PricingScreen />
    </Gate>
  );
}

function PricingScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<PriceList | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<PriceList>(
    (query) => services.catalogue.priceLists.list(query),
    { scope, initialSort: "-priority", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      scheduled: rows.filter((row) => row.recurrence !== null).length,
      entries: rows.reduce((sum, row) => sum + row.entryCount, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<PriceList>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.orderTypes
              .map((type) => tx(labelOf(ORDER_TYPE, type).label))
              .join(" · ")}
          />
        ),
      },
      {
        key: "scope",
        header: t("menu.scope"),
        render: (row) => {
          const listScope = labelOf(PRICE_LIST_SCOPE, row.scope);
          return <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>;
        },
      },
      {
        key: "priority",
        header: t("menu.priority"),
        sortable: true,
        numeric: true,
        hint: t("menu.priorityHint"),
        render: (row) => formatNumber(row.priority, fmt),
      },
      {
        key: "validFrom",
        header: t("menu.validity"),
        sortable: true,
        secondary: true,
        render: (row) => (
          <span className="whitespace-nowrap" dir="ltr">
            {formatDate(row.validFrom, fmt)} →{" "}
            {row.validTo ? formatDate(row.validTo, fmt) : "∞"}
          </span>
        ),
      },
      {
        key: "recurrence",
        header: t("menu.recurrence"),
        secondary: true,
        render: (row) =>
          row.recurrence ? (
            <span className="text-fg-muted font-mono text-xs">{row.recurrence}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "entryCount",
        header: t("menu.entries"),
        numeric: true,
        render: (row) => formatNumber(row.entryCount, fmt),
      },
      {
        key: "active",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={row.active ? "good" : "muted"} dot>
            {row.active ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("menu.pricingTitle")}
        subtitle={t("menu.pricingSubtitle")}
        spec="FR-POS-040"
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
        <Callout tone="muted">{t("menu.precedenceNote")}</Callout>

        <TileGrid columns={3}>
          <MetricTile
            label={t("menu.pricingTitle")}
            value={formatNumber(collection.total, fmt)}
            footer={
              <span>
                {formatNumber(totals.active, fmt)} {t("common.active").toLowerCase()}
              </span>
            }
          />
          <MetricTile
            label={t("menu.recurrence")}
            value={formatNumber(totals.scheduled, fmt)}
            spec="FR-MNU-022"
          />
          <MetricTile label={t("menu.entries")} value={formatNumber(totals.entries, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "scope",
              label: t("menu.scope"),
              options: Object.entries(PRICE_LIST_SCOPE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("menu.pricingTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <PriceListDrawer list={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function PriceListDrawer({ list, onClose }: { list: PriceList | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<PriceListEntry>[]>(
    () => [
      {
        key: "item",
        header: t("menu.itemName"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "previous",
        header: t("menu.previousPrice"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.previousPrice ? (
            <span className="text-fg-subtle line-through">
              {formatMoney(row.previousPrice, fmt)}
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "price",
        header: t("menu.price"),
        numeric: true,
        render: (row) => formatMoney(row.price, fmt),
      },
      {
        key: "change",
        header: t("common.variance"),
        numeric: true,
        render: (row) => {
          if (!row.previousPrice || row.previousPrice.amount === 0) {
            return <span className="text-fg-subtle">—</span>;
          }
          const change =
            ((row.price.amount - row.previousPrice.amount) / row.previousPrice.amount) * 100;
          if (change === 0) return <span className="text-fg-subtle">—</span>;
          return (
            <span className={cx(change > 0 ? "text-warn" : "text-good")}>
              {change > 0 ? "+" : ""}
              {formatPercent(change, fmt, 1)}
            </span>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  if (!list) return null;

  const listScope = labelOf(PRICE_LIST_SCOPE, list.scope);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(list.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {t("menu.priority")} {list.priority}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("menu.scope")}>
            <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.orderTypes")}>
            <span className="flex flex-wrap justify-end gap-1">
              {list.orderTypes.map((type) => {
                const entry = labelOf(ORDER_TYPE, type);
                return (
                  <Badge key={type} tone={entry.tone}>
                    {tx(entry.label)}
                  </Badge>
                );
              })}
            </span>
          </DescRow>
          <DescRow label={t("menu.validity")} mono>
            <span dir="ltr">
              {formatDate(list.validFrom, fmt)} →{" "}
              {list.validTo ? formatDate(list.validTo, fmt) : "∞"}
            </span>
          </DescRow>
          <DescRow label={t("menu.recurrence")} mono>
            {list.recurrence ?? t("common.none")}
          </DescRow>
          <DescRow label={t("menu.entries")} mono>
            {formatNumber(list.entryCount, fmt)}
          </DescRow>
        </DescList>

        {list.entries.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.entries")}</h3>
            <DataTable
              columns={columns}
              rows={list.entries}
              rowKey={(row) => `${row.menuItemId}-${row.variantId}`}
              caption={t("menu.entries")}
              dense
            />
          </section>
        ) : (
          <Callout tone="muted">{t("menu.noEntries")}</Callout>
        )}
      </div>
    </Drawer>
  );
}
