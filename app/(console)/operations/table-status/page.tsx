"use client";

/**
 * Table status — DASHBOARD-TABLE-STATUS-LIVE-P0.
 *
 * The manager's READ-ONLY view of which tables have an active dine-in order
 * right now, straight from `GET /orders/tables/status?branchId=`
 * (`pos.order.view_history`) — the same single occupancy algorithm the POS
 * table list and select-table operation use. Nothing here computes,
 * infers or stores occupancy: no order scan, no Organisation table records
 * (`/org/branches/{id}/tables`), no POS-session read.
 *
 * Deliberately shows ONLY what the backend actually knows —
 * Available / Occupied / Conflict. It does not invent the richer floor
 * states the SRS eventually describes (seated, food served, bill requested,
 * needs cleaning): none of them exists server-side yet. For an occupied
 * table it shows the order's own reference (MAIN-N) and its real order
 * lifecycle state, nothing more. A table in conflict (2+ active orders from
 * historical data) is an attention state: every conflicting order is listed
 * equally and none is presented as "the" order.
 *
 * Branch selection mirrors `operations/kitchen/page.tsx` (never a silent
 * default to the first branch while the scope is "All branches"). A branch's
 * tables are one branch's tables: switching branch shows a loading state,
 * never the previous branch's list (see `useTableStatus`).
 */

import { useMemo, useState } from "react";
import { TriangleAlert, Users } from "lucide-react";
import type { TableStatusRow } from "@/lib/console/services/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useTableStatus } from "@/lib/console/feeds";
import { formatNumber } from "@/lib/console/format";
import { ORDER_STATE } from "@/lib/console/labels";
import { PageBody, PageHeader } from "@/components/console/page";
import { LiveNotice } from "@/components/console/live-panels";
import { ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { Badge, Callout, Field, Select, cx } from "@/components/console/ui";

export default function TableStatusPage() {
  return (
    <Gate permissions={["pos.order.view_history"]}>
      <TableStatusScreen />
    </Gate>
  );
}

function TableStatusScreen() {
  const { t, tx } = useI18n();
  const { scope, availableBranches } = useSession();

  const singleAuthorizedBranch = availableBranches.length === 1 ? availableBranches[0]! : null;
  const contextBranchId = scope.branchId ?? singleAuthorizedBranch?.id ?? null;
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = contextBranchId ?? (pickedBranchId || null);

  const feed = useTableStatus(branchId);

  return (
    <>
      <PageHeader title={t("nav.tableStatus")} subtitle={t("tableStatus.subtitle")} />

      <PageBody>
        <LiveNotice source={feed.live ? "backend" : "device"} />

        {!contextBranchId && availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={pickedBranchId} onChange={(event) => setPickedBranchId(event.target.value)}>
              <option value="">—</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!branchId ? (
          <Callout tone="muted">{t("tableStatus.selectBranch")}</Callout>
        ) : feed.error ? (
          <StatusError error={feed.error} onRetry={feed.reload} />
        ) : !feed.ready || !feed.rows ? (
          <LoadingPanel />
        ) : feed.rows.length === 0 ? (
          <Callout tone="muted">{t("ops.noTables")}</Callout>
        ) : (
          <TableGrid rows={feed.rows} />
        )}
      </PageBody>
    </>
  );
}

/**
 * A refusal is not an outage: 403/404 say so plainly (and never leak more
 * than the backend already told this caller); everything else — network,
 * 5xx — keeps the console's ordinary error panel with Retry. None of these
 * ever renders a table.
 */
function StatusError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  const status = (error as { status?: number }).status;

  if (status === 403) return <Callout tone="bad">{t("tableStatus.forbidden")}</Callout>;
  if (status === 404) return <Callout tone="bad">{t("tableStatus.notFound")}</Callout>;
  return <ErrorPanel error={error} onRetry={onRetry} />;
}

function TableGrid({ rows }: { rows: TableStatusRow[] }) {
  const { t, fmt } = useI18n();

  const counts = useMemo(
    () => ({
      available: rows.filter((r) => r.occupancy === "available").length,
      occupied: rows.filter((r) => r.occupancy === "occupied").length,
      ambiguous: rows.filter((r) => r.occupancy === "ambiguous").length,
    }),
    [rows],
  );

  const sections = useMemo(() => {
    const bySection = new Map<string, TableStatusRow[]>();
    for (const row of rows) {
      const key = row.section ?? "";
      const list = bySection.get(key) ?? [];
      list.push(row);
      bySection.set(key, list);
    }
    return [...bySection.entries()];
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="table-status-summary">
        <Badge tone="good" dot>
          {t("pos.tableAvailable")} · {formatNumber(counts.available, fmt)}
        </Badge>
        <Badge tone="warn" dot>
          {t("pos.tableOccupied")} · {formatNumber(counts.occupied, fmt)}
        </Badge>
        {counts.ambiguous > 0 ? (
          <Badge tone="bad" dot>
            {t("pos.tableConflict")} · {formatNumber(counts.ambiguous, fmt)}
          </Badge>
        ) : null}
      </div>

      {sections.map(([section, sectionRows]) => (
        <section key={section || "_"} className="space-y-2">
          {section ? <h3 className="text-fg-subtle text-xs font-medium">{section}</h3> : null}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {sectionRows.map((row) => (
              <TableCard key={row.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TableCard({ row }: { row: TableStatusRow }) {
  const { t, tx, fmt } = useI18n();
  const ambiguous = row.occupancy === "ambiguous";
  const occupied = row.occupancy === "occupied";

  return (
    <li
      data-occupancy={row.occupancy}
      className={cx(
        "flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-center text-sm",
        ambiguous
          ? "border-bad/40 bg-bad-soft text-bad"
          : occupied
            ? "border-warn/40 bg-warn-soft text-fg"
            : "border-line bg-raised text-fg",
      )}
    >
      <span className="font-mono text-base font-medium">{row.label}</span>
      {row.seatCapacity !== null ? (
        <span className="text-fg-subtle inline-flex items-center gap-1 text-xs">
          <Users size={11} aria-hidden />
          {formatNumber(row.seatCapacity, fmt)} {t("pos.seats")}
        </span>
      ) : null}
      <Badge tone={ambiguous ? "bad" : occupied ? "warn" : "good"} dot>
        {ambiguous
          ? t("pos.tableConflict")
          : occupied
            ? t("pos.tableOccupied")
            : t("pos.tableAvailable")}
      </Badge>

      {occupied && row.activeOrder ? (
        <span className="flex flex-col items-center gap-0.5 text-xs">
          <span className="text-fg font-mono">{row.activeOrder.orderNumber}</span>
          <span className="text-fg-muted">{tx(orderStateLabel(row.activeOrder.state))}</span>
        </span>
      ) : null}

      {ambiguous ? (
        <span className="flex flex-col items-center gap-0.5 text-xs leading-snug">
          <span className="inline-flex items-center gap-1">
            <TriangleAlert size={11} aria-hidden />
            {t("tableStatus.conflictNote").replace(
              "{n}",
              formatNumber(row.conflictingOrders.length, fmt),
            )}
          </span>
          {/* Every conflicting order, equally — none is "the" order. */}
          <span className="font-mono">
            {row.conflictingOrders.map((order) => order.orderNumber).join(" · ")}
          </span>
        </span>
      ) : null}
    </li>
  );
}

/** The backend only ever reports the five non-final states here; anything else falls back to its raw key. */
function orderStateLabel(state: string) {
  const known = ORDER_STATE[state as keyof typeof ORDER_STATE];
  return known ? known.label : { en: state, ar: state };
}
