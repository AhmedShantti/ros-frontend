"use client";

/**
 * Audit trail — SRS ch.20, FR-AUD-004, FR-AUD-008, FR-AUD-010.
 *
 * Every state change, newest first, each entry carrying the hash of the one
 * before it (FR-AUD-004). Removing an entry from the middle breaks the chain,
 * which is the entire point.
 *
 * ## Where the rows come from
 *
 * Live, `GET /governance/audit/entries` is a real search: branch, actor,
 * entity type and id, action, correlation id and date range are all sent to
 * the server (FR-AUD-008), so a filter narrows the *log*, not the page of it
 * that happened to load. The free-text box is the one exception, and says
 * so — the endpoint has no text search.
 *
 * In the demo there is no server, so the log is what this device recorded
 * (the POS simulator) followed by the seeded history, filtered here with the
 * same predicate the server applies (`matchesAuditFilters`).
 *
 * ## Support access (FR-AUD-010)
 *
 * Anything done by a TRENDOW support user acting as someone in this tenant
 * carries `impersonatedBy`. Those sessions are surfaced at the top, not left
 * for somebody to discover in row 180: a tenant is entitled to know when the
 * vendor was inside its data, and for how long.
 *
 * ## Every field, and who looked (FR-AUD-002, FR-AUD-007)
 *
 * The entry drawer shows every FR-AUD-002 field — ULID, tenant and branch,
 * actor, action, entity, before/after as a field-by-field diff, correlation,
 * IP and device. Opening this screen, narrowing it, opening an entry and
 * exporting are each written to the security event log, and "Who accessed
 * this log" lists those events here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Filter, GitBranch, ShieldAlert, Table } from "lucide-react";

import type { AuditEntry, Id } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useLive } from "@/lib/console/live/store";
import { services } from "@/lib/console/services";
import { matchesAuditFilters, type AuditFilters } from "@/lib/console/services/types";
import { DATA_MODE } from "@/lib/api/config";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { exportRows, type ExportFormat } from "@/lib/console/export";
import { useExportLog } from "@/lib/console/export-log";
import { useAction } from "@/lib/console/actions";
import { ACTOR_TYPE, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, SearchInput, Section, Toolbar } from "@/components/console/page";
import { LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { ErrorPanel, Gate } from "@/components/console/states";
import { AuditDiff, AuditEntryFields, useAuditAccessLog } from "@/components/console/audit-entry-detail";
import { SecurityEventLog } from "@/components/console/security-event-log";
import { DateRangeField, SearchSelect, resolvePreset, type DateRange } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  Card,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  Select,
  Toast,
  Toggle,
  cx,
} from "@/components/console/ui";

export default function AuditPage() {
  return (
    <Gate permissions={["audit.view"]}>
      <AuditScreen />
    </Gate>
  );
}

const LIMIT = 200;

interface UiFilters {
  actorId: Id | null;
  action: string | null;
  branchId: Id | null;
  entityType: string | null;
  entityId: string;
  correlationId: string;
  range: DateRange | null;
  impersonatedOnly: boolean;
}

const EMPTY: UiFilters = {
  actorId: null,
  action: null,
  branchId: null,
  entityType: null,
  entityId: "",
  correlationId: "",
  range: null,
  impersonatedOnly: false,
};

/** The chain check for one source: at most one entry may point outside it. */
function chainIntact(rows: AuditEntry[]): boolean {
  if (rows.length < 2) return true;
  const hashes = new Set(rows.map((row) => row.hash));
  const orphans = rows.filter((row) => !row.previousHash || !hashes.has(row.previousHash)).length;
  return orphans <= 1;
}

