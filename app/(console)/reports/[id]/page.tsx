"use client";

/**
 * One report, run — SRS §19.3, FR-RPT-004, FR-RPT-042, FR-RPT-043.
 *
 * The catalogue lists what exists; this runs it. Three requirements shape
 * the layout:
 *
 *   - **Every figure states when it was computed** (FR-RPT-004), and says so
 *     loudly when the period is not finished. A manager looking at today's
 *     sales at 14:00 must know the number is partial; systems that hide that
 *     generate support tickets which are not defects.
 *   - **Every aggregate drills** (FR-RPT-042), in no more than four
 *     interactions. Here it is two: click the row, read the transactions.
 *   - **Export is a first-class action** (FR-RPT-043) and is logged with the
 *     filters and the row count (FR-RPT-044).
 */

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, RefreshCw } from "lucide-react";

import type { ReportDefinition } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  GROUPINGS,
  runReport,
  type DrillRow,
  type ReportResult,
} from "@/lib/console/reports/engine";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, money } from "@/lib/console/format";
import { DateRangeField, resolvePreset, type DateRange } from "@/components/console/fields";
import { PageBody, PageHeader, Section, Toolbar } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { CategoryBarChart } from "@/components/console/charts";
import { PeriodComparison } from "@/components/console/report-compare";
import { loadSalesRollup, reportToday } from "@/lib/console/reports/rollup";
import { delta } from "@/lib/console/reports/periods";
import { resolveComparison, type CompareMode } from "@/lib/console/reports/periods";
import {
  Badge,
  Button,
  Callout,
  Drawer,
  Field,
  Meter,
  SegmentedControl,
  Select,
  Toast,
  cx,
} from "@/components/console/ui";

export default function ReportRunnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <Runner id={id} />;
}

