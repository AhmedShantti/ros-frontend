"use client";

/**
 * Recipe compliance — FR-MNU-047.
 *
 * Every branch-scoped recipe beside the brand standard it deviates from:
 * what was added, removed or re-quantified, by how much, why, and whether
 * the variant is live. The recipes and their versions are real
 * (`GET /recipes`, `GET /recipes/{id}/versions`); the stated reason is the
 * one recorded when the variant was created.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type { Recipe } from "@/lib/console/types";
import type { RecipeVersion } from "@/lib/console/services/types";
import type { VariantNote } from "@/lib/console/services/menu-recipes";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatNumber, formatPercent } from "@/lib/console/format";
import { compareRecipes, type DeviationSummary } from "@/lib/console/menu-recipe-deviation";
import { currentVersion, DeviationList } from "@/components/console/menu-recipe-panels";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, Drawer, Field, Select } from "@/components/console/ui";

export default function RecipeCompliancePage() {
  return (
    <Gate permissions={["recipe.view"]}>
      <ComplianceScreen />
    </Gate>
  );
}

interface Row {
  variant: Recipe;
  standard: Recipe | null;
  version: RecipeVersion | null;
  note: VariantNote | null;
  summary: DeviationSummary;
}

function ComplianceScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const [branchId, setBranchId] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const data = useAsync(async (): Promise<Row[]> => {
    const recipes = (await services.catalogue.recipes.list({ limit: 1000, scope })).rows;
    const variants = recipes.filter((row) => row.scope === "branch");
    return Promise.all(
      variants.map(async (variant) => {
        const branch = branches.find((entry) => entry.id === variant.branchId);
        const candidates = recipes.filter(
          (row) => row.id !== variant.id && row.recipeType === variant.recipeType && row.targetId === variant.targetId && (row.scope ?? "tenant") !== "branch",
        );
        // The brand's own standard wins over the tenant's for a branch of that brand.
        const standard =
          candidates.find((row) => row.scope === "brand" && branch && row.brandId === branch.brandId) ??
          candidates.find((row) => (row.scope ?? "tenant") === "tenant") ??
          candidates[0] ??
          null;
        const [variantVersions, standardVersions, note] = await Promise.all([
          services.production.versions(variant.id).catch(() => []),
          standard ? services.production.versions(standard.id).catch(() => []) : Promise.resolve([]),
          services.menuRecipes.variantNotes.get(variant.id),
        ]);
        const version = currentVersion(variantVersions);
        const standardVersion = currentVersion(standardVersions);
        return {
          variant,
          standard,
          version,
          note,
          summary: compareRecipes(standardVersion?.lines ?? standard?.lines ?? [], version?.lines ?? variant.lines),
        };
      }),
    );
  }, [scope.tenantId, scope.brandId, scope.branchId, branches.length]);

  const rows = useMemo(
    () => (data.data ?? []).filter((row) => !branchId || row.variant.branchId === branchId),
    [data.data, branchId],
  );

  const branchName = (id: string | null | undefined) => {
    const branch = branches.find((entry) => entry.id === id);
    return branch ? tx(branch.name) : (id ?? "—");
  };

  const columns: Column<Row>[] = [
    { key: "branch", header: t("mnp.list.branch"), render: (row) => branchName(row.variant.branchId) },
    {
      key: "recipe",
      header: t("common.name"),
      render: (row) => tx(row.variant.targetName ?? row.variant.name) || tx(row.standard?.name ?? row.variant.name) || row.variant.id,
    },
    {
      key: "standard",
      header: t("mnr.compliance.standard"),
      secondary: true,
      render: (row) => (row.standard ? <Badge tone="muted">{row.standard.scope ?? "tenant"}</Badge> : <Badge tone="bad">{t("mnr.compliance.noStandard")}</Badge>),
    },
    { key: "added", header: t("mnr.variant.kind.added"), numeric: true, render: (row) => formatNumber(row.summary.added, fmt) },
    { key: "removed", header: t("mnr.variant.kind.removed"), numeric: true, render: (row) => formatNumber(row.summary.removed, fmt) },
    { key: "changed", header: t("mnr.compliance.changed"), numeric: true, render: (row) => formatNumber(row.summary.changed, fmt) },
    {
      key: "max",
      header: t("mnr.compliance.maxChange"),
      numeric: true,
      render: (row) =>
        row.summary.maxQuantityChange === null ? "—" : formatPercent(row.summary.maxQuantityChange * 100, fmt, 0),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) =>
        row.version ? (
          <Badge tone={row.version.status === "published" ? "good" : "warn"}>
            v{row.version.version} · {row.version.status}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "reason",
      header: t("mnr.variant.reason"),
      secondary: true,
      render: (row) => (row.note?.reason ? <span className="text-xs">{row.note.reason}</span> : <Badge tone="warn">{t("mnr.variant.noReason")}</Badge>),
    },
  ];

  const deviating = rows.filter((row) => row.summary.deviations.length > 0);
  const unexplained = rows.filter((row) => row.summary.deviations.length > 0 && !row.note?.reason);

  return (
    <>
      <PageHeader
        title={t("mnr.compliance.title")}
        subtitle={t("mnr.compliance.subtitle")}
        spec="FR-MNU-047"
        actions={
          <Link href="/menu/recipes">
            <Button icon={<ArrowLeft size={14} />}>{t("recipes.title")}</Button>
          </Link>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label={t("mnp.list.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">{t("mna.allBranches")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <ExportButton
            filename="recipe-compliance"
            title={t("mnr.compliance.title")}
            rows={rows}
            columns={[
              { key: "branch", header: "branch", value: (row) => branchName(row.variant.branchId) },
              { key: "recipe", header: "recipe_id", value: (row) => row.variant.id },
              { key: "standard", header: "standard_recipe_id", value: (row) => row.standard?.id ?? "" },
              { key: "added", header: "added", value: (row) => row.summary.added },
              { key: "removed", header: "removed", value: (row) => row.summary.removed },
              { key: "changed", header: "changed", value: (row) => row.summary.changed },
              { key: "max", header: "max_quantity_change", value: (row) => row.summary.maxQuantityChange ?? "" },
              { key: "status", header: "status", value: (row) => row.version?.status ?? "" },
              { key: "reason", header: "reason", value: (row) => row.note?.reason ?? "" },
              {
                key: "detail",
                header: "deviations",
                value: (row) =>
                  row.summary.deviations
                    .map((d) => `${tx(d.componentName) || d.componentId}: ${d.kinds.join("+")}`)
                    .join("; "),
              },
            ]}
          />
        </div>

        <AsyncPanel state={data}>
          {() => (
            <>
              <TileGrid columns={3}>
                <MetricTile label={t("mnr.compliance.variants")} value={formatNumber(rows.length, fmt)} spec="FR-MNU-047" />
                <MetricTile label={t("mnr.compliance.deviating")} value={formatNumber(deviating.length, fmt)} />
                <MetricTile label={t("mnr.compliance.unexplained")} value={formatNumber(unexplained.length, fmt)} />
              </TileGrid>
              {rows.length === 0 ? (
                <Callout tone="muted">{t("mnr.compliance.empty")}</Callout>
              ) : (
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.variant.id}
                  caption={t("mnr.compliance.title")}
                  onRowClick={setSelected}
                  dense
                />
              )}
            </>
          )}
        </AsyncPanel>
      </PageBody>

      {selected ? (
        <Drawer
          open
          onClose={() => setSelected(null)}
          title={branchName(selected.variant.branchId)}
          subtitle={tx(selected.variant.targetName ?? selected.variant.name)}
        >
          <div className="space-y-4">
            <Callout tone={selected.note?.reason ? "muted" : "warn"} title={t("mnr.variant.reason")}>
              {selected.note?.reason ?? t("mnr.variant.noReason")}
            </Callout>
            <DeviationList summary={selected.summary} />
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
