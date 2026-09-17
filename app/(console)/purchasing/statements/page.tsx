"use client";

/**
 * Supplier account statement — SRS §12.6, FR-PRC-044.
 *
 * Invoices, credits and payments for one supplier over a period, with the
 * opening and running balance, and what is still owed aged by days past due
 * (current, 1–30, 31–60, 61–90, 90+). Computed by `buildStatement` from the
 * same invoices, credit notes and payments every other payables screen reads.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { services } from "@/lib/console/services";
import { buildStatement, type StatementEntry } from "@/lib/console/purchasing-payables";
import { AGEING_BANDS, addDays } from "@/lib/console/purchasing-rules";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDate, formatMoney, money } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { EmptyPanel, ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { useSupplierList } from "@/components/console/purchasing-shared";
import { Badge, Callout, Field, Input, Meter, Select } from "@/components/console/ui";

export default function StatementsPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      {/* `useSearchParams` suspends during prerender. */}
      <Suspense fallback={<LoadingPanel />}>
        <StatementScreen />
      </Suspense>
    </Gate>
  );
}

function StatementScreen() {
  const { t, tx, fmt } = useI18n();
  const params = useSearchParams();
  const suppliers = useSupplierList();
  const [supplierId, setSupplierId] = useState(params.get("supplier") ?? "");
  const [to, setTo] = useState(todayIso());
  const [from, setFrom] = useState(addDays(todayIso(), -90));

  useEffect(() => {
    if (!supplierId && suppliers.rows[0]) setSupplierId(suppliers.rows[0].id);
  }, [supplierId, suppliers.rows]);

  const data = useAsync(async () => {
    if (!supplierId) return null;
    const [invoices, credits, payments, reviews] = await Promise.all([
      services.purchasing.invoices.list({ limit: 5000, filters: { supplierId } }).then((page) => page.rows),
      services.procurement.creditNotes.all(),
      services.procurement.payments.all(),
      services.procurement.invoiceReviews.all(),
    ]);
    return { invoices, credits, payments, reviews };
  }, [supplierId]);

  const supplier = suppliers.rows.find((row) => row.id === supplierId) ?? null;
  const currency = supplier?.currency ?? "EGP";
  const invalidRange = from > to;
  const statement = useMemo(
    () => (data.data && supplierId && !invalidRange ? buildStatement({ supplierId, from, to, ...data.data }) : null),
    [data.data, supplierId, from, to, invalidRange],
  );

  const columns: Column<StatementEntry>[] = [
    { key: "date", header: t("common.date"), render: (row) => formatDate(row.date, fmt) },
    { key: "kind", header: t("prc.stmt.type"), render: (row) => <Badge tone={row.kind === "invoice" ? "neutral" : "good"}>{t(`prc.stmt.kind.${row.kind}` as ConsoleKey)}</Badge> },
    { key: "reference", header: t("common.reference"), render: (row) => <span className="font-mono text-xs">{row.reference}</span> },
    { key: "debit", header: t("prc.stmt.debit"), numeric: true, render: (row) => (row.amountMinor > 0 ? formatMoney(money(row.amountMinor, currency), fmt) : "") },
    { key: "credit", header: t("prc.stmt.credit"), numeric: true, render: (row) => (row.amountMinor < 0 ? formatMoney(money(-row.amountMinor, currency), fmt) : "") },
    { key: "balance", header: t("prc.stmt.balance"), numeric: true, render: (row) => formatMoney(money(row.balanceMinor, currency), fmt) },
  ];

  const ageingTotal = statement ? AGEING_BANDS.reduce((sum, band) => sum + statement.ageing[band], 0) : 0;

  return (
    <>
      <PageHeader
        title={t("prc.stmt.title")}
        subtitle={t("prc.stmt.subtitle")}
        spec="FR-PRC-044"
        actions={
          statement && supplier ? (
            <ExportButton
              filename={`statement-${supplier.code}`}
              title={`${t("prc.stmt.title")} — ${tx(supplier.legalName)}`}
              filterSummary={`${from} – ${to}`}
              rows={statement.entries}
              columns={[
                { key: "date", header: t("common.date"), value: (row) => row.date },
                { key: "kind", header: t("prc.stmt.type"), value: (row) => t(`prc.stmt.kind.${row.kind}` as ConsoleKey) },
                { key: "reference", header: t("common.reference"), value: (row) => row.reference },
                { key: "debit", header: t("prc.stmt.debit"), value: (row) => (row.amountMinor > 0 ? (row.amountMinor / 100).toFixed(2) : "") },
                { key: "credit", header: t("prc.stmt.credit"), value: (row) => (row.amountMinor < 0 ? (-row.amountMinor / 100).toFixed(2) : "") },
                { key: "balance", header: t("prc.stmt.balance"), value: (row) => (row.balanceMinor / 100).toFixed(2) },
              ]}
            />
          ) : null
        }
      />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pur.supplier")}>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">—</option>
              {suppliers.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.stmt.from")} error={invalidRange ? t("prc.stmt.badRange") : undefined}>
            <Input type="date" dir="ltr" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t("prc.stmt.to")}>
            <Input type="date" dir="ltr" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>

        {suppliers.error ? (
          <ErrorPanel error={suppliers.error} onRetry={suppliers.reload} />
        ) : data.error ? (
          <ErrorPanel error={data.error} onRetry={data.reload} />
        ) : !supplierId ? (
          <EmptyPanel title={t("prc.stmt.pickSupplier")} />
        ) : data.loading || !statement ? (
          invalidRange ? null : <LoadingPanel />
        ) : (
          <>
            <TileGrid columns={4}>
              <MetricTile label={t("prc.stmt.opening")} value={formatMoney(money(statement.openingMinor, currency), fmt)} />
              <MetricTile label={t("prc.stmt.invoiced")} value={formatMoney(money(statement.invoicedMinor, currency), fmt)} />
              <MetricTile label={t("prc.stmt.creditsPayments")} value={formatMoney(money(statement.creditedMinor + statement.paidMinor, currency), fmt)} />
              <MetricTile label={t("prc.stmt.closing")} value={formatMoney(money(statement.closingMinor, currency), fmt)} spec="FR-PRC-044" />
            </TileGrid>

            {statement.rejectedInvoices > 0 ? <Callout tone="warn">{t("prc.stmt.rejectedNote").replace("{n}", String(statement.rejectedInvoices))}</Callout> : null}

            <Section title={t("prc.stmt.ageing")} hint={t("prc.stmt.ageingHint").replace("{date}", formatDate(to, fmt))}>
              <ul className="space-y-2">
                {AGEING_BANDS.map((band) => (
                  <li key={band}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-fg-muted">{t(`prc.age.${band}` as ConsoleKey)}</span>
                      <span className="font-mono tabular-nums">{formatMoney(money(statement.ageing[band], currency), fmt)}</span>
                    </div>
                    <Meter value={ageingTotal > 0 ? (statement.ageing[band] / ageingTotal) * 100 : 0} tone={band === "current" ? "good" : band === "1_30" ? "warn" : "bad"} />
                  </li>
                ))}
              </ul>
              {statement.unappliedCreditMinor > 0 ? (
                <Callout tone="accent" className="mt-3">
                  {t("prc.stmt.unapplied").replace("{amount}", formatMoney(money(statement.unappliedCreditMinor, currency), fmt))}
                </Callout>
              ) : null}
            </Section>

            <DataTable
              columns={columns}
              rows={statement.entries}
              rowKey={(row) => `${row.kind}-${row.reference}-${row.date}-${row.balanceMinor}`}
              caption={t("prc.stmt.title")}
              emptyTitle={t("prc.stmt.emptyTitle")}
              dense
            />
          </>
        )}
      </PageBody>
    </>
  );
}
