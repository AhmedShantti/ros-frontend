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
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  unitLabel,
} from "@/lib/console/format";
import { RECIPE_STATUS, RECIPE_TYPE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Meter,
  Tabs,
  Toast,
  cx,
} from "@/components/console/ui";
import { RecordDrawer } from "@/components/console/record-drawer";
import { RecipeEditor } from "@/components/console/recipe-editor";
import { useConfirm } from "@/components/console/confirm";

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
  const canEdit = usePermission("recipe.edit");

  const [selected, setSelected] = useState<Recipe | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  /**
   * BR-MNU-012 — what cannot be costed, computed by the backend rather than
   * counted off the fixtures as this tile used to be.
   */
  const completeness = useAsync(
    () => services.production.requiringCompletion(scope.branchId ?? undefined),
    [scope.branchId],
  );
  const incompleteCount =
    (completeness.data?.absentCount ?? 0) + (completeness.data?.incompleteCount ?? 0);

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
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
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
              incompleteCount > 0 ? (
                <span>
                  {formatNumber(incompleteCount, fmt)}{" "}
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
        canEdit={canEdit}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
          completeness.reload();
        }}
      />

      <RecordDrawer
        open={creating}
        title={t("recipes.newRecipe")}
        note={t("recipes.newRecipeNote")}
        fields={[
          { name: "name", label: t("common.name"), required: true, maxLength: 120 },
          {
            name: "recipeType",
            label: t("recipes.type"),
            kind: "select",
            required: true,
            options: [
              { value: "menu_item", label: t("recipes.typeMenuItem") },
              { value: "sub_recipe", label: t("recipes.typeSubRecipe") },
              { value: "production_item", label: t("recipes.typeProduction") },
            ],
          },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.catalogue.recipes.create({
            name: { en: values.name.trim(), ar: values.name.trim() },
            recipeType: values.recipeType as never,
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("recipes.created"));
          collection.reload();
        }}
      />

      <SubstituteGroups onChanged={setMessage} />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function RecipeDrawer({
  recipe,
  canPublish,
  canEdit,
  onClose,
  onChanged,
}: {
  recipe: Recipe | null;
  canPublish: boolean;
  canEdit: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const confirm = useConfirm();
  const action = useAction();
  const [tab, setTab] = useState<"components" | "versions" | "scale">("components");

  /** SRS §26.3 — version history, newest first, each with its lines. */
  const versions = useAsync(
    async () => (recipe ? services.production.versions(recipe.id) : []),
    [recipe?.id],
  );

  const draft = versions.data?.find((row) => row.status === "draft") ?? null;
  const published = versions.data?.find((row) => row.status === "published") ?? null;

  async function publish() {
    if (!recipe || !draft) return;
    const ok = await confirm({
      title: t("recipes.publishTitle"),
      body: published
        ? t("recipes.publishBody")
            .replace("{next}", `v${draft.version}`)
            .replace("{current}", `v${published.version}`)
        : t("recipes.publishFirstBody").replace("{next}", `v${draft.version}`),
      confirmLabel: t("recipes.publish"),
      tone: "warn",
    });
    if (!ok) return;

    await action.run(() => services.production.publishVersion(recipe.id, draft.version), {
      onSuccess: () => {
        versions.reload();
        onChanged(t("recipes.published"));
      },
    });
  }

  /**
   * FR-MNU-045 — a change to a published recipe opens a new draft rather
   * than editing the incumbent, because completed orders keep a reference to
   * the version they were sold under.
   */
  async function startDraft() {
    if (!recipe) return;
    await action.run(
      () =>
        services.production.createVersion(recipe.id, {
          yieldQuantity: recipe.yieldQuantity.value,
          yieldUnitId: recipe.yieldQuantity.unit,
          yieldPercentage: String(recipe.yieldPercentage),
          prepTimeSeconds: recipe.prepTimeSeconds,
          instructions: recipe.instructions,
          lines: recipe.lines.map((line, index) => ({
            sequence: index + 1,
            componentType: line.componentType,
            ...(line.componentType === "stock_item"
              ? { stockItemId: line.componentId }
              : { subRecipeId: line.componentId }),
            quantity: line.quantity.value,
            unitId: line.quantity.unit,
            wastagePercentage: String(line.wastagePercentage ?? 0),
            isOptional: line.isOptional,
          })),
        }),
      {
        onSuccess: () => {
          versions.reload();
          onChanged(t("recipes.draftCreated"));
        },
      },
    );
  }

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
        <div className="flex flex-wrap gap-2">
          {canPublish && draft ? (
            <Button variant="primary" loading={action.pending} onClick={() => void publish()}>
              {t("recipes.publish")} v{draft.version}
            </Button>
          ) : null}
          {canEdit && !draft ? (
            <Button loading={action.pending} onClick={() => void startDraft()}>
              {t("recipes.newDraft")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

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
          <DescRow label={t("recipes.cost")} mono>
            {formatMoney(recipe.computedCost, fmt)}
          </DescRow>
          <DescRow label={t("recipes.costPerPortion")} mono>
            {formatMoney(recipe.costPerPortion, fmt)}
          </DescRow>
          <DescRow label={t("recipes.sellingPrice")} mono>
            {recipe.sellingPrice ? formatMoney(recipe.sellingPrice, fmt) : "—"}
          </DescRow>
          <DescRow label={t("common.updated")}>{formatDate(recipe.effectiveFrom, fmt)}</DescRow>
        </DescList>

        {margin !== null ? (
          <section>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-fg-muted text-xs">{t("recipes.marginPercent")}</span>
              <span className="text-fg font-mono text-sm tabular-nums">
                {formatPercent(margin, fmt, 1)}
              </span>
            </div>
            <Meter value={margin} tone={margin < 50 ? "bad" : margin < 65 ? "warn" : "good"} />
          </section>
        ) : null}

        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "components" as const, label: t("recipes.components") },
            {
              value: "versions" as const,
              label: t("recipes.versions"),
              count: versions.data?.length,
            },
            { value: "scale" as const, label: t("recipes.scaleTab") },
          ]}
        />

        {tab === "components" ? (
          <AsyncPanel state={versions}>
            {() => (
              <RecipeEditor
                recipe={recipe}
                version={draft}
                canEdit={canEdit && Boolean(draft)}
                onSaved={(message) => {
                  versions.reload();
                  onChanged(message);
                }}
              />
            )}
          </AsyncPanel>
        ) : null}

        {tab === "versions" ? (
          <section>
            <p className="text-fg-subtle mb-2 text-xs leading-relaxed">
              {t("recipes.versionsNote")}
            </p>
            <AsyncPanel
              state={versions}
              isEmpty={(rows) => rows.length === 0}
              empty={<Callout tone="muted">{t("recipes.noVersions")}</Callout>}
            >
              {(rows) => (
                <ul className="border-line divide-line divide-y rounded-lg border">
                  {rows.map((version) => (
                    <li key={version.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="text-fg font-mono" dir="ltr">
                        v{version.version}
                      </span>
                      <span className="text-fg-subtle min-w-0 flex-1 truncate">
                        {version.lines.length > 0
                          ? `${formatNumber(version.lines.length, fmt)} ${t("recipes.components").toLowerCase()}`
                          : "—"}
                      </span>
                      <Badge
                        tone={
                          version.status === "published"
                            ? "good"
                            : version.status === "draft"
                              ? "warn"
                              : "muted"
                        }
                      >
                        {version.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </AsyncPanel>
          </section>
        ) : null}

        {tab === "scale" ? <RecipeScaling recipe={recipe} /> : null}

        {tx(recipe.instructions) && tab === "versions" ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.instructions")}</h3>
            <p className="text-fg-muted text-sm leading-relaxed">{tx(recipe.instructions)}</p>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

/**
 * FR-MNU-048 — the same recipe at a different output quantity.
 *
 * Batch production works backwards from "we need 40 portions", and doing that
 * arithmetic by hand across fourteen ingredients is where prep goes wrong.
 * Nothing here is saved: it is a calculator over the published recipe.
 */
function RecipeScaling({ recipe }: { recipe: Recipe }) {
  const { t, tx, fmt, locale } = useI18n();
  const [target, setTarget] = useState(recipe.yieldQuantity.value || "1");

  const base = Number(recipe.yieldQuantity.value || 0);
  const wanted = Number(target || 0);
  const factor = base > 0 && Number.isFinite(wanted) ? wanted / base : 1;

  return (
    <section className="space-y-4">
      <Callout tone="muted">{t("recipes.scaleHint")}</Callout>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("recipes.scaleTo")}>
          <div className="flex gap-1.5">
            <Input
              dir="ltr"
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="text-end font-mono tabular-nums"
              aria-label={t("recipes.scaleTo")}
            />
            <span className="border-line bg-sunken text-fg-muted flex items-center rounded-lg border px-3 text-sm">
              {unitLabel(recipe.yieldQuantity.unit, locale)}
            </span>
          </div>
        </Field>
        <Field label={t("recipes.scaleFactor")}>
          <p className="text-fg py-2 font-mono text-lg tabular-nums">
            ×{formatNumber(factor, fmt, 2)}
          </p>
        </Field>
      </div>

      {recipe.lines.length === 0 ? (
        <Callout tone="warn">{t("recipes.noComponents")}</Callout>
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {recipe.lines.map((line) => (
            <li key={line.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-fg min-w-0 flex-1 truncate text-sm">
                {tx(line.componentName)}
              </span>
              <span className="text-fg-subtle shrink-0 font-mono text-xs tabular-nums">
                {formatQuantity(line.quantity, fmt)}
              </span>
              <span className="text-fg-subtle shrink-0" aria-hidden>
                →
              </span>
              <span className="text-fg shrink-0 font-mono text-sm font-semibold tabular-nums">
                {formatQuantity(
                  {
                    value: (Number(line.quantity.value || 0) * factor).toFixed(2),
                    unit: line.quantity.unit,
                  },
                  fmt,
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-MNU-014 — interchangeable ingredients.
 *
 * A substitute group lets a recipe line say "any of these three oils" rather
 * than pinning one, so a stock-out does not make the recipe uncostable.
 */
function SubstituteGroups({ onChanged }: { onChanged: (message: string) => void }) {
  const { t, tx } = useI18n();
  const canManage = usePermission("recipe.manage");
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const groups = useAsync(() => services.production.substituteGroups(), []);
  const items = useAsync(() => services.inventory.items.list({ limit: 500 }), []);

  const itemName = (itemId: string) =>
    items.data?.rows.find((row) => row.id === itemId)?.name;

  return (
    <Section title={t("recipes.substituteGroups")}>
      <Card>
        <CardHeader
          title={t("recipes.substituteGroups")}
          hint={t("recipes.substituteGroupsNote")}
          spec="FR-MNU-014"
          action={
            canManage ? (
              <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
                {t("common.new")}
              </Button>
            ) : null
          }
        />

        <AsyncPanel
          state={groups}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="muted">{t("recipes.noSubstituteGroups")}</Callout>}
        >
          {(rows) => (
            <ul className="border-line divide-line mt-3 divide-y rounded-lg border">
              {rows.map((group) => (
                <li key={group.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-fg min-w-0 flex-1 truncate text-xs font-medium">
                      {group.name}
                    </span>
                    <Badge tone="muted">{group.memberIds.length}</Badge>
                    {canManage ? (
                      <Button variant="ghost" onClick={() => setAddingTo(group.id)}>
                        {t("common.add")}
                      </Button>
                    ) : null}
                  </div>

                  {group.memberIds.length > 0 ? (
                    <p className="text-fg-subtle mt-1 truncate text-xs">
                      {group.memberIds
                        .map((id) => {
                          const name = itemName(id);
                          return name ? tx(name) : id;
                        })
                        .join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </AsyncPanel>
      </Card>

      <RecordDrawer
        open={creating}
        title={t("recipes.newSubstituteGroup")}
        fields={[{ name: "name", label: t("common.name"), required: true, maxLength: 120 }]}
        onClose={() => setCreating(false)}
        onSubmit={(values) => services.production.createSubstituteGroup(values.name.trim())}
        onDone={() => {
          setCreating(false);
          groups.reload();
          onChanged(t("recipes.substituteGroupCreated"));
        }}
      />

      <RecordDrawer
        open={addingTo !== null}
        title={t("recipes.addSubstituteMember")}
        fields={[
          {
            name: "stockItemId",
            label: t("inv.item"),
            kind: "select",
            required: true,
            options: (items.data?.rows ?? []).map((item) => ({
              value: item.id,
              label: tx(item.name),
            })),
          },
        ]}
        submitLabel={t("common.add")}
        onClose={() => setAddingTo(null)}
        onSubmit={(values) =>
          services.production.addSubstituteMember(addingTo ?? "", values.stockItemId)
        }
        onDone={() => {
          setAddingTo(null);
          groups.reload();
          onChanged(t("recipes.substituteMemberAdded"));
        }}
      />
    </Section>
  );
}
