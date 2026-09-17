"use client";

/**
 * Audit entry detail and audit-log access recording — FR-AUD-002, FR-AUD-007.
 *
 * FR-AUD-002 lists what an entry carries: a ULID id, tenant and branch
 * scope, the actor, the action, the entity, the state before and after, the
 * correlation id, and where it came from (IP, device). `AuditEntryFields`
 * shows every one of them, including the ones the old drawer skipped when
 * empty — an absent IP is itself information — and `AuditDiff` sets before
 * against after field by field, so a changed price is found by reading one
 * highlighted row rather than two JSON blobs.
 *
 * FR-AUD-007 — reading the audit log is itself audited. `useAuditAccessLog`
 * records the screen being opened (and each distinct filter it is narrowed
 * to), an entry being opened, and an export, in the security event log.
 */

import { useEffect, useMemo, useRef } from "react";

import type { AuditEntry } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useSecurityLog } from "@/lib/console/security-log";
import { ulidTime } from "@/lib/console/services/security-events";
import { formatDateTime } from "@/lib/console/format";
import { ACTOR_TYPE, labelOf } from "@/lib/console/labels";
import { ClassificationBadge } from "@/components/console/security-sensitive";
import { Badge, DescList, DescRow, cx } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// FR-AUD-007
// ---------------------------------------------------------------------------

