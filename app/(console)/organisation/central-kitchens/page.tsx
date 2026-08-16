"use client";

/**
 * Central kitchens — SRS §17.5.
 *
 * A central kitchen consumes input stock and produces output stock. That makes
 * it the one location where a *stock item* is manufactured rather than bought,
 * and it is why production recipes exist as a separate recipe type: the output
 * of a production run is an inventory item with its own cost, not a dish.
 *
 * The cost has to carry through. Sauce made centrally and distributed to eight
 * branches must arrive costed at what it took to make — ingredients plus
 * production labour and yield loss — otherwise every receiving branch
 * understates its food cost and the central facility absorbs a loss that
 * belongs on the plate.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { CentralKitchen } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
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
} from "@/components/console/ui";

export default function CentralKitchensPage() {
  return (
    <Gate permissions={["org.manage", "inventory.view"]}>
      <CentralKitchensScreen />
    </Gate>
  );
}

function CentralKitchensScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("org.manage");
  const [selected, setSelected] = useState<CentralKitchen | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<CentralKitchen>(
    (query) => services.organisation.centralKitchens.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      // A branch can be served by more than one facility, so this is a set.
      served: new Set(rows.flatMap((row) => row.servesBranchIds)).size,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<CentralKitchen>[]>(
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
        key: "serves",
        header: t("org.serves"),
        numeric: true,
        render: (row) => formatNumber(row.servesBranchIds.length, fmt),
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
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("org.kitchensTitle")}
        subtitle={t("org.kitchensSubtitle")}
        spec="FR-BRN-030"
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
          <MetricTile
            label={t("nav.centralKitchens")}
            value={formatNumber(collection.total, fmt)}
          />
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("org.branchesServed")}
            value={formatNumber(totals.served, fmt)}
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
          caption={t("org.kitchensTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />

        <Callout tone="muted">{t("org.productionCostNote")}</Callout>
      </PageBody>

      <KitchenDrawer kitchen={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function KitchenDrawer({
  kitchen,
  onClose,
}: {
  kitchen: CentralKitchen | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!kitchen) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(kitchen.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {kitchen.code}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={kitchen.active ? "good" : "muted"} dot>
              {kitchen.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
          <DescRow label={t("org.country")} mono>
            <span dir="ltr">{kitchen.countryCode}</span>
          </DescRow>
          <DescRow label={t("org.serves")} mono>
            {formatNumber(kitchen.servesBranchIds.length, fmt)}
          </DescRow>
        </DescList>

        {kitchen.servesBranchIds.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("org.serves")}</h3>
            <ul className="divide-line divide-y">
              {kitchen.servesBranchIds.map((branchId) => {
                const branch = branchById.get(branchId);
                return (
                  <li key={branchId} className="py-2.5">
                    <p className="text-fg text-sm">{branch ? tx(branch.name) : branchId}</p>
                    {branch ? (
                      <p className="text-fg-subtle mt-0.5 font-mono text-xs" dir="ltr">
                        {branch.code}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Callout tone="muted">{t("org.productionCostNote")}</Callout>
      </div>
    </Drawer>
  );
}
