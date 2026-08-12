"use client";

/**
 * Cash sessions — SRS ch.16.
 *
 * Expected cash is the arithmetic in FR-FIN-005: float, plus cash taken,
 * less cash refunded, plus pay-ins, less pay-outs and safe drops. Variance
 * is the counted figure against that, and it is the only number on this
 * screen anyone argues about.
 */

import { useMemo } from "react";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import type { LiveCashSession } from "@/lib/console/live/state";
import { formatDateTime, formatMoney, formatTime, money } from "@/lib/console/format";
import { APPROVAL_STATE, CASH_SESSION_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import {
  Badge,
  Card,
  CardHeader,
  DescList,
  DescRow,
  SpecTag,
  cx,
} from "@/components/console/ui";

export default function CashSessionsPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();

  const sessions = useMemo(
    () => (state.session ? [state.session, ...state.closedSessions] : state.closedSessions),
    [state.session, state.closedSessions],
  );

  const currency = sessions[0]?.openingFloat.currency ?? "EGP";

  const totals = useMemo(() => {
    const closed = state.closedSessions;
    return {
      open: state.session ? 1 : 0,
      cash: sessions.reduce((s, x) => s + x.cashSales.amount, 0),
      variance: closed.reduce((s, x) => s + x.variance.amount, 0),
      flagged: closed.filter((x) => x.varianceApproval !== "not_required").length,
    };
  }, [sessions, state.session, state.closedSessions]);

  const columns: Column<LiveCashSession>[] = [
    {
      key: "drawer",
      header: t("fin.drawer"),
      render: (session) => (
        <CellStack primary={session.terminalName} secondary={tx(session.branchName)} />
      ),
    },
    {
      key: "cashier",
      header: t("fin.cashier"),
      render: (session) => (
        <CellStack
          primary={tx(session.employeeName)}
          secondary={`${formatTime(session.openedAt, fmt)}${
            session.closedAt ? ` → ${formatTime(session.closedAt, fmt)}` : ""
          }`}
        />
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (session) => {
        const entry = labelOf(CASH_SESSION_STATUS, session.status);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
    {
      key: "openingFloat",
      header: t("fin.openingFloat"),
      numeric: true,
      secondary: true,
      render: (session) => formatMoney(session.openingFloat, fmt),
    },
    {
      key: "cashSales",
      header: t("fin.cashSales"),
      numeric: true,
      render: (session) => formatMoney(session.cashSales, fmt),
    },
    {
      key: "expectedCash",
      header: t("fin.expectedCash"),
      numeric: true,
      hint: t("fin.expectedFormula"),
      render: (session) => formatMoney(session.expectedCash, fmt),
    },
    {
      key: "countedCash",
      header: t("fin.countedCash"),
      numeric: true,
      render: (session) =>
        session.countedCash ? formatMoney(session.countedCash, fmt) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "variance",
      header: t("common.variance"),
      numeric: true,
      render: (session) =>
        session.countedCash === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span
            className={cx(
              "font-medium",
              session.variance.amount === 0
                ? "text-fg"
                : session.variance.amount > 0
                  ? "text-good"
                  : "text-bad",
            )}
          >
            {formatMoney(session.variance, fmt)}
          </span>
        ),
    },
    {
      key: "varianceApproval",
      header: t("fin.varianceApproval"),
      secondary: true,
      render: (session) => {
        const entry = labelOf(APPROVAL_STATE, session.varianceApproval);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t("fin.cashTitle")}
        subtitle={t("fin.cashSubtitle")}
        spec="ch.16"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid>
          <MetricTile label={t("shift.title")} value={String(sessions.length)} />
          <MetricTile
            label={t("fin.cashSales")}
            value={formatMoney(money(totals.cash, currency), fmt)}
          />
          <MetricTile
            label={t("common.variance")}
            value={formatMoney(money(totals.variance, currency), fmt)}
            spec="FR-FIN-005"
          />
          <MetricTile
            label={t("fin.varianceApproval")}
            value={String(totals.flagged)}
            spec="FR-POS-096"
          />
        </TileGrid>

        {state.session ? (
          <Card>
            <CardHeader
              title={`${t("shift.title")} · ${state.session.terminalName}`}
              hint={t("fin.expectedFormula")}
              spec="FR-POS-091"
              action={<SpecTag id="FR-POS-093" />}
            />
            <div className="grid gap-x-8 sm:grid-cols-2">
              <DescList>
                <DescRow label={t("shift.cashier")}>{tx(state.session.employeeName)}</DescRow>
                <DescRow label={t("shift.openedAt")}>
                  {formatDateTime(state.session.openedAt, fmt)}
                </DescRow>
                <DescRow label={t("fin.openingFloat")} mono>
                  {formatMoney(state.session.openingFloat, fmt)}
                </DescRow>
                <DescRow label={t("fin.cashSales")} mono>
                  {formatMoney(state.session.cashSales, fmt)}
                </DescRow>
                <DescRow label={t("fin.cashRefunds")} mono>
                  {formatMoney(state.session.cashRefunds, fmt)}
                </DescRow>
              </DescList>
              <DescList>
                <DescRow label={t("fin.payIns")} mono>
                  {formatMoney(state.session.payIns, fmt)}
                </DescRow>
                <DescRow label={t("fin.payOuts")} mono>
                  {formatMoney(state.session.payOuts, fmt)}
                </DescRow>
                <DescRow label={t("fin.safeDrops")} mono>
                  {formatMoney(state.session.safeDrops, fmt)}
                </DescRow>
                <DescRow label={t("orders.title")} mono>
                  {state.session.orderCount}
                </DescRow>
                <DescRow label={t("fin.expectedCash")} mono>
                  <span className="text-fg font-semibold">
                    {formatMoney(state.session.expectedCash, fmt)}
                  </span>
                </DescRow>
              </DescList>
            </div>

            {state.session.movements.length > 0 ? (
              <ul className="border-line mt-4 space-y-1 border-t pt-3 text-xs">
                {[...state.session.movements].reverse().map((movement) => (
                  <li key={movement.id} className="flex items-center justify-between gap-3">
                    <span className="text-fg-muted shrink-0">
                      {formatTime(movement.at, fmt)} · {movement.kind.replace(/_/g, " ")}
                    </span>
                    <span className="text-fg-subtle min-w-0 flex-1 truncate">{movement.reason}</span>
                    <span className="text-fg shrink-0 tabular-nums">
                      {formatMoney(movement.amount, fmt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {sessions.length === 0 ? (
          <LiveEmpty />
        ) : (
          <Section title={t("fin.cashTitle")}>
            <DataTable
              columns={columns}
              rows={sessions}
              rowKey={(session) => session.id}
              caption={t("fin.cashTitle")}
            />
          </Section>
        )}
      </PageBody>
    </>
  );
}
