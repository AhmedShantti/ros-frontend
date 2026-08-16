"use client";

/**
 * Attendance — SRS §14.4.
 *
 * Clock events are the input to payroll, so the flags matter more than the
 * hours. A missing clock-out auto-closes at the scheduled end (FR-HRM-020);
 * that keeps the roster usable, but it means the recorded hours are an
 * assumption rather than an observation, and payroll should know which is
 * which before it pays them.
 *
 * The method column exists for the same reason. A PIN punch at the terminal
 * and a manual entry typed by a supervisor are both "8 hours" and only one of
 * them is evidence — manual entries are toned as a caution deliberately.
 *
 * Corrections are shown rather than applied silently. The original stands in
 * the audit trail; this column says a human overrode the device.
 */

import { useMemo, useState } from "react";
import type { AttendanceRecord } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatTime } from "@/lib/console/format";
import { ATTENDANCE_FLAG, ATTENDANCE_METHOD, labelOf } from "@/lib/console/labels";
import { branches } from "@/lib/console/mock/org";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Toast } from "@/components/console/ui";

export default function AttendancePage() {
  return (
    <Gate permissions={["hr.employee.view", "report.view.workforce"]}>
      <AttendanceScreen />
    </Gate>
  );
}

function AttendanceScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canExport = usePermission("hr.payroll.export");
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<AttendanceRecord>(
    (query) => services.workforce.attendance.list(query),
    { scope, initialSort: "-date", pageSize: 50 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      hours: rows.reduce((sum, row) => sum + row.regularHours + row.overtimeHours, 0),
      overtime: rows.reduce((sum, row) => sum + row.overtimeHours, 0),
      cost: rows.reduce((sum, row) => sum + row.cost.amount, 0),
      flagged: rows.filter((row) => row.flags.length > 0).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.cost.currency ?? "EGP";

  const columns = useMemo<Column<AttendanceRecord>[]>(
    () => [
      {
        key: "employeeName",
        header: t("wf.employee"),
        sortable: true,
        render: (row) => (
          <CellStack primary={tx(row.employeeName)} secondary={tx(row.branchName)} />
        ),
      },
      {
        key: "date",
        header: t("common.date"),
        sortable: true,
        render: (row) => formatDate(row.date, fmt),
      },
      {
        key: "clockIn",
        header: t("wf.clockIn"),
        render: (row) =>
          row.clockIn ? (
            <span className="font-mono text-xs">{formatTime(row.clockIn, fmt)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "clockOut",
        header: t("wf.clockOut"),
        render: (row) =>
          row.clockOut ? (
            <span className="font-mono text-xs">{formatTime(row.clockOut, fmt)}</span>
          ) : (
            <span className="text-bad font-mono text-xs">—</span>
          ),
      },
      {
        key: "regularHours",
        header: t("wf.regularHours"),
        numeric: true,
        render: (row) => formatNumber(row.regularHours, fmt, 1),
      },
      {
        key: "overtimeHours",
        header: t("wf.overtimeHours"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.overtimeHours === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="text-warn">{formatNumber(row.overtimeHours, fmt, 1)}</span>
          ),
      },
      {
        key: "method",
        header: t("wf.method"),
        secondary: true,
        render: (row) => {
          const method = labelOf(ATTENDANCE_METHOD, row.method);
          return <Badge tone={method.tone}>{tx(method.label)}</Badge>;
        },
      },
      {
        key: "flags",
        header: t("wf.flags"),
        render: (row) => (
          <span className="flex flex-wrap gap-1">
            {row.flags.length === 0 && !row.corrected ? (
              <span className="text-fg-subtle">—</span>
            ) : null}
            {row.flags.map((flag) => {
              const entry = labelOf(ATTENDANCE_FLAG, flag);
              return (
                <Badge key={flag} tone={entry.tone}>
                  {tx(entry.label)}
                </Badge>
              );
            })}
            {row.corrected ? <Badge tone="accent">{t("wf.corrected")}</Badge> : null}
          </span>
        ),
      },
      {
        key: "cost",
        header: t("wf.labourCost"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.cost, fmt),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("wf.attendanceTitle")}
        subtitle={t("wf.attendanceSubtitle")}
        spec="FR-HRM-020"
        actions={
          canExport ? (
            <Button variant="secondary" onClick={() => setMessage(t("common.notInBuild"))}>
              {t("wf.exportPayroll")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile label={t("wf.hours")} value={formatNumber(totals.hours, fmt, 1)} />
          <MetricTile
            label={t("wf.overtimeHours")}
            value={formatNumber(totals.overtime, fmt, 1)}
          />
          <MetricTile
            label={t("wf.labourCost")}
            value={formatMoney({ amount: totals.cost, currency }, fmt, true)}
          />
          <MetricTile
            label={t("wf.flags")}
            value={formatNumber(totals.flagged, fmt)}
            hint={t("wf.flagsHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "method",
              label: t("wf.method"),
              options: Object.entries(ATTENDANCE_METHOD).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "corrected",
              label: t("wf.corrected"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
            },
            {
              key: "branchId",
              label: t("common.branch"),
              options: branches.map((branch) => ({
                value: branch.id,
                label: tx(branch.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("wf.attendanceTitle")}
          dense
        />

        <Callout tone="muted">{t("wf.payrollNote")}</Callout>
      </PageBody>

      <Toast message={message} />
    </>
  );
}
