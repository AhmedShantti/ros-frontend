"use client";

/**
 * Waste insights — FR-CST-021, FR-CST-022, FR-CST-024.
 *
 * Built from the recorded waste itself (`services.inventory.waste`, a real
 * endpoint), orders (real), employees (real), attendance (demo only — the
 * backend has no attendance index) and the local equipment-fault log. Each
 * factor that has no source says so instead of reading as "no effect".
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AttendanceRecord, Employee, Order, WasteRecord } from "@/lib/console/types";
import type { EquipmentFault } from "@/lib/console/services/costing-faults";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useConfirm } from "@/components/console/confirm";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import {
  MIN_CORRELATION_DAYS,
  correlate,
  dailyWaste,
  faultsByDay,
  labourHoursByDay,
  newStartersByDay,
  ordersByDay,
  strengthOf,
  wasteBaseline,
  wasteShares,
  type BaselineRow,
  type FactorKey,
} from "@/lib/console/costing-waste";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { Section, TileGrid } from "@/components/console/page";
import { MetricTile, Sparkline } from "@/components/console/charts";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, Field, Input, Meter, Select, Toast, Toggle, cx } from "@/components/console/ui";

interface Sources {
  waste: WasteRecord[];
  orders: Order[];
  attendance: AttendanceRecord[] | null;
  employees: Employee[] | null;
  faults: EquipmentFault[];
}

async function loadSources(scope: ReturnType<typeof useSession>["scope"]): Promise<Sources> {
  const [waste, orders, attendance, employees, faults] = await Promise.all([
    services.inventory.waste.list({ limit: 20000 }),
    services.sales.orders.list({ scope, limit: 1000 }).catch(() => ({ rows: [] as Order[], total: 0 })),
    services.workforce.attendance
      .list({ scope, limit: 20000 })
      .then((page) => page.rows)
      .catch(() => null),
    services.workforce.employees
      .list({ limit: 5000 })
      .then((page) => page.rows)
      .catch(() => null),
    services.equipmentFaults.all().catch(() => [] as EquipmentFault[]),
  ]);
  const branchId = scope.branchId;
  return {
    waste: waste.rows,
    orders: orders.rows,
    attendance: attendance ? attendance.filter((row) => !branchId || row.branchId === branchId) : null,
    employees,
    faults: faults.filter((row) => !branchId || row.branchId === null || row.branchId === branchId),
  };
}

export function WasteInsights() {
  const { t } = useI18n();
  const { scope } = useSession();
  const state = useAsync(() => loadSources(scope), [scope.tenantId, scope.brandId, scope.branchId]);

  return (
    <AsyncPanel state={state}>
      {(sources) => (
        <>
          <WasteShares sources={sources} />
          <BaselineSection records={sources.waste} />
          <CorrelationSection sources={sources} onFaultsChanged={state.reload} />
          {scope.branchId ? <Callout tone="muted">{t("cst.waste.locationScopeNote")}</Callout> : null}
        </>
      )}
    </AsyncPanel>
  );
}

// ---------------------------------------------------------------------------
// FR-CST-021
// ---------------------------------------------------------------------------

function WasteShares({ sources }: { sources: Sources }) {
  const { t, fmt } = useI18n();

  const figures = useMemo(() => {
    const days = sources.waste.map((record) => record.recordedAt.slice(0, 10)).sort();
    const from = days[0] ?? "";
    const to = days[days.length - 1] ?? "";
    const trueWaste = sources.waste.filter((record) => record.isTrueWaste).reduce((sum, record) => sum + record.value.amount, 0);
    const inPeriod = sources.orders.filter(
      (order) => order.businessDay >= from && order.businessDay <= to && order.state !== "cancelled" && order.state !== "merged",
    );
    const net = inPeriod.reduce((sum, order) => sum + Math.max(0, order.subtotal.amount - order.discountTotal.amount), 0);
    const withLines = inPeriod.filter((order) => order.lines.length > 0);
    const cogs = withLines.reduce((sum, order) => sum + order.cogsTotal.amount, 0);
    return {
      from,
      to,
      trueWaste,
      currency: sources.waste[0]?.value.currency ?? "EGP",
      // COGS only counts when every order in the period carried its lines.
      shares: wasteShares(trueWaste, withLines.length === inPeriod.length ? cogs : 0, net),
      cogsIncomplete: withLines.length < inPeriod.length,
    };
  }, [sources]);

  return (
    <Section title={t("cst.waste.sharesTitle")} hint={t("cst.waste.sharesHint")} spec="FR-CST-021">
      <TileGrid columns={3}>
        <MetricTile
          label={t("inv.trueWaste")}
          value={formatMoney({ amount: figures.trueWaste, currency: figures.currency }, fmt, true)}
          footer={figures.from ? <span>{`${formatDate(figures.from, fmt)} – ${formatDate(figures.to, fmt)}`}</span> : null}
        />
        <MetricTile
          label={t("cst.waste.percentOfCogs")}
          value={figures.shares.percentOfCogs === null ? "—" : formatPercent(figures.shares.percentOfCogs, fmt, 2)}
          hint={figures.cogsIncomplete ? t("cst.waste.cogsIncomplete") : undefined}
        />
        <MetricTile
          label={t("cst.waste.percentOfNetSales")}
          value={figures.shares.percentOfNetSales === null ? "—" : formatPercent(figures.shares.percentOfNetSales, fmt, 2)}
        />
      </TileGrid>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-CST-022
// ---------------------------------------------------------------------------

function BaselineSection({ records }: { records: WasteRecord[] }) {
  const { t, tx, fmt } = useI18n();
  const [windowWeeks, setWindowWeeks] = useState("3");
  const [sigma, setSigma] = useState("2");
  const [trueOnly, setTrueOnly] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const weeks = Math.min(26, Math.max(2, Math.floor(Number(windowWeeks)) || 3));
  const k = Number(sigma) > 0 ? Number(sigma) : 2;

  const baseline = useMemo(
    () => wasteBaseline(records, { windowWeeks: weeks, sigma: k, trueWasteOnly: trueOnly }),
    [records, weeks, k, trueOnly],
  );
  const rows = flaggedOnly ? baseline.rows.filter((row) => row.flagged) : baseline.rows;
  const currency = records[0]?.value.currency ?? "EGP";
  const flagged = baseline.rows.filter((row) => row.flagged).length;

  const columns: Column<BaselineRow>[] = [
    {
      key: "item",
      header: t("common.name"),
      render: (row) => <CellStack primary={tx(row.itemName)} secondary={tx(row.locationName)} />,
    },
    {
      key: "weeks",
      header: t("cst.waste.weekly"),
      render: (row) => (
        <div className="w-28">
          <Sparkline values={row.weeks} />
        </div>
      ),
    },
    { key: "mean", header: t("cst.waste.baselineMean"), numeric: true, secondary: true, render: (row) => formatMoney({ amount: row.meanMinor, currency }, fmt) },
    { key: "sd", header: "σ", numeric: true, secondary: true, render: (row) => formatMoney({ amount: row.sdMinor, currency }, fmt) },
    { key: "current", header: t("cst.waste.thisWeek"), numeric: true, render: (row) => formatMoney({ amount: row.currentMinor, currency }, fmt) },
    {
      key: "z",
      header: t("cst.waste.deviation"),
      numeric: true,
      render: (row) =>
        row.z === null ? (
          <span className="text-fg-subtle text-xs">{t("cst.waste.noSpread")}</span>
        ) : (
          <span className={cx("font-mono tabular-nums", row.flagged && "text-bad font-semibold")}>
            {`${row.z >= 0 ? "+" : ""}${formatNumber(row.z, fmt, 1)}σ`}
          </span>
        ),
    },
    {
      key: "flag",
      header: "",
      render: (row) => (row.flagged ? <Badge tone="bad">{t("cst.waste.aboveBaseline")}</Badge> : null),
    },
  ];

  return (
    <Section
      title={t("cst.waste.baselineTitle")}
      hint={t("cst.waste.baselineHint")}
      spec="FR-CST-022"
      action={
        <ExportButton
          filename="waste-baseline"
          title={t("cst.waste.baselineTitle")}
          filterSummary={`${weeks}w · ${k}σ`}
          rows={rows}
          columns={[
            { key: "item", header: t("common.name"), value: (row) => tx(row.itemName) },
            { key: "location", header: t("common.location"), value: (row) => tx(row.locationName) },
            { key: "mean", header: t("cst.waste.baselineMean"), value: (row) => (row.meanMinor / 100).toFixed(2) },
            { key: "sd", header: "sigma", value: (row) => (row.sdMinor / 100).toFixed(2) },
            { key: "current", header: t("cst.waste.thisWeek"), value: (row) => (row.currentMinor / 100).toFixed(2) },
            { key: "z", header: "z", value: (row) => (row.z === null ? "" : row.z.toFixed(2)) },
            { key: "flag", header: t("cst.waste.aboveBaseline"), value: (row) => (row.flagged ? "yes" : "") },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t("cst.waste.windowWeeks")} hint={t("cst.waste.windowHint")}>
            <Input inputMode="numeric" dir="ltr" value={windowWeeks} onChange={(event) => setWindowWeeks(event.target.value)} />
          </Field>
          <Field label={t("cst.waste.sigma")} hint={t("cst.waste.sigmaHint")}>
            <Input inputMode="decimal" dir="ltr" value={sigma} onChange={(event) => setSigma(event.target.value)} />
          </Field>
          <Toggle checked={trueOnly} onChange={setTrueOnly} label={t("cst.waste.trueOnly")} />
          <Toggle checked={flaggedOnly} onChange={setFlaggedOnly} label={t("cst.waste.flaggedOnly")} />
        </div>
        <Callout tone={flagged > 0 ? "warn" : "muted"}>
          {t("cst.waste.flaggedCount").replace("{n}", String(flagged)).replace("{k}", formatNumber(k, fmt, 1))}
        </Callout>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} caption={t("cst.waste.baselineTitle")} dense />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-CST-024
// ---------------------------------------------------------------------------

const FACTOR_LABEL: Record<FactorKey, ConsoleKey> = {
  labourHours: "cst.waste.factor.labourHours",
  orderVolume: "cst.waste.factor.orderVolume",
  newStarters: "cst.waste.factor.newStarters",
  equipmentFaults: "cst.waste.factor.equipmentFaults",
};

function CorrelationSection({ sources, onFaultsChanged }: { sources: Sources; onFaultsChanged: () => void }) {
  const { t, tx, fmt } = useI18n();
  const [reason, setReason] = useState("");
  const [newWithinDays, setNewWithinDays] = useState("30");

  const reasons = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of sources.waste) seen.set(record.reasonCode, tx(record.reasonName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sources.waste, tx]);

  const within = Math.max(1, Math.floor(Number(newWithinDays)) || 30);

  const results = useMemo(() => {
    const days = sources.waste.map((record) => record.recordedAt.slice(0, 10)).sort();
    if (days.length === 0) return [];
    const span = { from: days[0]!, to: days[days.length - 1]! };
    return correlate(
      dailyWaste(sources.waste, reason || null),
      [
        { key: "labourHours", byDay: sources.attendance ? labourHoursByDay(sources.attendance) : null },
        { key: "orderVolume", byDay: ordersByDay(sources.orders) },
        {
          key: "newStarters",
          byDay: sources.attendance && sources.employees ? newStartersByDay(sources.attendance, sources.employees, within) : null,
        },
        { key: "equipmentFaults", byDay: faultsByDay(sources.faults) },
      ],
      span,
    );
  }, [sources, reason, within]);

  return (
    <Section title={t("cst.waste.correlationTitle")} hint={t("cst.waste.correlationHint")} spec="FR-CST-024">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("cst.waste.reason")}>
            <Select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {reasons.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cst.waste.newWithinDays")}>
            <Input inputMode="numeric" dir="ltr" value={newWithinDays} onChange={(event) => setNewWithinDays(event.target.value)} />
          </Field>
        </div>

        <ul className="divide-line divide-y">
          {results.map((result) => {
            const strength = strengthOf(result.r);
            return (
              <li key={result.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <span className="text-fg text-sm">{t(FACTOR_LABEL[result.key])}</span>
                  <span className="text-fg-subtle text-xs">
                    {!result.available
                      ? t("cst.waste.factorUnavailable")
                      : result.suppressed
                        ? t("cst.waste.tooFewDays").replace("{n}", String(result.n)).replace("{min}", String(MIN_CORRELATION_DAYS))
                        : t("cst.waste.pairedDays").replace("{n}", String(result.n))}
                  </span>
                </span>
                {result.r !== null ? (
                  <span className="flex min-w-48 items-center gap-3">
                    <div className="w-24">
                      <Meter value={Math.abs(result.r) * 100} tone={result.r > 0 ? "warn" : "accent"} />
                    </div>
                    <span className="font-mono text-sm tabular-nums" dir="ltr">
                      r = {formatNumber(result.r, fmt, 2)}
                    </span>
                    <Badge tone={strength === "strong" ? "bad" : strength === "moderate" ? "warn" : "muted"}>
                      {t(`cst.waste.strength.${strength}` as ConsoleKey)}
                    </Badge>
                  </span>
                ) : (
                  <span className="text-fg-subtle text-sm">—</span>
                )}
              </li>
            );
          })}
        </ul>

        <Callout tone="muted">{t("cst.waste.notCausation")}</Callout>

        <FaultLog faults={sources.faults} onChanged={onFaultsChanged} />
      </div>
    </Section>
  );
}

function FaultLog({ faults, onChanged }: { faults: EquipmentFault[]; onChanged: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches, scope, session } = useSession();
  const confirm = useConfirm();
  const [message, setMessage] = useTransientMessage();
  const [equipment, setEquipment] = useState("");
  const [reportedOn, setReportedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState(scope.branchId ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchName = (id: string | null) => {
    const branch = availableBranches.find((row) => row.id === id);
    return branch ? tx(branch.name) : t("cst.waste.allBranches");
  };

  async function add() {
    setSaving(true);
    setError(null);
    try {
      await services.equipmentFaults.record({
        equipment,
        reportedOn,
        branchId: branchId || null,
        note,
        reportedBy: session?.user ? tx(session.user.name) : null,
      });
      setEquipment("");
      setNote("");
      setMessage(t("cst.waste.faultSaved"));
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove(fault: EquipmentFault) {
    const ok = await confirm({
      title: t("cst.waste.faultDeleteTitle"),
      body: `${fault.equipment} · ${formatDate(fault.reportedOn, fmt)}`,
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await services.equipmentFaults.remove(fault.id);
    onChanged();
  }

  return (
    <div className="border-line space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-fg text-sm font-semibold">{t("cst.waste.faultLogTitle")}</h3>
        <p className="text-fg-subtle mt-0.5 text-xs">{t("cst.waste.faultLogHint")}</p>
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("cst.waste.equipment")} required>
          <Input value={equipment} onChange={(event) => setEquipment(event.target.value)} />
        </Field>
        <Field label={t("common.date")} required>
          <Input type="date" dir="ltr" value={reportedOn} onChange={(event) => setReportedOn(event.target.value)} />
        </Field>
        <Field label={t("common.branch")}>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">{t("cst.waste.allBranches")}</option>
            {availableBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.notes")}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      <Button variant="secondary" icon={<Plus size={14} />} loading={saving} disabled={!equipment.trim()} onClick={add}>
        {t("cst.waste.addFault")}
      </Button>

      {faults.length > 0 ? (
        <ul className="divide-line divide-y text-sm">
          {[...faults]
            .sort((a, b) => b.reportedOn.localeCompare(a.reportedOn))
            .map((fault) => (
              <li key={fault.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="text-fg">{fault.equipment}</span>
                  <span className="text-fg-subtle text-xs">
                    {formatDate(fault.reportedOn, fmt)} · {branchName(fault.branchId)}
                    {fault.note ? ` · ${fault.note}` : ""}
                  </span>
                </span>
                <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => remove(fault)} aria-label={t("common.delete")}>
                  {t("common.delete")}
                </Button>
              </li>
            ))}
        </ul>
      ) : null}
      <Toast message={message} />
    </div>
  );
}
