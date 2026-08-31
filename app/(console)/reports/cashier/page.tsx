"use client";

/**
 * Cashier report — SRS §19.3 "Cash Reconciliation".
 *
 * One row per shift, across every branch and every cashier, with the full
 * breakdown a manager needs to close the books on a shift after the fact:
 * what was sold, how it was paid for, what moved through the drawer beyond
 * sales, and whether the count matched. Every money figure here is read
 * directly off the `CashSession` record — nothing on this page recomputes a
 * total with its own arithmetic, so it can never drift from what the shift
 * itself reported at close time.
 */

import { useMemo, useState } from "react";
import { cashSessions } from "@/lib/console/mock/finance";
import { branches } from "@/lib/console/mock/org";
import { activeEmployees } from "@/lib/console/mock/workforce";
import type { CashSession } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatTime, tx as pick } from "@/lib/console/format";
import { CASH_SESSION_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Badge, Field, Select, cx } from "@/components/console/ui";
import { UnsupportedPanel } from "@/components/console/states";
import { DATA_MODE } from "@/lib/api/config";

type DateFilter = "all" | "today" | "yesterday" | "last7";

function withinFilter(session: CashSession, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const opened = new Date(session.openedAt).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (filter === "today") return now - opened < dayMs;
  if (filter === "yesterday") return now - opened >= dayMs && now - opened < 2 * dayMs;
  return now - opened < 7 * dayMs;
}

export default function CashierReportPage() {
  const { t } = useI18n();

  /*
   * Every row on this page is a `CashSession`, and the backend has no way to
   * hand one back: the drawer can be opened, moved, counted and closed, but
   * there is no session index and no day-close record to read afterwards.
   * Reconciling a shift against fixtures on a live till is exactly the
   * mistake this report exists to catch, so it says so instead.
   */
  if (DATA_MODE === "http") {
    return (
      <>
        <PageHeader title={t("rep.cashierTitle")} subtitle={t("rep.cashierSubtitle")} spec="§19.3" />
        <PageBody>
          <Section title={t("rep.cashierTitle")}>
            <UnsupportedPanel detail="No cash-session index exists in api/openapi.json — only the open, move, count and close commands." />
          </Section>
        </PageBody>
      </>
    );
  }

  return <CashierReportFromFixtures />;
}

