"use client";

/**
 * Brands — SRS §6.1, ch.17.
 *
 * A brand is a restaurant concept: its own menu, its own pricing, its own
 * identity. One tenant can run several, and two brands sharing a kitchen is
 * ordinary rather than exceptional — a ghost-kitchen operator may run six from
 * one address.
 *
 * That is why the brand, not the branch, is the level menus and price lists
 * attach to. Modelling the menu on the branch would force a six-brand kitchen
 * to maintain six copies of everything and keep them in step by hand.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Brand } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { branches } from "@/lib/console/mock/org";
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

export default function BrandsPage() {
  return (
    <Gate permissions={["org.manage", "settings.tenant.manage", "report.view.sales"]}>
      <BrandsScreen />
    </Gate>
  );
}

function BrandsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("org.manage");
  const [selected, setSelected] = useState<Brand | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Brand>(
    (query) => services.organisation.brands.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      branches: rows.reduce((sum, row) => sum + row.branchCount, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Brand>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.colour }}
            />
            <CellStack
              primary={tx(row.name)}
              secondary={<span className="font-mono">{row.code}</span>}
            />
          </div>
        ),
      },
      {
        key: "branchCount",
        header: t("org.branchCount"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.branchCount, fmt),
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
        title={t("org.brandsTitle")}
        subtitle={t("org.brandsSubtitle")}
        spec="§6.1"
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
          <MetricTile label={t("nav.brands")} value={formatNumber(collection.total, fmt)} />
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile label={t("org.branchCount")} value={formatNumber(totals.branches, fmt)} />
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
          caption={t("org.brandsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />

        <Callout tone="muted">{t("org.brandScopeNote")}</Callout>
      </PageBody>

      <BrandDrawer brand={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function BrandDrawer({ brand, onClose }: { brand: Brand | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!brand) return null;

  const brandBranches = branches.filter((branch) => branch.brandId === brand.id);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(brand.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {brand.code}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={brand.active ? "good" : "muted"} dot>
              {brand.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
          <DescRow label={t("org.branchCount")} mono>
            {formatNumber(brand.branchCount, fmt)}
          </DescRow>
          <DescRow label={t("common.code")} mono>
            <span className="inline-flex items-center gap-2" dir="ltr">
              <span
                aria-hidden
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: brand.colour }}
              />
              {brand.colour}
            </span>
          </DescRow>
        </DescList>

        {brandBranches.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("nav.branches")}</h3>
            <ul className="divide-line divide-y">
              {brandBranches.map((branch) => (
                <li key={branch.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-fg truncate text-sm">{tx(branch.name)}</p>
                    <p className="text-fg-subtle mt-0.5 font-mono text-xs" dir="ltr">
                      {branch.code}
                    </p>
                  </div>
                  {branch.isFranchise ? <Badge tone="accent">{t("org.franchise")}</Badge> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
