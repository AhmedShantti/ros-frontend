"use client";

/**
 * Franchisor compliance visibility — FR-BRN-037.
 *
 * Per franchised branch: menu deviation, price deviation and recipe deviation
 * against its brand's standard (the same arithmetic as the deviation report,
 * `components/console/branch-deviation-data.tsx`), plus purchase orders
 * delivered to the branch from suppliers outside the agreement's mandated
 * list. Each finding class contributes to a score; the drawer lists every
 * finding behind it.
 */

import { useMemo, useState } from "react";

import type { Id, PurchaseOrder, Warehouse } from "@/lib/console/types";
import { agreementInForce, complianceScore, type ComplianceRow, type FranchiseAgreement, type OffListPurchase } from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { DataTable, type Column } from "@/components/console/data-table";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { deviationsFor, useDeviationInputs } from "@/components/console/branch-deviation-data";
import { todayIso } from "@/components/console/franchise-lock";
import { Badge, Callout, Drawer, Meter } from "@/components/console/ui";

type Row = ComplianceRow & { agreement: FranchiseAgreement };

function offListPurchases(agreement: FranchiseAgreement, orders: PurchaseOrder[], warehouses: Warehouse[]): OffListPurchase[] {
  if (agreement.mandatedSupplierIds.length === 0) return [];
  const locations = new Set<Id>([agreement.branchId, ...warehouses.filter((w) => w.attachedBranchId === agreement.branchId).map((w) => w.id)]);
  return orders
    .filter((order) => locations.has(order.deliveryLocationId) && order.status !== "cancelled" && !agreement.mandatedSupplierIds.includes(order.supplierId))
    .filter((order) => order.createdAt.slice(0, 10) >= agreement.startsOn)
    .map((order) => ({ purchaseOrderId: order.id, reference: order.reference, supplierName: order.supplierName, total: order.total, createdAt: order.createdAt }));
}

