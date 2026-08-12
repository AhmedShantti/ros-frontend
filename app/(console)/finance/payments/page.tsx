"use client";

/**
 * Payments by tender — SRS §16.5.
 *
 * Every captured payment, grouped by how it was taken. Refunds are negative
 * amounts against the same tender rather than a separate category, so the
 * net per tender is what a reconciliation actually needs.
 */

import { useMemo } from "react";
import type { TenderType } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatMoney, formatPercent, money, percentOf } from "@/lib/console/format";
import { TENDER_TYPE } from "@/lib/console/labels";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile, MixDonut } from "@/components/console/charts";
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
  const { state } = useLive();

  const { rows, total, currency } = useMemo(() => {
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
    {
      key: "refunds",
      header: t("fin.cashRefunds"),
      numeric: true,
      render: (row) =>
        row.refunds === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="text-bad">−{formatMoney(money(row.refunds, currency), fmt)}</span>
        ),
    },
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
        <LiveNotice />

        {rows.length === 0 ? (
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
