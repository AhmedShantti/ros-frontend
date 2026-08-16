"use client";

/**
 * Integrations — SRS ch.23, FR-INT-004, FR-INT-006.
 *
 * Connector health is shown, not inferred. The three numbers that matter are
 * last success, error rate and queue depth, and they answer different
 * questions: whether it ever works, whether it works reliably, and whether the
 * backlog is growing.
 *
 * The circuit breaker is a first-class state (FR-INT-006). When a connector
 * crosses its failure threshold, calls stop and queue rather than continuing
 * to fail — a payment terminal that keeps retrying a dead endpoint blocks the
 * till, and a queue that drains on recovery does not.
 *
 * "Not configured" is deliberately distinct from "disabled". One means nobody
 * has set it up; the other means somebody turned it off. Collapsing them into
 * a single grey badge is how an unconfigured tax connector goes unnoticed
 * until a filing deadline.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Plug } from "lucide-react";
import type { Integration } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber, formatPercent, formatRelative } from "@/lib/console/format";
import { CONNECTOR_STATUS, INTEGRATION_CATEGORY, labelOf } from "@/lib/console/labels";
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

export default function IntegrationsPage() {
  return (
    <Gate permissions={["integration.manage"]}>
      <IntegrationsScreen />
    </Gate>
  );
}

function IntegrationsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Integration | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Integration>(
    (query) => services.platform.integrations.list(query),
    { scope, initialSort: "-errorRate", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      healthy: rows.filter((row) => row.status === "healthy").length,
      failing: rows.filter((row) => row.status === "failing" || row.status === "degraded")
        .length,
      circuitOpen: rows.filter((row) => row.circuitOpen).length,
      queued: rows.reduce((sum, row) => sum + row.queueDepth, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Integration>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => <CellStack primary={row.name} secondary={row.vendor} />,
      },
      {
        key: "category",
        header: t("int.category"),
        render: (row) => {
          const category = labelOf(INTEGRATION_CATEGORY, row.category);
          return <Badge tone={category.tone}>{tx(category.label)}</Badge>;
        },
      },
      {
        key: "lastSuccess",
        header: t("int.lastSuccess"),
        secondary: true,
        render: (row) =>
          row.lastSuccessAt ? (
            formatRelative(row.lastSuccessAt, fmt)
          ) : (
            <span className="text-fg-subtle">{t("common.never")}</span>
          ),
      },
      {
        key: "errorRate",
        header: t("int.errorRate"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              row.errorRate > 5 && "text-bad font-semibold",
              row.errorRate > 1 && row.errorRate <= 5 && "text-warn",
            )}
          >
            {formatPercent(row.errorRate, fmt, 2)}
          </span>
        ),
      },
      {
        key: "queueDepth",
        header: t("int.queueDepth"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.queueDepth === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatNumber(row.queueDepth, fmt)
          ),
      },
      {
        key: "branchCount",
        header: t("int.branchesConnected"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.branchCount, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(CONNECTOR_STATUS, row.status);
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={status.tone} dot>
                {tx(status.label)}
              </Badge>
              {row.circuitOpen ? (
                <Badge tone="bad">
                  <AlertTriangle size={11} aria-hidden />
                  {t("int.circuitOpen")}
                </Badge>
              ) : null}
            </span>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader title={t("int.title")} subtitle={t("int.subtitle")} spec="FR-INT-004" />

      <PageBody>
        {totals.circuitOpen > 0 ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("int.circuitOpen")}>
            {t("int.circuitNote")}
          </Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile label={t("int.healthy")} value={formatNumber(totals.healthy, fmt)} />
          <MetricTile
            label={t("int.unhealthy")}
            value={formatNumber(totals.failing, fmt)}
            spec="FR-INT-004"
          />
          <MetricTile
            label={t("int.circuitOpen")}
            value={formatNumber(totals.circuitOpen, fmt)}
            spec="FR-INT-006"
            hint={t("int.circuitNote")}
          />
          <MetricTile
            label={t("int.queueDepth")}
            value={formatNumber(totals.queued, fmt)}
            hint={t("int.queueHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "category",
              label: t("int.category"),
              options: Object.entries(INTEGRATION_CATEGORY).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(CONNECTOR_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "enabled",
              label: t("common.enabled"),
              options: [
                { value: "true", label: t("common.enabled") },
                { value: "false", label: t("common.disabled") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("int.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <IntegrationDrawer
        integration={selected}
        onClose={() => setSelected(null)}
        onAction={() => setMessage(t("common.notInBuild"))}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function IntegrationDrawer({
  integration,
  onClose,
  onAction,
}: {
  integration: Integration | null;
  onClose: () => void;
  onAction: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("integration.manage");

  if (!integration) return null;

  const status = labelOf(CONNECTOR_STATUS, integration.status);
  const category = labelOf(INTEGRATION_CATEGORY, integration.category);

  return (
    <Drawer
      open
      onClose={onClose}
      title={integration.name}
      subtitle={integration.vendor}
      footer={
        canManage ? (
          <>
            <Button variant="ghost" onClick={onAction}>
              {t("int.rotate")}
            </Button>
            <Button variant={integration.enabled ? "danger" : "primary"} onClick={onAction}>
              {integration.enabled ? t("int.disable") : t("int.enable")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-5">
        {integration.circuitOpen ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("int.circuitOpen")}>
            {t("int.circuitNote")}
          </Callout>
        ) : null}

        {integration.status === "not_configured" ? (
          <Callout tone="muted" icon={<Plug size={14} />}>
            {t("int.notConfiguredNote")}
          </Callout>
        ) : null}

        <p className="text-fg-muted text-sm leading-relaxed">{tx(integration.description)}</p>

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("int.category")}>
            <Badge tone={category.tone}>{tx(category.label)}</Badge>
          </DescRow>
          <DescRow label={t("int.vendor")}>{integration.vendor}</DescRow>
          <DescRow label={t("common.enabled")}>
            {integration.enabled ? t("common.enabled") : t("common.disabled")}
          </DescRow>
          <DescRow label={t("int.lastSuccess")}>
            {integration.lastSuccessAt
              ? formatRelative(integration.lastSuccessAt, fmt)
              : t("common.never")}
          </DescRow>
          <DescRow label={t("int.errorRate")} mono>
            {formatPercent(integration.errorRate, fmt, 2)}
          </DescRow>
          <DescRow label={t("int.queueDepth")} mono>
            {formatNumber(integration.queueDepth, fmt)}
          </DescRow>
          <DescRow label={t("int.branchesConnected")} mono>
            {formatNumber(integration.branchCount, fmt)}
          </DescRow>
        </DescList>

        <Callout tone="muted">{t("int.aclNote")}</Callout>
      </div>
    </Drawer>
  );
}
