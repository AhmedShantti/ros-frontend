"use client";

/**
 * Theoretical vs actual usage — SRS §13.3, FR-CST-010..015.
 *
 * This is the most diagnostic report in the module, and the reason recipes and
 * the movement ledger have to be right. Theoretical usage is what the recipes
 * say the sales should have consumed. Actual usage is what the ledger says
 * left the store. The gap is either recorded waste or it is unexplained, and
 * the unexplained column is the one worth reading.
 *
 * It is sorted by value, not by quantity. Two hundred grams of saffron matters
 * and forty kilos of ice does not, and a quantity-ranked list buries the first
 * under the second.
 *
 * The hypothesis column is offered as a prompt, never a conclusion (FR-CST-015).
 * The same 8% gap on chicken is over-portioning, theft, a wrong recipe yield,
 * or a mis-keyed delivery — the system can rank which is likeliest, and only a
 * person standing in the kitchen can tell which it is.
 */

import { useMemo, useState } from "react";
import type { VarianceRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent, unitLabel } from "@/lib/console/format";
import { stockItems } from "@/lib/console/mock/stock-items";
import {
  CellStack,
  CollectionTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Callout,
  DescList,
  DescRow,
  Drawer,
  cx,
} from "@/components/console/ui";

export default function VariancePage() {
  return (
    <Gate permissions={["costing.variance.view"]}>
      <VarianceScreen />
    </Gate>
  );
}

function VarianceScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<VarianceRow | null>(null);

  const collection = useCollection<VarianceRow>(
    (query) => services.costing.variance(query),
    { scope, initialSort: "-varianceValue", pageSize: 25 },
  );

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of stockItems) {
      if (!seen.has(item.category.en)) seen.set(item.category.en, tx(item.category));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tx]);

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      // Losses only. Netting a favourable variance against a loss hides both.
      loss: rows
        .filter((row) => row.varianceValue.amount < 0)
        .reduce((sum, row) => sum + Math.abs(row.varianceValue.amount), 0),
      unexplained: rows.filter((row) => Math.abs(row.unexplainedQty) > 0).length,
      worst: rows.reduce(
        (worst, row) =>
          Math.abs(row.variancePercent) > Math.abs(worst?.variancePercent ?? 0) ? row : worst,
        null as VarianceRow | null,
      ),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.varianceValue.currency ?? "EGP";

  const columns = useMemo<Column<VarianceRow>[]>(
    () => [
      {
        key: "itemName",
        header: t("inv.sku"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.sku}</span>}
          />
        ),
      },
      {
        key: "theoretical",
        header: t("cost.theoretical"),
        numeric: true,
        secondary: true,
        render: (row) => (
          <span>
            {formatNumber(row.theoreticalUsage, fmt, 1)}{" "}
            <span className="text-fg-subtle text-xs">{unitLabel(row.unit, fmt.locale)}</span>
          </span>
        ),
      },
      {
        key: "actual",
        header: t("cost.actualUsage"),
        numeric: true,
        secondary: true,
        render: (row) => (
          <span>
            {formatNumber(row.actualUsage, fmt, 1)}{" "}
            <span className="text-fg-subtle text-xs">{unitLabel(row.unit, fmt.locale)}</span>
          </span>
        ),
      },
      {
        key: "recordedWaste",
        header: t("cost.recordedWaste"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.recordedWasteQty === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatNumber(row.recordedWasteQty, fmt, 1)
          ),
      },
      {
        key: "unexplainedQty",
        header: t("cost.unexplained"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.unexplainedQty === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="text-bad font-semibold">
              {formatNumber(Math.abs(row.unexplainedQty), fmt, 1)}
            </span>
          ),
      },
      {
        key: "variancePercent",
        header: "%",
        sortable: true,
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              "font-mono tabular-nums",
              Math.abs(row.variancePercent) > 5 && "text-bad font-semibold",
              Math.abs(row.variancePercent) > 2 &&
                Math.abs(row.variancePercent) <= 5 &&
                "text-warn",
            )}
          >
            {formatPercent(row.variancePercent, fmt, 1)}
          </span>
        ),
      },
      {
        key: "varianceValue",
        header: t("cost.varianceValue"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <DeltaCell value={-row.varianceValue.amount}>
            {formatMoney(row.varianceValue, fmt)}
          </DeltaCell>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("cost.varianceTitle")}
        subtitle={t("cost.varianceSubtitle")}
        spec="FR-CST-010"
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("cost.varianceLoss")}
            value={formatMoney({ amount: totals.loss, currency }, fmt, true)}
            spec="FR-CST-012"
          />
          <MetricTile
            label={t("cost.unexplained")}
            value={formatNumber(totals.unexplained, fmt)}
            hint={t("cost.unexplainedHint")}
          />
          <MetricTile
            label={t("cost.worstItem")}
            value={
              totals.worst
                ? formatPercent(totals.worst.variancePercent, fmt, 1)
                : "—"
            }
            footer={totals.worst ? <span>{tx(totals.worst.itemName)}</span> : null}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("inv.searchPlaceholder")}
          filters={[{ key: "category", label: t("common.category"), options: categories }]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.itemId}
          caption={t("cost.varianceTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.itemId ?? null}
          dense
        />
      </PageBody>

      <VarianceDrawer row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function VarianceDrawer({ row, onClose }: { row: VarianceRow | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!row) return null;

  const unit = unitLabel(row.unit, fmt.locale);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(row.itemName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {row.sku}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.category")}>{tx(row.category)}</DescRow>
          <DescRow label={t("cost.theoretical")} mono>
            {formatNumber(row.theoreticalUsage, fmt, 2)} {unit}
          </DescRow>
          <DescRow label={t("cost.actualUsage")} mono>
            {formatNumber(row.actualUsage, fmt, 2)} {unit}
          </DescRow>
          <DescRow label={t("common.variance")} mono>
            <DeltaCell value={row.varianceQty}>
              {formatNumber(row.varianceQty, fmt, 2)} {unit}
            </DeltaCell>
          </DescRow>
          <DescRow label={t("cost.recordedWaste")} mono>
            {formatNumber(row.recordedWasteQty, fmt, 2)} {unit}
          </DescRow>
          <DescRow label={t("cost.unexplained")} mono>
            <span className="text-bad font-semibold">
              {formatNumber(row.unexplainedQty, fmt, 2)} {unit}
            </span>
          </DescRow>
          <DescRow label={t("cost.varianceValue")} mono>
            <DeltaCell value={-row.varianceValue.amount}>
              {formatMoney(row.varianceValue, fmt)}
            </DeltaCell>
          </DescRow>
          <DescRow label="%" mono>
            {formatPercent(row.variancePercent, fmt, 1)}
          </DescRow>
        </DescList>

        {row.hypothesis ? (
          <section>
            <h3 className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
              {t("cost.hypothesis")}
              <Badge tone="warn">{t("cost.hypothesisBadge")}</Badge>
            </h3>
            <p className="text-fg-muted text-sm leading-relaxed">{tx(row.hypothesis)}</p>
          </section>
        ) : null}

        <Callout tone="muted">{t("cost.hypothesisNote")}</Callout>
      </div>
    </Drawer>
  );
}
