"use client";

/**
 * Warehouses — SRS §6.1, §11.3.
 *
 * A warehouse holds stock and does not sell. That single difference is why it
 * is a distinct location kind rather than a flag on a branch: it takes part in
 * transfers, counts and valuation, and takes no part in sales, drawers or
 * kitchen routing.
 *
 * A warehouse may be attached to a branch — a back store behind the
 * restaurant — or stand alone as a regional depot. Attached ones inherit the
 * branch's scope for permissions, which is what stops a regional depot's stock
 * appearing to a single-branch manager.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Warehouse } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Toast } from "@/components/console/ui";
import { RecordDrawer } from "@/components/console/record-drawer";

export default function WarehousesPage() {
  return (
    <Gate permissions={["org.manage", "inventory.view"]}>
      <WarehousesScreen />
    </Gate>
  );
}

function WarehousesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  // Branch names come from the session, which is the real list against a
  // backend and the fixtures in demo mode.
  const branchIndex = useMemo(
    () => new Map(availableBranches.map((branch) => [branch.id, branch])),
    [availableBranches],
  );
  const canManage = usePermission("org.manage");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Warehouse>(
    (query) => services.organisation.warehouses.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      standalone: rows.filter((row) => row.attachedBranchId === null).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Warehouse>[]>(
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
        key: "attachedTo",
        header: t("org.attachedTo"),
        render: (row) => {
          if (row.attachedBranchId === null) {
            return <Badge tone="accent">{t("org.standalone")}</Badge>;
          }
          const branch = branchIndex.get(row.attachedBranchId);
          return branch ? (
            <span className="text-sm">{tx(branch.name)}</span>
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
            {row.countryCode}
          </span>
        ),
      },
      {
        key: "active",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={row.active ? "good" : "muted"} dot>
            {row.active ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, tx],
  );

  return (
    <>
      <PageHeader
        title={t("org.warehousesTitle")}
        subtitle={t("org.warehousesSubtitle")}
        spec="BR-PLT-001"
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("nav.warehouses")} value={formatNumber(collection.total, fmt)} />
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("org.standalone")}
            value={formatNumber(totals.standalone, fmt)}
            hint={t("org.standaloneHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("org.warehousesTitle")}
          dense
        />

        <Callout tone="muted">{t("org.warehouseNote")}</Callout>
      </PageBody>
      <RecordDrawer
        open={creating}
        title={t("org.newWarehouse")}
        fields={[
          { name: "name", label: t("common.name"), required: true, maxLength: 120 },
          {
            name: "warehouseType",
            label: t("org.warehouseType"),
            kind: "select",
            required: true,
            options: [
              { value: "central", label: t("org.warehouseCentral") },
              { value: "branch", label: t("org.warehouseBranch") },
              { value: "virtual", label: t("org.warehouseVirtual") },
            ],
          },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.organisation.warehouses.create({
            name: { en: values.name.trim(), ar: values.name.trim() },
            warehouseType: values.warehouseType as "central" | "branch" | "virtual",
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("org.warehouseCreated"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}