export function useAuditAccessLog(filterKey: string, filterSummary: string) {
  const record = useSecurityLog();
  const last = useRef<string | null>(null);

  // One "viewed" per distinct filter set, after it has settled for a moment,
  // so typing into a filter does not write an event per keystroke.
  useEffect(() => {
    if (last.current === filterKey) return;
    const timer = window.setTimeout(() => {
      last.current = filterKey;
      void record({
        kind: "audit.viewed",
        subjectType: "audit_log",
        subjectId: "tenant",
        detail: { filters: filterSummary.slice(0, 400) },
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [filterKey, filterSummary, record]);

  return {
    opened(entry: AuditEntry) {
      void record({
        kind: "audit.entry_opened",
        subjectType: "audit_entry",
        subjectId: entry.id,
        detail: { action: entry.action, entity: `${entry.entityType}:${entry.entityId}` },
      });
    },
    exported(rows: number, format: string, filters: string) {
      void record({
        kind: "audit.exported",
        subjectType: "audit_log",
        subjectId: "tenant",
        detail: { rows, format, filters: filters.slice(0, 400), class: "confidential" },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// FR-AUD-002
// ---------------------------------------------------------------------------

function Missing() {
  const { t } = useI18n();
  return <span className="text-fg-subtle">{t("aud2.notRecorded")}</span>;
}

export function AuditEntryFields({ entry }: { entry: AuditEntry }) {
  const { t, tx, fmt } = useI18n();
  const ulidAt = ulidTime(entry.id);

  return (
    <DescList>
      <DescRow label={t("aud2.id")} mono>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs break-all" dir="ltr">
            {entry.id}
          </span>
          {ulidAt !== null ? (
            <Badge tone="muted">ULID · {formatDateTime(new Date(ulidAt).toISOString(), fmt)}</Badge>
          ) : (
            <Badge tone="warn">{t("aud2.notUlid")}</Badge>
          )}
        </span>
      </DescRow>
      <DescRow label={t("aud2.tenant")} mono>
        <span className="text-xs" dir="ltr">
          {entry.tenantId || "—"}
        </span>
      </DescRow>
      <DescRow label={t("aud2.branch")}>
        {entry.branchId ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {entry.branchName ? tx(entry.branchName) : null}
            <span className="text-fg-subtle font-mono text-xs" dir="ltr">
              {entry.branchId}
            </span>
          </span>
        ) : (
          <span className="text-fg-subtle">{t("aud2.tenantWide")}</span>
        )}
      </DescRow>
      <DescRow label={t("audit.occurred")}>{formatDateTime(entry.occurredAt, fmt)}</DescRow>
      <DescRow label={t("audit.recorded")}>{formatDateTime(entry.recordedAt, fmt)}</DescRow>
      <DescRow label={t("audit.actor")}>
        <span className="flex flex-wrap items-center gap-1.5">
          {tx(entry.actorName) || "—"}
          <Badge tone="muted">{tx(labelOf(ACTOR_TYPE, entry.actorType).label)}</Badge>
          <span className="text-fg-subtle font-mono text-xs" dir="ltr">
            {entry.actorId || "—"}
          </span>
        </span>
      </DescRow>
      {entry.impersonatedBy ? <DescRow label={t("audit.impersonated")}>{tx(entry.impersonatedBy)}</DescRow> : null}
      <DescRow label={t("audit.action")} mono>
        <span className="text-xs" dir="ltr">
          {entry.action}
        </span>
      </DescRow>
      <DescRow label={t("audit.entity")} mono>
        <span className="text-xs" dir="ltr">
          {entry.entityType}:{entry.entityId || "—"}
        </span>
      </DescRow>
      <DescRow label={t("shift.reason")}>
        {entry.reasonCode || entry.reasonText ? (
          <span>
            {entry.reasonText ?? ""}
            {entry.reasonCode ? (
              <span className="text-fg-subtle ms-1.5 font-mono text-xs" dir="ltr">
                {entry.reasonCode}
              </span>
            ) : null}
          </span>
        ) : (
          <Missing />
        )}
      </DescRow>
      <DescRow label={t("orders.approvedBy")}>{entry.approverName ? tx(entry.approverName) : <Missing />}</DescRow>
      <DescRow label={t("audit.correlation")} mono>
        <span className="text-xs" dir="ltr">
          {entry.correlationId || "—"}
        </span>
      </DescRow>
      <DescRow label={t("audit.ip")} mono>
        {entry.ipAddress ? (
          <span className="text-xs" dir="ltr">
            {entry.ipAddress}
          </span>
        ) : (
          <Missing />
        )}
      </DescRow>
      <DescRow label={t("aud2.device")} mono>
        {entry.terminalId ? (
          <span className="text-xs" dir="ltr">
            {entry.terminalId}
          </span>
        ) : (
          <Missing />
        )}
      </DescRow>
      <DescRow label={t("audit.hash")} mono>
        <span className="text-xs break-all" dir="ltr">
          {entry.hash}
        </span>
      </DescRow>
      <DescRow label={t("audit.previousHash")} mono>
        <span className="text-xs break-all" dir="ltr">
          {entry.previousHash || "—"}
        </span>
      </DescRow>
      <DescRow label={t("aud2.class")}>
        <ClassificationBadge cls="confidential" />
      </DescRow>
    </DescList>
  );
}

function show(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AuditDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const { t } = useI18n();
  const rows = useMemo(() => {
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
    return keys.map((key) => {
      const a = before ? before[key] : undefined;
      const b = after ? after[key] : undefined;
      return { key, a: show(a), b: show(b), changed: JSON.stringify(a) !== JSON.stringify(b) };
    });
  }, [before, after]);

  if (!before && !after) return <p className="text-fg-subtle text-xs">{t("aud2.noState")}</p>;

  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <caption className="sr-only">{t("aud2.diff")}</caption>
        <thead className="bg-sunken text-fg-muted">
          <tr>
            <th scope="col" className="px-2.5 py-1.5 text-start font-medium">{t("aud2.field")}</th>
            <th scope="col" className="px-2.5 py-1.5 text-start font-medium">{t("audit.before")}</th>
            <th scope="col" className="px-2.5 py-1.5 text-start font-medium">{t("audit.after")}</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((row) => (
            <tr key={row.key} className={cx(row.changed && "bg-warn-soft/40")}>
              <th scope="row" className="text-fg px-2.5 py-1.5 text-start font-mono font-normal" dir="ltr">
                {row.key}
                {row.changed ? <span className="sr-only"> ({t("aud2.changed")})</span> : null}
              </th>
              <td className="text-fg-muted px-2.5 py-1.5 font-mono break-all" dir="ltr">
                {before ? row.a || "—" : "—"}
              </td>
              <td className={cx("px-2.5 py-1.5 font-mono break-all", row.changed ? "text-fg font-medium" : "text-fg-muted")} dir="ltr">
                {after ? row.b || "—" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
