"use client";

/**
 * Ask a question of the reports — FR-RPT-047.
 *
 * Three steps, and the middle one is the requirement: the question is
 * translated into report-engine parameters, those parameters are shown — as
 * editable fields and as one generated query line — and nothing runs until
 * the user confirms them. A wrong interpretation is corrected in the fields,
 * not discovered in a plausible-looking table.
 *
 * The translation is `parseReportQuestion`, a deterministic bilingual intent
 * parser over the report catalogue. No external model is called, and the
 * question never leaves the browser.
 */

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, MessageSquareText, Play, Sparkles } from "lucide-react";
import type { ReportDefinition } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { GROUPINGS, hasBuilder, runReport, type ReportResult } from "@/lib/console/reports/engine";
import {
  EXAMPLE_QUESTIONS,
  describeQuery,
  parseReportQuestion,
  rankRows,
  type ParsedReportQuery,
} from "@/lib/console/reports/report-query";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, money } from "@/lib/console/format";
import { DateRangeField } from "@/components/console/fields";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { AsyncPanel, LoadingPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { CategoryBarChart } from "@/components/console/charts";
import { Badge, Button, Callout, Field, Input, Select, Toast, Toggle, cx } from "@/components/console/ui";

export default function AskReportsPage() {
  const { t } = useI18n();
  const catalogue = useAsync<ReportDefinition[]>(() => services.platform.reports(), []);

  return (
    <>
      <PageHeader
        title={t("ask.title")}
        subtitle={t("ask.subtitle")}
        spec="FR-RPT-047"
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
      />
      <PageBody>
        <AsyncPanel state={catalogue}>{(reports) => <Ask reports={reports} />}</AsyncPanel>
      </PageBody>
    </>
  );
}

interface AskOutcome {
  query: Draft;
  data: ReportResult;
  /** The preceding period of equal length, when comparison was asked for. */
  previous: ReportResult | null;
  previousRange: { from: string; to: string } | null;
}

/** The period of equal length ending the day before `from`. */
function previousRange(from: string, to: string): { from: string; to: string } {
  const day = 86_400_000;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const length = Math.max(0, Math.round((end - start) / day));
  const prevTo = new Date(start - day);
  const prevFrom = new Date(start - day - length * day);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

type Draft = Pick<ParsedReportQuery, "reportId" | "groupBy" | "from" | "to" | "branchId" | "sort" | "limit" | "compare">;

function Ask({ reports }: { reports: ReportDefinition[] }) {
  const { t, tx, locale, fmt } = useI18n();
  const { scope, canAny } = useSession();
  const branches = useBranches(scope);
  const [message, setMessage] = useTransientMessage();

  const [question, setQuestion] = useState("");
  const [parsed, setParsed] = useState<ParsedReportQuery | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AskOutcome | null>(null);

  const runnable = useMemo(
    () => reports.filter((report) => hasBuilder(report.id)),
    [reports],
  );
  const reportById = useMemo(() => new Map(reports.map((report) => [report.id, report])), [reports]);

  function interpret(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = parseReportQuestion(trimmed, {
      today: new Date().toISOString().slice(0, 10),
      reports: runnable.map((report) => ({ id: report.id, permitted: canAny([report.requiredPermission]) })),
      branches: branches.map((branch) => ({
        id: branch.id,
        names: [branch.name.en, branch.name.ar, branch.code].filter((name): name is string => Boolean(name)),
      })),
    });
    setParsed(next);
    setDraft({
      reportId: next.reportId,
      groupBy: next.groupBy,
      from: next.from,
      to: next.to,
      branchId: next.branchId,
      sort: next.sort,
      limit: next.limit,
      compare: next.compare,
    });
    setResult(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    interpret(question);
  }

  async function run() {
    if (!draft?.reportId) return;
    setRunning(true);
    try {
      const params = {
        scope: { ...scope, branchId: draft.branchId ?? scope.branchId },
        groupBy: draft.groupBy ?? "",
        compare: draft.compare,
        locale,
      };
      const range = draft.compare ? previousRange(draft.from, draft.to) : null;
      const [data, previous] = await Promise.all([
        runReport(draft.reportId, { ...params, from: draft.from, to: draft.to }),
        range ? runReport(draft.reportId, { ...params, ...range }) : Promise.resolve(null),
      ]);
      setResult({ query: draft, data, previous, previousRange: range });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    } finally {
      setRunning(false);
    }
  }

  const definition = draft?.reportId ? reportById.get(draft.reportId) ?? null : null;
  const permitted = definition ? canAny([definition.requiredPermission]) : false;
  const groupings = draft?.reportId ? GROUPINGS[draft.reportId] ?? [] : [];

  return (
    <>
      <Section title={t("ask.questionTitle")} hint={t("ask.questionHint")} spec="FR-RPT-047">
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label={t("ask.questionLabel")}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t("ask.placeholder")}
                dir="auto"
                aria-describedby="ask-privacy"
              />
              <Button type="submit" variant="primary" icon={<MessageSquareText size={14} aria-hidden />} disabled={!question.trim()}>
                {t("ask.interpret")}
              </Button>
            </div>
          </Field>
          <p id="ask-privacy" className="text-fg-subtle text-xs">
            {t("ask.privacy")}
          </p>
          <div>
            <p className="text-fg-muted mb-1.5 text-xs">{t("ask.examples")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUESTIONS.map((example) => {
                const text = example[locale];
                return (
                  <li key={example.en}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion(text);
                        interpret(text);
                      }}
                      className="border-line bg-sunken/50 text-fg-muted hover:text-fg focus-visible:ring-accent rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </form>
      </Section>

      {parsed && draft ? (
        <Section
          title={t("ask.interpretedTitle")}
          hint={t("ask.interpretedHint")}
          action={
            <Badge tone={parsed.confidence === "high" ? "good" : parsed.confidence === "medium" ? "warn" : "bad"}>
              {t(`ask.confidence.${parsed.confidence}` as never)}
            </Badge>
          }
        >
          <div className="space-y-4">
            <div aria-live="polite">
              <p className="text-fg-muted mb-1 text-xs">{t("ask.generatedQuery")}</p>
              <code dir="ltr" className="border-line bg-sunken text-fg block rounded-lg border px-3 py-2 font-mono text-xs break-words">
                {describeQuery(draft)}
              </code>
            </div>

            {parsed.matches.length > 0 ? (
              <div>
                <p className="text-fg-muted mb-1.5 text-xs">{t("ask.understood")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {parsed.matches.map((match, index) => (
                    <li key={`${match.kind}-${index}`}>
                      <Badge tone="accent">
                        “{match.text}” → {t(`ask.kind.${match.kind}` as never)}: {match.value}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {parsed.unrecognised.length > 0 ? (
              <Callout tone="warn" title={t("ask.unrecognisedTitle")}>
                {t("ask.unrecognisedBody")} <span className="font-medium">{parsed.unrecognised.join(", ")}</span>
              </Callout>
            ) : null}
            {parsed.periodDefaulted ? <Callout tone="muted">{t("ask.periodDefaulted")}</Callout> : null}
            {parsed.measure === null ? <Callout tone="warn">{t("ask.noMeasure")}</Callout> : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t("ask.report")}>
                <Select
                  value={draft.reportId ?? ""}
                  onChange={(event) => {
                    const reportId = event.target.value || null;
                    const options = reportId ? GROUPINGS[reportId] ?? [] : [];
                    setDraft({
                      ...draft,
                      reportId,
                      groupBy: options.some((option) => option.key === draft.groupBy) ? draft.groupBy : options[0]?.key ?? null,
                      // A sort key belongs to one report's columns.
                      sort: reportId === draft.reportId ? draft.sort : null,
                    });
                  }}
                >
                  <option value="">{t("common.select")}</option>
                  {runnable.map((report) => (
                    <option key={report.id} value={report.id}>
                      {tx(report.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              {groupings.length > 0 ? (
                <Field label={t("common.grouping")}>
                  <Select value={draft.groupBy ?? ""} onChange={(event) => setDraft({ ...draft, groupBy: event.target.value })}>
                    {groupings.map((option) => (
                      <option key={option.key} value={option.key}>
                        {t(option.labelKey as never)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label={t("common.branch")}>
                <Select value={draft.branchId ?? ""} onChange={(event) => setDraft({ ...draft, branchId: event.target.value || null })}>
                  <option value="">{t("common.all")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {tx(branch.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("ask.sort")}>
                <Select
                  value={draft.sort ? draft.sort.direction : ""}
                  onChange={(event) => {
                    const direction = event.target.value as "asc" | "desc" | "";
                    setDraft({
                      ...draft,
                      sort: direction ? { key: draft.sort?.key ?? parsed.valueKey ?? "net", direction } : null,
                    });
                  }}
                >
                  <option value="">{t("ask.sortNone")}</option>
                  <option value="desc">{t("ask.sortDesc")}</option>
                  <option value="asc">{t("ask.sortAsc")}</option>
                </Select>
              </Field>
              <Field label={t("ask.limit")}>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  value={draft.limit ?? ""}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    setDraft({ ...draft, limit: event.target.value && Number.isInteger(n) && n > 0 ? Math.min(500, n) : null });
                  }}
                />
              </Field>
              <div className="flex items-end">
                <Toggle checked={draft.compare} onChange={(compare) => setDraft({ ...draft, compare })} label={t("rep.compare")} />
              </div>
            </div>
            <DateRangeField value={{ from: draft.from, to: draft.to }} onChange={(range) => setDraft({ ...draft, ...range })} label={t("common.period")} />

            {definition && !permitted ? (
              <Callout tone="warn" title={t("rep.notPermittedTitle")}>
                {t("rep.notPermittedBody").replace("{permission}", definition.requiredPermission)}
              </Callout>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<Play size={13} aria-hidden />} disabled={!draft.reportId || !permitted} loading={running} onClick={() => void run()}>
                {t("ask.confirmRun")}
              </Button>
              {draft.reportId ? (
                <Link
                  href={`/reports/${draft.reportId}`}
                  className="text-accent focus-visible:ring-accent inline-flex items-center gap-1 rounded text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {t("ask.openRunner")}
                  <ArrowRight size={12} className="rtl:rotate-180" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        </Section>
      ) : (
        <Callout tone="muted" icon={<Sparkles size={14} />}>
          {t("ask.emptyState")}
        </Callout>
      )}

      {running && !result ? <LoadingPanel compact /> : null}
      {result ? <AskResult result={result} title={definition ? tx(definition.name) : result.query.reportId ?? ""} fmtLocale={fmt} onExported={setMessage} /> : null}

      <Toast message={message} />
    </>
  );
}

function AskResult({
  result,
  title,
  fmtLocale,
  onExported,
}: {
  result: AskOutcome;
  title: string;
  fmtLocale: ReturnType<typeof useI18n>["fmt"];
  onExported: (message: string) => void;
}) {
  const { t } = useI18n();
  const { data, query, previous } = result;
  const fmt = fmtLocale;

  if (data.unavailable) {
    return (
      <Callout tone="muted" title={t("rep.noSourceTitle")}>
        {t("rep.noSourceBody")}
      </Callout>
    );
  }

  // The sort key may not exist on this report's columns (the user changed
  // the report after interpreting). Fall back to the chart column, then none.
  const columnKeys = new Set(data.columns.map((column) => column.key));
  const sortKey = query.sort && columnKeys.has(query.sort.key) ? query.sort.key : query.sort ? data.chart?.valueKey ?? null : null;
  const rows = rankRows(data.rows, sortKey && query.sort ? { key: sortKey, direction: query.sort.direction } : null, query.limit);
  const currencyOf = (key: string) => data.columns.find((column) => column.key === key)?.currency;
  // Period comparison: the same rows' figure in the preceding equal period,
  // matched by row id. Only meaningful for dimension groupings — a day in
  // this period has no namesake in the last, so those rows show a dash.
  const compareKey = previous && !previous.unavailable ? (sortKey ?? data.chart?.valueKey ?? null) : null;
  const previousById = new Map((previous?.rows ?? []).map((row) => [row.id, row]));
  const render = (key: string, value: number | string | undefined) => {
    const currency = currencyOf(key);
    if (currency && typeof value === "number") return formatMoney(money(value, currency as never), fmt);
    if (typeof value === "number") return formatNumber(value, fmt, 1);
    return String(value ?? "");
  };

  return (
    <Section
      title={t("ask.answerTitle")}
      hint={`${describeQuery({ ...query, sort: sortKey && query.sort ? { key: sortKey, direction: query.sort.direction } : null })}`}
      spec="FR-RPT-004"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-subtle text-xs">
            {t("rep.dataAsOf")}: {formatDateTime(data.generatedAt, fmt)}
          </span>
          {data.partial ? <Badge tone="warn">{t("rep.partialPeriod")}</Badge> : null}
          <ExportButton
            size="sm"
            filename={`ask-${query.reportId}`}
            title={title}
            filterSummary={describeQuery(query)}
            rows={rows}
            onExported={onExported}
            columns={[
              { key: "label", header: t("rep.col.group"), value: (row) => row.label },
              ...data.columns.map((column) => ({
                key: column.key,
                header: t(column.header as never),
                value: (row: (typeof rows)[number]) => {
                  const value = row.values[column.key];
                  return column.currency && typeof value === "number" ? value / 100 : (value ?? "");
                },
              })),
            ]}
          />
        </div>
      }
    >
      {rows.length === 0 ? (
        <Callout tone="muted" title={t("rep.emptyTitle")}>
          {t("rep.emptyBody")}
        </Callout>
      ) : (
        <div className="space-y-4">
          {query.limit === 1 && sortKey ? (
            <p className="text-fg text-base">
              <span className="font-semibold">{rows[0]!.label}</span>
              <span className="text-fg-muted"> — {t(data.columns.find((column) => column.key === sortKey)?.header as never)}: </span>
              <span className="font-mono tabular-nums">{render(sortKey, rows[0]!.values[sortKey])}</span>
            </p>
          ) : null}
          {data.chart && rows.length > 1 ? (
            <CategoryBarChart
              valueLabel={t(data.chart.label as never)}
              data={rows.slice(0, 12).map((row) => ({ label: row.label, value: Number(row.values[data.chart!.valueKey] ?? 0) }))}
              format={(value) => render(data.chart!.valueKey, value)}
            />
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-line bg-sunken border-b">
                  <th scope="col" className="text-fg-muted px-3 py-2 text-start text-xs font-medium">
                    {t("rep.col.group")}
                  </th>
                  {compareKey ? (
                    <>
                      <th scope="col" className="text-fg-muted px-3 py-2 text-end text-xs font-medium">
                        {t("ask.previousPeriod")} ({result.previousRange?.from} → {result.previousRange?.to})
                      </th>
                      <th scope="col" className="text-fg-muted px-3 py-2 text-end text-xs font-medium">
                        {t("ask.change")}
                      </th>
                    </>
                  ) : null}
                  {data.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sortKey === column.key && query.sort ? (query.sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={cx("text-fg-muted px-3 py-2 text-xs font-medium", column.numeric ? "text-end" : "text-start")}
                    >
                      {t(column.header as never)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="text-fg px-3 py-2 text-start text-sm font-normal">
                      {row.label}
                      {row.secondary ? <span className="text-fg-subtle block text-xs">{row.secondary}</span> : null}
                    </th>
                    {compareKey ? (
                      (() => {
                        const before = previousById.get(row.id)?.values[compareKey];
                        const now = Number(row.values[compareKey]);
                        const prior = typeof before === "number" ? before : null;
                        const change = prior !== null && prior !== 0 ? ((now - prior) / Math.abs(prior)) * 100 : null;
                        return (
                          <>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{prior === null ? "—" : render(compareKey, prior)}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">
                              {change === null ? "—" : `${change >= 0 ? "+" : "−"}${formatNumber(Math.abs(change), fmt, 1)}%`}
                            </td>
                          </>
                        );
                      })()
                    ) : null}
                    {data.columns.map((column) => (
                      <td key={column.key} className={cx("px-3 py-2", column.numeric && "text-end font-mono tabular-nums")}>
                        {render(column.key, row.values[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
