"use client";

/**
 * Kitchen employee metrics and employee ranking — FR-HRM-031, FR-HRM-032.
 *
 * The kitchen numbers come from the KDS tickets themselves (fire, start and
 * bump times, the lines, the remake priority) — the same store the station
 * screens write to. Attribution to a cook is by station assignment; see
 * `lib/console/workforce-metrics.ts` for why, and the screen says it.
 *
 * Ranking is on any metric, within a branch and/or position, over a period,
 * and it is a table rather than a leaderboard: ties share a rank, people with
 * no value for the metric are listed unranked, and the percentile sits next
 * to the rank so a two-person group does not make someone "last".
 */

import { Fragment, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Employee, Id, KitchenTicket } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches, useStations } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatDate, formatDuration, formatMoney, formatNumber, money } from "@/lib/console/format";
import {
  kitchenMetrics,
  rankWithin,
  serviceMetrics,
  type StationAssignment,
} from "@/lib/console/workforce-metrics";
import { localDateIso } from "@/lib/console/workforce-rules";
import { useConfirm } from "@/components/console/confirm";
import { DateRangeField, resolvePreset, type DateRange } from "@/components/console/fields";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, Field, Input, Select, cx } from "@/components/console/ui";

/** Every ticket the console can see: the live store plus the server's queue. */
function useKitchenTickets(): KitchenTicket[] {
  const { state } = useLive();
  const { scope } = useSession();
  const remote = useAsync(
    () =>
      services.operations
        .kitchenQueue({ scope, limit: 500 })
        .then((page) => page.rows)
        .catch(() => [] as KitchenTicket[]),
    [scope.branchId, scope.brandId],
  );
  return useMemo(() => {
    const byId = new Map<Id, KitchenTicket>();
    for (const ticket of remote.data ?? []) byId.set(ticket.id, ticket);
    for (const id of state.ticketIds) {
      const ticket = state.tickets[id];
      if (ticket) byId.set(ticket.id, ticket);
    }
    return [...byId.values()];
  }, [remote.data, state.ticketIds, state.tickets]);
}

function useAssignments(reloadKey: number) {
  return useAsync(() => services.workforceHr.stationAssignments.all(), [reloadKey]);
}

function useEmployees() {
  return useAsync(
    () =>
      services.workforce.employees
        .list({ limit: 500 })
        .then((page) => page.rows)
        .catch(() => [] as Employee[]),
    [],
  );
}

// ---------------------------------------------------------------------------
// FR-HRM-031 — kitchen metrics
// ---------------------------------------------------------------------------

