"use client";

/**
 * Ledger reconciliation — SRS FR-INV-051.
 *
 * "A scheduled reconciliation job SHALL verify that the sum of movements
 * equals the stock level projection for every (item, location) pair, and
 * SHALL raise a platform alert on any divergence."
 *
 * The job and the alert are the server's: a browser cannot run on a
 * schedule, and an alert raised from one tab is not a platform alert. So this
 * screen is the frontend of that job, and says so:
 *
 *   1. **The server's check** — `GET /inventory/reconciliation`, the real
 *      comparison over the whole ledger, run on demand here.
 *   2. **A check in this browser** — every item's ledger read and compared
 *      pair by pair (`reconcileInBrowser`): each movement's balance-after must
 *      follow from the one before, and the last must equal the level. It
 *      exists so a divergence can be *located* — which movement broke the
 *      chain — not only detected, and so the check can be run where the
 *      server's endpoint is unavailable.
 *   3. **Run history** — when each check ran, who ran it and what it found,
 *      kept on this device.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayCircle, RefreshCw, ServerCog } from "lucide-react";

import type { StockLevel } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ReconciliationRun } from "@/lib/console/services/inventory-controls";
import {
  divergenceOf,
  reconcileInBrowser,
  useLedger,
  type ReconciliationCheckRow,
  type ReconciliationFinding,
} from "@/lib/console/inventory-ledger";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate, UnsupportedPanel, isUnsupported } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { LedgerGate } from "@/components/console/inventory-ledger-panel";
import { Badge, Button, Callout, Toast } from "@/components/console/ui";

export default function ReconciliationPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <ReconciliationScreen />
    </Gate>
  );
}

const FINDING_TONE: Record<ReconciliationFinding, "good" | "bad" | "warn" | "muted"> = {
  ok: "good",
  chain_break: "bad",
  projection_mismatch: "bad",
  no_ledger: "warn",
  no_projection: "warn",
};

function ReconciliationScreen() {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const [message, setMessage] = useTransientMessage();
  const [browserRun, setBrowserRun] = useState(0);
  const runs = useAsync(() => services.inventoryControls.reconciliation.runs(), []);

  const server = useAsync(async () => {
    const report = await services.inventory.reconciliation();
    // Every server read is a run worth recording; it is what the job reports.
    await services.inventoryControls.reconciliation.record({
      source: "server",
      ranAt: new Date().toISOString(),
      ranBy: session?.user.email ?? null,
      reconciled: report.reconciled,
      pairsChecked: 0,
      divergences: report.divergences.length,
      itemsRead: 0,
      failures: 0,
    });
    return report;
  }, []);

  const runColumns: Column<ReconciliationRun>[] = [
    { key: "ranAt", header: t("invx.rec.ranAt"), render: (row) => formatDateTime(row.ranAt, fmt) },
    {
      key: "source",
      header: t("invx.rec.source"),
      render: (row) => <Badge tone={row.source === "server" ? "accent" : "muted"}>{t(`invx.rec.source.${row.source}` as ConsoleKey)}</Badge>,
    },
    { key: "by", header: t("invx.rec.ranBy"), secondary: true, render: (row) => row.ranBy ?? "—" },
    {
      key: "result",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={row.reconciled ? "good" : "bad"} dot>
          {row.reconciled ? t("inv.reconciled") : t("invx.rec.divergences").replace("{n}", formatNumber(row.divergences, fmt))}
        </Badge>
      ),
    },
    {
      key: "pairs",
      header: t("invx.rec.pairs"),
      numeric: true,
      secondary: true,
      render: (row) => (row.source === "browser" ? formatNumber(row.pairsChecked, fmt) : "—"),
    },
  ];

  return (
    <>
      <PageHeader title={t("invx.rec.title")} subtitle={t("invx.rec.subtitle")} spec="FR-INV-051" />
      <PageBody>
        <Callout tone="warn" icon={<ServerCog size={14} />} title={t("invx.rec.serverSideTitle")}>
          {t("invx.rec.serverSideBody")}
        </Callout>

        <Section
          title={t("invx.rec.serverTitle")}
          hint={t("invx.rec.serverHint")}
          action={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => { server.reload(); window.setTimeout(runs.reload, 800); }}>
              {t("invx.rec.runServer")}
            </Button>
          }
        >
          {server.error && isUnsupported(server.error) ? (
            <UnsupportedPanel detail={server.error.message} />
          ) : (
            <AsyncPanel state={server}>
              {(report) => (
                <div className="space-y-3">
                  <Callout tone={report.reconciled ? "good" : "bad"}>
                    {report.reconciled ? t("inv.reconciled") : t("inv.notReconciled")}
                  </Callout>
                  {report.note ? <p className="text-fg-subtle text-xs">{report.note}</p> : null}
                  {report.divergences.length > 0 ? (
                    <DataTable
                      columns={[
                        { key: "item", header: t("inv.item"), render: (row) => <CellStack primary={tx(row.itemName)} /> },
                        { key: "location", header: t("common.location"), render: (row) => tx(row.locationName) },
                        { key: "ledger", header: t("inv.ledger"), numeric: true, render: (row) => <span className="font-mono" dir="ltr">{row.ledger.value}</span> },
                        { key: "projected", header: t("inv.projected"), numeric: true, render: (row) => <span className="font-mono" dir="ltr">{row.projected.value}</span> },
                      ]}
                      rows={report.divergences}
                      rowKey={(row) => `${row.stockItemId}-${row.locationId}`}
                      caption={t("invx.rec.serverTitle")}
                      dense
                    />
                  ) : null}
                </div>
              )}
            </AsyncPanel>
          )}
        </Section>

        <Section
          title={t("invx.rec.browserTitle")}
          hint={t("invx.rec.browserHint")}
          action={
            <Button size="sm" variant={browserRun === 0 ? "primary" : "ghost"} icon={<PlayCircle size={12} />} onClick={() => setBrowserRun((n) => n + 1)}>
              {browserRun === 0 ? t("invx.rec.runBrowser") : t("invx.rec.runAgain")}
            </Button>
          }
        >
          {browserRun === 0 ? (
            <p className="text-fg-muted text-sm">{t("invx.rec.browserIdle")}</p>
          ) : (
            <BrowserCheck
              key={browserRun}
              onComplete={() => runs.reload()}
              onExported={setMessage}
            />
          )}
        </Section>

        <Section title={t("invx.rec.historyTitle")} hint={t("invx.rec.historyHint")}>
          <AsyncPanel state={runs}>
            {(rows) => (
              <DataTable
                columns={runColumns}
                rows={[...rows].sort((a, b) => b.ranAt.localeCompare(a.ranAt)).slice(0, 50)}
                rowKey={(row) => row.id}
                caption={t("invx.rec.historyTitle")}
                emptyTitle={t("invx.rec.noRuns")}
                dense
              />
            )}
          </AsyncPanel>
        </Section>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function BrowserCheck({ onComplete, onExported }: { onComplete: () => void; onExported: (message: string) => void }) {
  const ledger = useLedger();
  const levels = useAsync(
    () => services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows).catch(() => [] as StockLevel[]),
    [],
  );

  return (
    <LedgerGate state={ledger}>
      {(load) =>
        levels.data === null ? null : (
          <BrowserResults
            rows={reconcileInBrowser(load.movements, levels.data)}
            itemsRead={load.itemsRead}
            failures={load.failures.length}
            onComplete={onComplete}
            onExported={onExported}
          />
        )
      }
    </LedgerGate>
  );
}

function BrowserResults({
  rows,
  itemsRead,
  failures,
  onComplete,
  onExported,
}: {
  rows: ReconciliationCheckRow[];
  itemsRead: number;
  failures: number;
  onComplete: () => void;
  onExported: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const [finding, setFinding] = useState("problems");

  const divergent = rows.filter((row) => row.finding !== "ok");

  // Record the run once, when the results first render. The ref keeps a
  // development double-mount from logging the same run twice.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void services.inventoryControls.reconciliation
      .record({
        source: "browser",
        ranAt: new Date().toISOString(),
        ranBy: session?.user.email ?? null,
        reconciled: divergent.length === 0 && failures === 0,
        pairsChecked: rows.length,
        divergences: divergent.length,
        itemsRead,
        failures,
      })
      .then(onComplete, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const list = finding === "problems" ? divergent : finding === "all" ? rows : rows.filter((row) => row.finding === finding);
    return [...list].sort((a, b) => Math.abs(Number(divergenceOf(b))) - Math.abs(Number(divergenceOf(a))));
  }, [rows, divergent, finding]);

  const count = (value: ReconciliationFinding) => rows.filter((row) => row.finding === value).length;

  const columns: Column<ReconciliationCheckRow>[] = [
    {
      key: "item",
      header: t("inv.item"),
      render: (row) => <CellStack primary={tx(row.itemName)} secondary={tx(row.locationName)} />,
    },
    {
      key: "finding",
      header: t("invx.rec.finding"),
      render: (row) => (
        <Badge tone={FINDING_TONE[row.finding]} dot>
          {t(`invx.rec.finding.${row.finding}` as ConsoleKey)}
        </Badge>
      ),
    },
    {
      key: "sum",
      header: t("invx.rec.movementSum"),
      numeric: true,
      secondary: true,
      render: (row) => <span className="font-mono" dir="ltr">{row.movementSum}</span>,
    },
    {
      key: "ledger",
      header: t("invx.rec.ledgerBalance"),
      numeric: true,
      render: (row) => <span className="font-mono" dir="ltr">{row.ledgerBalance ?? "—"}</span>,
    },
    {
      key: "projected",
      header: t("inv.projected"),
      numeric: true,
      render: (row) => <span className="font-mono" dir="ltr">{row.projected ?? "—"}</span>,
    },
    {
      key: "break",
      header: t("invx.rec.firstBreak"),
      secondary: true,
      render: (row) => (row.firstBreakId ? <span className="font-mono text-xs">{row.firstBreakId}</span> : "—"),
    },
  ];

  return (
    <div className="space-y-4">
      <TileGrid columns={4}>
        <MetricTile label={t("invx.rec.pairs")} value={formatNumber(rows.length, fmt)} />
        <MetricTile label={t("invx.rec.finding.chain_break")} value={formatNumber(count("chain_break"), fmt)} hint={t("invx.rec.chainHint")} />
        <MetricTile label={t("invx.rec.finding.projection_mismatch")} value={formatNumber(count("projection_mismatch"), fmt)} hint={t("invx.rec.mismatchHint")} />
        <MetricTile
          label={t("invx.rec.incomplete")}
          value={formatNumber(count("no_ledger") + count("no_projection"), fmt)}
          hint={t("invx.rec.incompleteHint")}
        />
      </TileGrid>

      <Callout tone={divergent.length === 0 ? "good" : "bad"}>
        {divergent.length === 0
          ? t("invx.rec.browserClean").replace("{n}", formatNumber(rows.length, fmt))
          : t("invx.rec.browserDirty").replace("{n}", formatNumber(divergent.length, fmt))}
      </Callout>

      <Toolbar
        actions={
          <ExportButton
            filename="ledger-reconciliation"
            title={t("invx.rec.browserTitle")}
            rows={visible}
            onExported={onExported}
            columns={[
              { key: "item", header: t("inv.item"), value: (row) => tx(row.itemName) },
              { key: "location", header: t("common.location"), value: (row) => tx(row.locationName) },
              { key: "finding", header: t("invx.rec.finding"), value: (row) => row.finding },
              { key: "sum", header: t("invx.rec.movementSum"), value: (row) => row.movementSum },
              { key: "ledger", header: t("invx.rec.ledgerBalance"), value: (row) => row.ledgerBalance ?? "" },
              { key: "projected", header: t("inv.projected"), value: (row) => row.projected ?? "" },
              { key: "break", header: t("invx.rec.firstBreak"), value: (row) => row.firstBreakId ?? "" },
            ]}
          />
        }
      >
        <FilterSelect
          filter={{
            key: "finding",
            label: t("invx.rec.finding"),
            allLabel: t("invx.rec.showAll"),
            options: [
              { value: "problems", label: t("invx.rec.showProblems") },
              ...(["ok", "chain_break", "projection_mismatch", "no_ledger", "no_projection"] as ReconciliationFinding[]).map((value) => ({
                value,
                label: t(`invx.rec.finding.${value}` as ConsoleKey),
              })),
            ],
          }}
          value={finding}
          onChange={setFinding}
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => `${row.itemId}-${row.locationId}`}
        caption={t("invx.rec.browserTitle")}
        emptyTitle={t("invx.rec.nothingToShow")}
        dense
      />
    </div>
  );
}