export function FranchiseComplianceTab({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const [selected, setSelected] = useState<Row | null>(null);
  const inputs = useDeviationInputs();
  const purchasing = useAsync(async () => {
    const [orders, warehouses] = await Promise.all([
      services.purchasing.orders.list({ limit: 1000 }).then((page) => page.rows),
      services.organisation.warehouses.list({ limit: 500 }).then((page) => page.rows).catch(() => [] as Warehouse[]),
    ]);
    return { orders, warehouses };
  }, []);

  const branchName = (id: Id) => {
    const branch = availableBranches.find((b) => b.id === id);
    return branch ? tx(branch.name) : id;
  };

  const rows = useMemo<Row[]>(() => {
    if (!inputs.data || !purchasing.data) return [];
    const active = inputs.data.agreements.filter((row) => agreementInForce(row, todayIso()));
    const branches = availableBranches.filter((branch) => active.some((row) => row.branchId === branch.id));
    const deviations = deviationsFor(branches, inputs.data);
    return deviations.map((deviation) => {
      const agreement = active.find((row) => row.branchId === deviation.branch.id)!;
      const base = {
        branchId: deviation.branch.id,
        menu: deviation.menu,
        prices: deviation.prices,
        recipes: deviation.recipes,
        offListPurchases: offListPurchases(agreement, purchasing.data!.orders, purchasing.data!.warehouses),
      };
      return { ...base, ...complianceScore(base), agreement };
    });
  }, [inputs.data, purchasing.data, availableBranches]);

  const noStandard = inputs.data
    ? rows.filter((row) => {
        const branch = availableBranches.find((b) => b.id === row.branchId);
        return !inputs.data!.standards.some((standard) => standard.brandId === branch?.brandId);
      })
    : [];

  const count = (row: Row) => ({
    menu: (row.menu?.missing.length ?? 0) + (row.menu?.extra.length ?? 0),
    price: row.prices.filter((p) => p.beyondTolerance).length,
    recipe: row.recipes.filter((r) => r.override.status !== "approved").length,
    supplier: row.offListPurchases.length,
  });

  const columns: Column<Row>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => `${branchName(row.branchId)} · ${row.agreement.franchiseeName}` },
    {
      key: "score",
      header: t("frn.score"),
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="w-10 font-mono tabular-nums">{formatNumber(row.score, fmt)}</span>
          <span className="w-24">
            <Meter value={row.score} tone={row.score >= 90 ? "good" : row.score >= 70 ? "warn" : "bad"} />
          </span>
        </span>
      ),
    },
    { key: "menu", header: t("frn.menuDeviation"), numeric: true, render: (row) => formatNumber(count(row).menu, fmt) },
    { key: "price", header: t("frn.priceDeviation"), numeric: true, render: (row) => formatNumber(count(row).price, fmt) },
    { key: "recipe", header: t("frn.recipeDeviation"), numeric: true, render: (row) => formatNumber(count(row).recipe, fmt) },
    {
      key: "supplier",
      header: t("frn.offListPurchases"),
      numeric: true,
      render: (row) =>
        row.agreement.mandatedSupplierIds.length === 0 ? <Badge tone="muted">{t("frn.noMandate")}</Badge> : formatNumber(count(row).supplier, fmt),
    },
  ];

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("frn.complianceNote")}</Callout>
      {noStandard.length > 0 ? (
        <Callout tone="warn">{t("frn.complianceNoStandard").replace("{branches}", noStandard.map((row) => branchName(row.branchId)).join(", "))}</Callout>
      ) : null}
      <AsyncPanel state={inputs}>
        {() => (
          <AsyncPanel state={purchasing}>
            {() => (
              <>
                <div className="flex justify-end">
                  <ExportButton
                    filename="franchise-compliance"
                    title={t("frn.tab.compliance")}
                    rows={rows}
                    onExported={notify}
                    columns={[
                      { key: "branch", header: t("common.branch"), value: (row) => branchName(row.branchId) },
                      { key: "franchisee", header: t("frn.franchisee"), value: (row) => row.agreement.franchiseeName },
                      { key: "score", header: t("frn.score"), value: (row) => row.score },
                      { key: "menu", header: t("frn.menuDeviation"), value: (row) => count(row).menu },
                      { key: "price", header: t("frn.priceDeviation"), value: (row) => count(row).price },
                      { key: "recipe", header: t("frn.recipeDeviation"), value: (row) => count(row).recipe },
                      { key: "supplier", header: t("frn.offListPurchases"), value: (row) => count(row).supplier },
                    ]}
                  />
                </div>
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.branchId}
                  caption={t("frn.tab.compliance")}
                  onRowClick={setSelected}
                  activeRowKey={selected?.branchId ?? null}
                  emptyTitle={t("frn.noAgreementsInForce")}
                  dense
                />
              </>
            )}
          </AsyncPanel>
        )}
      </AsyncPanel>

      {selected ? (
        <Drawer open onClose={() => setSelected(null)} title={branchName(selected.branchId)} subtitle={`${selected.agreement.franchiseeName} · ${t("frn.score")} ${selected.score}`}>
          <div className="space-y-5">
            <FindingSection title={t("frn.menuDeviation")} empty={t("frn.none")}>
              {[
                ...(selected.menu?.missing ?? []).map((menu) => (
                  <li key={`m-${menu.id}`}>
                    <Badge tone="bad">{t("bdev.menuMissing")}</Badge> {tx(menu.name)}
                  </li>
                )),
                ...(selected.menu?.extra ?? []).map((menu) => (
                  <li key={`e-${menu.id}`}>
                    <Badge tone="warn">{t("bdev.menuExtra")}</Badge> {tx(menu.name)}
                  </li>
                )),
              ]}
            </FindingSection>
            <FindingSection title={t("frn.priceDeviation")} empty={t("frn.none")}>
              {selected.prices.map((price) => (
                <li key={`${price.priceListId}-${price.variantId}`} className="flex flex-wrap items-center gap-2">
                  {tx(price.itemName)}
                  <span className="font-mono text-xs">
                    {formatMoney(price.standard, fmt)} → {formatMoney(price.branch, fmt)} ({formatPercent(price.percent, fmt)})
                  </span>
                  {price.beyondTolerance ? <Badge tone="bad">{t("bdev.beyondTolerance")}</Badge> : <Badge tone="muted">{t("bdev.withinTolerance")}</Badge>}
                </li>
              ))}
            </FindingSection>
            <FindingSection title={t("frn.recipeDeviation")} empty={t("frn.none")}>
              {selected.recipes.map((recipe) => (
                <li key={recipe.override.id} className="flex flex-wrap items-center gap-2">
                  {tx(recipe.override.recipeName)} · {recipe.changedLines}
                  <Badge tone={recipe.override.status === "approved" ? "good" : "warn"}>{t(`bdev.override.${recipe.override.status}` as never)}</Badge>
                  {recipe.stale ? <Badge tone="bad">{t("bdev.stale")}</Badge> : null}
                </li>
              ))}
            </FindingSection>
            <FindingSection title={t("frn.offListPurchases")} empty={selected.agreement.mandatedSupplierIds.length === 0 ? t("frn.noMandate") : t("frn.none")}>
              {selected.offListPurchases.map((purchase) => (
                <li key={purchase.purchaseOrderId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{purchase.reference}</span>
                  {tx(purchase.supplierName)}
                  <span className="font-mono text-xs">{formatMoney(purchase.total, fmt)}</span>
                  <span className="text-fg-subtle text-xs">{formatDate(purchase.createdAt, fmt)}</span>
                </li>
              ))}
            </FindingSection>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

function FindingSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{title}</h3>
      {children.length === 0 ? <p className="text-fg-muted text-sm">{empty}</p> : <ul className="space-y-1.5 text-sm">{children}</ul>}
    </section>
  );
}
