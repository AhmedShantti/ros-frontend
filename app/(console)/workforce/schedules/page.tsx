"use client";

/**
 * Schedules — SRS §14.3, FR-HRM-012.
 *
 * A shift is validated when it is written, not when it is worked. Rest
 * periods, consecutive-day limits and certification requirements are checked
 * against the roster as it is built, because a violation discovered on the day
 * is not a finding — it is a branch short-staffed at eleven o'clock.
 *
 * Violations do not block publishing. Real rosters need exceptions, and a rule
 * that cannot be overridden gets worked around outside the system where nobody
 * can see it. What the rule buys is that the exception is recorded and visible
 * on the row.
 *
 * Projected cost sits next to hours because the two together are the only
 * useful reading. Eight hours of a head chef and eight of a trainee are the
 * same roster line and very different labour cost.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import type { ScheduledShift } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage, useBranches } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { SHIFT_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Toast } from "@/components/console/ui";

export default function SchedulesPage() {
  return (
    <Gate permissions={["hr.schedule.manage", "hr.employee.view"]}>
      <SchedulesScreen />
    </Gate>
  );
}

function SchedulesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canManage = usePermission("hr.schedule.manage");
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<ScheduledShift>(
    (query) => services.workforce.shifts.list(query),
    { scope, initialSort: "date", pageSize: 50 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      hours: rows.reduce((sum, row) => sum + row.hours, 0),
      cost: rows.reduce((sum, row) => sum + row.projectedCost.amount, 0),
      violations: rows.filter((row) => row.violations.length > 0).length,
      drafts: rows.filter((row) => row.status === "draft").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.projectedCost.currency ?? "EGP";

  const columns = useMemo<Column<ScheduledShift>[]>(
    () => [
      {
        key: "employeeName",
        header: t("wf.employee"),
        sortable: true,
        render: (row) => (
          <CellStack primary={tx(row.employeeName)} secondary={tx(row.position)} />
        ),
      },
      {
        key: "date",
        header: t("common.date"),
        sortable: true,
        render: (row) => formatDate(row.date, fmt),
      },
      {
        key: "shift",
        header: t("wf.shift"),
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.startTime} – {row.endTime}
          </span>
        ),
      },
      {
        key: "hours",
        header: t("wf.hours"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.hours, fmt, 1),
      },
      {
        key: "projectedCost",
        header: t("wf.projectedCost"),
        numeric: true,
        render: (row) => formatMoney(row.projectedCost, fmt),
      },
      {
        key: "violations",
        header: t("wf.violations"),
        render: (row) =>
          row.violations.length === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.violations.map((violation) => (
                <Badge key={violation} tone="warn">
                  {violation}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(SHIFT_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("wf.schedulesTitle")}
        subtitle={t("wf.schedulesSubtitle")}
        spec="FR-HRM-012"
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setMessage(t("common.notInBuild"))}
            >
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        {totals.violations > 0 ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("wf.violations")}>
            {t("wf.violationsNote")}
          </Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile
            label={t("wf.scheduledHours")}
            value={formatNumber(totals.hours, fmt, 1)}
          />
          <MetricTile
            label={t("wf.projectedCost")}
            value={formatMoney({ amount: totals.cost, currency }, fmt, true)}
          />
          <MetricTile
            label={t("wf.violations")}
            value={formatNumber(totals.violations, fmt)}
            spec="FR-HRM-012"
          />
          <MetricTile
            label={tx(SHIFT_STATUS.draft!.label)}
            value={formatNumber(totals.drafts, fmt)}
            hint={t("wf.draftHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(SHIFT_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
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
          caption={t("wf.schedulesTitle")}
          dense
        />
      </PageBody>

      <Toast message={message} />
    </>
  );
}
