"use client";

/**
 * The security event log on screen — FR-SEC-033, FR-AUD-007, FR-SEC-053.
 *
 * Newest first, with the hash chain verified on every load (an entry edited
 * outside the console is named), a category filter, and a CSV export that is
 * itself labelled Confidential and recorded as an audit-log export.
 */

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { useSecurityLog } from "@/lib/console/security-log";
import { formatDateTime } from "@/lib/console/format";
import { exportRows } from "@/lib/console/export";
import { SIEM_CATEGORIES, type SiemCategory } from "@/lib/console/security-policy";
import type { SecurityEvent, SecurityEventKind } from "@/lib/console/services/security-events";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { ClassificationBadge } from "@/components/console/security-sensitive";
import { ErrorPanel } from "@/components/console/states";
import { Badge, Button, Callout, Card, CardHeader, Select } from "@/components/console/ui";

export function SecurityEventLog({
  kinds,
  title,
  hint,
  spec,
  canExport,
}: {
  kinds?: SecurityEventKind[];
  title: string;
  hint?: string;
  spec?: string;
  canExport: boolean;
}) {
  const { t, fmt } = useI18n();
  const record = useSecurityLog();
  const [category, setCategory] = useState<SiemCategory | "">("");
  const kindsKey = kinds?.join(",") ?? "";
  const events = useAsync(() => services.securityEvents.list(kinds ? { kinds } : {}), [kindsKey]);
  const chain = useAsync(() => services.securityEvents.verify(), [events.data]);

  const rows = useMemo(
    () => (events.data ?? []).filter((row) => !category || row.category === category),
    [events.data, category],
  );

  const columns: Column<SecurityEvent>[] = [
    { key: "at", header: t("sev.at"), render: (row) => <span className="text-xs tabular-nums">{formatDateTime(row.at, fmt)}</span> },
    {
      key: "kind",
      header: t("sev.kind"),
      render: (row) => (
        <CellStack
          primary={<span className="font-mono text-xs">{row.kind}</span>}
          secondary={t(`siem.cat.${row.category}` as ConsoleKey)}
        />
      ),
    },
    { key: "actor", header: t("sev.actor"), render: (row) => <span className="text-xs">{row.actorName}</span> },
    {
      key: "subject",
      header: t("sev.subject"),
      render: (row) => (
        <span className="font-mono text-[0.68rem]" dir="ltr">
          {row.subjectType}:{row.subjectId}
        </span>
      ),
    },
    {
      key: "detail",
      header: t("sev.detail"),
      secondary: true,
      render: (row) => (
        <span className="text-fg-muted font-mono text-[0.68rem] break-all" dir="ltr">
          {Object.entries(row.detail)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" ")}
        </span>
      ),
    },
    { key: "id", header: "ULID", secondary: true, render: (row) => <span className="font-mono text-[0.62rem]" dir="ltr">{row.id}</span> },
  ];

  async function exportCsv() {
    const outcome = exportRows("csv", {
      filename: "security-events-confidential",
      title,
      rows,
      columns: [
        { key: "id", header: "id", value: (row) => row.id },
        { key: "seq", header: "seq", value: (row) => String(row.seq) },
        { key: "tenantId", header: "tenant_id", value: (row) => row.tenantId },
        { key: "at", header: "at", value: (row) => row.at },
        { key: "kind", header: "kind", value: (row) => row.kind },
        { key: "category", header: "category", value: (row) => row.category },
        { key: "actorId", header: "actor_id", value: (row) => row.actorId ?? "" },
        { key: "actorName", header: "actor", value: (row) => row.actorName },
        { key: "subject", header: "subject", value: (row) => `${row.subjectType}:${row.subjectId}` },
        { key: "detail", header: "detail", value: (row) => JSON.stringify(row.detail) },
        { key: "correlationId", header: "correlation_id", value: (row) => row.correlationId },
        { key: "hash", header: "hash", value: (row) => row.hash },
        { key: "previousHash", header: "previous_hash", value: (row) => row.previousHash },
      ],
    });
    // FR-AUD-007 — exporting a log is itself recorded.
    await record({
      kind: "audit.exported",
      subjectType: "security_event_log",
      subjectId: kindsKey || "all",
      detail: { rows: outcome.rowCount, format: "csv", class: "confidential" },
    });
    events.reload();
  }

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title={title}
          hint={hint}
          spec={spec}
          action={
            <span className="flex items-center gap-2">
              <ClassificationBadge cls="confidential" />
              {canExport ? (
                <Button size="sm" variant="ghost" icon={<Download size={12} />} disabled={rows.length === 0} onClick={() => void exportCsv()}>
                  {t("common.export")}
                </Button>
              ) : null}
            </span>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {chain.data ? (
            <Badge tone={chain.data.intact ? "good" : "bad"} dot>
              {chain.data.intact
                ? t("sev.chainIntact").replace("{n}", String(chain.data.count))
                : t("sev.chainBroken").replace("{id}", chain.data.brokenAt ?? "—")}
            </Badge>
          ) : null}
          {!kinds ? (
            <div className="min-w-44">
              <Select aria-label={t("sev.category")} value={category} onChange={(event) => setCategory(event.target.value as SiemCategory | "")}>
                <option value="">{t("sev.anyCategory")}</option>
                {SIEM_CATEGORIES.map((row) => (
                  <option key={row} value={row}>
                    {t(`siem.cat.${row}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      </div>
      {events.error ? <ErrorPanel error={events.error} onRetry={events.reload} compact /> : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={events.loading && !events.data}
        caption={title}
        emptyTitle={t("sev.empty")}
        dense
      />
      <div className="px-5 py-3">
        <Callout tone="muted">{t("sev.deviceNote")}</Callout>
      </div>
    </Card>
  );
}
