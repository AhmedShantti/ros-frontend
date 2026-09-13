"use client";

/**
 * Export history — FR-RPT-043, FR-RPT-044.
 *
 * "All exports SHALL be logged in the audit trail with the requesting user,
 * filters applied, and row count." Every export control in the console —
 * the report runner, the audit log, segment exports, scheduled deliveries —
 * writes to `lib/console/export-log.ts`; this is where that record is read.
 *
 * Exports past 50,000 rows are jobs, not downloads (FR-RPT-043), and they
 * show here as queued and then ready, so the person who asked has one place
 * to find out where the big one went.
 *
 * The log on this screen is what *this browser* produced. The server keeps
 * its own `report.exported` audit entries for everything it serves; the link
 * at the top goes there.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText, ScrollText, Table } from "lucide-react";

import type { ExportFormat } from "@/lib/console/export";
import { useExportLog, type ExportRecord } from "@/lib/console/export-log";
import { useI18n, useSession } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, SearchInput, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { Gate } from "@/components/console/states";
import { Badge, Callout, Toast } from "@/components/console/ui";

export default function ExportHistoryPage() {
  return (
    <Gate permissions={["report.export", "audit.view"]}>
      <ExportHistoryScreen />
    </Gate>
  );
}

const FORMAT_ICON: Record<ExportFormat, typeof Table> = {
  csv: Table,
  xlsx: FileSpreadsheet,
  pdf: FileText,
};

const STATUS_TONE: Record<ExportRecord["status"], "good" | "warn" | "accent"> = {
  completed: "good",
  queued: "warn",
  ready: "accent",
};

function ExportHistoryScreen() {
  const { t, fmt } = useI18n();
  const { session, can } = useSession();
  const log = useExportLog();
  const [message, setMessage] = useTransientMessage();
  const [term, setTerm] = useState("");
  const [format, setFormat] = useState("all");
  const [status, setStatus] = useState("all");
  const [mine, setMine] = useState("all");

  const me = session?.user.email ?? null;

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return log.rows.filter((row) => {
      if (format !== "all" && row.format !== format) return false;
      if (status !== "all" && row.status !== status) return false;
      if (mine === "mine" && row.requestedBy !== me) return false;
      if (!needle) return true;
      return [row.title, row.filters ?? "", row.requestedBy ?? ""].some((text) => text.toLowerCase().includes(needle));
    });
  }, [log.rows, term, format, status, mine, me]);

  const last30 = log.rows.filter((row) => Date.now() - Date.parse(row.occurredAt) < 30 * 86_400_000);

  const columns: Column<ExportRecord>[] = [
    {
      key: "occurredAt",
      header: t("xh.when"),
      render: (row) => <CellStack primary={formatRelative(row.occurredAt, fmt)} secondary={formatDateTime(row.occurredAt, fmt)} />,
    },
    {
      key: "title",
      header: t("xh.what"),
      render: (row) => {
        const Icon = FORMAT_ICON[row.format];
        return (
          <span className="flex items-start gap-2">
            <Icon size={14} className="text-fg-subtle mt-0.5 shrink-0" aria-hidden />
            <CellStack primary={row.title} secondary={row.filters ?? t("xh.noFilters")} />
          </span>
        );
      },
    },
    {
      key: "format",
      header: t("dlv.format"),
      render: (row) => <Badge tone="neutral">{row.format.toUpperCase()}</Badge>,
    },
    {
      key: "rowCount",
      header: t("xh.rows"),
      numeric: true,
      render: (row) => formatNumber(row.rowCount, fmt),
    },
    {
      key: "requestedBy",
      header: t("xh.by"),
      secondary: true,
      render: (row) => <span className="text-fg-muted text-xs">{row.requestedBy ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {t(`xh.status.${row.status}` as never)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("xh.title")}
        subtitle={t("xh.subtitle")}
        spec="FR-RPT-044"
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
        actions={
          <ExportButton
            filename="export-history"
            title={t("xh.title")}
            filterSummary={t("xh.thisBrowser")}
            rows={rows}
            onExported={setMessage}
            columns={[
              { key: "occurredAt", header: t("xh.when"), value: (row) => row.occurredAt },
              { key: "title", header: t("xh.what"), value: (row) => row.title },
              { key: "format", header: t("dlv.format"), value: (row) => row.format },
              { key: "rows", header: t("xh.rows"), value: (row) => row.rowCount },
              { key: "filters", header: t("xh.filters"), value: (row) => row.filters ?? "" },
              { key: "by", header: t("xh.by"), value: (row) => row.requestedBy ?? "" },
              { key: "status", header: t("common.status"), value: (row) => row.status },
            ]}
          />
        }
      />

      <PageBody>
        <Callout tone="muted" icon={<ScrollText size={14} />}>
          {t("xh.scopeNote")}{" "}
          {can("audit.view") ? (
            <Link href="/audit" className="font-medium underline underline-offset-2">
              {t("xh.openAudit")}
            </Link>
          ) : null}
        </Callout>

        <TileGrid columns={4}>
          <MetricTile label={t("xh.last30")} value={formatNumber(last30.length, fmt)} />
          <MetricTile
            label={t("xh.rowsLast30")}
            value={formatNumber(last30.reduce((sum, row) => sum + row.rowCount, 0), fmt)}
          />
          <MetricTile
            label={t("xh.queued")}
            value={formatNumber(log.rows.filter((row) => row.status === "queued").length, fmt)}
          />
          <MetricTile
            label={t("xh.ready")}
            value={formatNumber(log.rows.filter((row) => row.status === "ready").length, fmt)}
          />
        </TileGrid>

        {log.rows.some((row) => row.status === "ready") ? (
          <Callout tone="accent" title={t("xh.readyTitle")}>
            {t("xh.readyBody")}
          </Callout>
        ) : null}

        <Toolbar>
          <SearchInput value={term} onChange={setTerm} />
          <FilterSelect
            filter={{
              key: "format",
              label: t("dlv.format"),
              options: (["csv", "xlsx", "pdf"] as ExportFormat[]).map((value) => ({ value, label: value.toUpperCase() })),
            }}
            value={format}
            onChange={setFormat}
          />
          <FilterSelect
            filter={{
              key: "status",
              label: t("common.status"),
              options: (["completed", "queued", "ready"] as ExportRecord["status"][]).map((value) => ({
                value,
                label: t(`xh.status.${value}` as never),
              })),
            }}
            value={status}
            onChange={setStatus}
          />
          <FilterSelect
            filter={{
              key: "mine",
              label: t("xh.by"),
              allLabel: t("xh.everyone"),
              options: [{ value: "mine", label: t("xh.onlyMine") }],
            }}
            value={mine}
            onChange={setMine}
          />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          caption={t("xh.title")}
          filtered={term.trim().length > 0 || format !== "all" || status !== "all" || mine !== "all"}
          onClearFilters={() => {
            setTerm("");
            setFormat("all");
            setStatus("all");
            setMine("all");
          }}
          emptyTitle={t("xh.none")}
          emptyBody={t("xh.noneBody")}
          dense
        />
      </PageBody>

      <Toast message={message} />
    </>
  );
}
