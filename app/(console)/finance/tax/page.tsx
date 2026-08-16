"use client";

/**
 * Tax summary — SRS §16.6.
 *
 * Tax is computed per line by the country pack's engine and then summed, never
 * computed on the order total. The difference is not academic: an order mixing
 * a standard-rated dish with a zero-rated bottle of water has no single
 * meaningful rate, and applying one to the total mis-states both.
 *
 * Under tax-inclusive pricing — the norm in the region — the net is derived
 * backwards out of the shelf price rather than the gross being derived
 * forwards from a net. That is why net is shown beside gross here instead of
 * the tax figure standing alone: the relationship is the thing worth checking.
 *
 * Rounding is reported apart from tax and revenue (FR-FIN-052). Cash rounding
 * applies only to the cash portion of a settlement, and absorbing it into
 * either line would make the return disagree with the ledger by a few piastres
 * a day — which is precisely the kind of discrepancy that costs a week to find.
 */

import { useMemo } from "react";
import type { TaxSummaryRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatPercent } from "@/lib/console/format";
import { TAX_CLASS, labelOf } from "@/lib/console/labels";
import { countryPacks } from "@/lib/console/mock/platform";
import { branchById } from "@/lib/console/mock/org";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile, MixDonut } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Badge, Callout, DescList, DescRow } from "@/components/console/ui";

export default function TaxPage() {
  return (
    <Gate permissions={["finance.tax.view"]}>
      <TaxScreen />
    </Gate>
  );
}

function TaxScreen() {
  const { t } = useI18n();
  const { scope } = useSession();

  const state = useAsync<TaxSummaryRow[]>(
    () => services.finance.taxSummary(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  return (
    <>
      <PageHeader
        title={t("fin.taxTitle")}
        subtitle={t("fin.taxSubtitle")}
        spec="FR-FIN-040"
      />

      <PageBody>
        <AsyncPanel state={state}>{(rows) => <TaxBody rows={rows} />}</AsyncPanel>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

function TaxBody({ rows }: { rows: TaxSummaryRow[] }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();

  // The pack in force for the branch in scope decides how these numbers were
  // produced — inclusive or exclusive, rounded which way, summed at which level.
  const pack = useMemo(() => {
    const branch = scope.branchId ? branchById.get(scope.branchId) : null;
    const code = branch?.countryCode ?? "EG";
    return countryPacks.find((candidate) => candidate.code === code) ?? countryPacks[0]!;
  }, [scope.branchId]);

  const totals = useMemo(() => {
    return {
      net: rows.reduce((sum, row) => sum + row.netAmount.amount, 0),
      tax: rows.reduce((sum, row) => sum + row.taxAmount.amount, 0),
      gross: rows.reduce((sum, row) => sum + row.grossAmount.amount, 0),
    };
  }, [rows]);

  const currency = rows[0]?.netAmount.currency ?? "EGP";

  const mix = useMemo(
    () =>
      rows
        .filter((row) => row.taxAmount.amount > 0)
        .map((row) => ({
          label: tx(labelOf(TAX_CLASS, row.taxClass).label),
          value: row.taxAmount.amount,
        })),
    [rows, tx],
  );

  const columns = useMemo<Column<TaxSummaryRow>[]>(
    () => [
      {
        key: "taxClass",
        header: t("menu.taxClass"),
        render: (row) => {
          const entry = labelOf(TAX_CLASS, row.taxClass);
          return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
        },
      },
      {
        key: "rate",
        header: t("fin.taxRate"),
        numeric: true,
        render: (row) => formatPercent(row.rate, fmt, row.rate % 1 === 0 ? 0 : 1),
      },
      {
        key: "netAmount",
        header: t("fin.netAmount"),
        numeric: true,
        render: (row) => formatMoney(row.netAmount, fmt),
      },
      {
        key: "taxAmount",
        header: t("fin.taxAmount"),
        numeric: true,
        render: (row) => formatMoney(row.taxAmount, fmt),
      },
      {
        key: "grossAmount",
        header: t("fin.grossAmount"),
        numeric: true,
        render: (row) => formatMoney(row.grossAmount, fmt),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <TileGrid columns={3}>
        <MetricTile
          label={t("fin.netAmount")}
          value={formatMoney({ amount: totals.net, currency }, fmt, true)}
        />
        <MetricTile
          label={t("fin.taxAmount")}
          value={formatMoney({ amount: totals.tax, currency }, fmt, true)}
          spec="FR-FIN-040"
        />
        <MetricTile
          label={t("fin.grossAmount")}
          value={formatMoney({ amount: totals.gross, currency }, fmt, true)}
        />
      </TileGrid>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.taxClass}
        caption={t("fin.taxTitle")}
        totals={
          <tr>
            <td className="text-fg px-4 py-2.5 text-sm font-semibold">{t("common.total")}</td>
            <td />
            <td className="text-fg px-4 py-2.5 text-end font-mono text-sm font-semibold tabular-nums">
              {formatMoney({ amount: totals.net, currency }, fmt)}
            </td>
            <td className="text-fg px-4 py-2.5 text-end font-mono text-sm font-semibold tabular-nums">
              {formatMoney({ amount: totals.tax, currency }, fmt)}
            </td>
            <td className="text-fg px-4 py-2.5 text-end font-mono text-sm font-semibold tabular-nums">
              {formatMoney({ amount: totals.gross, currency }, fmt)}
            </td>
          </tr>
        }
        dense
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("cp.taxEngine")} spec="FR-LOC-020">
          <DescList>
            <DescRow label={t("org.country")}>{tx(pack.name)}</DescRow>
            <DescRow label={t("cp.taxEngine")} mono>
              {pack.taxEngine}
            </DescRow>
            <DescRow label={t("cp.pricingMode")}>
              <Badge tone={pack.pricingMode === "tax_inclusive" ? "accent" : "neutral"}>
                {pack.pricingMode === "tax_inclusive"
                  ? t("fin.taxInclusive")
                  : t("fin.taxExclusive")}
              </Badge>
            </DescRow>
            <DescRow label={t("cp.computationLevel")} mono>
              {pack.computationLevel === "line" ? t("fin.perLine") : t("fin.perOrder")}
            </DescRow>
            <DescRow label={t("cp.rounding")} mono>
              {pack.roundingMode}
            </DescRow>
            <DescRow label={t("cp.fiscal")}>
              {pack.fiscalProvider ?? t("common.none")}
            </DescRow>
          </DescList>
        </Section>

        {mix.length > 0 ? (
          <Section title={t("fin.taxAmount")}>
            <MixDonut
              data={mix}
              format={(value) => formatMoney({ amount: value, currency }, fmt, true)}
              centreLabel={t("fin.taxAmount")}
              centreValue={formatMoney({ amount: totals.tax, currency }, fmt, true)}
            />
          </Section>
        ) : null}
      </div>

      <Callout tone="muted">{t("fin.roundingNote")}</Callout>
    </>
  );
}
