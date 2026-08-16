"use client";

/**
 * Recipes — SRS §7.4.4, §10.6.
 *
 * This is where the sellable world meets the physical one. A recipe is the
 * only reason a sale can move stock, and the only reason a menu item has a
 * cost at all.
 *
 * Two properties of the model drive this screen:
 *
 *   - Recipes are versioned, and a completed order keeps the version it was
 *     sold under (BR-MNU-010). Re-costing last month's sales with this week's
 *     recipe would rewrite history, so the version is shown on every row.
 *   - A recipe may be incomplete and the item still sellable (BR-MNU-012).
 *     That is a deliberate allowance, not a bug — but an incomplete recipe
 *     books zero cost, so the count of them is a headline metric rather than
 *     a footnote.
 *
 * Cost is Σ (quantity × (1 + trim loss) × unit cost) ÷ yield percentage. The
 * drawer shows each term so the total can be argued with.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Recipe, RecipeLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from "@/lib/console/format";
import { RECIPE_STATUS, RECIPE_TYPE, labelOf } from "@/lib/console/labels";
import { incompleteRecipeItems } from "@/lib/console/mock/catalogue";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
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
  Meter,
  Toast,
  cx,
} from "@/components/console/ui";

export default function MenuRecipesPage() {
  return (
    <Gate permissions={["recipe.view"]}>
      <RecipesScreen />
    </Gate>
  );
}

/** Selling price minus cost, over selling price. Null when the item is not sold. */
function marginPercent(recipe: Recipe): number | null {
  if (!recipe.sellingPrice || recipe.sellingPrice.amount === 0) return null;
  return (
    ((recipe.sellingPrice.amount - recipe.costPerPortion.amount) / recipe.sellingPrice.amount) *
    100
  );
}

function RecipesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canPublish = usePermission("recipe.publish");

  const [selected, setSelected] = useState<Recipe | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Recipe>(
    (query) => services.catalogue.recipes.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const margins = rows.map(marginPercent).filter((m): m is number => m !== null);
    return {
      incomplete: rows.filter((row) => !row.complete).length,
      drafts: rows.filter((row) => row.status === "draft").length,
      averageMargin:
        margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Recipe>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.targetName ? tx(row.targetName) : undefined}
          />
        ),
      },
      {
        key: "recipeType",
        header: t("recipes.type"),
        secondary: true,
        render: (row) => {
          const type = labelOf(RECIPE_TYPE, row.recipeType);
          return <Badge tone={type.tone}>{tx(type.label)}</Badge>;
        },
      },
      {
        key: "version",
        header: t("recipes.version"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => <span className="font-mono">v{formatNumber(row.version, fmt)}</span>,
      },
      {
        key: "yield",
        header: t("recipes.yield"),
        numeric: true,
        secondary: true,
        render: (row) => formatQuantity(row.yieldQuantity, fmt),
      },
      {
        key: "cost",
        header: t("recipes.costPerPortion"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.complete ? (
            formatMoney(row.costPerPortion, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "margin",
        header: t("recipes.marginPercent"),
        sortable: true,
        numeric: true,
        render: (row) => {
          const margin = marginPercent(row);
          if (margin === null || !row.complete) return <span className="text-fg-subtle">—</span>;
          return (
            <span
              className={cx(
                margin < 50 && "text-bad",
                margin >= 50 && margin < 65 && "text-warn",
                margin >= 65 && "text-good",
              )}
            >
              {formatPercent(margin, fmt, 1)}
            </span>
          );
        },
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(RECIPE_STATUS, row.status);
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={status.tone} dot>
                {tx(status.label)}
              </Badge>
              {!row.complete ? <Badge tone="warn">{t("recipes.incomplete")}</Badge> : null}
            </span>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("recipes.title")}
        subtitle={t("recipes.subtitle")}
        spec="FR-MNU-040"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile label={t("recipes.title")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("recipes.incomplete")}
            value={formatNumber(totals.incomplete, fmt)}
            spec="BR-MNU-012"
            footer={
              incompleteRecipeItems.length > 0 ? (
                <span>
                  {formatNumber(incompleteRecipeItems.length, fmt)}{" "}
                  {t("recipes.itemsWithout")}
                </span>
              ) : null
            }
          />
          <MetricTile
            label={tx(RECIPE_STATUS.draft?.label ?? { en: "Draft", ar: "مسودة" })}
            value={formatNumber(totals.drafts, fmt)}
          />
          <MetricTile
            label={t("recipes.marginPercent")}
            value={
              totals.averageMargin === null
                ? "—"
                : formatPercent(totals.averageMargin, fmt, 1)
            }
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(RECIPE_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "recipeType",
              label: t("recipes.type"),
              options: Object.entries(RECIPE_TYPE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "complete",
              label: t("recipes.completeness"),
              options: [
                { value: "true", label: t("recipes.complete") },
                { value: "false", label: t("recipes.incomplete") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("recipes.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <RecipeDrawer
        recipe={selected}
        canPublish={canPublish}
        onClose={() => setSelected(null)}
        onPublish={() => setMessage(t("common.notInBuild"))}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function RecipeDrawer({
  recipe,
  canPublish,
  onClose,
  onPublish,
}: {
  recipe: Recipe | null;
  canPublish: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<RecipeLine>[]>(
    () => [
      {
        key: "component",
        header: t("recipes.component"),
        render: (row) => (
          <CellStack
            primary={tx(row.componentName)}
            secondary={
              row.componentType === "sub_recipe"
                ? t("recipes.subRecipe")
                : t("recipes.stockItem")
            }
          />
        ),
      },
      {
        key: "quantity",
        header: t("common.quantity"),
        numeric: true,
        render: (row) => formatQuantity(row.quantity, fmt),
      },
      {
        key: "wastage",
        header: t("recipes.wastage"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.wastagePercentage === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatPercent(row.wastagePercentage, fmt, 0)
          ),
      },
      {
        key: "unitCost",
        header: t("common.perUnit"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.unitCost, fmt),
      },
      {
        key: "lineCost",
        header: t("recipes.lineCost"),
        numeric: true,
        render: (row) => (
          <span className={cx(row.isOptional && "text-fg-subtle")}>
            {formatMoney(row.lineCost, fmt)}
          </span>
        ),
      },
    ],
    [t, tx, fmt],
  );

  if (!recipe) return null;

  const status = labelOf(RECIPE_STATUS, recipe.status);
  const type = labelOf(RECIPE_TYPE, recipe.recipeType);
  const margin = marginPercent(recipe);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(recipe.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          v{recipe.version} · {recipe.id}
        </span>
      }
      footer={
        canPublish && recipe.status === "draft" ? (
          <Button variant="primary" onClick={onPublish}>
            {t("recipes.publish")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {!recipe.complete ? (
          <Callout tone="warn" title={t("recipes.incomplete")}>
            {t("recipes.incompleteBody")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("recipes.type")}>
            <Badge tone={type.tone}>{tx(type.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("recipes.yield")} mono>
            {formatQuantity(recipe.yieldQuantity, fmt)}
          </DescRow>
          <DescRow label={t("recipes.yieldPercent")} mono>
            {formatPercent(recipe.yieldPercentage, fmt, 0)}
          </DescRow>
          <DescRow label={t("recipes.cost")} mono>
            {formatMoney(recipe.computedCost, fmt)}
          </DescRow>
          <DescRow label={t("recipes.costPerPortion")} mono>
            {formatMoney(recipe.costPerPortion, fmt)}
          </DescRow>
          <DescRow label={t("recipes.sellingPrice")} mono>
            {recipe.sellingPrice ? formatMoney(recipe.sellingPrice, fmt) : "—"}
          </DescRow>
          <DescRow label={t("common.updated")}>
            {formatDate(recipe.effectiveFrom, fmt)}
          </DescRow>
        </DescList>

        {margin !== null ? (
          <section>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-fg-muted text-xs">{t("recipes.marginPercent")}</span>
              <span className="text-fg font-mono text-sm tabular-nums">
                {formatPercent(margin, fmt, 1)}
              </span>
            </div>
            <Meter
              value={margin}
              tone={margin < 50 ? "bad" : margin < 65 ? "warn" : "good"}
            />
          </section>
        ) : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          {recipe.lines.length > 0 ? (
            <DataTable
              columns={columns}
              rows={recipe.lines}
              rowKey={(row) => row.id}
              caption={t("recipes.components")}
              dense
            />
          ) : (
            <Callout tone="warn">{t("recipes.noComponents")}</Callout>
          )}
          <p className="text-fg-subtle mt-2 text-xs leading-relaxed">
            {t("recipes.formulaNote")}
          </p>
        </section>

        {tx(recipe.instructions) ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.instructions")}</h3>
            <p className="text-fg-muted text-sm leading-relaxed">{tx(recipe.instructions)}</p>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
