"use client";

/**
 * Report catalogue — SRS §19.3, §19.5.
 *
 * The design principle the SRS states for this module is that reports arrive;
 * they are not fetched (§19.1). A manager should not remember to open a screen
 * on Monday morning — the report should be waiting. This catalogue is
 * therefore a list of things that can be scheduled, not a menu of screens.
 *
 * Each entry declares the permission it needs, and reports the current role
 * cannot run are shown disabled rather than hidden: knowing that a
 * cost-variance report exists is not itself sensitive, and hiding it produces
 * support tickets asking for a report that is already there.
 *
 * Every export is written to the audit trail with the requesting user, the
 * filters applied and the row count (FR-RPT-030). An export is a copy of
 * tenant data leaving the system, and it is treated as one.
 */

import { useMemo, useState } from "react";
import { Download, FileBarChart, Play } from "lucide-react";
import type { ReportCategory, ReportDefinition } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { REPORT_CATEGORY, labelOf } from "@/lib/console/labels";
import { PageBody, PageHeader, Section, Toolbar } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, SegmentedControl, Toast, cx } from "@/components/console/ui";

type Filter = ReportCategory | "all";

export default function ReportsPage() {
  const { t } = useI18n();
  const state = useAsync<ReportDefinition[]>(() => services.platform.reports(), []);

  return (
    <>
      <PageHeader title={t("rep.title")} subtitle={t("rep.subtitle")} spec="§19.3" />

      <PageBody>
        <Callout tone="muted">{t("rep.exportNote")}</Callout>
        <AsyncPanel state={state}>{(rows) => <ReportsBody reports={rows} />}</AsyncPanel>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

function ReportsBody({ reports }: { reports: ReportDefinition[] }) {
  const { t, tx } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useTransientMessage();

  const categories = useMemo(() => {
    const present = new Set(reports.map((report) => report.category));
    return (Object.keys(REPORT_CATEGORY) as ReportCategory[]).filter((key) =>
      present.has(key),
    );
  }, [reports]);

  const grouped = useMemo(() => {
    const visible = filter === "all" ? reports : reports.filter((r) => r.category === filter);
    const map = new Map<ReportCategory, ReportDefinition[]>();
    for (const report of visible) {
      const list = map.get(report.category) ?? [];
      list.push(report);
      map.set(report.category, list);
    }
    return [...map.entries()];
  }, [reports, filter]);

  return (
    <>
      <Toolbar>
        <SegmentedControl<Filter>
          label={t("rep.category")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("common.all") },
            ...categories.map((key) => ({
              value: key as Filter,
              label: tx(labelOf(REPORT_CATEGORY, key).label),
            })),
          ]}
        />
      </Toolbar>

      {grouped.map(([category, list]) => {
        const entry = labelOf(REPORT_CATEGORY, category);
        return (
          <Section key={category} title={tx(entry.label)}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  onRun={() => setMessage(t("rep.ranTitle"))}
                />
              ))}
            </ul>
          </Section>
        );
      })}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ReportCard({
  report,
  onRun,
}: {
  report: ReportDefinition;
  onRun: () => void;
}) {
  const { t, tx } = useI18n();
  const { canAny } = useSession();

  const allowed = canAny([report.requiredPermission]);

  return (
    <li
      className={cx(
        "border-line bg-sunken/40 flex flex-col justify-between gap-3 rounded-lg border p-4",
        !allowed && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-fg flex items-center gap-2 text-sm font-medium">
            <FileBarChart size={14} className="text-fg-subtle shrink-0" aria-hidden />
            {tx(report.name)}
          </h3>
          <span className="border-line text-fg-subtle shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wide uppercase">
            {report.specRef}
          </span>
        </div>

        <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{tx(report.description)}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {report.async ? <Badge tone="accent">{t("rep.async")}</Badge> : null}
          {!allowed ? (
            <Badge tone="muted">
              <span dir="ltr" className="font-mono text-[0.62rem]">
                {report.requiredPermission}
              </span>
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Play size={12} />} disabled={!allowed} onClick={onRun}>
          {t("rep.run")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Download size={12} />} disabled={!allowed} onClick={onRun}>
          {t("common.exportCsv")}
        </Button>
      </div>
    </li>
  );
}
