"use client";

/**
 * Inventory valuation at any date — SRS FR-INV-015, costed per FR-INV-012.
 *
 * "Total inventory value per location, per category, and per item, at any
 * historical date, computed from the movement ledger." The backend has no
 * valuation report, so this screen reads every item's ledger once and
 * replays it in the browser up to the chosen date under each item's own
 * costing method — weighted average, FIFO layers or standard cost
 * (`replayPosition`). Changing the date re-replays the ledger already read;
 * it does not go back to the server.
 *
 * Two honest limits are shown rather than hidden: an issue with nothing on
 * hand to cost it against is carried at the last known cost and counted, and
 * items whose ledger could not be read are listed above the report.
 */

import { useMemo, useState } from "react";
import type { CostingMethod } from "@/lib/console/types";
import { useLedger, latestMovementAt, valuationAt, type ValuationRow } from "@/lib/console/inventory-ledger";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, money } from "@/lib/console/format";
import { COSTING_METHOD, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, DeltaCell, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { CategoryBarChart, MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { LedgerGate } from "@/components/console/inventory-ledger-panel";
import { Badge, Callout, Field, Input, SegmentedControl, Toast } from "@/components/console/ui";
import { useTransientMessage } from "@/lib/console/hooks";
import type { ConsoleKey } from "@/locales";

type GroupBy = "location" | "category" | "item";

interface GroupRow {
  key: string;
  label: string;
  secondary: string | null;
  valueMinor: number;
  compareMinor: number | null;
  items: number;
  quantity: number | null;
  unit: string | null;
  method: CostingMethod | null;
  uncosted: number;
}

export default function ValuationPage() {
  return (
    <Gate permissions={["inventory.cost.view"]}>
      <ValuationScreen />
    </Gate>
  );
}

function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function ValuationScreen() {
  const { t } = useI18n();
  const ledger = useLedger();

  return (
    <>
      <PageHeader title={t("invx.val.title")} subtitle={t("invx.val.subtitle")} spec="FR-INV-015" />
      <PageBody>
        <Callout tone="muted">{t("invx.val.method")}</Callout>
        <LedgerGate state={ledger}>{(load) => <ValuationBody state={ledger} movementsCount={load.movements.length} />}</LedgerGate>
      </PageBody>
    </>
  );
}

function ValuationBody({ state, movementsCount }: { state: ReturnType<typeof useLedger>; movementsCount: number }) {
  const { t, tx, fmt } = useI18n();
  const { tenant, scope } = useSession();
  const [message, setMessage] = useTransientMessage();
  const movements = useMemo(() => state.ledger?.movements ?? [], [state.ledger]);
  const latest = latestMovementAt(movements);
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState<string>(latest ? latest.slice(0, 10) : today);
  const [compareTo, setCompareTo] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("location");
  const [locationId, setLocationId] = useState<string>(scope.branchId ?? "all");

  const currency = tenant.baseCurrency;

  const current = useMemo(() => valuationAt(movements, state.items, endOfDay(asOf)), [movements, state.items, asOf]);
  const previous = useMemo(
    () => (compareTo ? valuationAt(movements, state.items, endOfDay(compareTo)) : null),
    [movements, state.items, compareTo],
  );

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of current) seen.set(row.locationId, tx(row.locationName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [current, tx]);

  const inScope = (rows: ValuationRow[]) => (locationId === "all" ? rows : rows.filter((row) => row.locationId === locationId));

  const groups = useMemo<GroupRow[]>(() => {
    const keyOf = (row: ValuationRow) =>
      groupBy === "location" ? row.locationId : groupBy === "category" ? row.category.en || "—" : row.itemId;
    const map = new Map<string, GroupRow>();
    const add = (row: ValuationRow, into: "value" | "compare") => {
      const key = keyOf(row);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label:
            groupBy === "location" ? tx(row.locationName) : groupBy === "category" ? tx(row.category) || t("invx.val.uncategorised") : tx(row.itemName),
          secondary: groupBy === "item" ? row.sku : null,
          valueMinor: 0,
          compareMinor: previous ? 0 : null,
          items: 0,
          quantity: groupBy === "item" ? 0 : null,
          unit: groupBy === "item" ? row.unit : null,
          method: groupBy === "item" ? row.costingMethod : null,
          uncosted: 0,
        };
        map.set(key, group);
      }
      if (into === "value") {
        group.valueMinor += row.valueMinor;
        if (row.quantity !== 0) group.items += 1;
        if (group.quantity !== null) group.quantity += row.quantity;
        if (row.uncostedIssues > 0) group.uncosted += 1;
      } else if (group.compareMinor !== null) {
        group.compareMinor += row.valueMinor;
      }
    };
    for (const row of inScope(current)) add(row, "value");
    for (const row of inScope(previous ?? [])) add(row, "compare");
    return [...map.values()].sort((a, b) => b.valueMinor - a.valueMinor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, previous, groupBy, locationId, tx, t]);

  const total = groups.reduce((sum, row) => sum + row.valueMinor, 0);
  const compareTotal = previous ? groups.reduce((sum, row) => sum + (row.compareMinor ?? 0), 0) : null;
  const byMethod = useMemo(() => {
    const out: Record<CostingMethod, number> = { weighted_average: 0, fifo: 0, standard: 0 };
    for (const row of inScope(current)) out[row.costingMethod] += row.valueMinor;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, locationId]);
  const uncosted = inScope(current).filter((row) => row.uncostedIssues > 0).length;
  const negative = inScope(current).filter((row) => row.quantity < 0).length;

  const columns: Column<GroupRow>[] = [
    {
      key: "label",
      header: t(`invx.val.group.${groupBy}` as ConsoleKey),
      render: (row) => (
        <CellStack
          primary={row.label}
          secondary={
            row.secondary ? (
              <span className="font-mono">{row.secondary}</span>
            ) : groupBy !== "item" ? (
              t("invx.val.itemsCount").replace("{n}", formatNumber(row.items, fmt))
            ) : undefined
          }
        />
      ),
    },
    ...(groupBy === "item"
      ? [
          {
            key: "quantity",
            header: t("common.quantity"),
            numeric: true,
            render: (row: GroupRow) => (
              <span dir="ltr" className={row.quantity !== null && row.quantity < 0 ? "text-bad font-mono" : "font-mono"}>
                {formatNumber(row.quantity ?? 0, fmt, 3)} {row.unit}
              </span>
            ),
          },
          {
            key: "method",
            header: t("inv.costingMethod"),
            secondary: true,
            render: (row: GroupRow) =>
              row.method ? <Badge tone="muted">{tx(labelOf(COSTING_METHOD, row.method).label)}</Badge> : null,
          },
        ]
      : []),
    {
      key: "value",
      header: t("invx.val.valueAt").replace("{date}", asOf),
      numeric: true,
      render: (row) => (
        <span className="font-mono">
          {formatMoney(money(row.valueMinor, currency), fmt)}
          {row.uncosted > 0 ? (
            <span className="text-warn ms-1" title={t("invx.val.uncostedHint")}>
              *
            </span>
          ) : null}
        </span>
      ),
    },
    ...(previous
      ? [
          {
            key: "change",
            header: t("invx.val.change"),
            numeric: true,
            render: (row: GroupRow) => {
              const delta = row.valueMinor - (row.compareMinor ?? 0);
              return <DeltaCell value={delta}>{formatMoney(money(delta, currency), fmt)}</DeltaCell>;
            },
          },
        ]
      : []),
    {
      key: "share",
      header: "%",
      numeric: true,
      secondary: true,
      render: (row) => formatNumber(total > 0 ? (row.valueMinor / total) * 100 : 0, fmt, 1),
    },
  ];

  return (
    <>
      <Toolbar>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("invx.val.asOf")}>
            <Input type="date" dir="ltr" value={asOf} max={today} onChange={(event) => event.target.value && setAsOf(event.target.value)} />
          </Field>
          <Field label={t("invx.val.compareTo")}>
            <Input type="date" dir="ltr" value={compareTo} max={asOf} onChange={(event) => setCompareTo(event.target.value)} />
          </Field>
          <FilterSelect
            filter={{ key: "location", label: t("common.location"), options: locations.map(([value, label]) => ({ value, label })) }}
            value={locationId}
            onChange={setLocationId}
          />
          <SegmentedControl<GroupBy>
            label={t("common.grouping")}
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "location", label: t("invx.val.group.location") },
              { value: "category", label: t("invx.val.group.category") },
              { value: "item", label: t("invx.val.group.item") },
            ]}
          />
        </div>
        <ExportButton
          filename={`inventory-valuation-${asOf}`}
          title={`${t("invx.val.title")} — ${asOf}`}
          filterSummary={`${t(`invx.val.group.${groupBy}` as ConsoleKey)} · ${locationId === "all" ? t("common.all") : (locations.find(([id]) => id === locationId)?.[1] ?? "")}`}
          rows={groups}
          onExported={setMessage}
          columns={[
            { key: "label", header: t(`invx.val.group.${groupBy}` as ConsoleKey), value: (row) => row.label },
            { key: "sku", header: t("inv.sku"), value: (row) => row.secondary ?? "" },
            { key: "qty", header: t("common.quantity"), value: (row) => (row.quantity === null ? "" : row.quantity.toFixed(3)) },
            { key: "value", header: t("common.value"), value: (row) => (row.valueMinor / 100).toFixed(2) },
            { key: "compare", header: t("invx.val.compareTo"), value: (row) => (row.compareMinor === null ? "" : (row.compareMinor / 100).toFixed(2)) },
          ]}
        />
      </Toolbar>

      <TileGrid columns={4}>
        <MetricTile
          label={t("invx.val.total")}
          value={formatMoney(money(total, currency), fmt, true)}
          spec="FR-INV-015"
          footer={
            compareTotal !== null ? (
              <DeltaCell value={total - compareTotal}>
                {formatMoney(money(total - compareTotal, currency), fmt, true)} {t("invx.val.since").replace("{date}", compareTo)}
              </DeltaCell>
            ) : undefined
          }
        />
        <MetricTile label={t("invx.val.movements")} value={formatNumber(movementsCount, fmt)} hint={t("invx.val.movementsHint")} />
        <MetricTile label={t("invx.val.negative")} value={formatNumber(negative, fmt)} hint={t("invx.val.negativeHint")} />
        <MetricTile label={t("invx.val.uncosted")} value={formatNumber(uncosted, fmt)} hint={t("invx.val.uncostedHint")} />
      </TileGrid>

      <Section title={t("invx.val.byMethod")} hint={t("invx.val.byMethodHint")} spec="FR-INV-012">
        <CategoryBarChart
          data={(Object.keys(byMethod) as CostingMethod[]).map((method) => ({
            label: tx(labelOf(COSTING_METHOD, method).label),
            value: byMethod[method],
          }))}
          valueLabel={t("common.value")}
          format={(value) => formatMoney(money(value, currency), fmt, true)}
          height={140}
        />
      </Section>

      <DataTable
        columns={columns}
        rows={groups}
        rowKey={(row) => row.key}
        caption={t("invx.val.title")}
        emptyTitle={t("invx.val.emptyTitle")}
        emptyBody={t("invx.val.emptyBody")}
        dense
      />

      <Toast message={message} />
    </>
  );
}
