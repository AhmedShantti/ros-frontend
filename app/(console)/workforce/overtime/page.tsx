"use client";

/**
 * Overtime — SRS §14.4, §14.5.
 *
 * Unapproved overtime is reported separately and never silently included. The
 * distinction is the point of the screen: hours were worked either way, and
 * the cost is real either way, but "approved overtime" is a management
 * decision and "unapproved overtime" is a roster that did not hold.
 *
 * Rolling the two together produces a labour-cost line that always reconciles
 * and never explains anything. Splitting them means the overtime that keeps
 * appearing on the same branch every week has somewhere to show up.
 *
 * The multiplier comes from the country pack, not from this module — it is a
 * jurisdiction rule, and a tenant operating in three countries has three of
 * them.
 */

import { useMemo, useState } from "react";
import type { OvertimeRecord } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { APPROVAL_STATE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Toast } from "@/components/console/ui";

export default function OvertimePage() {
  return (
    <Gate permissions={["hr.overtime.approve", "report.view.workforce"]}>
      <OvertimeScreen />
    </Gate>
  );
}

function OvertimeScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canApprove = usePermission("hr.overtime.approve");
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<OvertimeRecord>(
    (query) => services.workforce.overtime.list(query),
    { scope, initialSort: "-overtimeHours", pageSize: 50 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const pending = rows.filter((row) => row.approval === "pending");
    return {
      hours: rows.reduce((sum, row) => sum + row.overtimeHours, 0),
      cost: rows.reduce((sum, row) => sum + row.cost.amount, 0),
      pendingHours: pending.reduce((sum, row) => sum + row.overtimeHours, 0),
      pendingCost: pending.reduce((sum, row) => sum + row.cost.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.cost.currency ?? "EGP";

  const columns = useMemo<Column<OvertimeRecord>[]>(
    () => [
      {
        key: "employeeName",
        header: t("wf.employee"),
        render: (row) => (
          <CellStack primary={tx(row.employeeName)} secondary={tx(row.branchName)} />
        ),
      },
      {
        key: "weekStarting",
        header: t("wf.weekStarting"),
        render: (row) => formatDate(row.weekStarting, fmt),
      },
      {
        key: "regularHours",
        header: t("wf.regularHours"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.regularHours, fmt, 1),
      },
      {
        key: "overtimeHours",
        header: t("wf.overtimeHours"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span className="text-warn font-semibold">
            {formatNumber(row.overtimeHours, fmt, 1)}
          </span>
        ),
      },
      {
        key: "multiplier",
        header: t("wf.multiplier"),
        numeric: true,
        secondary: true,
        render: (row) => (
          <span dir="ltr">×{formatNumber(row.multiplier, fmt, 2)}</span>
        ),
      },
      {
        key: "cost",
        header: t("wf.labourCost"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.cost, fmt),
      },
      {
        key: "approval",
        header: t("apr.title"),
        render: (row) => {
          const approval = labelOf(APPROVAL_STATE, row.approval);
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={approval.tone} dot={row.approval !== "not_required"}>
                {tx(approval.label)}
              </Badge>
              {row.approvedBy ? (
                <span className="text-fg-subtle text-xs">{tx(row.approvedBy)}</span>
              ) : null}
            </span>
          );
        },
      },
      ...(canApprove
        ? [
            {
              key: "action",
              header: t("common.actions"),
              align: "end" as const,
              render: (row: OvertimeRecord) =>
                row.approval === "pending" ? (
                  <Button size="sm" onClick={() => setMessage(t("common.notInBuild"))}>
                    {t("common.approve")}
                  </Button>
                ) : (
                  <span className="text-fg-subtle">—</span>
                ),
            } satisfies Column<OvertimeRecord>,
          ]
        : []),
    ],
    [t, tx, fmt, canApprove, setMessage],
  );

  return (
    <>
      <PageHeader
        title={t("wf.overtimeTitle")}
        subtitle={t("wf.overtimeSubtitle")}
        spec="FR-HRM-024"
      />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile
            label={t("wf.overtimeHours")}
            value={formatNumber(totals.hours, fmt, 1)}
          />
          <MetricTile
            label={t("wf.labourCost")}
            value={formatMoney({ amount: totals.cost, currency }, fmt, true)}
          />
          <MetricTile
            label={t("wf.unapprovedHours")}
            value={formatNumber(totals.pendingHours, fmt, 1)}
            spec="FR-HRM-024"
            hint={t("wf.unapprovedHint")}
          />
          <MetricTile
            label={t("wf.unapprovedCost")}
            value={formatMoney({ amount: totals.pendingCost, currency }, fmt, true)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "approval",
              label: t("apr.title"),
              options: Object.entries(APPROVAL_STATE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("wf.overtimeTitle")}
          dense
        />

        <Callout tone="muted">{t("wf.multiplierNote")}</Callout>
      </PageBody>

      <Toast message={message} />
    </>
  );
}
