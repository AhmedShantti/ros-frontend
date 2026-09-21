"use client";

/**
 * DINE-IN-TABLE-SELECTOR-RESUME-P0 — the POS Dine-In table-selection surface.
 *
 * What it shows is exactly what `GET /orders/tables` reports: every table of
 * this session's own branch with the backend's DERIVED occupancy
 * (`available` / `occupied` / `ambiguous`). Nothing here computes, caches or
 * persists occupancy.
 *
 * What a tap does is ONE call — `POST /orders/tables/{id}/select` — for
 * available and occupied tables alike. The backend atomically creates the
 * table's one active order (`created`) or returns the SAME existing order
 * (`resumed`); this component never decides which, and never falls back to a
 * direct `POST /orders`. Occupied is therefore selectable on purpose: it is
 * how the operator resumes the table's existing order.
 *
 * An ambiguous table (dirty data left two or more active orders on it) is
 * shown as a problem and is not opened or resumed: there is no single order
 * to hand back, and picking one would be a guess.
 *
 * POS-safe by construction: `services.sales.tables()` / `.selectTable()` are
 * session-branch-scoped `@AllowPosSession()` routes — never the
 * `settings.branch.read`-gated `/org/branches/{id}/tables`.
 */

import { useRef, useState } from "react";
import { RefreshCw, TriangleAlert, Users } from "lucide-react";

import { services, type ServiceError } from "@/lib/console/services";
import type { PosTable, SelectedTable } from "@/lib/console/services/types";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Spinner, cx } from "@/components/console/ui";

/** `ServiceError.code` the backend raises when a table has 2+ active orders. */
const TABLE_AMBIGUOUS = "DINE_IN_TABLE_AMBIGUOUS";

