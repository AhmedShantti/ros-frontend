"use client";

/**
 * The bill-of-materials editor — FR-MNU-040 … FR-MNU-046.
 *
 * A recipe is the only reason a sale can move stock and the only reason a
 * menu item has a cost at all, so this is where the sellable world is
 * actually joined to the physical one. Reading a recipe was never the hard
 * part; *composing* one is.
 *
 * Four things this screen has to get right, and why:
 *
 *   - **Only drafts are editable.** A published version is what completed
 *     orders reference (BR-MNU-010); editing it in place would restate last
 *     month's food cost. So the editor works on a draft and publishing is a
 *     separate, deliberate act.
 *   - **Trim loss and yield are first-class inputs**, not advanced options.
 *     A kilogram of purchased potatoes does not produce a kilogram of chips.
 *     A costing system that ignores that understates food cost by 15–25% on
 *     every fresh item, which makes the whole report worthless — so both
 *     terms sit in the line table and the total shows its working.
 *   - **Cycles are refused with the path shown.** "Circular reference" tells
 *     you nothing; "Sauce → Base → Sauce" tells you exactly which line to
 *     delete (FR-MNU-042).
 *   - **Incomplete is allowed.** BR-MNU-012 is explicit that an item may be
 *     sold with a partial recipe. The editor nags; it never blocks.
 *
 * The cost arithmetic below mirrors what the server computes so the figure
 * moves as you type. The server remains the authority — this is a preview,
 * and it is labelled as one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react";

import type { Id, Localised, Quantity, Recipe, StockItem, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { RecipeLineInput, RecipeVersion, SubstituteGroup } from "@/lib/console/services/types";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatPercent, money } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import {
  LocalisedField,
  PercentInput,
  QuantityInput,
  SearchSelect,
  type SearchOption,
} from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Field,
  Input,
  Select,
  Toggle,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// The editable shape
// ---------------------------------------------------------------------------

export interface DraftLine {
  /** Local key. A saved line keeps the server's id; a new one gets a temp. */
  key: string;
  componentType: "stock_item" | "sub_recipe";
  componentId: Id | null;
  componentName: Localised;
  quantity: Quantity;
  wastagePercentage: string;
  isOptional: boolean;
  substituteGroupId: Id | null;
  /** Latest known unit cost, for the running total. */
  unitCost: number;
  currency: string;
}

export interface DraftRecipe {
  yieldQuantity: Quantity;
  yieldPercentage: string;
  prepTimeMinutes: string;
  instructions: Localised;
  lines: DraftLine[];
}

let seq = 0;
const tempKey = () => `new_${(seq += 1)}`;

function toDraftLine(line: Recipe["lines"][number]): DraftLine {
  return {
    key: line.id,
    componentType: line.componentType,
    componentId: line.componentId,
    componentName: line.componentName,
    quantity: line.quantity,
    wastagePercentage: String(line.wastagePercentage ?? 0),
    isOptional: line.isOptional,
    substituteGroupId: null,
    unitCost: line.unitCost.amount,
    currency: line.unitCost.currency,
  };
}

export function draftFromRecipe(recipe: Recipe): DraftRecipe {
  return {
    yieldQuantity: recipe.yieldQuantity,
    yieldPercentage: String(recipe.yieldPercentage ?? 100),
    prepTimeMinutes: String(Math.round((recipe.prepTimeSeconds ?? 0) / 60)),
    instructions: recipe.instructions ?? { en: "", ar: "" },
    lines: recipe.lines.map(toDraftLine),
  };
}

// ---------------------------------------------------------------------------
// Costing preview — FR-MNU-043, FR-MNU-044, FR-MNU-046
// ---------------------------------------------------------------------------

/**
 * Σ (quantity × (1 + trim loss) × unit cost) ÷ yield percentage.
 *
 * Optional lines are counted, because "optional" describes whether the
 * component may be missing at prep time, not whether it is free.
 */
export function lineCostOf(line: DraftLine): number {
  const quantity = Number(line.quantity.value || 0);
  const trim = Number(line.wastagePercentage || 0) / 100;
  if (!Number.isFinite(quantity) || !Number.isFinite(trim)) return 0;
  return quantity * (1 + trim) * line.unitCost;
}