function CashierReportFromFixtures() {
  const { t, tx, fmt } = useI18n();
  const [branchId, setBranchId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const rows = useMemo(
    () =>
      cashSessions.filter(
        (s) =>
          (branchId === "all" || s.branchId === branchId) &&
          (employeeId === "all" || s.employeeId === employeeId) &&
          withinFilter(s, dateFilter),
      ),
    [branchId, employeeId, dateFilter],
  );

  const currency = rows[0]?.openingFloat.currency ?? "EGP";

  const totals = useMemo(
    () => ({
      shifts: rows.length,
      grossSales: rows.reduce((s, r) => s + r.grossSales.amount, 0),
      netSales: rows.reduce((s, r) => s + r.netSales.amount, 0),
      variance: rows.reduce((s, r) => s + r.variance.amount, 0),
      cancelledOrders: rows.reduce((s, r) => s + r.cancelledOrderCount, 0),
    }),
    [rows],
  );

  const columns: Column<CashSession>[] = [
    {
      key: "cashier",
      header: t("fin.cashier"),
      render: (s) => (
        <CellStack
          primary={tx(s.employeeName)}
          secondary={`${formatTime(s.openedAt, fmt)}${s.closedAt ? ` → ${formatTime(s.closedAt, fmt)}` : ""}`}
        />
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (s) => tx(s.branchName),
      secondary: true,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (s) => {
        const entry = labelOf(CASH_SESSION_STATUS, s.status);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
    {
      key: "openingFloat",
      header: t("shift.openingFloat"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.openingFloat, fmt),
    },
    {
      key: "orderCount",
      header: t("shift.ordersTaken"),
      numeric: true,
      secondary: true,
      render: (s) => s.orderCount,
    },
    {
      key: "grossSales",
      header: t("shift.grossSales"),
      numeric: true,
      render: (s) => formatMoney(s.grossSales, fmt),
    },
    {
      key: "discountTotal",
      header: t("pos.discountTotal"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.discountTotal, fmt),
    },
    {
      key: "taxTotal",
      header: t("orders.tax"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.taxTotal, fmt),
    },
    {
      key: "serviceChargeTotal",
      header: t("orders.serviceCharge"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.serviceChargeTotal, fmt),
    },
    {
      key: "netSales",
      header: t("shift.netSales"),
      numeric: true,
      render: (s) => formatMoney(s.netSales, fmt),
    },
    {
      key: "cashSales",
      header: t("shift.cashSales"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.cashSales, fmt),
    },
    {
      key: "cardSales",
      header: t("shift.cardSales"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.cardSales, fmt),
    },
    {
      key: "otherSales",
      header: t("shift.otherSales"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.otherSales, fmt),
    },
    {
      key: "refundTotal",
      header: t("shift.refunds"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.refundTotal, fmt),
    },
    {
      key: "cancelledOrderCount",
      header: t("shift.cancelledOrders"),
      numeric: true,
      secondary: true,
      render: (s) => s.cancelledOrderCount,
    },
    {
      key: "payIns",
      header: t("shift.deposits"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.payIns, fmt),
    },
    {
      key: "payOuts",
      header: t("shift.withdrawals"),
      numeric: true,
      secondary: true,
      render: (s) => formatMoney(s.payOuts, fmt),
    },
    {
      key: "expectedCash",
      header: t("shift.expected"),
      numeric: true,
      render: (s) => formatMoney(s.expectedCash, fmt),
    },
    {
      key: "countedCash",
      header: t("fin.countedCash"),
      numeric: true,
      render: (s) =>
        s.countedCash ? formatMoney(s.countedCash, fmt) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "variance",
      header: t("common.variance"),
      numeric: true,
      render: (s) =>
        s.countedCash === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span
            className={cx(
              "font-medium",
              s.variance.amount === 0 ? "text-fg" : s.variance.amount > 0 ? "text-good" : "text-bad",
            )}
          >
            {formatMoney(s.variance, fmt)} ·{" "}
            {s.variance.amount === 0
              ? t("shift.balanced")
              : s.variance.amount > 0
                ? t("shift.varianceOver")
                : t("shift.varianceShort")}
          </span>
        ),
    },
    {
      key: "closingCash",
      header: t("shift.closingCash"),
      numeric: true,
      secondary: true,
      render: (s) =>
        s.countedCash ? formatMoney(s.countedCash, fmt) : <span className="text-fg-subtle">—</span>,
    },
  ];

  return (
    <>
      <PageHeader title={t("rep.cashierTitle")} subtitle={t("rep.cashierSubtitle")} spec="§19.3" />

      <PageBody>
        <TileGrid>
          <MetricTile label={t("shift.title")} value={String(totals.shifts)} />
          <MetricTile
            label={t("shift.grossSales")}
            value={formatMoney({ amount: totals.grossSales, currency }, fmt)}
          />
          <MetricTile
            label={t("shift.netSales")}
            value={formatMoney({ amount: totals.netSales, currency }, fmt)}
          />
          <MetricTile
            label={t("common.variance")}
            value={formatMoney({ amount: totals.variance, currency }, fmt)}
            spec="FR-FIN-005"
          />
        </TileGrid>

        <Toolbar>
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="all">{t("common.all")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b.name, "en")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fin.cashier")}>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="all">{t("common.all")}</option>
              {activeEmployees
                .filter((e) => branchId === "all" || e.homeBranchId === branchId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {pick(e.name, "en")}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("common.date")}>
            <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}>
              <option value="all">{t("common.all")}</option>
              <option value="today">{t("filter.today")}</option>
              <option value="yesterday">{t("filter.yesterday")}</option>
              <option value="last7">{t("filter.last7")}</option>
            </Select>
          </Field>
        </Toolbar>

        <Section title={t("rep.cashierTitle")}>
          <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} caption={t("rep.cashierTitle")} />
        </Section>
      </PageBody>
    </>
  );
}