export function KitchenMetricsPanel() {
  const { t, tx, fmt } = useI18n();
  const [period, setPeriod] = useState<DateRange>(() => resolvePreset("last7"));
  const [reloadKey, setReloadKey] = useState(0);
  const tickets = useKitchenTickets();
  const assignments = useAssignments(reloadKey);
  const [expanded, setExpanded] = useState<Id | null>(null);

  const result = useMemo(
    () => kitchenMetrics(tickets, assignments.data ?? [], period),
    [tickets, assignments.data, period],
  );

  return (
    <div className="space-y-4">
      <Callout tone="muted" title={t("wf.kitchen.attributionTitle")}>
        {t("wf.kitchen.attributionBody")}
      </Callout>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeField value={period} onChange={setPeriod} label={t("wf.rank.period")} />
        <ExportButton
          filename={`kitchen-metrics-${period.from}-${period.to}`}
          title={t("wf.kitchen.title")}
          permission="report.view.workforce"
          rows={result.rows}
          columns={[
            { key: "name", header: t("wf.employee"), value: (row) => tx(row.employeeName) },
            { key: "tickets", header: t("wf.kitchen.tickets"), value: (row) => row.tickets },
            { key: "items", header: t("wf.kitchen.itemsPrepared"), value: (row) => row.itemsPrepared },
            { key: "avg", header: t("wf.kitchen.avgPrep"), value: (row) => row.averagePrepSeconds ?? "" },
            { key: "remakes", header: t("wf.kitchen.remakes"), value: (row) => row.remakeCount },
            { key: "shared", header: t("wf.kitchen.shared"), value: (row) => row.sharedTickets },
          ]}
        />
      </div>

      {result.unattributed > 0 ? (
        <Callout tone="warn">
          {t("wf.kitchen.unattributed").replace("{n}", formatNumber(result.unattributed, fmt))}
        </Callout>
      ) : null}

      {result.rows.length === 0 ? (
        <Callout tone="muted">{t("wf.kitchen.none")}</Callout>
      ) : (
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t("wf.kitchen.title")}</caption>
            <thead>
              <tr className="bg-sunken border-line border-b text-xs">
                <th scope="col" className="text-fg-muted px-3 py-2 text-start font-medium">{t("wf.employee")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.kitchen.itemsPrepared")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.kitchen.avgPrep")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.kitchen.remakes")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.kitchen.tickets")}</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {result.rows.map((row) => (
                <Fragment key={row.employeeId}>
                  <tr
                    className="hover:bg-sunken/50 cursor-pointer"
                    onClick={() => setExpanded(expanded === row.employeeId ? null : row.employeeId)}
                  >
                    <th scope="row" className="text-fg px-3 py-2 text-start font-normal">
                      {tx(row.employeeName)}
                      {row.sharedTickets > 0 ? (
                        <Badge tone="muted" className="ms-2">
                          {t("wf.kitchen.sharedBadge").replace("{n}", String(row.sharedTickets))}
                        </Badge>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-end font-mono tabular-nums">{formatNumber(row.itemsPrepared, fmt)}</td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums">
                      {row.averagePrepSeconds === null ? "—" : formatDuration(row.averagePrepSeconds, fmt)}
                    </td>
                    <td className={cx("px-3 py-2 text-end font-mono tabular-nums", row.remakeCount > 0 && "text-warn")}>
                      {formatNumber(row.remakeCount, fmt)}
                    </td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums">{formatNumber(row.tickets, fmt)}</td>
                  </tr>
                  {expanded === row.employeeId ? (
                    <tr>
                      <td colSpan={5} className="bg-sunken/30 px-3 py-2">
                        <p className="text-fg-muted mb-1 text-xs font-medium">{t("wf.kitchen.byItem")}</p>
                        <ul className="grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                          {row.byItem.map((item) => (
                            <li key={item.name.en || item.name.ar} className="flex justify-between gap-2">
                              <span className="text-fg truncate">{tx(item.name)}</span>
                              <span className="text-fg-muted font-mono tabular-nums">
                                {formatNumber(item.count, fmt)} ·{" "}
                                {item.averagePrepSeconds === null ? "—" : formatDuration(item.averagePrepSeconds, fmt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StationAssignmentsEditor
        assignments={assignments.data ?? []}
        onChanged={() => setReloadKey((n) => n + 1)}
      />
    </div>
  );
}

/** Who was on which station, when — the attribution source for FR-HRM-031. */
function StationAssignmentsEditor({
  assignments,
  onChanged,
}: {
  assignments: StationAssignment[];
  onChanged: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("hr.schedule.manage");
  const stations = useStations(scope);
  const employees = useEmployees();
  const action = useAction();
  const confirm = useConfirm();
  const [draft, setDraft] = useState({
    employeeId: "",
    stationId: "",
    date: localDateIso(new Date()),
    startTime: "08:00",
    endTime: "16:00",
  });

  const recent = [...assignments].sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)).slice(0, 30);

  async function add() {
    const employee = (employees.data ?? []).find((row) => row.id === draft.employeeId);
    const station = stations.find((row) => row.id === draft.stationId);
    if (!employee || !station || draft.startTime === draft.endTime) return;
    await action.run(
      () =>
        services.workforceHr.stationAssignments.create({
          ...draft,
          employeeName: employee.name,
          stationName: station.name,
          branchId: station.branchId,
        }),
      { onSuccess: onChanged },
    );
  }

  async function remove(row: StationAssignment) {
    const ok = await confirm({
      title: t("wf.kitchen.removeAssignment"),
      body: t("wf.kitchen.removeAssignmentBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.workforceHr.stationAssignments.remove(row.id), { onSuccess: onChanged });
  }

  return (
    <section className="border-line space-y-3 rounded-lg border p-3">
      <h3 className="text-fg text-sm font-semibold">{t("wf.kitchen.assignments")}</h3>
      <p className="text-fg-subtle text-xs">{t("wf.kitchen.assignmentsHint")}</p>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {canManage ? (
        <div className="grid items-end gap-2 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Field label={t("wf.employee")}>
              <Select value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}>
                <option value="">—</option>
                {(employees.data ?? [])
                  .filter((row) => row.status === "active")
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {tx(row.name)}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label={t("wf.kitchen.station")}>
            <Select value={draft.stationId} onChange={(event) => setDraft({ ...draft, stationId: event.target.value })}>
              <option value="">—</option>
              {stations.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" dir="ltr" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
          </Field>
          <Field label={t("wf.startTime")}>
            <Input type="time" dir="ltr" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} />
          </Field>
          <Field label={t("wf.endTime")}>
            <Input type="time" dir="ltr" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} />
          </Field>
          <Button
            size="sm"
            icon={<Plus size={12} />}
            loading={action.pending}
            disabled={!draft.employeeId || !draft.stationId || draft.startTime === draft.endTime}
            onClick={() => void add()}
          >
            {t("common.add")}
          </Button>
        </div>
      ) : null}
      {recent.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("wf.kitchen.noAssignments")}</p>
      ) : (
        <ul className="divide-line divide-y text-xs">
          {recent.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-fg">
                {tx(row.employeeName)} · {tx(row.stationName)}
              </span>
              <span className="text-fg-muted flex items-center gap-2 font-mono tabular-nums">
                {formatDate(row.date, fmt)} {row.startTime}–{row.endTime}
                {canManage ? (
                  <Button size="sm" variant="ghost" aria-label={t("common.delete")} icon={<Trash2 size={12} />} onClick={() => void remove(row)} />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// FR-HRM-032 — ranking
// ---------------------------------------------------------------------------

type MetricKey =
  | "netSales"
  | "orderCount"
  | "averageOrder"
  | "discount"
  | "voidedLines"
  | "itemsPrepared"
  | "averagePrep"
  | "remakes";

const METRICS: { key: MetricKey; higherIsBetter: boolean; kind: "money" | "count" | "seconds" }[] = [
  { key: "netSales", higherIsBetter: true, kind: "money" },
  { key: "orderCount", higherIsBetter: true, kind: "count" },
  { key: "averageOrder", higherIsBetter: true, kind: "money" },
  { key: "discount", higherIsBetter: false, kind: "money" },
  { key: "voidedLines", higherIsBetter: false, kind: "count" },
  { key: "itemsPrepared", higherIsBetter: true, kind: "count" },
  { key: "averagePrep", higherIsBetter: false, kind: "seconds" },
  { key: "remakes", higherIsBetter: false, kind: "count" },
];

interface RankRow {
  employeeId: Id;
  name: Employee["name"];
  branchId: Id | null;
  position: Employee["position"] | null;
  values: Record<MetricKey, number | null>;
}

export function RankingPanel() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const { state } = useLive();
  const branches = useBranches(scope);
  const employees = useEmployees();
  const tickets = useKitchenTickets();
  const assignments = useAssignments(0);

  const [period, setPeriod] = useState<DateRange>(() => resolvePreset("last30"));
  const [metric, setMetric] = useState<MetricKey>("netSales");
  const [branchId, setBranchId] = useState<string>("all");
  const [position, setPosition] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"none" | "branch" | "position">("none");

  const currency = branches[0]?.currency ?? "EGP";

  const rows = useMemo<RankRow[]>(() => {
    const byEmployee = new Map((employees.data ?? []).map((row) => [row.id, row]));
    const out = new Map<string, RankRow>();
    const rowFor = (employeeId: Id, fallbackName: Employee["name"], fallbackBranch: Id | null) => {
      const employee = byEmployee.get(employeeId);
      const branch = fallbackBranch ?? employee?.homeBranchId ?? null;
      const key = `${employeeId}::${branch}`;
      const existing = out.get(key);
      if (existing) return existing;
      const created: RankRow = {
        employeeId,
        name: employee?.name ?? fallbackName,
        branchId: branch,
        position: employee?.position ?? null,
        values: {
          netSales: null,
          orderCount: null,
          averageOrder: null,
          discount: null,
          voidedLines: null,
          itemsPrepared: null,
          averagePrep: null,
          remakes: null,
        },
      };
      out.set(key, created);
      return created;
    };

    const orders = state.orderIds.map((id) => state.orders[id]).filter((order) => order !== undefined);
    for (const metricRow of serviceMetrics(orders, period)) {
      const row = rowFor(metricRow.employeeId, metricRow.employeeName, metricRow.branchId);
      row.values.netSales = metricRow.netSalesMinor;
      row.values.orderCount = metricRow.orderCount;
      row.values.averageOrder = metricRow.averageOrderMinor;
      row.values.discount = metricRow.discountMinor;
      row.values.voidedLines = metricRow.voidedLines;
    }
    for (const metricRow of kitchenMetrics(tickets, assignments.data ?? [], period).rows) {
      const assignment = (assignments.data ?? []).find((a) => a.employeeId === metricRow.employeeId);
      const row = rowFor(metricRow.employeeId, metricRow.employeeName, assignment?.branchId ?? null);
      row.values.itemsPrepared = metricRow.itemsPrepared;
      row.values.averagePrep = metricRow.averagePrepSeconds;
      row.values.remakes = metricRow.remakeCount;
    }
    return [...out.values()];
  }, [employees.data, state.orderIds, state.orders, tickets, assignments.data, period]);

  const positions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (row.position?.en) seen.set(row.position.en, tx(row.position));
    return [...seen.entries()];
  }, [rows, tx]);

  const definition = METRICS.find((entry) => entry.key === metric)!;
  const filtered = rows.filter(
    (row) =>
      (branchId === "all" || row.branchId === branchId) && (position === "all" || row.position?.en === position),
  );
  const ranked = rankWithin(filtered, {
    value: (row) => row.values[metric],
    higherIsBetter: definition.higherIsBetter,
    groupOf: (row) =>
      groupBy === "branch" ? (row.branchId ?? "") : groupBy === "position" ? (row.position?.en ?? "") : "all",
    tiebreak: (row) => row.name.en,
  });

  const show = (value: number | null) =>
    value === null
      ? "—"
      : definition.kind === "money"
        ? formatMoney(money(value, currency), fmt)
        : definition.kind === "seconds"
          ? formatDuration(value, fmt)
          : formatNumber(value, fmt);

  const groupLabel = (key: string) =>
    groupBy === "branch"
      ? tx(branches.find((branch) => branch.id === key)?.name) || key
      : groupBy === "position"
        ? positions.find(([value]) => value === key)?.[1] ?? key
        : "";

  return (
    <div className="space-y-4">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <DateRangeField value={period} onChange={setPeriod} label={t("wf.rank.period")} />
        </div>
        <Field label={t("wf.rank.metric")}>
          <Select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
            {METRICS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {t(`wf.rank.metric.${entry.key}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.branch")}>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="all">{t("common.all")}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("wf.position")}>
          <Select value={position} onChange={(event) => setPosition(event.target.value)}>
            <option value="all">{t("common.all")}</option>
            {positions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t("wf.rank.groupBy")}>
          <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
            <option value="none">{t("wf.rank.groupNone")}</option>
            <option value="branch">{t("common.branch")}</option>
            <option value="position">{t("wf.position")}</option>
          </Select>
        </Field>
        <ExportButton
          filename={`employee-ranking-${metric}-${period.from}-${period.to}`}
          title={t("wf.rank.title")}
          permission="report.view.workforce"
          rows={ranked}
          columns={[
            { key: "group", header: t("wf.rank.groupBy"), value: (row) => groupLabel(row.groupKey) },
            { key: "rank", header: t("wf.rank.rank"), value: (row) => row.rank ?? "" },
            { key: "name", header: t("wf.employee"), value: (row) => tx(row.row.name) },
            { key: "value", header: t(`wf.rank.metric.${metric}` as never), value: (row) => row.value ?? "" },
            { key: "percentile", header: t("wf.rank.percentile"), value: (row) => row.percentile ?? "" },
          ]}
        />
      </div>

      <Callout tone="muted">
        {t(definition.higherIsBetter ? "wf.rank.higherBetter" : "wf.rank.lowerBetter")} {t("wf.rank.note")}
      </Callout>

      {ranked.length === 0 ? (
        <Callout tone="muted">{t("wf.rank.none")}</Callout>
      ) : (
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">{t("wf.rank.title")}</caption>
            <thead>
              <tr className="bg-sunken border-line border-b text-xs">
                {groupBy !== "none" ? (
                  <th scope="col" className="text-fg-muted px-3 py-2 text-start font-medium">{t("wf.rank.group")}</th>
                ) : null}
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.rank.rank")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-start font-medium">{t("wf.employee")}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t(`wf.rank.metric.${metric}` as never)}</th>
                <th scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">{t("wf.rank.percentile")}</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {ranked.map((entry) => (
                <tr key={`${entry.groupKey}-${entry.row.employeeId}-${entry.row.branchId}`}>
                  {groupBy !== "none" ? <td className="text-fg-muted px-3 py-2 text-xs">{groupLabel(entry.groupKey)}</td> : null}
                  <td className="px-3 py-2 text-end font-mono tabular-nums">
                    {entry.rank === null ? <span className="text-fg-subtle">—</span> : `${entry.rank} / ${entry.groupSize}`}
                  </td>
                  <td className="text-fg px-3 py-2">
                    {tx(entry.row.name)}
                    {entry.row.position ? <span className="text-fg-subtle ms-2 text-xs">{tx(entry.row.position)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums">{show(entry.value)}</td>
                  <td className="text-fg-muted px-3 py-2 text-end font-mono tabular-nums">
                    {entry.percentile === null ? "—" : `${entry.percentile}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
