"use client";

/**
 * Terminals — SRS ch.21, FR-SEC-030.
 *
 * The queue depth is the column that matters, and the note beside it is the
 * point the SRS is making: an offline terminal keeps selling. Orders, payments
 * and shift events are written locally and queued, so "offline" is a sync
 * state, not an outage — the queue is work waiting to send, not lost sales.
 *
 * That reframing changes what "degraded" means operationally. A terminal
 * offline for ten minutes needs no action. The same terminal with four hundred
 * queued operations means the connection has been down long enough that the
 * console's figures are behind the floor, and every report should be read with
 * that in mind.
 *
 * Registration is per device (FR-SEC-030) so that revoking a lost tablet does
 * not require changing anybody's password.
 */

import { useMemo, useState } from "react";
import { Battery, Wifi, WifiOff } from "lucide-react";
import type { Terminal } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { TERMINAL_STATUS, labelOf } from "@/lib/console/labels";
import { branchById } from "@/lib/console/mock/org";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
  cx,
} from "@/components/console/ui";

const TERMINAL_KIND_LABEL = {
  pos: { en: "POS", ar: "نقطة بيع" },
  kds: { en: "KDS", ar: "شاشة مطبخ" },
  kiosk: { en: "Kiosk", ar: "كشك" },
} as const;

export default function TerminalsPage() {
  return (
    <Gate permissions={["ops.terminal.view"]}>
      <TerminalsScreen />
    </Gate>
  );
}

function TerminalsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Terminal | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Terminal>(
    (query) => services.operations.terminals(query),
    { scope, initialSort: "-queuedOperations", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      online: rows.filter((row) => row.status === "online").length,
      offline: rows.filter((row) => row.status === "offline" || row.status === "degraded")
        .length,
      queued: rows.reduce((sum, row) => sum + row.queuedOperations, 0),
      versions: new Set(rows.map((row) => row.appVersion)).size,
    };
  }, [collection.rows]);

  const versions = useMemo(
    () => [...new Set(collection.rows.map((row) => row.appVersion))].sort(),
    [collection.rows],
  );

  const columns = useMemo<Column<Terminal>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack primary={row.name} secondary={<span className="font-mono">{row.code}</span>} />
        ),
      },
      {
        key: "branch",
        header: t("common.branch"),
        secondary: true,
        render: (row) => {
          const branch = branchById.get(row.branchId);
          return branch ? tx(branch.name) : <span className="text-fg-subtle">—</span>;
        },
      },
      {
        key: "kind",
        header: t("terminals.kind"),
        render: (row) => <Badge tone="neutral">{tx(TERMINAL_KIND_LABEL[row.kind])}</Badge>,
      },
      {
        key: "appVersion",
        header: t("terminals.version"),
        secondary: true,
        render: (row) => (
          <span className="text-fg-muted font-mono text-xs" dir="ltr">
            {row.appVersion}
          </span>
        ),
      },
      {
        key: "lastSeenAt",
        header: t("terminals.lastSeen"),
        sortable: true,
        render: (row) => formatRelative(row.lastSeenAt, fmt),
      },
      {
        key: "queuedOperations",
        header: t("terminals.queued"),
        sortable: true,
        numeric: true,
        hint: t("terminals.offlineNote"),
        render: (row) =>
          row.queuedOperations === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span
              className={cx(
                row.queuedOperations > 200 && "text-bad font-semibold",
                row.queuedOperations > 50 && row.queuedOperations <= 200 && "text-warn",
              )}
            >
              {formatNumber(row.queuedOperations, fmt)}
            </span>
          ),
      },
      {
        key: "battery",
        header: t("terminals.battery"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.batteryPercent === null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span
              className={cx(
                "inline-flex items-center gap-1",
                row.batteryPercent < 20 && "text-bad",
              )}
            >
              <Battery size={12} aria-hidden />
              {formatNumber(row.batteryPercent, fmt)}%
            </span>
          ),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(TERMINAL_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("terminals.title")}
        subtitle={t("terminals.subtitle")}
        spec="FR-SEC-030"
      />

      <PageBody>
        <Callout tone="muted" icon={<WifiOff size={14} />}>
          {t("terminals.offlineNote")}
        </Callout>

        <TileGrid columns={4}>
          <MetricTile
            label={t("terminals.online")}
            value={formatNumber(totals.online, fmt)}
          />
          <MetricTile
            label={t("terminals.notOnline")}
            value={formatNumber(totals.offline, fmt)}
          />
          <MetricTile
            label={t("terminals.queued")}
            value={formatNumber(totals.queued, fmt)}
            spec="§21.5"
            hint={t("terminals.queuedHint")}
          />
          <MetricTile
            label={t("terminals.versionSpread")}
            value={formatNumber(totals.versions, fmt)}
            hint={t("terminals.versionHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(TERMINAL_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "kind",
              label: t("terminals.kind"),
              options: Object.entries(TERMINAL_KIND_LABEL).map(([value, label]) => ({
                value,
                label: tx(label),
              })),
            },
            {
              key: "appVersion",
              label: t("terminals.version"),
              options: versions.map((version) => ({ value: version, label: version })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("terminals.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <TerminalDrawer
        terminal={selected}
        onClose={() => setSelected(null)}
        onRevoke={() => setMessage(t("common.notInBuild"))}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TerminalDrawer({
  terminal,
  onClose,
  onRevoke,
}: {
  terminal: Terminal | null;
  onClose: () => void;
  onRevoke: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("ops.terminal.manage");

  if (!terminal) return null;

  const status = labelOf(TERMINAL_STATUS, terminal.status);
  const branch = branchById.get(terminal.branchId);
  const online = terminal.status === "online";

  return (
    <Drawer
      open
      onClose={onClose}
      title={terminal.name}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {terminal.code}
        </span>
      }
      footer={
        canManage && terminal.status !== "revoked" ? (
          <Button variant="danger" onClick={onRevoke}>
            {t("terminals.revoke")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {terminal.queuedOperations > 0 ? (
          <Callout tone={terminal.queuedOperations > 200 ? "warn" : "muted"}>
            {t("terminals.queuedHint")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {online ? <Wifi size={11} aria-hidden /> : <WifiOff size={11} aria-hidden />}
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("terminals.kind")}>
            {tx(TERMINAL_KIND_LABEL[terminal.kind])}
          </DescRow>
          <DescRow label={t("common.branch")}>{branch ? tx(branch.name) : "—"}</DescRow>
          <DescRow label={t("terminals.version")} mono>
            <span dir="ltr">{terminal.appVersion}</span>
          </DescRow>
          <DescRow label={t("terminals.lastSeen")}>
            {formatDateTime(terminal.lastSeenAt, fmt)}
          </DescRow>
          <DescRow label={t("terminals.queued")} mono>
            {formatNumber(terminal.queuedOperations, fmt)}
          </DescRow>
          <DescRow label={t("terminals.battery")} mono>
            {terminal.batteryPercent === null
              ? "—"
              : `${formatNumber(terminal.batteryPercent, fmt)}%`}
          </DescRow>
          <DescRow label={t("terminals.ip")} mono>
            <span dir="ltr">{terminal.ipAddress}</span>
          </DescRow>
        </DescList>

        <Callout tone="muted">{t("terminals.registrationNote")}</Callout>
      </div>
    </Drawer>
  );
}
