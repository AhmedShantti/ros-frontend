"use client";

/**
 * Contribution margin and menu engineering — SRS §13.6, FR-MNU-055.
 *
 * The Boston matrix puts popularity against profitability and gives each
 * quadrant an action:
 *
 *   Star          high sold, high margin   protect it
 *   Plough-horse  high sold, low margin    re-engineer the cost
 *   Puzzle        low sold, high margin    promote it
 *   Dog           low sold, low margin     remove or reinvent
 *
 * The important discipline is ranking by *total* contribution, not by margin
 * percentage. A 78% margin on a dish nobody orders contributes less than a 52%
 * margin on the one that carries the lunch service, and a percentage-ranked
 * menu review reliably deletes the wrong items.
 *
 * The channel table underneath answers a question the item table cannot: the
 * same dish is a different business on an aggregator once commission and
 * packaging come out, and a menu that is profitable dine-in can be
 * loss-making on delivery without a single number on this page changing.
 */

import { useMemo, useState } from "react";
import type { ChannelProfitabilityRow, ContributionMarginRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync, useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import {
  MENU_CLASSIFICATION,
  MENU_CLASSIFICATION_ACTION,
  ORDER_CHANNEL,
  labelOf,
} from "@/lib/console/labels";
import { menuCategories } from "@/lib/console/mock/catalogue";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Meter,
  cx,
} from "@/components/console/ui";

export default function MarginPage() {
  return (
    <Gate permissions={["costing.margin.view"]}>
      <MarginScreen />
    </Gate>
  );
}

function MarginScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<ContributionMarginRow | null>(null);

  const collection = useCollection<ContributionMarginRow>(
    (query) => services.costing.contributionMargin(query),
    { scope, initialSort: "-totalContribution", pageSize: 25 },
  );

  const channels = useAsync<ChannelProfitabilityRow[]>(
    () => services.costing.channelProfitability(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const mix = useMemo(() => {
    const counts = { star: 0, plough_horse: 0, puzzle: 0, dog: 0 };
    for (const row of collection.rows) counts[row.classification] += 1;
    return counts;
  }, [collection.rows]);

  const columns = useMemo<Column<ContributionMarginRow>[]>(
    () => [
      {
        key: "itemName",
        header: t("menu.itemName"),
        sortable: true,
        render: (row) => <CellStack primary={tx(row.itemName)} secondary={tx(row.category)} />,
      },
      {
        key: "unitsSold",
        header: t("cost.unitsSold"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.unitsSold, fmt),
      },
      {
        key: "sellingPrice",
        header: t("cost.sellingPrice"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.sellingPrice, fmt),
      },
      {
        key: "directCost",
        header: t("cost.directCost"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.directCost, fmt),
      },
      {
        key: "contributionMarginPercent",
        header: t("cost.marginPercent"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              row.contributionMarginPercent >= 65 && "text-good",
              row.contributionMarginPercent < 50 && "text-bad",
            )}
          >
            {formatPercent(row.contributionMarginPercent, fmt, 1)}
          </span>
        ),
      },
      {
        key: "totalContribution",
        header: t("cost.totalContribution"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.totalContribution, fmt, true),
      },
      {
        key: "classification",
        header: t("cost.classification"),
        render: (row) => {
          const entry = labelOf(MENU_CLASSIFICATION, row.classification);
          return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("cost.marginTitle")}
        subtitle={t("cost.marginSubtitle")}
        spec="FR-MNU-055"
      />

      <PageBody>
        <TileGrid columns={4}>
          {(["star", "plough_horse", "puzzle", "dog"] as const).map((key) => {
            const entry = labelOf(MENU_CLASSIFICATION, key);
            return (
              <MetricTile
                key={key}
                label={tx(entry.label)}
                value={formatNumber(mix[key], fmt)}
                footer={<span>{tx(MENU_CLASSIFICATION_ACTION[key])}</span>}
              />
            );
          })}
        </TileGrid>

        <Callout tone="muted">{t("cost.rankingNote")}</Callout>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "classification",
              label: t("cost.classification"),
              options: Object.entries(MENU_CLASSIFICATION).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "category",
              label: t("common.category"),
              // Costing has no endpoint, so no row ever loads to filter.
              // An empty list says that; a fixture list would invite a
              // manager to filter by a category this tenant may not have.
              options:
                DATA_MODE === "http"
                  ? []
                  : menuCategories.map((category) => ({
                      value: category.name.en,
                      label: tx(category.name),
                    })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.itemId}
          caption={t("cost.marginTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.itemId ?? null}
          dense
        />

        <Section title={t("cost.byChannel")} hint={t("cost.channelNote")} spec="FR-CST-006" padded={false}>
          <AsyncPanel state={channels}>
            {(rows) => <ChannelTable rows={rows} />}
          </AsyncPanel>
        </Section>
      </PageBody>

      <MarginDrawer row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ChannelTable({ rows }: { rows: ChannelProfitabilityRow[] }) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<ChannelProfitabilityRow>[]>(
    () => [
      {
        key: "channel",
        header: t("orders.channel"),
        render: (row) => {
          const entry = labelOf(ORDER_CHANNEL, row.channel);
          return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
        },
      },
      {
        key: "revenue",
        header: t("cost.revenue"),
        numeric: true,
        render: (row) => formatMoney(row.revenue, fmt, true),
      },
      {
        key: "cogs",
        header: t("pl.cogs"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.cogs, fmt, true),
      },
      {
        key: "commission",
        header: t("cost.commission"),
        numeric: true,
        render: (row) =>
          row.commission.amount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatMoney(row.commission, fmt, true)
          ),
      },
      {
        key: "packaging",
        header: t("cost.packaging"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.packaging.amount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatMoney(row.packaging, fmt, true)
          ),
      },
      {
        key: "netContribution",
        header: t("cost.netContribution"),
        numeric: true,
        render: (row) => formatMoney(row.netContribution, fmt, true),
      },
      {
        key: "marginPercent",
        header: t("cost.marginPercent"),
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              row.marginPercent < 0 && "text-bad font-semibold",
              row.marginPercent >= 0 && row.marginPercent < 20 && "text-warn",
              row.marginPercent >= 20 && "text-good",
            )}
          >
            {formatPercent(row.marginPercent, fmt, 1)}
          </span>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.channel}
      caption={t("cost.byChannel")}
      dense
    />
  );
}

// ---------------------------------------------------------------------------

function MarginDrawer({
  row,
  onClose,
}: {
  row: ContributionMarginRow | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!row) return null;

  const entry = labelOf(MENU_CLASSIFICATION, row.classification);

  return (
    <Drawer open onClose={onClose} title={tx(row.itemName)} subtitle={tx(row.category)}>
      <div className="space-y-5">
        <Callout tone={entry.tone === "muted" ? "neutral" : entry.tone} title={tx(entry.label)}>
          {tx(MENU_CLASSIFICATION_ACTION[row.classification])}
        </Callout>

        <DescList>
          <DescRow label={t("cost.unitsSold")} mono>
            {formatNumber(row.unitsSold, fmt)}
          </DescRow>
          <DescRow label={t("cost.sellingPrice")} mono>
            {formatMoney(row.sellingPrice, fmt)}
          </DescRow>
          <DescRow label={t("cost.directCost")} mono>
            {formatMoney(row.directCost, fmt)}
          </DescRow>
          <DescRow label={t("cost.contributionMargin")} mono>
            {formatMoney(row.contributionMargin, fmt)}
          </DescRow>
          <DescRow label={t("cost.totalContribution")} mono>
            {formatMoney(row.totalContribution, fmt)}
          </DescRow>
        </DescList>

        <section>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-fg-muted text-xs">{t("cost.marginPercent")}</span>
            <span className="text-fg font-mono text-sm tabular-nums">
              {formatPercent(row.contributionMarginPercent, fmt, 1)}
            </span>
          </div>
          <Meter
            value={row.contributionMarginPercent}
            tone={
              row.contributionMarginPercent >= 65
                ? "good"
                : row.contributionMarginPercent >= 50
                  ? "warn"
                  : "bad"
            }
          />
        </section>
      </div>
    </Drawer>
  );
}