function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function AuditScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, canAll } = useSession();
  const branches = useBranches(scope);
  const live = DATA_MODE === "http";
  const { state: device } = useLive();

  const [filters, setFilters] = useState<UiFilters>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [message, setMessage] = useTransientMessage();
  const [showAccess, setShowAccess] = useState(false);

  const set = (patch: Partial<UiFilters>) => setFilters((current) => ({ ...current, ...patch }));

  // Typed fields settle before they reach the server.
  const entityId = useDebounced(filters.entityId.trim());
  const correlationId = useDebounced(filters.correlationId.trim());

  const structured: AuditFilters = useMemo(
    () => ({
      branchId: filters.branchId ?? undefined,
      actorId: filters.actorId ?? undefined,
      entityType: filters.entityType ?? undefined,
      entityId: entityId || undefined,
      action: filters.action ?? undefined,
      correlationId: correlationId || undefined,
      dateFrom: filters.range?.from || undefined,
      dateTo: filters.range?.to || undefined,
    }),
    [filters.branchId, filters.actorId, filters.entityType, entityId, filters.action, correlationId, filters.range],
  );
  const structuredKey = JSON.stringify(structured);
  const anyStructured = Object.values(structured).some(Boolean);

  const remote = useAsync<AuditEntry[]>(
    async () =>
      (
        await services.governance.audit.list({
          scope,
          limit: live ? LIMIT : 500,
          filters: live ? { ...structured } : undefined,
        })
      ).rows,
    [live, live ? structuredKey : "", scope.tenantId, scope.brandId, scope.branchId],
  );

  /** Everything this screen knows about, before the structured filters. */
  const base = useMemo(() => {
    if (live) return remote.data ?? [];
    return [...device.audit, ...(remote.data ?? [])];
  }, [live, remote.data, device.audit]);

  // Pickers are built from every entry seen so far, so choosing an actor does
  // not make every other actor vanish from the list.
  const seen = useRef({
    actors: new Map<Id, string>(),
    actions: new Set<string>(),
    entities: new Set<string>(),
  });
  for (const row of base) {
    if (row.actorId) seen.current.actors.set(row.actorId, tx(row.actorName) || row.actorId);
    seen.current.actions.add(row.action);
    seen.current.entities.add(row.entityType);
  }

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return base.filter((entry) => {
      // Live, the server already applied these; re-applying is a no-op that
      // keeps the demo and live paths one code path.
      if (!matchesAuditFilters(entry, structured)) return false;
      if (filters.impersonatedOnly && !entry.impersonatedBy) return false;
      if (!needle) return true;
      return (
        entry.action.toLowerCase().includes(needle) ||
        entry.entityId.toLowerCase().includes(needle) ||
        entry.correlationId.toLowerCase().includes(needle) ||
        tx(entry.actorName).toLowerCase().includes(needle) ||
        (entry.reasonText ?? "").toLowerCase().includes(needle)
      );
    });
  }, [base, structured, filters.impersonatedOnly, term, tx]);

  const verified = useMemo(() => {
    if (anyStructured && live) return null;
    return live
      ? chainIntact(base)
      : chainIntact(device.audit) && chainIntact(remote.data ?? []);
  }, [anyStructured, live, base, device.audit, remote.data]);

  // FR-AUD-010 — support sessions, grouped by who and which day.
  const sessions = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; who: string; day: string; start: string; end: string; count: number; actors: Set<string>; correlation: string }
    >();
    for (const entry of base) {
      if (!entry.impersonatedBy) continue;
      const who = tx(entry.impersonatedBy);
      const day = entry.occurredAt.slice(0, 10);
      const key = `${who}|${day}`;
      const group = groups.get(key) ?? {
        key,
        who,
        day,
        start: entry.occurredAt,
        end: entry.occurredAt,
        count: 0,
        actors: new Set<string>(),
        correlation: entry.correlationId,
      };
      group.count += 1;
      group.actors.add(tx(entry.actorName));
      if (entry.occurredAt < group.start) group.start = entry.occurredAt;
      if (entry.occurredAt > group.end) group.end = entry.occurredAt;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.end.localeCompare(a.end));
  }, [base, tx]);

  const recentSessions = sessions.filter(
    (session) => Date.now() - Date.parse(session.end) < 30 * 86_400_000,
  );

  const activeChips = [
    filters.actorId ? `${t("audit.actor")}: ${seen.current.actors.get(filters.actorId) ?? filters.actorId}` : null,
    filters.action ? `${t("audit.action")}: ${filters.action}` : null,
    filters.branchId ? `${t("common.branch")}: ${tx(branches.find((row) => row.id === filters.branchId)?.name) || filters.branchId}` : null,
    filters.entityType ? `${t("audit.entity")}: ${filters.entityType}` : null,
    entityId ? `${t("audit.entityId")}: ${entityId}` : null,
    correlationId ? `${t("audit.correlation")}: ${correlationId}` : null,
    filters.range ? `${filters.range.from} → ${filters.range.to}` : null,
    filters.impersonatedOnly ? t("audit.supportOnly") : null,
  ].filter((chip): chip is string => chip !== null);

  // FR-AUD-007 — viewing and narrowing the log is recorded.
  const access = useAuditAccessLog(
    `${structuredKey}|${filters.impersonatedOnly}`,
    activeChips.join(" · ") || t("audit.allEntries"),
  );
  const openEntry = (entry: AuditEntry) => {
    setSelected(entry);
    access.opened(entry);
  };

  const columns: Column<AuditEntry>[] = [
    {
      key: "occurredAt",
      header: t("audit.occurred"),
      render: (entry) => formatDateTime(entry.occurredAt, fmt),
    },
    {
      key: "action",
      header: t("audit.action"),
      render: (entry) => (
        <CellStack
          primary={
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-xs">{entry.action}</span>
              {entry.impersonatedBy ? (
                <Badge tone="warn">
                  <ShieldAlert size={10} aria-hidden /> {t("audit.support")}
                </Badge>
              ) : null}
            </span>
          }
          secondary={entry.reasonText ?? undefined}
        />
      ),
    },
    {
      key: "entity",
      header: t("audit.entity"),
      render: (entry) => (
        <CellStack
          primary={entry.entityType}
          secondary={<span className="font-mono text-[0.68rem]">{entry.entityId}</span>}
        />
      ),
    },
    {
      key: "actor",
      header: t("audit.actor"),
      render: (entry) => (
        <CellStack
          primary={tx(entry.actorName) || entry.actorId || "—"}
          secondary={
            entry.impersonatedBy
              ? `${t("audit.via")} ${tx(entry.impersonatedBy)}`
              : tx(labelOf(ACTOR_TYPE, entry.actorType).label)
          }
        />
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      secondary: true,
      render: (entry) =>
        entry.branchName ? tx(entry.branchName) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "correlation",
      header: t("audit.correlation"),
      secondary: true,
      render: (entry) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            set({ correlationId: entry.correlationId });
            setShowMore(true);
          }}
          className="text-fg-muted hover:text-accent font-mono text-[0.68rem] underline-offset-2 hover:underline"
          title={t("audit.followChain")}
        >
          {entry.correlationId}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
        spec="FR-AUD-008"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AuditExport
              filters={structured}
              impersonatedOnly={filters.impersonatedOnly}
              summary={activeChips.join(" · ") || t("audit.allEntries")}
              allowed={canAll(["audit.view", "report.export"])}
              onDone={setMessage}
              onExported={access.exported}
            />
            <Button size="sm" variant={showAccess ? "secondary" : "ghost"} onClick={() => setShowAccess((open) => !open)} aria-expanded={showAccess}>
              {t("aud2.accessLog")}
            </Button>
            <TerminalLinks />
          </div>
        }
      />

      <PageBody>
        <LiveNotice source={live ? "backend" : "device"} />

        {showAccess ? (
          <SecurityEventLog
            kinds={["audit.viewed", "audit.entry_opened", "audit.exported"]}
            title={t("aud2.accessLog")}
            hint={t("aud2.accessLogHint")}
            spec="FR-AUD-007"
            canExport={canAll(["audit.view", "report.export"])}
          />
        ) : null}

        {recentSessions.length > 0 ? (
          <Callout tone="warn" icon={<ShieldAlert size={14} />} title={t("audit.supportAccessTitle")}>
            <span>
              {t("audit.supportAccessBody")
                .replace("{n}", String(recentSessions.length))
                .replace("{last}", formatRelative(recentSessions[0]!.end, fmt))}
            </span>{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => set({ impersonatedOnly: true })}
            >
              {t("audit.reviewSupport")}
            </button>
          </Callout>
        ) : null}

        {verified === null ? (
          <Callout tone="muted" title={t("audit.chainVerified")}>
            {t("audit.chainFiltered")}
          </Callout>
        ) : (
          <Callout tone={verified ? "good" : "bad"} title={verified ? t("audit.chainVerified") : t("audit.chainBroken")}>
            {t("audit.chainNote")}
          </Callout>
        )}

        <Card>
          <Toolbar>
            <SearchInput value={term} onChange={setTerm} placeholder={t("audit.searchLoaded")} />
            <div className="min-w-44">
              <SearchSelect
                value={filters.actorId}
                onChange={(value) => set({ actorId: value })}
                options={[...seen.current.actors.entries()].map(([id, name]) => ({ value: id, label: name, hint: id }))}
                placeholder={t("audit.anyActor")}
                aria-label={t("audit.actor")}
                allowClear
              />
            </div>
            <div className="min-w-48">
              <SearchSelect
                value={filters.action}
                onChange={(value) => set({ action: value })}
                options={[...seen.current.actions].sort().map((action) => ({ value: action, label: action }))}
                placeholder={t("audit.anyAction")}
                aria-label={t("audit.action")}
                allowClear
              />
            </div>
            <Select
              aria-label={t("common.branch")}
              value={filters.branchId ?? ""}
              onChange={(event) => set({ branchId: event.target.value || null })}
              className="w-auto min-w-36 py-1.5 text-xs"
            >
              <option value="">{t("audit.anyBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant={showMore ? "secondary" : "ghost"}
              icon={<Filter size={12} />}
              onClick={() => setShowMore((open) => !open)}
              aria-expanded={showMore}
            >
              {t("audit.moreFilters")}
            </Button>
          </Toolbar>

          {showMore ? (
            <div className="border-line mt-4 grid gap-4 border-t pt-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label={t("audit.entity")}>
                <Select value={filters.entityType ?? ""} onChange={(event) => set({ entityType: event.target.value || null })}>
                  <option value="">{t("audit.anyEntity")}</option>
                  {[...seen.current.entities].sort().map((entity) => (
                    <option key={entity} value={entity}>
                      {entity}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("audit.entityId")}>
                <Input dir="ltr" value={filters.entityId} onChange={(event) => set({ entityId: event.target.value })} className="font-mono text-xs" />
              </Field>
              <Field label={t("audit.correlation")} hint={t("audit.correlationHint")}>
                <Input dir="ltr" value={filters.correlationId} onChange={(event) => set({ correlationId: event.target.value })} className="font-mono text-xs" />
              </Field>
              <div className="md:col-span-2">
                <Toggle
                  checked={filters.range !== null}
                  onChange={(on) => set({ range: on ? resolvePreset("last7") : null })}
                  label={t("audit.limitDates")}
                />
                {filters.range ? <DateRangeField value={filters.range} onChange={(range) => set({ range })} /> : null}
              </div>
              <Toggle
                checked={filters.impersonatedOnly}
                onChange={(on) => set({ impersonatedOnly: on })}
                label={t("audit.supportOnly")}
                hint={t("audit.supportOnlyHint")}
              />
            </div>
          ) : null}

          {activeChips.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <Badge key={chip} tone="accent">
                  {chip}
                </Badge>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY);
                  setTerm("");
                }}
                className="text-fg-muted hover:text-fg ms-1 text-xs underline underline-offset-2"
              >
                {t("common.clearFilters")}
              </button>
            </div>
          ) : null}

          {live && term.trim() ? (
            <p className="text-fg-subtle mt-2 text-xs">{t("audit.textIsLocal")}</p>
          ) : null}
        </Card>

        {remote.error ? <ErrorPanel error={remote.error} onRetry={remote.reload} /> : null}

        {sessions.length > 0 && filters.impersonatedOnly ? (
          <SupportSessions
            sessions={sessions}
            onPick={(session) => set({ correlationId: session.correlation })}
          />
        ) : null}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.id}
          loading={remote.loading && base.length === 0}
          onRowClick={openEntry}
          activeRowKey={selected?.id ?? null}
          filtered={activeChips.length > 0 || term.trim().length > 0}
          onClearFilters={() => {
            setFilters(EMPTY);
            setTerm("");
          }}
          caption={t("audit.title")}
          emptyTitle={t("audit.emptyTitle")}
          emptyBody={live ? t("audit.emptyLive") : t("audit.emptyDevice")}
          footer={
            <p className="text-fg-subtle px-4 py-2.5 text-xs">
              {t("audit.showingCount")
                .replace("{n}", formatNumber(rows.length, fmt))
                .replace("{total}", formatNumber(base.length, fmt))}
              {live && base.length >= LIMIT ? ` ${t("audit.pageCap").replace("{n}", String(LIMIT))}` : ""}
            </p>
          }
          dense
        />
      </PageBody>

      {selected ? (
        <EntryDrawer
          entry={selected}
          known={base}
          onClose={() => setSelected(null)}
          onOpen={openEntry}
          onFilterChain={(id) => {
            set({ correlationId: id });
            setShowMore(true);
            setSelected(null);
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Support access — FR-AUD-010
// ---------------------------------------------------------------------------

function SupportSessions({
  sessions,
  onPick,
}: {
  sessions: { key: string; who: string; day: string; start: string; end: string; count: number; actors: Set<string>; correlation: string }[];
  onPick: (session: { correlation: string }) => void;
}) {
  const { t, fmt } = useI18n();
  type Row = (typeof sessions)[number];

  const columns: Column<Row>[] = [
    { key: "who", header: t("audit.supportUser"), render: (row) => <CellStack primary={row.who} secondary={formatDate(row.day, fmt)} /> },
    {
      key: "window",
      header: t("audit.supportWindow"),
      render: (row) => (
        <span className="text-xs tabular-nums">
          {formatDateTime(row.start, fmt)} – {formatDateTime(row.end, fmt)}
        </span>
      ),
    },
    { key: "as", header: t("audit.actingAs"), render: (row) => <span className="text-xs">{[...row.actors].join(", ")}</span> },
    { key: "count", header: t("audit.actions"), numeric: true, render: (row) => formatNumber(row.count, fmt) },
  ];

  return (
    <Section title={t("audit.supportSessions")} hint={t("audit.supportSessionsHint")} spec="FR-AUD-010" padded={false}>
      <DataTable
        columns={columns}
        rows={sessions}
        rowKey={(row) => row.key}
        onRowClick={onPick}
        caption={t("audit.supportSessions")}
        dense
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Export — FR-AUD-008
// ---------------------------------------------------------------------------

function AuditExport({
  filters,
  impersonatedOnly,
  summary,
  allowed,
  onDone,
  onExported,
}: {
  filters: AuditFilters;
  impersonatedOnly: boolean;
  summary: string;
  allowed: boolean;
  onDone: (message: string) => void;
  onExported: (rows: number, format: string, filters: string) => void;
}) {
  const { t, tx } = useI18n();
  const { session } = useSession();
  const log = useExportLog();
  const action = useAction(onDone);

  async function run(format: ExportFormat) {
    await action.run(async () => {
      // The complete matching set from the export endpoint, not the page on
      // screen — an auditor asking for September wants all of September.
      const all = await services.governance.auditExport(filters);
      const rows = impersonatedOnly ? all.filter((entry) => entry.impersonatedBy) : all;
      const outcome = exportRows(format, {
        filename: "audit-log",
        title: t("audit.title"),
        subtitle: summary,
        rows,
        columns: [
          { key: "occurredAt", header: t("audit.occurred"), value: (row) => row.occurredAt },
          { key: "recordedAt", header: t("audit.recorded"), value: (row) => row.recordedAt },
          { key: "action", header: t("audit.action"), value: (row) => row.action },
          { key: "entityType", header: t("audit.entity"), value: (row) => row.entityType },
          { key: "entityId", header: t("audit.entityId"), value: (row) => row.entityId },
          { key: "actor", header: t("audit.actor"), value: (row) => tx(row.actorName) || row.actorId },
          { key: "actorType", header: t("audit.actorType"), value: (row) => row.actorType },
          { key: "impersonatedBy", header: t("audit.support"), value: (row) => tx(row.impersonatedBy) },
          { key: "branch", header: t("common.branch"), value: (row) => tx(row.branchName) },
          { key: "reason", header: t("shift.reason"), value: (row) => row.reasonText ?? row.reasonCode ?? "" },
          { key: "approver", header: t("orders.approvedBy"), value: (row) => tx(row.approverName) },
          { key: "terminal", header: t("audit.terminal"), value: (row) => row.terminalId ?? "" },
          { key: "ip", header: t("audit.ip"), value: (row) => row.ipAddress },
          { key: "correlation", header: t("audit.correlation"), value: (row) => row.correlationId },
          { key: "hash", header: t("audit.hash"), value: (row) => row.hash },
          { key: "previousHash", header: t("audit.previousHash"), value: (row) => row.previousHash },
        ],
      });
      log.record({
        title: t("audit.title"),
        format,
        rowCount: outcome.rowCount,
        filters: summary,
        requestedBy: session?.user.email ?? null,
      });
      // FR-AUD-007 — an export of the audit log is itself an audited access.
      onExported(outcome.rowCount, format, summary);
      return outcome.rowCount;
    }, {
      onSuccess: (count) =>
        onDone(t("export.done").replace("{n}", String(count)).replace("{format}", format.toUpperCase())),
    });
  }

  const trigger = (
    <Button
      size="sm"
      variant="ghost"
      icon={<Download size={12} />}
      loading={action.pending}
      disabled={!allowed}
      title={!allowed ? t("audit.exportDenied") : undefined}
    >
      {t("common.export")}
    </Button>
  );

  if (!allowed) return trigger;

  return (
    <Menu trigger={({ toggle }) => <span onClick={toggle}>{trigger}</span>} align="end">
      <MenuLabel>{t("audit.exportAllMatching")}</MenuLabel>
      <MenuItem icon={<Table size={13} />} onSelect={() => void run("csv")}>
        {t("export.csv")}
      </MenuItem>
      <MenuItem icon={<FileSpreadsheet size={13} />} onSelect={() => void run("xlsx")}>
        {t("export.xlsx")}
      </MenuItem>
      <MenuItem icon={<FileText size={13} />} onSelect={() => void run("pdf")}>
        {t("export.pdf")}
      </MenuItem>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// One entry, and the chain it belongs to
// ---------------------------------------------------------------------------

function EntryDrawer({
  entry,
  known,
  onClose,
  onOpen,
  onFilterChain,
}: {
  entry: AuditEntry;
  known: AuditEntry[];
  onClose: () => void;
  onOpen: (entry: AuditEntry) => void;
  onFilterChain: (correlationId: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const live = DATA_MODE === "http";

  // Live, the chain is asked for by correlation id — it may reach entries
  // outside the page that loaded. In the demo, every entry is already here.
  const remoteChain = useAsync<AuditEntry[]>(
    async () =>
      live
        ? (
            await services.governance.audit.list({
              scope,
              limit: 100,
              filters: { correlationId: entry.correlationId },
            })
          ).rows
        : [],
    [live, entry.correlationId],
  );

  const chain = useMemo(() => {
    const pool = live ? [...(remoteChain.data ?? []), ...known] : known;
    const unique = new Map<string, AuditEntry>();
    for (const row of pool) if (row.correlationId === entry.correlationId) unique.set(row.id, row);
    return [...unique.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }, [live, remoteChain.data, known, entry.correlationId]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={entry.action}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{entry.entityType}</Badge>
          {entry.impersonatedBy ? (
            <Badge tone="warn">
              <ShieldAlert size={10} aria-hidden /> {tx(entry.impersonatedBy)}
            </Badge>
          ) : null}
        </span>
      }
    >
      {entry.impersonatedBy ? (
        <Callout tone="warn" className="mb-4" title={t("audit.supportEntryTitle")}>
          {t("audit.supportEntryBody")
            .replace("{support}", tx(entry.impersonatedBy))
            .replace("{actor}", tx(entry.actorName) || entry.actorId)}
        </Callout>
      ) : null}

      {/* FR-AUD-002 — every field the entry carries, including the empty ones. */}
      <AuditEntryFields entry={entry} />

      <section className="mt-5">
        <h3 className="text-fg mb-1.5 text-xs font-semibold">{t("aud2.diff")}</h3>
        <AuditDiff before={entry.before} after={entry.after} />
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
            <GitBranch size={14} aria-hidden /> {t("audit.chainTitle")}
          </h3>
          <Button size="sm" variant="ghost" onClick={() => onFilterChain(entry.correlationId)}>
            {t("audit.filterChain")}
          </Button>
        </div>
        <p className="text-fg-subtle mb-3 text-xs">{t("audit.chainHint")}</p>
        {remoteChain.loading && chain.length <= 1 ? (
          <p className="text-fg-subtle text-xs">{t("state.loadingData")}</p>
        ) : (
          <ol className="border-line space-y-0 border-s ps-4">
            {chain.map((row) => (
              <li key={row.id} className="relative pb-3">
                <span
                  aria-hidden
                  className={cx(
                    "absolute -start-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full border-2",
                    row.id === entry.id ? "border-accent bg-accent" : "border-line-strong bg-raised",
                  )}
                />
                <button
                  type="button"
                  disabled={row.id === entry.id}
                  onClick={() => onOpen(row)}
                  className="hover:bg-sunken w-full rounded-md px-2 py-1 text-start disabled:cursor-default"
                >
                  <span className="text-fg block font-mono text-xs">{row.action}</span>
                  <span className="text-fg-subtle block text-[0.68rem]">
                    {formatDateTime(row.occurredAt, fmt)} · {tx(row.actorName) || row.actorId} · {row.entityType}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Drawer>
  );
}
