"use client";

/**
 * Customer segments — SRS §18.5, FR-CRM-035 … FR-CRM-037.
 *
 * RFM, but computed against each customer's own rhythm rather than a global
 * threshold (FR-CRM-036). Someone who orders weekly and has not been seen
 * for a month is at risk. Someone who orders twice a year and has not been
 * seen for a month is between visits. A single "60 days since last order"
 * rule calls the second one churned and is wrong about most of the book.
 *
 * Export is consent-gated (FR-CRM-037) and says how many members it dropped.
 * A campaign export that silently includes people who never opted in is a
 * regulatory problem wearing a CSV.
 */

import { useMemo, useState } from "react";
import { Target, Users } from "lucide-react";

import type { Customer, CustomerSegment } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { churnRiskOf } from "@/lib/console/services/crm";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatRelative } from "@/lib/console/format";
import { exportRows } from "@/lib/console/export";
import { useExportLog } from "@/lib/console/export-log";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { SEGMENT_TONE } from "@/components/console/customer";
import { Badge, Button, Callout, Meter, Toast, cx } from "@/components/console/ui";

export default function SegmentsPage() {
  return (
    <Gate permissions={["crm.customer.view"]}>
      <SegmentsScreen />
    </Gate>
  );
}

const ACTION_KEY: Record<CustomerSegment, string> = {
  champion: "seg.action.champion",
  loyal: "seg.action.loyal",
  at_risk: "seg.action.at_risk",
  hibernating: "seg.action.hibernating",
  new: "seg.action.new",
  unclassified: "seg.action.unclassified",
};

