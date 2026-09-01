"use client";

/**
 * Payments by tender — SRS §16.5.
 *
 * Every captured payment, grouped by how it was taken. Refunds are negative
 * amounts against the same tender rather than a separate category, so the
 * net per tender is what a reconciliation actually needs.
 *
 * Two sources. Against a backend the totals come from the daily-trading
 * report's `tenderTotals`, which is the server's own arithmetic over the
 * business day. Without one they are computed from the payments the
 * terminals on this device have taken.
 *
 * The report carries an amount and a payment count per tender and nothing
 * else — there is no gross/refund split in it — so the refund column is
 * dropped in live mode rather than rendered as a dash, which would read as
 * "no refunds today" instead of "not a figure this source has".
 */

import { useMemo } from "react";
import type { TenderType } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { DATA_MODE } from "@/lib/api/config";
import { formatMoney, formatPercent, money, percentOf } from "@/lib/console/format";
import { TENDER_TYPE } from "@/lib/console/labels";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile, MixDonut } from "@/components/console/charts";
import { ErrorPanel, LoadingPanel } from "@/components/console/states";
import { Card, CardHeader, Meter } from "@/components/console/ui";

interface Row {
  tender: TenderType;
  gross: number;
  refunds: number;
  net: number;
  count: number;
}

export default function PaymentsPage() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const { state } = useLive();

  const live = DATA_MODE === "http";

  const remote = useAsync(
    async () => (live ? await services.finance.paymentSummary(scope) : []),
    [live, scope.tenantId, scope.brandId, scope.branchId],
  );

  const device = useMemo(() => {
    const map = new Map<TenderType, Row>();
    let currencyCode = "EGP";

    for (const id of state.orderIds) {
      const order = state.orders[id];
      if (!order) continue;
      currencyCode = order.currency;
      for (const payment of order.payments) {
        const row = map.get(payment.tender) ?? {
          tender: payment.tender,
          gross: 0,
          refunds: 0,
          net: 0,
          count: 0,
        };
        if (payment.amount.amount >= 0) row.gross += payment.amount.amount;
        else row.refunds += -payment.amount.amount;
        row.net += payment.amount.amount;
        row.count += 1;
        map.set(payment.tender, row);
      }
    }

    const list = [...map.values()].sort((a, b) => b.net - a.net);
    return {
      rows: list,
      total: list.reduce((s, row) => s + row.net, 0),
      currency: currencyCode as "EGP" | "SAR" | "AED",
    };
  }, [state]);

  const { rows, total, currency } = useMemo(() => {
    if (!live) return device;

    const list: Row[] = (remote.data ?? [])
      .map((row) => ({
        tender: row.tender,
        gross: row.amount.amount,
        refunds: 0,
        net: row.amount.amount,
        count: row.count,
      }))
      .sort((a, b) => b.net - a.net);

    return {
      rows: list,
      total: list.reduce((sum, row) => sum + row.net, 0),
      currency: (remote.data?.[0]?.amount.currency ?? "EGP") as "EGP" | "SAR" | "AED",
    };
  }, [live, device, remote.data]);

  const columns: Column<Row>[] = [
    {
      key: "tender",
      header: t("fin.tenderType"),
      render: (row) => tx(TENDER_TYPE[row.tender].label),
    },
    {
      key: "count",
      header: t("fin.transactionCount"),
      numeric: true,
      render: (row) => row.count,
    },
    {
      key: "gross",
      header: t("fin.grossAmount"),
      numeric: true,
      render: (row) => formatMoney(money(row.gross, currency), fmt),
    },
    // Omitted in live mode: `tenderTotals` has no refund figure to show.
    ...(live
      ? []
      : [
          {
            key: "refunds",
            header: t("fin.cashRefunds"),
            numeric: true,
            render: (row: Row) =>
              row.refunds === 0 ? (
                <span className="text-fg-subtle">—</span>
              ) : (
                <span className="text-bad">
                  −{formatMoney(money(row.refunds, currency), fmt)}
                </span>
              ),
          } satisfies Column<Row>,
        ]),
    {
      key: "net",
      header: t("fin.netAmount"),
      numeric: true,
      render: (row) => formatMoney(money(row.net, currency), fmt),
    },
    {
      key: "share",
      header: t("common.total"),
      render: (row) => (
        <div className="min-w-24">
          <Meter value={total === 0 ? 0 : (row.net / total) * 100} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("fin.paymentsTitle")}
        subtitle={t("fin.paymentsSubtitle")}
        spec="§16.5"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice source={live ? "backend" : "device"} />

        {live && remote.error ? (
          <ErrorPanel error={remote.error} onRetry={remote.reload} />
        ) : live && remote.loading && remote.data === null ? (
          <LoadingPanel />
        ) : rows.length === 0 ? (
          <LiveEmpty />
        ) : (
          <>
            <TileGrid columns={3}>
              <MetricTile
                label={t("fin.netAmount")}
                value={formatMoney(money(total, currency), fmt)}
              />
              <MetricTile
                label={t("fin.transactionCount")}
                value={String(rows.reduce((s, row) => s + row.count, 0))}
              />
              <MetricTile
                label={tx(TENDER_TYPE.cash.label)}
                value={formatPercent(
                  percentOf(
                    money(rows.find((row) => row.tender === "cash")?.net ?? 0, currency),
                    money(total || 1, currency),
                  ),
                  fmt,
                )}
              />
            </TileGrid>

            <Card>
              <CardHeader title={t("fin.tenderType")} spec="§16.5" />
              <MixDonut
                data={rows.map((row) => ({
                  label: tx(TENDER_TYPE[row.tender].label),
                  value: Math.max(0, row.net),
                }))}
                format={(value) => formatMoney(money(value, currency), fmt, true)}
                centreLabel={t("fin.netAmount")}
                centreValue={formatMoney(money(total, currency), fmt, true)}
              />
            </Card>

            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.tender}
              caption={t("fin.paymentsTitle")}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