function Runner({ id }: { id: string }) {
  const { t, tx, fmt, locale } = useI18n();
  const router = useRouter();
  const { scope, canAny } = useSession();
  const branches = useBranches(scope);
  const [message, setMessage] = useTransientMessage();

  const [range, setRange] = useState<DateRange>(() => resolvePreset("last30"));
  const [branchId, setBranchId] = useState<string>(scope.branchId ?? "");
  const [groupBy, setGroupBy] = useState<string>(() => GROUPINGS[id]?.[0]?.key ?? "");
  const [mode, setMode] = useState<CompareMode>("off");
  const [drilling, setDrilling] = useState<{ label: string; rows: DrillRow[] } | null>(null);
  const [nonce, setNonce] = useState(0);

  const catalogue = useAsync<ReportDefinition[]>(() => services.platform.reports(), []);
  const definition = (catalogue.data ?? []).find((entry) => entry.id === id) ?? null;

  // A comparison fixes the period: "this week" and "this year" are not
  // free-form ranges, so the date picker steps aside while one is chosen.
  const periods = useMemo(() => resolveComparison(mode, reportToday()), [mode]);
  const active = periods ? periods.current : range;
  const activeScope = { ...scope, branchId: branchId || scope.branchId };
  const isSales = definition?.category === "sales";

  const result = useAsync<ReportResult>(
    () =>
      runReport(id, {
        from: active.from,
        to: active.to,
        scope: activeScope,
        groupBy,
        compare: mode !== "off",
        locale,
      }),
    [id, active.from, active.to, branchId, groupBy, mode, locale, nonce],
  );

  // Sales reports compare through the daily rollup (FR-RPT-002): a year of
  // orders is not something a browser should page through.
  const rollup = useAsync(
    () =>
      periods && isSales
        ? loadSalesRollup(
            activeScope,
            branches.map((branch) => ({ id: branch.id, name: branch.name })),
          )
        : Promise.resolve(null),
    [mode, isSales, branchId, branches, nonce],
  );

  // Every other report is run a second time over the previous period, and the
  // table gains a previous and a change column for its headline figure.
  const previous = useAsync<ReportResult | null>(
    () =>
      periods && definition && !isSales
        ? runReport(id, {
            from: periods.previous.from,
            to: periods.previous.to,
            scope: activeScope,
            groupBy,
            compare: true,
            locale,
          })
        : Promise.resolve(null),
    [id, mode, definition, isSales, branchId, groupBy, locale, nonce],
  );

  const allowed = definition ? canAny([definition.requiredPermission]) : true;
  const groupings = GROUPINGS[id] ?? [];

  const filterSummary = useMemo(() => {
    const parts = [`${active.from} → ${active.to}`];
    if (branchId) {
      const branch = branches.find((entry) => entry.id === branchId);
      if (branch) parts.push(tx(branch.name));
    }
    if (groupBy) parts.push(groupBy);
    return parts.join(" · ");
  }, [active.from, active.to, branchId, branches, groupBy, tx]);

  // Non-sales reports: the headline column, the previous run, and the notice
  // for when the previous period has nothing in it.
  const cmp = useMemo(() => {
    const data = result.data;
    const prev = previous.data;
    if (!periods || isSales || !data || !prev || !data.chart) return null;
    const column = data.columns.find((entry) => entry.key === data.chart!.valueKey);
    if (!column) return null;
    return {
      column,
      rows: new Map(prev.rows.map((row) => [row.id, row])),
      total: Number(prev.totals?.[column.key] ?? 0),
      empty: prev.rows.length === 0,
    };
  }, [periods, isSales, result.data, previous.data]);

  async function drill(rowId: string) {
    const data = result.data;
    if (!data?.drill) return;
    const row = data.rows.find((entry) => entry.id === rowId);
    if (!row) return;
    const rows = await data.drill(row);
    setDrilling({ label: row.label, rows });
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title={definition ? tx(definition.name) : id} />
        <PageBody>
          <Callout tone="warn" title={t("rep.notPermittedTitle")}>
            {t("rep.notPermittedBody").replace(
              "{permission}",
              definition?.requiredPermission ?? "",
            )}
          </Callout>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={definition ? tx(definition.name) : id}
        subtitle={definition ? tx(definition.description) : undefined}
        spec={definition?.specRef}
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
        meta={
          result.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {t("rep.dataAsOf")}: {formatDateTime(result.data.generatedAt, fmt)}
              </span>
              {result.data.partial ? (
                <Badge tone="warn">{t("rep.partialPeriod")}</Badge>
              ) : null}
            </span>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} />}
              onClick={() => setNonce((n) => n + 1)}
            >
              {t("rep.refresh")}
            </Button>
            {result.data ? (
              <ExportButton
                filename={id}
                title={definition ? tx(definition.name) : id}
                filterSummary={filterSummary}
                rows={result.data.rows}
                onExported={setMessage}
                columns={[
                  { key: "label", header: t("rep.col.group"), value: (row) => row.label },
                  ...result.data.columns.map((column) => ({
                    key: column.key,
                    header: t(column.header as never),
                    value: (row: (typeof result.data.rows)[number]) => {
                      const value = row.values[column.key];
                      if (column.currency && typeof value === "number") return value / 100;
                      return value ?? "";
                    },
                  })),
                ]}
              />
            ) : null}
          </div>
        }
      />

      <PageBody>
        {/* -- Parameters -------------------------------------------------- */}
        <Section title={t("rep.parameters")} spec="§19.3">
          <div className="space-y-4">
            <div className="space-y-2">
              <SegmentedControl<CompareMode>
                label={t("rep.cmp.mode")}
                value={mode}
                onChange={setMode}
                options={[
                  { value: "off", label: t("rep.cmp.off") },
                  { value: "week", label: t("rep.cmp.week") },
                  { value: "year", label: t("rep.cmp.year") },
                ]}
              />
              {periods ? (
                <p className="text-fg-subtle text-xs">{t("rep.cmp.fixedPeriod")}</p>
              ) : (
                <DateRangeField value={range} onChange={setRange} label={t("common.period")} />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("common.branch")}>
                <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">{t("common.all")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {tx(branch.name)}
                    </option>
                  ))}
                </Select>
              </Field>

              {groupings.length > 0 ? (
                <Field label={t("common.grouping")}>
                  <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                    {groupings.map((option) => (
                      <option key={option.key} value={option.key}>
                        {t(option.labelKey as never)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          </div>
        </Section>

        {/* -- Comparison (sales reports) ---------------------------------- */}
        {periods && isSales ? (
          <AsyncPanel state={rollup}>
            {(data) => (data ? <PeriodComparison periods={periods} rollup={data} /> : null)}
          </AsyncPanel>
        ) : null}

        {periods && isSales ? (
          <Callout tone="muted">{t("rep.cmp.ordersNote")}</Callout>
        ) : null}

        {/* -- Result ------------------------------------------------------ */}
        <AsyncPanel state={result}>
          {(data) =>
            data.unavailable ? (
              <Callout tone="muted" title={t("rep.noSourceTitle")}>
                {t("rep.noSourceBody")}
              </Callout>
            ) : data.rows.length === 0 ? (
              <Callout tone="muted" title={t("rep.emptyTitle")}>
                {t("rep.emptyBody")}
              </Callout>
            ) : (
              <>
                {data.chart ? (
                  <Section title={t(data.chart.label as never)} padded={false}>
                    <div className="p-4">
                      <CategoryBarChart
                        valueLabel={t(data.chart.label as never)}
                        data={data.rows.slice(0, 12).map((row) => ({
                          label: row.label,
                          value: Number(row.values[data.chart!.valueKey] ?? 0),
                        }))}
                        format={(value: number) =>
                          currencyOf(data, data.chart!.valueKey)
                            ? formatMoney(
                                money(value, currencyOf(data, data.chart!.valueKey) as never),
                                fmt,
                                true,
                              )
                            : formatNumber(value, fmt)
                        }
                      />
                    </div>
                  </Section>
                ) : null}

                {cmp?.empty ? (
                  <Callout tone="warn" title={t("rep.cmp.noPreviousTitle")}>
                    {t("rep.cmp.noPreviousBody")}
                  </Callout>
                ) : null}

                <Section title={t("rep.results")} padded={false}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        {definition ? tx(definition.name) : id}
                      </caption>
                      <thead>
                        <tr className="border-line bg-sunken border-b">
                          <th
                            scope="col"
                            className="text-fg-muted px-3 py-2 text-start text-xs font-medium"
                          >
                            {t("rep.col.group")}
                          </th>
                          {data.columns.map((column) => (
                            <th
                              key={column.key}
                              scope="col"
                              className={cx(
                                "text-fg-muted px-3 py-2 text-xs font-medium",
                                column.numeric ? "text-end" : "text-start",
                              )}
                            >
                              {t(column.header as never)}
                            </th>
                          ))}
                          {cmp ? (
                            <>
                              <th scope="col" className="text-fg-muted px-3 py-2 text-end text-xs font-medium">
                                {t("rep.cmp.previous")}
                              </th>
                              <th scope="col" className="text-fg-muted px-3 py-2 text-end text-xs font-medium">
                                {t("rep.cmp.change")}
                              </th>
                            </>
                          ) : null}
                          {data.drill ? <th scope="col" className="w-8" /> : null}
                        </tr>
                      </thead>

                      <tbody className="divide-line divide-y">
                        {data.rows.map((row) => {
                          const clickable = Boolean(data.drill);
                          return (
                            <tr
                              key={row.id}
                              tabIndex={clickable ? 0 : undefined}
                              onClick={clickable ? () => void drill(row.id) : undefined}
                              onKeyDown={
                                clickable
                                  ? (event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void drill(row.id);
                                      }
                                    }
                                  : undefined
                              }
                              className={cx(
                                clickable && "hover:bg-sunken/60 focus:bg-sunken cursor-pointer",
                              )}
                            >
                              <th
                                scope="row"
                                className="text-fg px-3 py-2 text-start text-sm font-normal"
                              >
                                {row.label}
                                {row.secondary ? (
                                  <span className="text-fg-subtle block text-xs">
                                    {row.secondary}
                                  </span>
                                ) : null}
                              </th>

                              {data.columns.map((column) => {
                                const value = row.values[column.key];
                                const total = Number(data.totals?.[column.key] ?? 0);
                                return (
                                  <td
                                    key={column.key}
                                    className={cx(
                                      "px-3 py-2",
                                      column.numeric && "text-end font-mono tabular-nums",
                                    )}
                                  >
                                    {column.currency && typeof value === "number"
                                      ? formatMoney(money(value, column.currency as never), fmt)
                                      : typeof value === "number"
                                        ? formatNumber(value, fmt, 1)
                                        : String(value ?? "")}
                                    {column.share && total > 0 && typeof value === "number" ? (
                                      <span className="mt-1 block">
                                        <Meter value={(value / total) * 100} tone="accent" />
                                      </span>
                                    ) : null}
                                  </td>
                                );
                              })}

                              {cmp ? (
                                <PreviousCells
                                  column={cmp.column}
                                  current={Number(row.values[cmp.column.key] ?? 0)}
                                  previous={
                                    cmp.rows.has(row.id)
                                      ? Number(cmp.rows.get(row.id)!.values[cmp.column.key] ?? 0)
                                      : null
                                  }
                                />
                              ) : null}

                              {data.drill ? (
                                <td className="px-2 py-2">
                                  <ChevronRight
                                    size={13}
                                    aria-hidden
                                    className="text-fg-subtle"
                                  />
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>

                      {data.totals ? (
                        <tfoot>
                          <tr className="border-line bg-sunken border-t font-medium">
                            <th scope="row" className="text-fg px-3 py-2 text-start text-sm">
                              {t("rep.total")}
                            </th>
                            {data.columns.map((column) => {
                              const value = data.totals?.[column.key];
                              return (
                                <td
                                  key={column.key}
                                  className={cx(
                                    "px-3 py-2",
                                    column.numeric && "text-end font-mono tabular-nums",
                                  )}
                                >
                                  {value === undefined
                                    ? ""
                                    : column.currency && typeof value === "number"
                                      ? formatMoney(money(value, column.currency as never), fmt)
                                      : typeof value === "number"
                                        ? formatNumber(value, fmt, 1)
                                        : String(value)}
                                </td>
                              );
                            })}
                            {cmp ? (
                              <PreviousCells
                                column={cmp.column}
                                current={Number(data.totals?.[cmp.column.key] ?? 0)}
                                previous={cmp.total}
                              />
                            ) : null}
                            {data.drill ? <td /> : null}
                          </tr>
                        </tfoot>
                      ) : null}
                    </table>
                  </div>

                  {data.drill ? (
                    <p className="text-fg-subtle border-line border-t px-3 py-2 text-xs">
                      {t("rep.drillHint")}
                    </p>
                  ) : null}
                </Section>
              </>
            )
          }
        </AsyncPanel>
      </PageBody>

      {/* -- Drill-down ---------------------------------------------------- */}
      {drilling ? (
        <Drawer
          open
          onClose={() => setDrilling(null)}
          title={drilling.label}
          subtitle="FR-RPT-042"
        >
          <div className="space-y-3">
            <Callout tone="muted">{t("rep.drillNote")}</Callout>

            {drilling.rows.length === 0 ? (
              <Callout tone="warn">{t("rep.drillEmpty")}</Callout>
            ) : (
              <ul className="border-line divide-line divide-y rounded-lg border">
                {drilling.rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="text-fg-subtle w-28 shrink-0 tabular-nums">
                      {formatDateTime(row.when, fmt)}
                    </span>
                    <span className="text-fg min-w-0 flex-1 truncate">{row.what}</span>
                    <span className="text-fg-subtle hidden shrink-0 truncate sm:block">
                      {row.who}
                    </span>
                    <span className="text-fg shrink-0 font-mono tabular-nums">
                      {formatMoney(money(row.amount, row.currency as never), fmt)}
                    </span>
                    {row.href ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push(row.href!)}
                        aria-label={t("rep.openDocument")}
                      >
                        {t("rep.open")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-fg-subtle text-xs">
              {t("rep.drillCount").replace("{n}", String(drilling.rows.length))}
            </p>
          </div>
        </Drawer>
      ) : null}

      <Toast message={message} />
    </>
  );
}

/** The currency a numeric column is denominated in, if any. */
function currencyOf(result: ReportResult, key: string): string | undefined {
  return result.columns.find((column) => column.key === key)?.currency;
}

/** The previous-period value and its change, for one row or the total. */
function PreviousCells({
  column,
  current,
  previous,
}: {
  column: { currency?: string };
  current: number;
  previous: number | null;
}) {
  const { fmt } = useI18n();
  const show = (value: number) =>
    column.currency
      ? formatMoney(money(value, column.currency as never), fmt)
      : formatNumber(value, fmt, 1);

  if (previous === null) {
    return (
      <>
        <td className="text-fg-subtle px-3 py-2 text-end font-mono">—</td>
        <td className="text-fg-subtle px-3 py-2 text-end font-mono">—</td>
      </>
    );
  }

  const change = delta(current, previous);
  const tone = change.direction === "flat" ? "text-fg-muted" : change.direction === "up" ? "text-good" : "text-bad";

  return (
    <>
      <td className="text-fg-muted px-3 py-2 text-end font-mono tabular-nums">{show(previous)}</td>
      <td className={cx("px-3 py-2 text-end font-mono tabular-nums", tone)}>
        {change.percent === null
          ? "—"
          : `${change.change > 0 ? "+" : change.change < 0 ? "−" : ""}${formatNumber(Math.abs(change.percent), fmt, 1)}%`}
      </td>
    </>
  );
}