export function recipeCostOf(draft: DraftRecipe): number {
  const gross = draft.lines.reduce((sum, line) => sum + lineCostOf(line), 0);
  const yieldPercent = Number(draft.yieldPercentage || 100);
  if (!Number.isFinite(yieldPercent) || yieldPercent <= 0) return gross;
  return gross / (yieldPercent / 100);
}

// ---------------------------------------------------------------------------
// Cycle detection — FR-MNU-042
// ---------------------------------------------------------------------------

/**
 * Walk the sub-recipe graph and return the offending path, if any.
 *
 * Depth-first with the current stack carried along, so what comes back is
 * the actual cycle ("Garlic sauce → Aioli base → Garlic sauce") rather than
 * the bare fact that one exists.
 */
export function findCycle(
  rootId: Id,
  rootName: string,
  draftLines: DraftLine[],
  recipesById: Map<Id, Recipe>,
): string[] | null {
  const stack: string[] = [rootName];

  function walk(componentId: Id, seen: Set<Id>): string[] | null {
    if (componentId === rootId) return [...stack, rootName];
    if (seen.has(componentId)) return null;
    seen.add(componentId);

    const child = recipesById.get(componentId);
    if (!child) return null;

    for (const line of child.lines) {
      if (line.componentType !== "sub_recipe") continue;
      stack.push(child.name.en || child.name.ar);
      const cycle = walk(line.componentId, seen);
      if (cycle) return cycle;
      stack.pop();
    }
    return null;
  }

  for (const line of draftLines) {
    if (line.componentType !== "sub_recipe" || !line.componentId) continue;
    const found = walk(line.componentId, new Set());
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

export function RecipeEditor({
  recipe,
  version,
  canEdit,
  onSaved,
}: {
  recipe: Recipe;
  /** The draft being edited. A published version is read-only. */
  version: RecipeVersion | null;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const confirm = useConfirm();
  const action = useAction();

  const [draft, setDraft] = useState<DraftRecipe>(() => draftFromRecipe(recipe));
  const [dirty, setDirty] = useState(false);

  // Re-seed when a different recipe or version is opened.
  useEffect(() => {
    setDraft(draftFromRecipe(recipe));
    setDirty(false);
  }, [recipe.id, recipe.version, version?.id]);

  const stock = useAsync(
    () => services.inventory.items.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  const recipeList = useAsync(
    () => services.catalogue.recipes.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  const groups = useAsync<SubstituteGroup[]>(
    () => services.production.substituteGroups().catch(() => []),
    [],
  );

  const stockById = useMemo(() => {
    const map = new Map<Id, StockItem>();
    for (const item of stock.data ?? []) map.set(item.id, item);
    return map;
  }, [stock.data]);

  const recipesById = useMemo(() => {
    const map = new Map<Id, Recipe>();
    for (const row of recipeList.data ?? []) map.set(row.id, row);
    return map;
  }, [recipeList.data]);

  const stockOptions = useMemo<SearchOption[]>(
    () =>
      (stock.data ?? []).map((item) => ({
        value: item.id,
        label: tx(item.name),
        hint: `${item.sku} · ${tx(item.category)}`,
      })),
    [stock.data, tx],
  );

  const subRecipeOptions = useMemo<SearchOption[]>(
    () =>
      (recipeList.data ?? [])
        .filter((row) => row.id !== recipe.id && row.recipeType !== "menu_item")
        .map((row) => ({
          value: row.id,
          label: tx(row.name),
          hint: t(`recipes.type${row.recipeType === "sub_recipe" ? "SubRecipe" : "Production"}` as never),
        })),
    [recipeList.data, recipe.id, tx, t],
  );

  const patch = useCallback((part: Partial<DraftRecipe>) => {
    setDraft((current) => ({ ...current, ...part }));
    setDirty(true);
  }, []);

  const patchLine = useCallback((key: string, part: Partial<DraftLine>) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...part } : line)),
    }));
    setDirty(true);
  }, []);

  function addLine(componentType: DraftLine["componentType"]) {
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: tempKey(),
          componentType,
          componentId: null,
          componentName: { en: "", ar: "" },
          quantity: { value: "", unit: "g" as UnitCode },
          wastagePercentage: "0",
          isOptional: false,
          substituteGroupId: null,
          unitCost: 0,
          currency: recipe.computedCost.currency,
        },
      ],
    }));
    setDirty(true);
  }

  async function removeLine(key: string) {
    const line = draft.lines.find((row) => row.key === key);
    const ok = await confirm({
      title: t("recipes.removeLine"),
      body: t("recipes.removeLineBody").replace(
        "{name}",
        line ? tx(line.componentName) || t("recipes.unnamedComponent") : "",
      ),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setDraft((current) => ({ ...current, lines: current.lines.filter((row) => row.key !== key) }));
    setDirty(true);
  }

  function duplicateLine(key: string) {
    setDraft((current) => {
      const source = current.lines.find((row) => row.key === key);
      if (!source) return current;
      const index = current.lines.findIndex((row) => row.key === key);
      const copy = { ...source, key: tempKey() };
      const lines = [...current.lines];
      lines.splice(index + 1, 0, copy);
      return { ...current, lines };
    });
    setDirty(true);
  }

  // -- Validation ------------------------------------------------------------

  const cycle = useMemo(
    () => findCycle(recipe.id, tx(recipe.name), draft.lines, recipesById),
    [recipe.id, recipe.name, draft.lines, recipesById, tx],
  );

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const line of draft.lines) {
      if (!line.componentId) continue;
      seen.set(line.componentId, (seen.get(line.componentId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id));
  }, [draft.lines]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (cycle) list.push(t("recipes.cycleDetected").replace("{path}", cycle.join(" → ")));
    if (draft.lines.some((line) => !line.componentId)) list.push(t("recipes.lineNoComponent"));
    if (draft.lines.some((line) => !line.quantity.value || Number(line.quantity.value) <= 0)) {
      list.push(t("recipes.lineNoQuantity"));
    }
    const yieldPercent = Number(draft.yieldPercentage);
    if (!Number.isFinite(yieldPercent) || yieldPercent <= 0 || yieldPercent > 100) {
      list.push(t("recipes.yieldRange"));
    }
    if (!draft.yieldQuantity.value || Number(draft.yieldQuantity.value) <= 0) {
      list.push(t("recipes.yieldQuantityRequired"));
    }
    return list;
  }, [cycle, draft, t]);

  const blocked = problems.length > 0;
  const cost = recipeCostOf(draft);
  const currency = recipe.computedCost.currency;

  // -- Save ------------------------------------------------------------------

  async function save() {
    if (blocked || !canEdit) return;

    const lines: RecipeLineInput[] = draft.lines.map((line, index) => ({
      sequence: index + 1,
      componentType: line.componentType,
      ...(line.componentType === "stock_item"
        ? { stockItemId: line.componentId! }
        : { subRecipeId: line.componentId! }),
      ...(line.substituteGroupId ? { substituteGroupId: line.substituteGroupId } : {}),
      quantity: line.quantity.value,
      unitId: line.quantity.unit,
      wastagePercentage: line.wastagePercentage || "0",
      isOptional: line.isOptional,
    }));

    await action.run(
      async () => {
        if (version && version.status === "draft") {
          await services.production.replaceLines(recipe.id, version.version, lines);
          return;
        }
        // No draft yet: publishing a change means opening one first. Doing it
        // here rather than making the user find a separate "new version"
        // button is the difference between an editor and a puzzle.
        await services.production.createVersion(recipe.id, {
          yieldQuantity: draft.yieldQuantity.value,
          yieldUnitId: draft.yieldQuantity.unit,
          yieldPercentage: draft.yieldPercentage,
          prepTimeSeconds: Math.round(Number(draft.prepTimeMinutes || 0) * 60),
          instructions: draft.instructions,
          lines,
        });
      },
      {
        onSuccess: () => {
          setDirty(false);
          onSaved(t("recipes.draftSaved"));
        },
      },
    );
  }

  const readOnly = !canEdit || (version !== null && version.status !== "draft");

  return (
    <div className="space-y-5">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {readOnly ? (
        <Callout tone="muted" title={t("recipes.readOnlyTitle")}>
          {canEdit ? t("recipes.readOnlyPublished") : t("recipes.readOnlyPermission")}
        </Callout>
      ) : null}

      {cycle ? (
        <Callout tone="bad" icon={<AlertTriangle size={14} />} title={t("recipes.cycleTitle")}>
          <span dir="ltr" className="font-mono text-[0.7rem]">
            {cycle.join(" → ")}
          </span>
        </Callout>
      ) : null}

      {/* -- Yield ---------------------------------------------------------- */}
      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.yieldSection")}</h3>
        <p className="text-fg-subtle mb-3 text-xs leading-relaxed">{t("recipes.yieldNote")}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("recipes.yieldQuantity")} required>
            <QuantityInput
              value={draft.yieldQuantity}
              disabled={readOnly}
              onChange={(yieldQuantity) => patch({ yieldQuantity })}
              aria-label={t("recipes.yieldQuantity")}
            />
          </Field>
          <Field label={t("recipes.yieldPercent")} hint={t("recipes.yieldPercentHint")} required>
            <PercentInput
              value={draft.yieldPercentage}
              disabled={readOnly}
              onChange={(yieldPercentage) => patch({ yieldPercentage })}
              aria-label={t("recipes.yieldPercent")}
            />
          </Field>
          <Field label={t("recipes.prepTime")} hint={t("recipes.prepTimeHint")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              disabled={readOnly}
              value={draft.prepTimeMinutes}
              onChange={(event) => patch({ prepTimeMinutes: event.target.value })}
              className="text-end font-mono tabular-nums"
            />
          </Field>
        </div>
      </section>

      {/* -- Components ----------------------------------------------------- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-fg text-sm font-semibold">{t("recipes.components")}</h3>
          {!readOnly ? (
            <div className="flex gap-1.5">
              <Button size="sm" icon={<Plus size={12} />} onClick={() => addLine("stock_item")}>
                {t("recipes.addStockItem")}
              </Button>
              <Button size="sm" icon={<Plus size={12} />} onClick={() => addLine("sub_recipe")}>
                {t("recipes.addSubRecipe")}
              </Button>
            </div>
          ) : null}
        </div>

        {draft.lines.length === 0 ? (
          <div className="border-line rounded-xl border border-dashed px-6 py-10 text-center">
            <p className="text-fg text-sm font-medium">{t("recipes.noComponents")}</p>
            <p className="text-fg-muted mx-auto mt-1 max-w-sm text-xs leading-relaxed">
              {t("recipes.noComponentsHint")}
            </p>
            {!readOnly ? (
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" icon={<Plus size={12} />} onClick={() => addLine("stock_item")}>
                  {t("recipes.addStockItem")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {draft.lines.map((line, index) => {
              const options =
                line.componentType === "stock_item" ? stockOptions : subRecipeOptions;
              const isDuplicate = line.componentId ? duplicates.has(line.componentId) : false;

              return (
                <li
                  key={line.key}
                  className={cx(
                    "border-line rounded-lg border p-3",
                    isDuplicate && "border-warn/60 bg-warn-soft/30",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-fg-subtle mt-2.5 w-5 shrink-0 text-center font-mono text-xs tabular-nums">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                        <Field
                          label={
                            line.componentType === "stock_item"
                              ? t("recipes.stockItem")
                              : t("recipes.subRecipe")
                          }
                          required
                          error={isDuplicate ? t("recipes.duplicateComponent") : undefined}
                        >
                          <SearchSelect
                            options={options}
                            value={line.componentId}
                            disabled={readOnly}
                            aria-label={t("recipes.component")}
                            placeholder={t("recipes.chooseComponent")}
                            onChange={(componentId) => {
                              if (!componentId) {
                                patchLine(line.key, { componentId: null });
                                return;
                              }
                              if (line.componentType === "stock_item") {
                                const item = stockById.get(componentId);
                                patchLine(line.key, {
                                  componentId,
                                  componentName: item?.name ?? { en: "", ar: "" },
                                  unitCost: item?.unitCost?.amount ?? 0,
                                  quantity: {
                                    ...line.quantity,
                                    unit: item?.baseUnit ?? line.quantity.unit,
                                  },
                                });
                              } else {
                                const sub = recipesById.get(componentId);
                                patchLine(line.key, {
                                  componentId,
                                  componentName: sub?.name ?? { en: "", ar: "" },
                                  unitCost: sub?.costPerPortion?.amount ?? 0,
                                  quantity: {
                                    ...line.quantity,
                                    unit: sub?.yieldQuantity?.unit ?? line.quantity.unit,
                                  },
                                });
                              }
                            }}
                          />
                        </Field>

                        <Field label={t("common.quantity")} required>
                          <QuantityInput
                            value={line.quantity}
                            disabled={readOnly}
                            onChange={(quantity) => patchLine(line.key, { quantity })}
                            aria-label={t("common.quantity")}
                          />
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label={t("recipes.wastage")} hint={t("recipes.wastageHint")}>
                          <PercentInput
                            value={line.wastagePercentage}
                            disabled={readOnly}
                            onChange={(wastagePercentage) =>
                              patchLine(line.key, { wastagePercentage })
                            }
                            aria-label={t("recipes.wastage")}
                          />
                        </Field>

                        <Field
                          label={t("recipes.substituteGroup")}
                          hint={t("recipes.substituteGroupHint")}
                        >
                          <Select
                            disabled={readOnly}
                            value={line.substituteGroupId ?? ""}
                            onChange={(event) =>
                              patchLine(line.key, {
                                substituteGroupId: event.target.value || null,
                              })
                            }
                          >
                            <option value="">{t("common.none")}</option>
                            {(groups.data ?? []).map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </Select>
                        </Field>

                        <div className="flex items-end">
                          <div className="w-full">
                            <span className="text-fg-muted text-xs">{t("recipes.lineCost")}</span>
                            <p className="text-fg mt-1.5 font-mono text-sm tabular-nums">
                              {formatMoney(money(Math.round(lineCostOf(line)), currency), fmt)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <Toggle
                        checked={line.isOptional}
                        disabled={readOnly}
                        onChange={(isOptional) => patchLine(line.key, { isOptional })}
                        label={t("recipes.optionalLine")}
                        hint={t("recipes.optionalLineHint")}
                      />
                    </div>

                    {!readOnly ? (
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("common.duplicate")}
                          icon={<Copy size={13} />}
                          onClick={() => duplicateLine(line.key)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("common.delete")}
                          icon={<Trash2 size={13} />}
                          onClick={() => void removeLine(line.key)}
                        />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* -- Cost ----------------------------------------------------------- */}
      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.costSection")}</h3>
        <DescList>
          <DescRow label={t("recipes.componentsCost")} mono>
            {formatMoney(
              money(
                Math.round(draft.lines.reduce((sum, line) => sum + lineCostOf(line), 0)),
                currency,
              ),
              fmt,
            )}
          </DescRow>
          <DescRow label={t("recipes.yieldPercent")} mono>
            {formatPercent(Number(draft.yieldPercentage || 100), fmt, 0)}
          </DescRow>
          <DescRow label={<span className="text-fg font-semibold">{t("recipes.cost")}</span>} mono>
            <span className="text-fg font-semibold">
              {formatMoney(money(Math.round(cost), currency), fmt)}
            </span>
          </DescRow>
        </DescList>
        <p className="text-fg-subtle mt-2 text-xs leading-relaxed">{t("recipes.previewNote")}</p>
      </section>

      {/* -- Instructions --------------------------------------------------- */}
      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.instructions")}</h3>
        <LocalisedField
          label={t("recipes.instructions")}
          hint={t("recipes.instructionsHint")}
          multiline
          value={draft.instructions}
          onChange={(instructions) => patch({ instructions })}
        />
      </section>

      {/* -- Save ----------------------------------------------------------- */}
      {!readOnly ? (
        <div className="border-line sticky bottom-0 -mx-5 border-t px-5 py-3 backdrop-blur">
          {problems.length > 0 ? (
            <ul className="text-bad mb-2 space-y-0.5 text-xs">
              {problems.map((problem) => (
                <li key={problem}>• {problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={blocked || !dirty}
              loading={action.pending}
              onClick={() => void save()}
            >
              {t("recipes.saveDraft")}
            </Button>
            {dirty ? <Badge tone="warn">{t("common.unsavedChanges")}</Badge> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
