"use client";

/**
 * Central-kitchen production — SRS §17.5, FR-BRN-020 … FR-BRN-028.
 *
 * Four views of one flow: the plan says what to make (026), orders make it
 * (021–025), the yield report says how well it was made (024), and
 * distribution sends it out (027–028). The production and distribution
 * documents are kept in this browser because the backend has no such
 * documents; every stock movement they cause goes to the real ledger — see
 * `lib/console/services/production.ts`.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import type { Id, StockLevel } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { DistributionOrder, ProductionOrder } from "@/lib/console/services/production";
import { branchNeed, toProduce } from "@/lib/console/production";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber, formatPercent, formatQuantity } from "@/lib/console/format";
import { DATA_MODE } from "@/lib/api/config";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Badge, Button, Callout, Field, Select, Tabs, Toast } from "@/components/console/ui";
import {
  NewOrderDrawer,
  OrderDrawer,
  STATUS_TONE,
  VarianceText,
  kitchenLocation,
  useKitchenData,
  type KitchenData,
  type OrderPrefill,
} from "@/components/console/production-orders";
import { DistributionDrawer } from "@/components/console/distribution-orders";

type Tab = "orders" | "yield" | "plan" | "distribution";

export default function ProductionPage() {
  return (
    <Gate permissions={["inventory.view", "org.manage"]}>
      <ProductionScreen />
    </Gate>
  );
}

function ProductionScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("orders");
  const [message, setMessage] = useTransientMessage();
  const data = useKitchenData();
  const orders = useAsync(() => services.centralKitchen.orders.all(), []);
  const distributions = useAsync(() => services.centralKitchen.distributions.all(), []);

  const [creating, setCreating] = useState<OrderPrefill | null>(null);
  const [selected, setSelected] = useState<ProductionOrder | null>(null);
  const [distributing, setDistributing] = useState<ProductionOrder | null>(null);
  const [openDistribution, setOpenDistribution] = useState<DistributionOrder | null>(null);

  const all = orders.data ?? [];
  const counts = {
    planned: all.filter((row) => row.status === "planned").length,
    running: all.filter((row) => row.status === "in_progress").length,
    failed: all.filter((row) => row.status === "posting_failed").length,
    completed: all.filter((row) => row.status === "completed").length,
  };

  function orderChanged(next: ProductionOrder, note: string) {
    setSelected(next.status === "cancelled" ? null : next);
    orders.reload();
    setMessage(note);
  }

  return (
    <>
      <PageHeader title={t("prd.title")} subtitle={t("prd.subtitle")} spec="FR-BRN-021" />
      <PageBody>
        <Callout tone="muted">{DATA_MODE === "http" ? t("prd.sourceLive") : t("prd.sourceDemo")}</Callout>

        <TileGrid columns={4}>
          <MetricTile label={t("prd.status.planned")} value={String(counts.planned)} />
          <MetricTile label={t("prd.status.in_progress")} value={String(counts.running)} />
          <MetricTile label={t("prd.status.posting_failed")} value={String(counts.failed)} />
          <MetricTile label={t("prd.status.completed")} value={String(counts.completed)} />
        </TileGrid>

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          label={t("prd.title")}
          options={[
            { value: "orders", label: t("prd.tabOrders"), count: counts.planned + counts.running + counts.failed },
            { value: "yield", label: t("prd.tabYield") },
            { value: "plan", label: t("prd.tabPlan") },
            { value: "distribution", label: t("prd.tabDistribution"), count: (distributions.data ?? []).filter((row) => row.status !== "dispatched").length },
          ]}
        />

        <AsyncPanel state={data}>
          {(ready) =>
            tab === "orders" ? (
              <OrdersTab rows={all} onNew={() => setCreating({})} onOpen={setSelected} activeId={selected?.id ?? null} />
            ) : tab === "yield" ? (
              <YieldTab rows={all} />
            ) : tab === "plan" ? (
              <PlanTab data={ready} orders={all} onCreate={setCreating} />
            ) : (
              <DistributionTab rows={distributions.data ?? []} onOpen={setOpenDistribution} />
            )
          }
        </AsyncPanel>
      </PageBody>

      {data.data ? (
        <>
          <NewOrderDrawer
            open={creating !== null}
            data={data.data}
            prefill={creating}
            onClose={() => setCreating(null)}
            onCreated={(order) => {
              setCreating(null);
              orders.reload();
              setSelected(order);
              setMessage(t("prd.created").replace("{number}", order.number));
            }}
          />
          {selected ? (
            <OrderDrawer
              key={`${selected.id}:${selected.status}`}
              order={selected}
              data={data.data}
              onClose={() => setSelected(null)}
              onChanged={orderChanged}
              onDistribute={(order) => {
                setSelected(null);
                setDistributing(order);
              }}
            />
          ) : null}
          {distributing || openDistribution ? (
            <DistributionHost
              data={data.data}
              source={distributing}
              existing={openDistribution}
              onClose={() => {
                setDistributing(null);
                setOpenDistribution(null);
              }}
              onChanged={(_, note) => {
                distributions.reload();
                setMessage(note);
              }}
            />
          ) : null}
        </>
      ) : null}

      <Toast message={message} />
    </>
  );
}

function DistributionHost(props: {
  data: KitchenData;
  source: ProductionOrder | null;
  existing: DistributionOrder | null;
  onClose: () => void;
  onChanged: (row: DistributionOrder, message: string) => void;
}) {
  const { availableBranches } = useSession();
  return <DistributionDrawer {...props} branches={availableBranches} />;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function OrdersTab({
  rows,
  onNew,
  onOpen,
  activeId,
}: {
  rows: ProductionOrder[];
  onNew: () => void;
  onOpen: (row: ProductionOrder) => void;
  activeId: Id | null;
}) {
  const { t, tx, fmt } = useI18n();
  const canCreate = usePermission("inventory.adjust");
  const [status, setStatus] = useState("");

  const visible = [...rows]
    .filter((row) => !status || row.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<ProductionOrder>[] = [
    { key: "number", header: t("prd.number"), render: (row) => <span className="font-mono text-xs">{row.number}</span> },
    { key: "output", header: t("prd.output"), render: (row) => <CellStack primary={tx(row.outputName)} secondary={tx(row.kitchenName)} /> },
    {
      key: "target",
      header: t("prd.target"),
      numeric: true,
      render: (row) => <span className="font-mono">{formatQuantity({ value: row.targetQuantity, unit: row.unit }, fmt)}</span>,
    },
    { key: "date", header: t("prd.targetDate"), render: (row) => formatDate(row.targetDate, fmt) },
    {
      key: "actual",
      header: t("prd.actualOutput"),
      numeric: true,
      secondary: true,
      render: (row) =>
        row.completion ? <span className="font-mono">{formatQuantity({ value: row.completion.actualOutput, unit: row.unit }, fmt)}</span> : "—",
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[row.status]} dot>
            {t(`prd.status.${row.status}` as ConsoleKey)}
          </Badge>
          {row.shortageOverride ? <Badge tone="warn">{t("prd.override")}</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("common.status")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {(["planned", "in_progress", "posting_failed", "completed", "cancelled"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`prd.status.${value}` as ConsoleKey)}
              </option>
            ))}
          </Select>
        </Field>
        {canCreate ? (
          <Button variant="primary" icon={<Plus size={14} />} onClick={onNew}>
            {t("prd.newOrder")}
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        onRowClick={onOpen}
        activeRowKey={activeId}
        caption={t("prd.tabOrders")}
        emptyTitle={t("prd.noOrders")}
        emptyBody={t("prd.noOrdersBody")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yield — FR-BRN-024: by item, batch, date and operator
// ---------------------------------------------------------------------------

function YieldTab({ rows }: { rows: ProductionOrder[] }) {
  const { t, tx, fmt } = useI18n();
  const [itemId, setItemId] = useState("");
  const runs = rows
    .filter((row) => row.completion && (row.status === "completed" || row.status === "posting_failed"))
    .sort((a, b) => b.completion!.completedAt.localeCompare(a.completion!.completedAt));
  const items = [...new Map(runs.map((row) => [row.outputItemId, row.outputName])).entries()];
  const visible = runs.filter((row) => !itemId || row.outputItemId === itemId);

  const byItem = useMemo(() => {
    const groups = new Map<Id, { name: ProductionOrder["outputName"]; runs: number; sum: number; counted: number }>();
    for (const row of runs) {
      const group = groups.get(row.outputItemId) ?? { name: row.outputName, runs: 0, sum: 0, counted: 0 };
      group.runs += 1;
      if (row.completion!.yieldVariancePercent !== null) {
        group.sum += row.completion!.yieldVariancePercent;
        group.counted += 1;
      }
      groups.set(row.outputItemId, group);
    }
    return [...groups.values()];
  }, [runs]);

  const columns: Column<ProductionOrder>[] = [
    { key: "date", header: t("prd.productionDate"), render: (row) => formatDate(row.completion!.productionDate, fmt) },
    { key: "batch", header: t("prd.batchNumber"), render: (row) => <span className="font-mono text-xs">{row.completion!.batchNumber}</span> },
    { key: "item", header: t("prd.output"), render: (row) => tx(row.outputName) },
    { key: "operator", header: t("prd.operator"), secondary: true, render: (row) => row.completion!.completedBy ?? "—" },
    {
      key: "theoretical",
      header: t("prd.theoretical"),
      numeric: true,
      render: (row) =>
        row.completion!.theoreticalOutput ? (
          <span className="font-mono">{formatQuantity({ value: row.completion!.theoreticalOutput, unit: row.unit }, fmt)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "actual",
      header: t("prd.actualOutput"),
      numeric: true,
      render: (row) => <span className="font-mono">{formatQuantity({ value: row.completion!.actualOutput, unit: row.unit }, fmt)}</span>,
    },
    {
      key: "variance",
      header: t("prd.yieldVariance"),
      numeric: true,
      render: (row) => (
        <span className="font-mono">
          <VarianceText value={row.completion!.yieldVariance} percent={row.completion!.yieldVariancePercent} unit={row.unit} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">{t("prd.yieldExplain")}</p>
      {byItem.length ? (
        <TileGrid columns={4}>
          {byItem.slice(0, 8).map((group) => (
            <MetricTile
              key={tx(group.name)}
              label={tx(group.name)}
              value={group.counted ? formatPercent(group.sum / group.counted, fmt) : "—"}
              hint={t("prd.avgOver").replace("{n}", String(group.runs))}
            />
          ))}
        </TileGrid>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("prd.output")}>
          <Select value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {items.map(([id, name]) => (
              <option key={id} value={id}>
                {tx(name)}
              </option>
            ))}
          </Select>
        </Field>
        <ExportButton
          filename="production-yield"
          title={t("prd.tabYield")}
          rows={visible}
          columns={[
            { key: "date", header: t("prd.productionDate"), value: (row) => row.completion!.productionDate },
            { key: "batch", header: t("prd.batchNumber"), value: (row) => row.completion!.batchNumber },
            { key: "item", header: t("prd.output"), value: (row) => tx(row.outputName) },
            { key: "operator", header: t("prd.operator"), value: (row) => row.completion!.completedBy ?? "" },
            { key: "unit", header: t("dst.unit"), value: (row) => row.unit },
            { key: "theoretical", header: t("prd.theoretical"), value: (row) => row.completion!.theoreticalOutput ?? "" },
            { key: "actual", header: t("prd.actualOutput"), value: (row) => row.completion!.actualOutput },
            { key: "variance", header: t("prd.yieldVariance"), value: (row) => row.completion!.yieldVariance ?? "" },
            {
              key: "percent",
              header: "%",
              value: (row) => (row.completion!.yieldVariancePercent === null ? "" : Number(row.completion!.yieldVariancePercent.toFixed(2))),
            },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        caption={t("prd.tabYield")}
        emptyTitle={t("prd.noRuns")}
        emptyBody={t("prd.noRunsBody")}
        dense
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan — FR-BRN-026
// ---------------------------------------------------------------------------

interface PlanRow {
  itemId: Id;
  name: ProductionOrder["outputName"];
  unit: ProductionOrder["unit"];
  recipeId: Id | null;
  kitchenOnHand: string;
  branches: { branchId: Id; name: ProductionOrder["outputName"]; onHand: string; par: string; need: string }[];
  need: string;
  produce: string;
}

function PlanTab({
  data,
  orders,
  onCreate,
}: {
  data: KitchenData;
  orders: ProductionOrder[];
  onCreate: (prefill: OrderPrefill) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const canCreate = usePermission("inventory.adjust");
  const [kitchenId, setKitchenId] = useState(data.kitchens[0]?.id ?? "");
  const [open, setOpen] = useState<Set<Id>>(new Set());
  const kitchen = data.kitchens.find((row) => row.id === kitchenId) ?? null;

  const levels = useAsync(() => services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows), []);

  const rows = useMemo<PlanRow[]>(() => {
    if (!kitchen || !levels.data) return [];
    // What this kitchen makes: recipes that name a stock output, and whatever it has made before.
    const recipeFor = new Map<Id, Id>();
    for (const recipe of data.producing) {
      if (recipe.targetId && data.itemById.has(recipe.targetId)) recipeFor.set(recipe.targetId, recipe.id);
    }
    for (const order of orders) {
      if (order.kitchenId === kitchen.id && !recipeFor.has(order.outputItemId)) recipeFor.set(order.outputItemId, order.recipeId);
    }

    const served = kitchen.servesBranchIds.length ? availableBranches.filter((b) => kitchen.servesBranchIds.includes(b.id)) : availableBranches;
    const at = new Map<string, StockLevel>(levels.data.map((level) => [`${level.itemId}:${level.locationId}`, level]));
    const location = kitchenLocation(kitchen);

    return [...recipeFor.entries()].flatMap(([itemId, recipeId]) => {
      const item = data.itemById.get(itemId);
      if (!item) return [];
      const branches = served.map((branch) => {
        const level = at.get(`${itemId}:${branch.id}`);
        const onHand = level?.onHand.value ?? "0";
        const par = String(level?.parLevel ?? 0);
        return { branchId: branch.id, name: branch.name, onHand, par, need: branchNeed(onHand, par) };
      });
      const kitchenOnHand = at.get(`${itemId}:${location}`)?.onHand.value ?? "0";
      const needs = branches.map((row) => row.need);
      return [
        {
          itemId,
          name: item.name,
          unit: item.baseUnit,
          recipeId,
          kitchenOnHand,
          branches,
          need: String(needs.reduce((sum, value) => sum + Number(value), 0)),
          produce: toProduce(needs, kitchenOnHand),
        },
      ];
    });
  }, [kitchen, levels.data, data, orders, availableBranches]);

  function toggle(itemId: Id) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const tomorrow = (() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return todayIso(date);
  })();

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("prd.planBasis")}</Callout>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("prd.kitchen")}>
          <Select value={kitchenId} onChange={(event) => setKitchenId(event.target.value)}>
            {data.kitchens.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>
        <ExportButton
          filename="production-plan"
          title={t("prd.tabPlan")}
          filterSummary={kitchen ? tx(kitchen.name) : undefined}
          rows={rows}
          columns={[
            { key: "item", header: t("prd.output"), value: (row) => tx(row.name) },
            { key: "unit", header: t("dst.unit"), value: (row) => row.unit },
            { key: "need", header: t("prd.branchNeed"), value: (row) => row.need },
            { key: "kitchen", header: t("prd.onHandKitchen"), value: (row) => row.kitchenOnHand },
            { key: "produce", header: t("prd.toProduce"), value: (row) => row.produce },
          ]}
        />
      </div>

      {kitchen && kitchen.servesBranchIds.length === 0 ? <Callout tone="muted">{t("prd.servesAll")}</Callout> : null}

      <AsyncPanel state={levels}>
        {() =>
          rows.length === 0 ? (
            <Callout tone="muted">{t("prd.planEmpty")}</Callout>
          ) : (
            <ul className="border-line divide-line divide-y rounded-lg border">
              {rows.map((row) => {
                const expanded = open.has(row.itemId);
                return (
                  <li key={row.itemId} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() => toggle(row.itemId)}
                        aria-expanded={expanded}
                        className="text-fg flex min-w-0 flex-1 items-center gap-1 text-start font-medium"
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} className="rtl:rotate-180" />}
                        {tx(row.name)}
                      </button>
                      <span className="text-fg-muted text-xs">
                        {t("prd.branchNeed")}: <span className="font-mono">{formatQuantity({ value: row.need, unit: row.unit }, fmt)}</span>
                      </span>
                      <span className="text-fg-muted text-xs">
                        {t("prd.onHandKitchen")}: <span className="font-mono">{formatQuantity({ value: row.kitchenOnHand, unit: row.unit }, fmt)}</span>
                      </span>
                      <Badge tone={Number(row.produce) > 0 ? "accent" : "muted"}>
                        {t("prd.toProduce")} {formatQuantity({ value: row.produce, unit: row.unit }, fmt)}
                      </Badge>
                      {canCreate && Number(row.produce) > 0 && row.recipeId ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            onCreate({
                              kitchenId,
                              recipeId: row.recipeId!,
                              outputItemId: row.itemId,
                              quantity: row.produce,
                              targetDate: tomorrow,
                            })
                          }
                        >
                          {t("prd.createOrder")}
                        </Button>
                      ) : null}
                    </div>
                    {expanded ? (
                      <table className="mt-2 w-full text-xs">
                        <thead>
                          <tr className="text-fg-subtle">
                            <th className="py-1 text-start font-medium">{t("common.branch")}</th>
                            <th className="py-1 text-end font-medium">{t("prd.onHand")}</th>
                            <th className="py-1 text-end font-medium">{t("prd.par")}</th>
                            <th className="py-1 text-end font-medium">{t("prd.branchNeed")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.branches.map((branch) => (
                            <tr key={branch.branchId}>
                              <td className="text-fg py-0.5">{tx(branch.name)}</td>
                              <td className="py-0.5 text-end font-mono">{formatNumber(Number(branch.onHand), fmt, 3)}</td>
                              <td className="py-0.5 text-end font-mono">{formatNumber(Number(branch.par), fmt, 3)}</td>
                              <td className="py-0.5 text-end font-mono">{formatNumber(Number(branch.need), fmt, 3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        }
      </AsyncPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribution — FR-BRN-027 / 028
// ---------------------------------------------------------------------------

function DistributionTab({ rows, onOpen }: { rows: DistributionOrder[]; onOpen: (row: DistributionOrder) => void }) {
  const { t, tx, fmt } = useI18n();
  const visible = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<DistributionOrder>[] = [
    { key: "number", header: t("prd.number"), render: (row) => <span className="font-mono text-xs">{row.number}</span> },
    {
      key: "item",
      header: t("prd.output"),
      render: (row) => <CellStack primary={tx(row.itemName)} secondary={row.batchNumber ? <span className="font-mono">{row.batchNumber}</span> : null} />,
    },
    { key: "rule", header: t("dst.ruleCol"), secondary: true, render: (row) => t(`dst.rule.${row.rule}` as ConsoleKey) },
    {
      key: "allocated",
      header: t("dst.allocated"),
      numeric: true,
      render: (row) => {
        const total = row.lines.reduce((sum, line) => sum + Number(line.allocated || 0), 0);
        return <span className="font-mono">{formatQuantity({ value: String(total), unit: row.unit }, fmt)}</span>;
      },
    },
    { key: "branches", header: t("dst.branches"), numeric: true, render: (row) => row.lines.filter((line) => Number(line.allocated) > 0).length },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={row.status === "dispatched" ? "good" : row.status === "partial" ? "bad" : "neutral"} dot>
          {t(`dst.status.${row.status}` as ConsoleKey)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-fg-muted text-sm">{t("dst.explain")}</p>
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        onRowClick={onOpen}
        caption={t("prd.tabDistribution")}
        emptyTitle={t("dst.none")}
        emptyBody={t("dst.noneBody")}
      />
    </div>
  );
}