function SegmentsScreen() {
  const { t, tx, fmt } = useI18n();
  const canExport = usePermission("crm.customer.export");
  const log = useExportLog();
  const [message, setMessage] = useTransientMessage();
  const [focus, setFocus] = useState<CustomerSegment | null>(null);

  const state = useAsync(() => services.crm.segments(), []);

  const totals = useMemo(() => {
    const rows = state.data ?? [];
    return {
      customers: rows.reduce((sum, row) => sum + row.count, 0),
      value: rows.reduce((sum, row) => sum + row.value.amount, 0),
      atRisk:
        (rows.find((row) => row.segment === "at_risk")?.count ?? 0) +
        (rows.find((row) => row.segment === "hibernating")?.count ?? 0),
      atRiskValue:
        (rows.find((row) => row.segment === "at_risk")?.value.amount ?? 0) +
        (rows.find((row) => row.segment === "hibernating")?.value.amount ?? 0),
    };
  }, [state.data]);

  const currency = state.data?.[0]?.value.currency ?? "EGP";

  /**
   * FR-CRM-037 — export a segment for a campaign, subject to consent.
   *
   * The excluded count is reported rather than quietly dropped: "412 of 530"
   * is a fact a marketer needs before they judge the campaign's reach, and a
   * silent filter looks like a bug in the segmentation.
   */
  function exportSegment(segment: CustomerSegment, customers: Customer[]) {
    const consenting = customers.filter((customer) =>
      customer.consent.some((flag) => flag.purpose === "marketing" && flag.granted),
    );
    const excluded = customers.length - consenting.length;

    if (consenting.length === 0) {
      setMessage(t("seg.noneConsented"));
      return;
    }

    const outcome = exportRows("csv", {
      filename: `segment-${segment}`,
      title: t(`crm.segment.${segment}` as never),
      subtitle: t("seg.exportSubtitle").replace("{n}", String(excluded)),
      columns: [
        { key: "phone", header: t("crm.phone"), value: (row) => row.phone },
        { key: "name", header: t("common.name"), value: (row) => tx(row.name) },
        { key: "email", header: t("crm.email"), value: (row) => row.email ?? "" },
        { key: "language", header: t("crm.preferredLanguage"), value: (row) => row.preferredLanguage },
        { key: "spend", header: t("crm.totalSpend"), value: (row) => row.totalSpend.amount / 100 },
        { key: "orders", header: t("crm.orders"), value: (row) => row.orderCount },
        { key: "lastOrder", header: t("crm.lastOrder"), value: (row) => row.lastOrderAt ?? "" },
      ],
      rows: consenting,
    });

    log.record({
      title: `${t("seg.title")} — ${segment}`,
      format: "csv",
      rowCount: outcome.rowCount,
      filters: t("seg.consentFilter"),
      requestedBy: null,
    });

    setMessage(
      excluded > 0
        ? t("seg.exportedWithExclusions")
            .replace("{n}", String(consenting.length))
            .replace("{excluded}", String(excluded))
        : t("seg.exported").replace("{n}", String(consenting.length)),
    );
  }

  const memberColumns = useMemo<Column<Customer>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        render: (row) => (
          <CellStack primary={tx(row.name)} secondary={<span dir="ltr">{row.phone}</span>} />
        ),
      },
      {
        key: "orders",
        header: t("crm.orders"),
        numeric: true,
        render: (row) => formatNumber(row.orderCount, fmt),
      },
      {
        key: "spend",
        header: t("crm.totalSpend"),
        numeric: true,
        render: (row) => formatMoney(row.totalSpend, fmt),
      },
      {
        key: "last",
        header: t("crm.lastOrder"),
        secondary: true,
        render: (row) => (row.lastOrderAt ? formatRelative(row.lastOrderAt, fmt) : "—"),
      },
      {
        key: "risk",
        header: t("crm.churnRisk"),
        render: (row) => {
          const risk = churnRiskOf(row);
          if (risk === null) return <span className="text-fg-subtle">—</span>;
          return (
            <div className="w-24">
              <Meter value={risk * 100} tone={risk > 0.6 ? "bad" : risk > 0.35 ? "warn" : "good"} />
            </div>
          );
        },
      },
      {
        key: "consent",
        header: t("seg.consent"),
        render: (row) =>
          row.consent.some((flag) => flag.purpose === "marketing" && flag.granted) ? (
            <Badge tone="good">{t("common.yes")}</Badge>
          ) : (
            <Badge tone="muted">{t("common.no")}</Badge>
          ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader title={t("seg.title")} subtitle={t("seg.subtitle")} spec="FR-CRM-035" />

      <PageBody>
        <Callout tone="accent" title={t("seg.methodTitle")}>
          {t("seg.methodBody")}
        </Callout>

        <TileGrid columns={3}>
          <MetricTile label={t("crm.customers")} value={formatNumber(totals.customers, fmt)} />
          <MetricTile
            label={t("seg.bookValue")}
            value={formatMoney({ amount: totals.value, currency }, fmt, true)}
          />
          <MetricTile
            label={t("seg.valueAtRisk")}
            value={formatMoney({ amount: totals.atRiskValue, currency }, fmt, true)}
            hint={t("seg.valueAtRiskHint").replace("{n}", String(totals.atRisk))}
          />
        </TileGrid>

        <AsyncPanel state={state}>
          {(segments) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {segments
                  .filter((entry) => entry.segment !== "unclassified" || entry.count > 0)
                  .map((entry) => {
                    const share =
                      totals.customers > 0 ? (entry.count / totals.customers) * 100 : 0;
                    return (
                      <button
                        key={entry.segment}
                        type="button"
                        onClick={() =>
                          setFocus(focus === entry.segment ? null : entry.segment)
                        }
                        aria-pressed={focus === entry.segment}
                        className={cx(
                          "border-line bg-raised rounded-xl border p-4 text-start transition-colors",
                          focus === entry.segment
                            ? "border-accent bg-accent-soft/40"
                            : "hover:border-accent/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge tone={SEGMENT_TONE[entry.segment]}>
                            {t(`crm.segment.${entry.segment}` as never)}
                          </Badge>
                          <span className="text-fg font-mono text-lg tabular-nums">
                            {formatNumber(entry.count, fmt)}
                          </span>
                        </div>

                        <div className="mt-3">
                          <Meter value={share} tone={SEGMENT_TONE[entry.segment]} />
                        </div>

                        <p className="text-fg-muted mt-2 text-xs tabular-nums">
                          {formatMoney(entry.value, fmt, true)}
                        </p>
                        <p className="text-fg-subtle mt-2 text-xs leading-relaxed">
                          {t(ACTION_KEY[entry.segment] as never)}
                        </p>

                        {canExport && entry.count > 0 ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              exportSegment(entry.segment, entry.customers);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                exportSegment(entry.segment, entry.customers);
                              }
                            }}
                            className="text-accent mt-3 inline-block cursor-pointer text-xs underline underline-offset-2"
                          >
                            {t("seg.exportSegment")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>

              {focus ? (
                <Section
                  title={t(`crm.segment.${focus}` as never)}
                  hint={t("seg.membersHint")}
                  action={
                    <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
                      {t("common.close")}
                    </Button>
                  }
                  padded={false}
                >
                  <DataTable
                    columns={memberColumns}
                    rows={segments.find((entry) => entry.segment === focus)?.customers ?? []}
                    rowKey={(row) => row.id}
                    caption={t("seg.title")}
                    emptyTitle={t("seg.emptySegment")}
                    dense
                  />
                </Section>
              ) : (
                <Callout tone="muted">{t("seg.pickOne")}</Callout>
              )}
            </>
          )}
        </AsyncPanel>
      </PageBody>

      <Toast message={message} />
    </>
  );
}
