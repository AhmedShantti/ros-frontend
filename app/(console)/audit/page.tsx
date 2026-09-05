"use client";

/**
 * Audit trail — SRS ch.20.
 *
 * Every discount, void, comp, refund and drawer movement the terminals have
 * recorded, newest first, each entry carrying the hash of the one before it
 * (FR-AUD-004). Removing an entry from the middle breaks the chain, which is
 * the entire point.
 *
 * Live mode reads `GET /governance/audit/entries` (FR-AUD-008) through
 * `useAuditFeed`, not the local reducer — the device never saw what other
 * terminals or the backend itself did. The backend has no free-text search
 * of its own (only structured filters this screen does not yet expose:
 * `branchId`/`actorId`/`entityType`/`entityId`/`action`/`correlationId`/
 * date range), so the search box stays exactly what it always was: a
 * client-side filter over the page of rows already fetched, never a claim
 * that the server searched anything.
 */

import { useMemo, useState } from "react";
import type { AuditEntry } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useAuditFeed } from "@/lib/console/feeds";
import { formatDateTime } from "@/lib/console/format";
import { ACTOR_TYPE, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, SearchInput, Toolbar } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { ErrorPanel } from "@/components/console/states";
import { Badge, Callout, Drawer, DescList, DescRow } from "@/components/console/ui";

export default function AuditPage() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const feed = useAuditFeed(scope);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return feed.rows;
    return feed.rows.filter(
      (entry) =>
        entry.action.toLowerCase().includes(needle) ||
        entry.entityId.toLowerCase().includes(needle) ||
        entry.actorName.en.toLowerCase().includes(needle),
    );
  }, [feed.rows, term]);

  /** Recompute the chain: every entry must carry its predecessor's hash. */
  const chainIntact = useMemo(() => {
    for (let i = 0; i < feed.rows.length - 1; i += 1) {
      if (feed.rows[i]!.previousHash !== feed.rows[i + 1]!.hash) return false;
    }
    return true;
  }, [feed.rows]);

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
          primary={<span className="font-mono text-xs">{entry.action}</span>}
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
          primary={tx(entry.actorName)}
          secondary={tx(labelOf(ACTOR_TYPE, entry.actorType).label)}
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
      key: "approver",
      header: t("orders.approvedBy"),
      secondary: true,
      render: (entry) =>
        entry.approverName ? tx(entry.approverName) : <span className="text-fg-subtle">—</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
        spec="ch.20"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice source={feed.live ? "backend" : "device"} />

        <Callout tone={chainIntact ? "good" : "bad"} title={t("audit.chainVerified")}>
          {t("audit.chainNote")}
        </Callout>

        {feed.error ? <ErrorPanel error={feed.error} onRetry={feed.reload} /> : null}

        {feed.rows.length === 0 ? (
          <LiveEmpty source={feed.live ? "backend" : "device"} />
        ) : (
          <>
            <Toolbar>
              <SearchInput
                value={term}
                onChange={setTerm}
                placeholder={t("common.searchPlaceholder")}
              />
            </Toolbar>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(entry) => entry.id}
              onRowClick={setSelected}
              activeRowKey={selected?.id ?? null}
              filtered={term.trim().length > 0}
              onClearFilters={() => setTerm("")}
              caption={t("audit.title")}
              dense
            />
          </>
        )}
      </PageBody>

      {selected ? (
        <Drawer
          open
          onClose={() => setSelected(null)}
          title={selected.action}
          subtitle={<Badge tone="neutral">{selected.entityType}</Badge>}
        >
          <DescList>
            <DescRow label={t("audit.occurred")}>
              {formatDateTime(selected.occurredAt, fmt)}
            </DescRow>
            <DescRow label={t("audit.recorded")}>
              {formatDateTime(selected.recordedAt, fmt)}
            </DescRow>
            <DescRow label={t("audit.actor")}>{tx(selected.actorName)}</DescRow>
            {selected.branchName ? (
              <DescRow label={t("common.branch")}>{tx(selected.branchName)}</DescRow>
            ) : null}
            <DescRow label={t("audit.entity")} mono>
              {selected.entityId}
            </DescRow>
            {selected.reasonText ? (
              <DescRow label={t("shift.reason")}>{selected.reasonText}</DescRow>
            ) : null}
            {selected.approverName ? (
              <DescRow label={t("orders.approvedBy")}>{tx(selected.approverName)}</DescRow>
            ) : null}
            <DescRow label={t("audit.correlation")} mono>
              {selected.correlationId}
            </DescRow>
            <DescRow label={t("audit.hash")} mono>
              <span className="text-xs break-all">{selected.hash}</span>
            </DescRow>
            <DescRow label={t("audit.previousHash")} mono>
              <span className="text-xs break-all">{selected.previousHash}</span>
            </DescRow>
          </DescList>

          {selected.before || selected.after ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {selected.before ? (
                <div>
                  <h3 className="text-fg mb-1.5 text-xs font-semibold">{t("audit.before")}</h3>
                  <pre className="bg-sunken border-line overflow-x-auto rounded-lg border p-3 text-xs">
                    {JSON.stringify(selected.before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {selected.after ? (
                <div>
                  <h3 className="text-fg mb-1.5 text-xs font-semibold">{t("audit.after")}</h3>
                  <pre className="bg-sunken border-line overflow-x-auto rounded-lg border p-3 text-xs">
                    {JSON.stringify(selected.after, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </Drawer>
      ) : null}
    </>
  );
}
