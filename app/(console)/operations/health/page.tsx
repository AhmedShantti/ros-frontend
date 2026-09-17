"use client";

/**
 * System health — NFR-OBS-007.
 *
 * A per-tenant health view support can read without database access: which
 * tenant and build this is, whether the API answers and how fast, the sync
 * backlog and offline terminals, connector health, open sync conflicts,
 * whether this browser and window are supported (NFR-PORT-003/004), and the
 * redacted client error log (NFR-OBS-001/005) with an export for a ticket.
 *
 * Everything is read through the same services the console uses, with the
 * session's scope, so support sees exactly this tenant — never another.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Download, RefreshCw, Send, Trash2 } from "lucide-react";
import type { Integration, Terminal } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useOrderFeed } from "@/lib/console/feeds";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { CONNECTOR_STATUS } from "@/lib/console/labels";
import { API_BASE_URL, DATA_MODE } from "@/lib/api/config";
import { useConnectivityStore } from "@/store/connectivity";
import { blockState } from "@/lib/console/offline-fiscal";
import { CURRENT_RELEASE } from "@/lib/console/ops-release-notes";
import {
  CLIENT_LOG_EVENT,
  clearClientLog,
  correlationId,
  readClientLog,
  recordClientLog,
  redactText,
  toJsonLines,
  type ClientLogEntry,
} from "@/lib/console/ops-telemetry";
import { MAX_VIEWPORT, MIN_VIEWPORT, checkFeatures, supportVerdict, type FeatureCheck, type SupportVerdict } from "@/lib/console/ops-browser-support";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, DescList, DescRow, Field, Textarea, Toast } from "@/components/console/ui";

const NONE = "—";

export default function HealthPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("health.title")} subtitle={t("health.subtitle")} spec="NFR-OBS-007" />
      <Gate permissions={["ops.terminal.view", "settings.tenant.manage", "audit.view", "integration.manage"]}>
        <Health />
      </Gate>
    </>
  );
}

interface Probe {
  status: "ok" | "slow" | "down" | "no_backend";
  latencyMs: number | null;
  at: string;
  detail: string | null;
}

function Health() {
  const { t, tx, fmt } = useI18n();
  const { scope, tenant, branch } = useSession();
  const [message, setMessage] = useTransientMessage();

  // -- API probe -------------------------------------------------------------
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);
  const runProbe = useCallback(async () => {
    if (DATA_MODE !== "http") {
      setProbe({ status: "no_backend", latencyMs: null, at: new Date().toISOString(), detail: null });
      return;
    }
    setProbing(true);
    const started = performance.now();
    try {
      const { api } = await import("@/lib/api/endpoints");
      await api.health.check();
      const latency = Math.round(performance.now() - started);
      setProbe({ status: latency > 500 ? "slow" : "ok", latencyMs: latency, at: new Date().toISOString(), detail: null });
    } catch (error) {
      setProbe({ status: "down", latencyMs: null, at: new Date().toISOString(), detail: error instanceof Error ? redactText(error.message) : null });
    } finally {
      setProbing(false);
    }
  }, []);
  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  // -- Operational signals ---------------------------------------------------
  const connectivity = useConnectivityStore((store) => store.state);
  const queue = useConnectivityStore((store) => store.queue);
  const lastSyncedAt = useConnectivityStore((store) => store.lastSyncedAt);
  const terminals = useAsync<Terminal[]>(async () => (await services.operations.terminals({ scope, limit: 200 })).rows, [scope.tenantId, scope.brandId, scope.branchId]);
  const integrations = useAsync<Integration[]>(async () => (await services.platform.integrations.list({ scope, limit: 100 })).rows, [scope.tenantId]);
  const conflicts = useAsync(() => services.conflicts.list(), [scope.tenantId]);
  const fiscalBlocks = useAsync(() => services.fiscalSequence.blocks(), [scope.tenantId]);
  const orders = useOrderFeed(scope);

  const now = Date.now();
  const recentOrders = orders.rows.filter((order) => now - Date.parse(order.openedAt) <= 15 * 60_000).length;
  const ordersPerMinute = recentOrders / 15;
  const queued = queue.filter((entry) => entry.status !== "conflict").length;
  const terminalBacklog = (terminals.data ?? []).reduce((sum, terminal) => sum + terminal.queuedOperations, 0);
  const offlineTerminals = (terminals.data ?? []).filter((terminal) => terminal.status === "offline").length;
  const openConflicts = (conflicts.data ?? []).filter((record) => record.status === "open").length;
  const voidPending = (fiscalBlocks.data ?? []).filter((block) => blockState(block, new Date()) === "void_pending").length;
  const troubledConnectors = (integrations.data ?? []).filter((row) => row.enabled && (row.status === "failing" || row.status === "degraded" || row.circuitOpen));

  // -- Browser support -------------------------------------------------------
  const [support, setSupport] = useState<{ verdict: SupportVerdict; features: FeatureCheck[] } | null>(null);
  useEffect(() => {
    const evaluate = () => {
      const features = checkFeatures();
      setSupport({ verdict: supportVerdict(navigator.userAgent, features, window.innerWidth), features });
    };
    evaluate();
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, []);

  // -- Client log ------------------------------------------------------------
  const [log, setLog] = useState<ClientLogEntry[]>([]);
  const [correlation, setCorrelation] = useState<string>("");
  useEffect(() => {
    const load = () => setLog(readClientLog());
    load();
    setCorrelation(correlationId());
    window.addEventListener(CLIENT_LOG_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CLIENT_LOG_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const probeTone = probe?.status === "ok" ? "good" : probe?.status === "slow" ? "warn" : probe?.status === "down" ? "bad" : "muted";

  return (
    <PageBody>
      {/* Tenant and build ---------------------------------------------------- */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={t("health.tenant")} spec="NFR-OBS-007">
          <DescList>
            <DescRow label={t("health.tenantName")}>{tx(tenant.name)}</DescRow>
            <DescRow label={t("health.tenantId")} mono>
              <span dir="ltr">{scope.tenantId}</span>
            </DescRow>
            <DescRow label={t("common.branch")}>{branch ? tx(branch.name) : t("common.all")}</DescRow>
            <DescRow label={t("health.dataMode")}>
              <Badge tone={DATA_MODE === "http" ? "accent" : "muted"}>{DATA_MODE === "http" ? t("health.modeLive") : t("health.modeDemo")}</Badge>
            </DescRow>
            {DATA_MODE === "http" ? (
              <DescRow label={t("health.apiBase")} mono>
                <span dir="ltr">{API_BASE_URL || NONE}</span>
              </DescRow>
            ) : null}
            <DescRow label={t("health.release")} mono>
              <Link href="/operations/release-notes" className="text-accent">
                {CURRENT_RELEASE}
              </Link>
            </DescRow>
            <DescRow label={t("health.correlation")} mono>
              <span dir="ltr">{correlation || NONE}</span>
            </DescRow>
          </DescList>
        </Section>

        <Section
          title={t("health.api")}
          action={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={12} aria-hidden />} loading={probing} onClick={() => void runProbe()}>
              {t("health.probe")}
            </Button>
          }
        >
          {probe ? (
            <div className="space-y-3" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <Activity size={16} className="text-fg-subtle" aria-hidden />
                <Badge tone={probeTone} dot>
                  {t(`health.probe.${probe.status}` as never)}
                </Badge>
                {probe.latencyMs !== null ? <span className="text-fg font-mono text-sm tabular-nums">{formatNumber(probe.latencyMs, fmt)} ms</span> : null}
              </div>
              <p className="text-fg-subtle text-xs">
                {t("health.checkedAt")} {formatDateTime(probe.at, fmt)}
              </p>
              {probe.detail ? <Callout tone="bad">{probe.detail}</Callout> : null}
              <DescList>
                <DescRow label={t("health.connectivity")}>
                  <Badge tone={connectivity === "online" || connectivity === "synced" ? "good" : connectivity === "degraded" || connectivity === "syncing" ? "warn" : "bad"}>
                    {t(`health.conn.${connectivity}` as never)}
                  </Badge>
                </DescRow>
                <DescRow label={t("health.lastSynced")}>{lastSyncedAt ? formatRelative(new Date(lastSyncedAt).toISOString(), fmt) : NONE}</DescRow>
              </DescList>
            </div>
          ) : null}
        </Section>
      </div>

      {/* Operational signals ------------------------------------------------ */}
      <TileGrid>
        <MetricTile label={t("health.ordersPerMinute")} value={formatNumber(ordersPerMinute, fmt, 2)} hint={t("health.ordersPerMinuteHint")} />
        <MetricTile label={t("health.syncBacklog")} value={formatNumber(queued + terminalBacklog, fmt)} hint={t("health.syncBacklogHint").replace("{device}", formatNumber(queued, fmt)).replace("{terminals}", formatNumber(terminalBacklog, fmt))} />
        <MetricTile label={t("health.offlineTerminals")} value={terminals.data ? formatNumber(offlineTerminals, fmt) : NONE} hint={terminals.error ? terminals.error.message : undefined} />
        <MetricTile label={t("health.fiscalExceptions")} value={fiscalBlocks.data ? formatNumber(voidPending, fmt) : NONE} hint={t("health.fiscalExceptionsHint")} />
      </TileGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={t("health.integrations")} action={<Link className="text-accent text-xs font-medium" href="/integrations">{t("dash.viewAll")}</Link>}>
          {integrations.error ? (
            <Callout tone="muted">{integrations.error.message}</Callout>
          ) : troubledConnectors.length === 0 ? (
            <Callout tone="good">{t("health.integrationsOk")}</Callout>
          ) : (
            <ul className="divide-line divide-y">
              {troubledConnectors.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="text-fg text-sm">{row.name}</span>
                    <span className="text-fg-subtle block text-xs">
                      {t("health.errorRate")} {formatNumber(row.errorRate, fmt, 1)}% · {t("health.queue")} {formatNumber(row.queueDepth, fmt)}
                      {row.circuitOpen ? ` · ${t("health.circuitOpen")}` : ""}
                    </span>
                  </span>
                  <Badge tone={CONNECTOR_STATUS[row.status].tone}>{tx(CONNECTOR_STATUS[row.status].label)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("health.syncConflicts")} action={<Link className="text-accent text-xs font-medium" href="/operations/conflicts">{t("dash.viewAll")}</Link>}>
          <p className={openConflicts > 0 ? "text-warn font-mono text-2xl tabular-nums" : "text-fg font-mono text-2xl tabular-nums"}>
            {conflicts.data ? formatNumber(openConflicts, fmt) : NONE}
          </p>
          <p className="text-fg-subtle mt-1 text-xs">{t("health.syncConflictsHint")}</p>
        </Section>
      </div>

      {/* Browser support ---------------------------------------------------- */}
      <Section title={t("health.support")} hint={t("health.supportHint")} spec="NFR-PORT-003">
        {support ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DescList>
              <DescRow label={t("health.browser")}>
                <Badge tone={support.verdict.supportedFamily ? "good" : "warn"}>
                  {t(`health.browser.${support.verdict.browser.family}` as never)}
                  {support.verdict.browser.version !== null ? ` ${support.verdict.browser.version}` : ""}
                </Badge>
              </DescRow>
              <DescRow label={t("health.viewport")}>
                <span className="flex items-center gap-2">
                  <span className="font-mono tabular-nums">{formatNumber(support.verdict.width, fmt)} px</span>
                  <Badge tone={support.verdict.viewport === "ok" ? "good" : "warn"}>{t(`health.viewport.${support.verdict.viewport}` as never)}</Badge>
                </span>
              </DescRow>
              <DescRow label={t("health.supportedRange")} mono>
                {MIN_VIEWPORT}–{MAX_VIEWPORT} px
              </DescRow>
            </DescList>
            <ul className="grid grid-cols-2 gap-1.5">
              {support.features.map((feature) => (
                <li key={feature.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-fg-muted">{t(`health.feature.${feature.id}` as never)}</span>
                  <Badge tone={feature.ok ? "good" : "bad"}>{feature.ok ? t("health.present") : t("health.missing")}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {/* Client error log --------------------------------------------------- */}
      <ClientLog log={log} scope={{ tenantId: scope.tenantId, branchId: scope.branchId }} onMessage={setMessage} />

      <Toast message={message} />
    </PageBody>
  );
}

function ClientLog({
  log,
  scope,
  onMessage,
}: {
  log: ClientLogEntry[];
  scope: { tenantId: string | null; branchId: string | null };
  onMessage: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [report, setReport] = useState("");
  const preview = useMemo(() => redactText(report), [report]);

  function exportLog() {
    const blob = new Blob([toJsonLines(log)], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ros-client-log-${new Date().toISOString().slice(0, 10)}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clear() {
    const ok = await confirm({
      title: t("health.clearLogTitle"),
      body: t("health.clearLogBody").replace("{count}", String(log.length)),
      confirmLabel: t("health.clearLog"),
      tone: "danger",
    });
    if (ok) {
      clearClientLog();
      onMessage(t("health.logCleared"));
    }
  }

  function submitReport() {
    if (!report.trim()) return;
    recordClientLog(
      {
        level: "info",
        kind: "problem_report",
        message: report,
        context: { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, online: navigator.onLine, dataMode: DATA_MODE },
      },
      { ...scope, release: CURRENT_RELEASE },
    );
    setReport("");
    onMessage(t("health.reportSaved"));
  }

  return (
    <Section
      title={t("health.clientLog")}
      hint={t("health.clientLogHint")}
      spec="NFR-OBS-005"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Download size={12} aria-hidden />} disabled={log.length === 0} onClick={exportLog}>
            {t("health.exportLog")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} aria-hidden />} disabled={log.length === 0} onClick={() => void clear()}>
            {t("health.clearLog")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("health.localLogNote")}</Callout>

        <div className="border-line space-y-2 rounded-lg border p-3">
          <Field label={t("health.reportProblem")} hint={t("health.reportProblemHint")}>
            <Textarea rows={3} value={report} onChange={(event) => setReport(event.target.value)} dir="auto" />
          </Field>
          {report.trim() && preview !== report ? (
            <div>
              <p className="text-fg-subtle text-xs">{t("health.redactedPreview")}</p>
              <p className="text-fg bg-sunken rounded px-2 py-1 text-xs break-words">{preview}</p>
            </div>
          ) : null}
          <Button size="sm" variant="primary" icon={<Send size={12} aria-hidden />} disabled={!report.trim()} onClick={submitReport}>
            {t("health.saveReport")}
          </Button>
        </div>

        {log.length === 0 ? (
          <p className="text-fg-subtle text-xs">{t("health.logEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">{t("health.clientLog")}</caption>
              <thead>
                <tr className="border-line text-fg-muted border-b">
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("health.when")}</th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("health.level")}</th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("health.message")}</th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("health.route")}</th>
                  <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("health.ids")}</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {log.slice(0, 50).map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="text-fg-muted px-2 py-1.5 whitespace-nowrap">{formatDateTime(entry.at, fmt)}</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={entry.level === "error" ? "bad" : entry.level === "warn" ? "warn" : "muted"}>{t(`health.kind.${entry.kind}` as never)}</Badge>
                    </td>
                    <td className="text-fg px-2 py-1.5 break-words">{entry.message}</td>
                    <td dir="ltr" className="text-fg-subtle px-2 py-1.5 font-mono">{entry.route}</td>
                    <td dir="ltr" className="text-fg-subtle px-2 py-1.5 font-mono text-[0.65rem]">
                      <span className="block">{entry.correlationId}</span>
                      {entry.causationId ? <span className="block">↳ {entry.causationId}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