export function DineInTableSelector({
  onSelected,
}: {
  onSelected: (result: SelectedTable) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const tablesState = useAsync(() => services.sales.tables(), []);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // `pendingId` is state, so two taps inside one event-loop turn could both
  // read `null`; the ref closes that gap. The backend stays authoritative
  // (one active order per table), this only avoids a redundant request.
  const inFlight = useRef(false);

  function describe(error: ServiceError): { message: string; refresh: boolean } {
    if (error.code === TABLE_AMBIGUOUS) return { message: t("pos.tableAmbiguous"), refresh: true };
    if (error.status === 403) return { message: t("pos.tableSelectForbidden"), refresh: false };
    if (error.status === 404) return { message: t("pos.tableNotFound"), refresh: true };
    if (error.status === 0) return { message: t("pos.tableNetworkError"), refresh: false };
    // Anything else (a 409 for a stale key, a validation refusal, …) keeps the
    // backend's own wording rather than an invented one.
    return { message: error.message, refresh: error.status === 409 };
  }

  async function select(row: PosTable) {
    if (row.occupancy === "ambiguous") {
      // The list already says this table cannot be opened. Explain, don't ask.
      setProblem(t("pos.tableAmbiguous"));
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingId(row.id);
    setProblem(null);
    try {
      await action.run(
        // No guest count, ever: it is not part of the POS Dine-In flow.
        () => services.sales.selectTable(row.id),
        {
          onSuccess: onSelected,
          onError: (error) => {
            const { message, refresh } = describe(error);
            setProblem(message);
            // The list was stale; show what the server says now.
            if (refresh) tablesState.reload();
          },
        },
      );
    } finally {
      inFlight.current = false;
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-fg text-xs font-medium">{t("pos.selectTable")}</p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={13} />}
          disabled={pendingId !== null}
          loading={tablesState.loading && tablesState.data !== null}
          onClick={tablesState.reload}
        >
          {t("common.refresh")}
        </Button>
      </div>

      {problem ? (
        <div role="alert" className="mb-2">
          <Callout tone="bad" icon={<TriangleAlert size={14} />}>
            {problem}
          </Callout>
        </div>
      ) : null}

      {tablesState.error ? (
        <Callout tone="bad">
          {(tablesState.error as Partial<ServiceError>).status === 403
            ? t("pos.tablesAuthError")
            : t("pos.tablesLoadError")}{" "}
          <button type="button" className="underline" onClick={tablesState.reload}>
            {t("state.errorRetry")}
          </button>
        </Callout>
      ) : (
        <AsyncPanel
          state={tablesState}
          skeleton={<Spinner />}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("ops.noTables")}</Callout>}
        >
          {(rows) => <TableGrid rows={rows} pendingId={pendingId} onSelect={select} />}
        </AsyncPanel>
      )}
    </div>
  );
}

/**
 * Touch-friendly card grid, grouped by section/area when the branch defines
 * one (`org.tables.section`, optional).
 */
function TableGrid({
  rows,
  pendingId,
  onSelect,
}: {
  rows: PosTable[];
  pendingId: string | null;
  onSelect: (row: PosTable) => void;
}) {
  const sections = new Map<string, PosTable[]>();
  for (const row of rows) {
    const key = row.section ?? "";
    const list = sections.get(key) ?? [];
    list.push(row);
    sections.set(key, list);
  }

  return (
    <div className="space-y-3">
      {[...sections.entries()].map(([section, sectionRows]) => (
        <div key={section || "_"}>
          {section ? <p className="text-fg-subtle mb-1.5 text-xs font-medium">{section}</p> : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sectionRows.map((row) => (
              <TableCard
                key={row.id}
                row={row}
                busy={pendingId === row.id}
                locked={pendingId !== null}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableCard({
  row,
  busy,
  locked,
  onSelect,
}: {
  row: PosTable;
  /** This card's own request is in flight. */
  busy: boolean;
  /** Some card's request is in flight — nothing else may be tapped. */
  locked: boolean;
  onSelect: (row: PosTable) => void;
}) {
  const { t } = useI18n();
  const ambiguous = row.occupancy === "ambiguous";
  const occupied = row.occupancy === "occupied";
  const status = ambiguous
    ? t("pos.tableConflict")
    : occupied
      ? t("pos.tableOccupied")
      : t("pos.tableAvailable");

  return (
    <button
      type="button"
      // Every visible part, separated — the card's spans carry no whitespace
      // between them, so the computed name would otherwise run "4" and "6
      // seats" together. (Label-in-name holds: nothing here is hidden text.)
      aria-label={[
        row.label,
        row.seatCapacity !== null ? `${row.seatCapacity} ${t("pos.seats")}` : null,
        status,
        occupied && row.activeOrder ? `${row.activeOrder.orderNumber} ${t("pos.tableResumeOrder")}` : null,
        ambiguous ? t("pos.tableConflictHint") : null,
      ]
        .filter(Boolean)
        .join(", ")}
      // An ambiguous table is a problem card, not a disabled one: a tap
      // explains why it cannot be opened, and never reaches the network.
      aria-disabled={ambiguous || undefined}
      aria-busy={busy || undefined}
      disabled={locked}
      onClick={() => onSelect(row)}
      className={cx(
        "flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-center text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        ambiguous
          ? "border-bad/40 bg-bad-soft text-bad"
          : occupied
            ? "border-warn/40 bg-warn-soft text-fg hover:bg-warn-soft/70"
            : "border-line bg-raised text-fg hover:bg-sunken",
      )}
    >
      <span className="font-mono text-base">{row.label}</span>
      {row.seatCapacity !== null ? (
        <span className="text-fg-subtle inline-flex items-center gap-1 text-xs font-normal">
          <Users size={11} aria-hidden />
          {row.seatCapacity} {t("pos.seats")}
        </span>
      ) : null}
      <Badge tone={ambiguous ? "bad" : occupied ? "warn" : "good"} dot>
        {status}
      </Badge>
      {occupied && row.activeOrder ? (
        <span className="text-fg-muted text-xs font-normal">
          <span className="font-mono">{row.activeOrder.orderNumber}</span> ·{" "}
          {t("pos.tableResumeOrder")}
        </span>
      ) : null}
      {ambiguous ? (
        <span className="text-xs leading-snug font-normal">{t("pos.tableConflictHint")}</span>
      ) : null}
      {busy ? <Spinner size={14} /> : null}
    </button>
  );
}
