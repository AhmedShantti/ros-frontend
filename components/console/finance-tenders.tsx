"use client";

/** FR-FIN-010 — a tender-type breakdown table: card by scheme, wallet by provider. */

import type { Currency } from "@/lib/console/types";
import { UNRECORDED, type TenderBucket } from "@/lib/console/finance-tenders";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatNumber, money } from "@/lib/console/format";
import { TENDER_TYPE } from "@/lib/console/labels";
import { DataTable, type Column } from "@/components/console/data-table";

export function useTenderLabel() {
  const { t, tx } = useI18n();
  return (row: Pick<TenderBucket, "tender" | "sub">) => {
    const base = tx(TENDER_TYPE[row.tender].label);
    if (!row.sub) return base;
    if (row.sub === UNRECORDED) {
      return `${base} · ${row.tender === "wallet" ? t("fnc.providerUnrecorded") : t("fnc.schemeUnrecorded")}`;
    }
    return `${base} · ${row.sub.toUpperCase()}`;
  };
}

export function TenderTotalsTable({ rows, currency }: { rows: TenderBucket[]; currency: Currency }) {
  const { t, fmt } = useI18n();
  const label = useTenderLabel();
  const columns: Column<TenderBucket>[] = [
    { key: "tender", header: t("fin.tenderType"), render: (row) => label(row) },
    { key: "count", header: t("fin.count"), numeric: true, render: (row) => formatNumber(row.count, fmt) },
    {
      key: "refunds",
      header: t("fin.cashRefunds"),
      numeric: true,
      secondary: true,
      render: (row) => (row.refunds === 0 ? "—" : formatMoney(money(-row.refunds, currency), fmt)),
    },
    { key: "amount", header: t("fin.netAmount"), numeric: true, render: (row) => formatMoney(money(row.amount, currency), fmt) },
  ];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      caption={t("fnc.tenderTotals")}
      dense
      totals={
        <tr>
          <td className="text-fg px-4 py-2 text-sm font-semibold">{t("common.total")}</td>
          <td />
          <td />
          <td className="text-fg px-4 py-2 text-end font-mono text-sm font-semibold tabular-nums">
            {formatMoney(money(total, currency), fmt)}
          </td>
        </tr>
      }
    />
  );
}
