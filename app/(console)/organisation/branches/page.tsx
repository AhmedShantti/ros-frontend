"use client";

/**
 * Branches — SRS ch.17.
 *
 * The branch is the operational unit and the isolation boundary that matters
 * most: its own stock, drawers, roster, trading hours, currency and tax setup.
 * Almost every permission in the system is ultimately scoped to a set of these.
 *
 * The business-day boundary is the field that surprises people. A branch that
 * closes at 02:00 needs its trading day to end at 04:00, not at midnight, or
 * every late Friday splits across two reports and neither one describes a
 * shift anybody worked (FR-FIN-024).
 *
 * Franchises are flagged because the data-sharing rules differ: a franchisee
 * sees its own branch and nothing else, whatever the org chart says.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Branch } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber } from "@/lib/console/format";
import { brandById, brands } from "@/lib/console/mock/org";
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
} from "@/components/console/ui";

export default function BranchesPage() {
  return (
    <Gate permissions={["org.manage", "settings.branch.manage", "report.view.sales"]}>
      <BranchesScreen />
    </Gate>
  );
}

function BranchesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("org.manage");
  const [selected, setSelected] = useState<Branch | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Branch>(
    (query) => services.organisation.branches.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      seats: rows.reduce((sum, row) => sum + row.seats, 0),
      franchises: rows.filter((row) => row.isFranchise).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Branch>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={<span className="font-mono">{row.code}</span>}
          />
        ),
      },
      {
        key: "brand",
        header: t("common.brand"),
        render: (row) => {
          const brand = brandById.get(row.brandId);
          return brand ? (
            <span className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: brand.colour }}
              />
              {tx(brand.name)}
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          );
        },
      },
      {
        key: "country",
        header: t("org.country"),
        secondary: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.countryCode} · {row.currency}
          </span>
        ),
      },
      {
        key: "dayBoundary",
        header: t("org.dayBoundary"),
        secondary: true,
        hint: t("org.dayBoundaryHint"),
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.businessDayBoundary}
          </span>
        ),
      },
      {
        key: "seats",
        header: t("org.seats"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.seats, fmt),
      },
      {
        key: "openedAt",
        header: t("org.openedOn"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.openedAt, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.active ? "good" : "muted"} dot>
              {row.active ? t("common.active") : t("common.inactive")}
            </Badge>
            {row.isFranchise ? <Badge tone="accent">{t("org.franchise")}</Badge> : null}
          </span>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("org.branchesTitle")}
        subtitle={t("org.branchesSubtitle")}
        spec="FR-BRN-001"
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setMessage(t("common.notInBuild"))}
            >
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile label={t("org.seats")} value={formatNumber(totals.seats, fmt)} />
          <MetricTile
            label={t("org.franchise")}
            value={formatNumber(totals.franchises, fmt)}
            hint={t("org.franchiseHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("org.branchSearchPlaceholder")}
          filters={[
            {
              key: "brandId",
              label: t("common.brand"),
              options: brands.map((brand) => ({ value: brand.id, label: tx(brand.name) })),
            },
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
            {
              key: "isFranchise",
              label: t("org.franchise"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("org.branchesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <BranchDrawer branch={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function BranchDrawer({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!branch) return null;

  const brand = brandById.get(branch.brandId);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(branch.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {branch.code}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.brand")}>{brand ? tx(brand.name) : "—"}</DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={branch.active ? "good" : "muted"} dot>
              {branch.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
          <DescRow label={t("org.franchise")}>
            {branch.isFranchise ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("org.country")} mono>
            <span dir="ltr">{branch.countryCode}</span>
          </DescRow>
          <DescRow label={t("org.currency")} mono>
            <span dir="ltr">{branch.currency}</span>
          </DescRow>
          <DescRow label={t("org.timezone")} mono>
            <span dir="ltr">{branch.timezone}</span>
          </DescRow>
          <DescRow label={t("org.dayBoundary")} mono>
            <span dir="ltr">{branch.businessDayBoundary}</span>
          </DescRow>
          <DescRow label={t("org.seats")} mono>
            {formatNumber(branch.seats, fmt)}
          </DescRow>
          <DescRow label={t("org.area")} mono>
            <span dir="ltr">{formatNumber(branch.areaSqm, fmt)} m²</span>
          </DescRow>
          <DescRow label={t("org.openedOn")}>{formatDate(branch.openedAt, fmt)}</DescRow>
          <DescRow label={t("org.address")}>{branch.address}</DescRow>
        </DescList>

        <Callout tone="muted">{t("org.dayBoundaryHint")}</Callout>
      </div>
    </Drawer>
  );
}
