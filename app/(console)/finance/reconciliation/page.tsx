"use client";

/**
 * Settlement reconciliation — SRS §16.3, FR-FIN-011, FR-FIN-012.
 *
 * Two statements a restaurant receives and rarely checks. The acquirer's
 * batch settlement says what the card terminal actually settled, per scheme;
 * the aggregator's payout statement says what it paid after commission and
 * fees. Both are compared here against the orders the system recorded.
 *
 * Sources, honestly: the orders are real (`GET /orders` live, walked up to a
 * bounded number of pages). The statements, each aggregator's contract terms
 * and the resolution of each difference have no backend resource and are
 * kept in this browser. Nothing on this page is auto-imported from an
 * acquirer or aggregator API — the integrations do not exist.
 */

import { useMemo, useState } from "react";
import { FileUp, Plus } from "lucide-react";

import type { Order } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { DiscrepancyResolution } from "@/lib/console/services/finance-settlements";
import {
  reconcileCardBatch,
  reconcilePayout,
  type CardMatch,
  type PayoutMatch,
} from "@/lib/console/finance-reconciliation";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, money } from "@/lib/console/format";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { MoneyInput } from "@/components/console/fields";
import { ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { Badge, Button, Callout, Field, Tabs, cx } from "@/components/console/ui";
import {
  CardBatchForm,
  CardCsvImport,
  CardMatchDrawer,
  PayoutForm,
  PayoutMatchDrawer,
  ResolutionBadge,
  TermsEditor,
} from "@/components/console/finance-reconciliation";

/** How many orders are read for matching; beyond this the page says so. */
const ORDER_SCAN = 1000;

type Tab = "card" | "aggregator";

export default function ReconciliationPage() {
  return (
    <Gate permissions={["report.view.financial"]}>
      <ReconciliationScreen />
    </Gate>
  );
}

function ReconciliationScreen() {
  const { t, fmt } = useI18n();
  const { scope, tenant, branch } = useSession();
  const [tab, setTab] = useState<Tab>("card");
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);
  const [tolerance, setTolerance] = useState<number | null>(() => {
    try {
      return services.settlements.prefs().toleranceMinor;
    } catch {
      return 100;
    }
  });

  const currency = branch?.currency ?? tenant.baseCurrency;

  const orders = useAsync<{ rows: Order[]; total: number }>(
    () =>
      services.sales.orders
        .list({ scope, limit: ORDER_SCAN, offset: 0 })
        .then((page) => ({ rows: page.rows, total: page.total })),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const stored = useAsync(
    async () => {
      const [batches, payouts, terms, resolutions] = await Promise.all([
        services.settlements.batches.all(),
        services.settlements.payouts.all(),
        services.settlements.terms.all(),
        services.settlements.resolutions.all(),
      ]);
      return { batches, payouts, terms, resolutions };
    },
    [nonce, scope.tenantId],
  );

  const resolutions = useMemo(
    () => new Map<string, DiscrepancyResolution>((stored.data?.resolutions ?? []).map((row) => [row.key, row])),
    [stored.data],
  );

  const toleranceMinor = tolerance ?? 0;

  const cardMatches = useMemo<CardMatch[]>(
    () =>
      (stored.data?.batches ?? [])
        .filter((batch) => !scope.branchId || !batch.branchId || batch.branchId === scope.branchId)
        .map((batch) => reconcileCardBatch(batch, orders.data?.rows ?? [], toleranceMinor))
        .sort((a, b) => b.batch.businessDay.localeCompare(a.batch.businessDay)),
    [stored.data, orders.data, toleranceMinor, scope.branchId],
  );

  const payoutMatches = useMemo<PayoutMatch[]>(
    () =>
      (stored.data?.payouts ?? [])
        .filter((row) => !scope.branchId || !row.branchId || row.branchId === scope.branchId)
        .map((statement) =>
          reconcilePayout(
            statement,
            orders.data?.rows ?? [],
            stored.data?.terms.find((row) => row.aggregator.toLowerCase() === statement.aggregator.toLowerCase()) ?? null,
            toleranceMinor,
          ),
        )
        .sort((a, b) => b.statement.periodTo.localeCompare(a.statement.periodTo)),
    [stored.data, orders.data, toleranceMinor, scope.branchId],
  );

  const openFlags = (keys: { key: string; flagged: boolean }[]) =>
    keys.filter((row) => row.flagged && (resolutions.get(row.key)?.status ?? "open") === "open").length;

  const cardOpen = cardMatches.reduce((sum, match) => sum + openFlags(match.rows), 0);
  const payoutOpen = payoutMatches.reduce(
    (sum, match) => sum + openFlags([...match.orders, { key: match.totalKey, flagged: match.totalFlagged }]),
    0,
  );

  const truncated = (orders.data?.total ?? 0) > (orders.data?.rows.length ?? 0);

  return (
    <>
      <PageHeader title={t("fnc.reconTitle")} subtitle={t("fnc.reconSubtitle")} spec="FR-FIN-011" />

      <PageBody>
        <Callout tone="muted">{t("fnc.reconSources")}</Callout>
        {truncated ? (
          <Callout tone="warn">
            {t("fnc.ordersTruncated").replace("{n}", formatNumber(orders.data?.rows.length ?? 0, fmt))}
          </Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile label={t("fnc.cardBatches")} value={formatNumber(cardMatches.length, fmt)} spec="FR-FIN-011" />
          <MetricTile label={t("fnc.openCardFlags")} value={formatNumber(cardOpen, fmt)} />
          <MetricTile label={t("fnc.payoutStatements")} value={formatNumber(payoutMatches.length, fmt)} spec="FR-FIN-012" />
          <MetricTile label={t("fnc.openPayoutFlags")} value={formatNumber(payoutOpen, fmt)} />
        </TileGrid>

        <Toolbar>
          <div className="w-48">
            <Field label={t("fnc.tolerance")} hint={t("fnc.toleranceHint")}>
              <MoneyInput
                value={tolerance}
                currency={currency}
                min={0}
                onChange={(next) => {
                  setTolerance(next);
                  if (next !== null && next >= 0) services.settlements.setPrefs({ toleranceMinor: next });
                }}
              />
            </Field>
          </div>
        </Toolbar>

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "card", label: t("fnc.cardBatches"), count: cardOpen },
            { value: "aggregator", label: t("fnc.aggregatorPayouts"), count: payoutOpen },
          ]}
        />

        {orders.error ? (
          <ErrorPanel error={orders.error} onRetry={orders.reload} />
        ) : orders.loading && !orders.data ? (
          <LoadingPanel />
        ) : stored.error ? (
          <ErrorPanel error={stored.error} onRetry={stored.reload} />
        ) : tab === "card" ? (
          <CardTab matches={cardMatches} resolutions={resolutions} currency={currency} onChanged={refresh} />
        ) : (
          <AggregatorTab
            matches={payoutMatches}
            resolutions={resolutions}
            terms={stored.data?.terms ?? []}
            currency={currency}
            onChanged={refresh}
          />
        )}
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

function CardTab({
  matches,
  resolutions,
  currency,
  onChanged,
}: {
  matches: CardMatch[];
  resolutions: Map<string, DiscrepancyResolution>;
  currency: Order["currency"];
  onChanged: () => void;
}) {
  const { t, fmt } = useI18n();
  const [entering, setEntering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = matches.find((match) => match.batch.id === selectedId) ?? null;
  const m = (amount: number, c = currency) => formatMoney(money(amount, c), fmt);

  const columns: Column<CardMatch>[] = [
    {
      key: "batch",
      header: t("fnc.batchNumber"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs" dir="ltr">{row.batch.batchNumber}</span>
          <span className="text-fg-subtle text-xs">{row.batch.acquirer}</span>
        </span>
      ),
    },
    { key: "day", header: t("fin.businessDay"), render: (row) => formatDate(row.batch.businessDay, fmt) },
    { key: "terminal", header: t("fnc.terminal"), secondary: true, render: (row) => row.batch.terminalName ?? t("fnc.allTerminals") },
    { key: "statement", header: t("fnc.statementTotal"), numeric: true, render: (row) => m(row.statementTotal, row.batch.currency) },
    { key: "system", header: t("fnc.systemTotal"), numeric: true, render: (row) => m(row.systemTotal, row.batch.currency) },
    {
      key: "difference",
      header: "Δ",
      numeric: true,
      render: (row) => (
        <span className={cx("font-mono tabular-nums", row.flaggedCount > 0 && "text-bad font-semibold")}>
          {m(row.difference, row.batch.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const open = row.rows.filter((r) => r.flagged && (resolutions.get(r.key)?.status ?? "open") === "open").length;
        return row.flaggedCount === 0 ? (
          <ResolutionBadge resolution={undefined} flagged={false} />
        ) : open > 0 ? (
          <Badge tone="bad">{formatNumber(open, fmt)} {t("fnc.openFlags")}</Badge>
        ) : (
          <Badge tone="good">{t("fnc.allResolved")}</Badge>
        );
      },
    },
  ];

  const exportRows = matches.flatMap((match) =>
    match.rows.map((row) => ({ match, row, resolution: resolutions.get(row.key)?.status ?? (row.flagged ? "open" : "matched") })),
  );

  return (
    <Section
      title={t("fnc.cardBatches")}
      spec="FR-FIN-011"
      action={
        <span className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setEntering(true)}>
            {t("fnc.enterBatch")}
          </Button>
          <Button size="sm" icon={<FileUp size={14} />} onClick={() => setImporting(true)}>
            {t("fnc.importCsv")}
          </Button>
          <ExportButton
            filename="card-batch-reconciliation"
            title={t("fnc.cardBatches")}
            rows={exportRows}
            columns={[
              { key: "batch", header: t("fnc.batchNumber"), value: (r) => r.match.batch.batchNumber },
              { key: "acquirer", header: t("fnc.acquirer"), value: (r) => r.match.batch.acquirer },
              { key: "day", header: t("fin.businessDay"), value: (r) => r.match.batch.businessDay },
              { key: "scheme", header: t("fnc.scheme"), value: (r) => r.row.scheme },
              { key: "sc", header: `${t("fnc.statement")} ${t("fin.count")}`, value: (r) => r.row.statementCount },
              { key: "sa", header: `${t("fnc.statement")} ${t("fin.amount")}`, value: (r) => (r.row.statementAmount / 100).toFixed(2) },
              { key: "yc", header: `${t("fnc.system")} ${t("fin.count")}`, value: (r) => r.row.systemCount },
              { key: "ya", header: `${t("fnc.system")} ${t("fin.amount")}`, value: (r) => (r.row.systemAmount / 100).toFixed(2) },
              { key: "d", header: "Δ", value: (r) => (r.row.difference / 100).toFixed(2) },
              { key: "side", header: t("fnc.match"), value: (r) => r.row.side },
              { key: "res", header: t("common.status"), value: (r) => r.resolution },
            ]}
          />
        </span>
      }
    >
      <DataTable
        columns={columns}
        rows={matches}
        rowKey={(row) => row.batch.id}
        caption={t("fnc.cardBatches")}
        onRowClick={(row) => setSelectedId(row.batch.id)}
        activeRowKey={selectedId}
        emptyTitle={t("fnc.noBatches")}
        emptyBody={t("fnc.noBatchesBody")}
        dense
      />

      <CardBatchForm open={entering} currency={currency} onClose={() => setEntering(false)} onSaved={onChanged} />
      <CardCsvImport open={importing} currency={currency} onClose={() => setImporting(false)} onSaved={onChanged} />
      <CardMatchDrawer match={selected} resolutions={resolutions} onClose={() => setSelectedId(null)} onChanged={onChanged} />
    </Section>
  );
}

// ---------------------------------------------------------------------------

function AggregatorTab({
  matches,
  resolutions,
  terms,
  currency,
  onChanged,
}: {
  matches: PayoutMatch[];
  resolutions: Map<string, DiscrepancyResolution>;
  terms: import("@/lib/console/services/finance-settlements").AggregatorTerms[];
  currency: Order["currency"];
  onChanged: () => void;
}) {
  const { t, fmt } = useI18n();
  const [entering, setEntering] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = matches.find((match) => match.statement.id === selectedId) ?? null;
  const m = (amount: number, c = currency) => formatMoney(money(amount, c), fmt);

  const columns: Column<PayoutMatch>[] = [
    { key: "aggregator", header: t("fnc.aggregator"), render: (row) => row.statement.aggregator },
    {
      key: "period",
      header: t("fnc.period"),
      render: (row) => `${formatDate(row.statement.periodFrom, fmt)} → ${formatDate(row.statement.periodTo, fmt)}`,
    },
    { key: "orders", header: t("fnc.ordersInPeriod"), numeric: true, secondary: true, render: (row) => formatNumber(row.orderCount, fmt) },
    { key: "net", header: t("fnc.netPayout"), numeric: true, render: (row) => m(row.statement.netPayoutMinor, row.statement.currency) },
    { key: "expected", header: t("fnc.expected"), numeric: true, render: (row) => m(row.expectedNet, row.statement.currency) },
    {
      key: "difference",
      header: "Δ",
      numeric: true,
      render: (row) => (
        <span className={cx("font-mono tabular-nums", row.totalFlagged && "text-bad font-semibold")}>
          {m(row.netDifference, row.statement.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const keys = [...row.orders, { key: row.totalKey, flagged: row.totalFlagged }];
        const open = keys.filter((r) => r.flagged && (resolutions.get(r.key)?.status ?? "open") === "open").length;
        return row.flaggedCount === 0 ? (
          <ResolutionBadge resolution={undefined} flagged={false} />
        ) : open > 0 ? (
          <Badge tone="bad">{formatNumber(open, fmt)} {t("fnc.openFlags")}</Badge>
        ) : (
          <Badge tone="good">{t("fnc.allResolved")}</Badge>
        );
      },
    },
  ];

  return (
    <>
      <Section title={t("fnc.terms")} spec="FR-FIN-012">
        <TermsEditor terms={terms} currency={currency} onSaved={onChanged} />
      </Section>

      <Section
        title={t("fnc.aggregatorPayouts")}
        spec="FR-FIN-012"
        action={
          <span className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setEntering(true)}>
              {t("fnc.enterPayout")}
            </Button>
            <ExportButton
              filename="aggregator-payout-reconciliation"
              title={t("fnc.aggregatorPayouts")}
              rows={matches}
              columns={[
                { key: "aggregator", header: t("fnc.aggregator"), value: (r) => r.statement.aggregator },
                { key: "from", header: t("fnc.periodFrom"), value: (r) => r.statement.periodFrom },
                { key: "to", header: t("fnc.periodTo"), value: (r) => r.statement.periodTo },
                { key: "orders", header: t("fnc.ordersInPeriod"), value: (r) => r.orderCount },
                { key: "gross", header: t("fnc.gross"), value: (r) => (r.systemGross / 100).toFixed(2) },
                { key: "commission", header: t("fnc.commission"), value: (r) => (r.expectedCommission / 100).toFixed(2) },
                { key: "expected", header: t("fnc.expected"), value: (r) => (r.expectedNet / 100).toFixed(2) },
                { key: "net", header: t("fnc.netPayout"), value: (r) => (r.statement.netPayoutMinor / 100).toFixed(2) },
                { key: "d", header: "Δ", value: (r) => (r.netDifference / 100).toFixed(2) },
                { key: "res", header: t("common.status"), value: (r) => resolutions.get(r.totalKey)?.status ?? (r.totalFlagged ? "open" : "matched") },
              ]}
            />
          </span>
        }
      >
        <DataTable
          columns={columns}
          rows={matches}
          rowKey={(row) => row.statement.id}
          caption={t("fnc.aggregatorPayouts")}
          onRowClick={(row) => setSelectedId(row.statement.id)}
          activeRowKey={selectedId}
          emptyTitle={t("fnc.noPayouts")}
          emptyBody={t("fnc.noPayoutsBody")}
          dense
        />
      </Section>

      <PayoutForm open={entering} currency={currency} terms={terms} onClose={() => setEntering(false)} onSaved={onChanged} />
      <PayoutMatchDrawer match={selected} resolutions={resolutions} onClose={() => setSelectedId(null)} onChanged={onChanged} />
    </>
  );
}
