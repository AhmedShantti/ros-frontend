"use client";

/**
 * Tenants — SRS ch.6.
 *
 * Platform-level administration, which is why it sits behind
 * `platform.tenant.manage` rather than any tenant-scoped permission. A tenant
 * owner never sees this screen; the people who operate the platform do.
 *
 * The lifecycle states are not decoration. `past_due` still trades — cutting
 * off a restaurant's till over an unpaid invoice is a business decision nobody
 * should make by accident — while `restricted` keeps the terminals selling and
 * closes the console, and `suspended` stops both. Showing the state plainly is
 * how support answers "why can't I log in" without opening a database.
 */

import { useMemo, useState } from "react";
import type { Tenant } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber } from "@/lib/console/format";
import { PLAN_TIER, TENANT_STATE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Callout, DescList, DescRow, Drawer } from "@/components/console/ui";

export default function TenantsPage() {
  return (
    <Gate permissions={["platform.tenant.manage"]}>
      <TenantsScreen />
    </Gate>
  );
}

function TenantsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Tenant | null>(null);

  const collection = useCollection<Tenant>(
    (query) => services.organisation.tenants.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.state === "active").length,
      atRisk: rows.filter(
        (row) =>
          row.state === "past_due" || row.state === "restricted" || row.state === "suspended",
      ).length,
      branches: rows.reduce((sum, row) => sum + row.branchCount, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Tenant>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={<span className="font-mono">{row.slug}</span>}
          />
        ),
      },
      {
        key: "plan",
        header: t("org.plan"),
        render: (row) => {
          const plan = labelOf(PLAN_TIER, row.plan);
          return <Badge tone={plan.tone}>{tx(plan.label)}</Badge>;
        },
      },
      {
        key: "country",
        header: t("org.country"),
        secondary: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.countryCode} · {row.baseCurrency}
          </span>
        ),
      },
      {
        key: "region",
        header: t("org.region"),
        secondary: true,
        render: (row) => (
          <span className="text-fg-muted font-mono text-xs" dir="ltr">
            {row.region}
          </span>
        ),
      },
      {
        key: "branchCount",
        header: t("org.branchCount"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span dir="ltr">
            {formatNumber(row.brandCount, fmt)} / {formatNumber(row.branchCount, fmt)}
          </span>
        ),
      },
      {
        key: "createdAt",
        header: t("common.created"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.createdAt, fmt),
      },
      {
        key: "state",
        header: t("org.state"),
        render: (row) => {
          const state = labelOf(TENANT_STATE, row.state);
          return (
            <Badge tone={state.tone} dot>
              {tx(state.label)}
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
        title={t("org.tenantsTitle")}
        subtitle={t("org.tenantsSubtitle")}
        spec="§6.3"
      />

      <PageBody>
        <Callout tone="muted">{t("org.tenantIsolationNote")}</Callout>

        <TileGrid columns={3}>
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("org.atRisk")}
            value={formatNumber(totals.atRisk, fmt)}
            hint={t("org.atRiskHint")}
          />
          <MetricTile label={t("org.branchCount")} value={formatNumber(totals.branches, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "state",
              label: t("org.state"),
              options: Object.entries(TENANT_STATE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "plan",
              label: t("org.plan"),
              options: Object.entries(PLAN_TIER).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("org.tenantsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <TenantDrawer tenant={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TenantDrawer({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!tenant) return null;

  const state = labelOf(TENANT_STATE, tenant.state);
  const plan = labelOf(PLAN_TIER, tenant.plan);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(tenant.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {tenant.slug}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("org.state")}>
            <Badge tone={state.tone} dot>
              {tx(state.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("org.plan")}>
            <Badge tone={plan.tone}>{tx(plan.label)}</Badge>
          </DescRow>
          <DescRow label={t("org.country")} mono>
            <span dir="ltr">{tenant.countryCode}</span>
          </DescRow>
          <DescRow label={t("org.currency")} mono>
            <span dir="ltr">{tenant.baseCurrency}</span>
          </DescRow>
          <DescRow label={t("org.region")} mono>
            <span dir="ltr">{tenant.region}</span>
          </DescRow>
          <DescRow label={t("nav.brands")} mono>
            {formatNumber(tenant.brandCount, fmt)}
          </DescRow>
          <DescRow label={t("org.branchCount")} mono>
            {formatNumber(tenant.branchCount, fmt)}
          </DescRow>
          <DescRow label={t("common.created")}>{formatDate(tenant.createdAt, fmt)}</DescRow>
        </DescList>

        <Callout tone="muted">{t("org.residencyNote")}</Callout>
      </div>
    </Drawer>
  );
}
