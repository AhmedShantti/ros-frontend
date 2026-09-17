"use client";

/**
 * Recipe panels beyond the bill of materials — FR-MNU-047, FR-MNU-049, FR-MNU-050.
 *
 *  - **Branch variants** (FR-MNU-047). A branch may hold its own version of
 *    the brand recipe — a different oil because the local supplier has no
 *    other, a smaller portion for a kiosk. The variant is a real
 *    branch-scoped recipe (`POST /recipes`, `scope: branch`) seeded from the
 *    standard's lines; the deviation is computed component by component and
 *    shown beside it, and the reason, which the API has no field for, is
 *    kept in `services.menuRecipes`.
 *  - **Prep card** (FR-MNU-049). Localised instructions and reference photos,
 *    in the large, glanceable layout a line cook reads from the pass. Both
 *    are stored on the recipe version (`instructions`, `referenceImages`),
 *    which is why they are authored when a draft is opened.
 *  - **Nutrition** (FR-MNU-050). Per portion, from per-ingredient data, with
 *    every gap named and the "not certified" notice always visible.
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Maximize2, Plus, Trash2 } from "lucide-react";

import type { Id, Localised, Recipe, RecipeLine, UnitCode } from "@/lib/console/types";
import type { RecipeLineInput, RecipeReferenceImage, RecipeVersion } from "@/lib/console/services/types";
import { NUTRIENTS, emptyNutrients, type Nutrient, type NutritionFacts } from "@/lib/console/services/menu-recipes";
import { services } from "@/lib/console/services";
import { thumbnailFrom } from "@/lib/console/services/menu-profiles";
import { localId } from "@/lib/console/local-store";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber, formatPercent, formatQuantity } from "@/lib/console/format";
import { computeNutrition, type RecipeNode } from "@/lib/console/menu-nutrition";
import { compareRecipes, type DeviationSummary } from "@/lib/console/menu-recipe-deviation";
import { useActor } from "@/lib/console/menu-price-actions";
import { AsyncPanel } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { FranchiseLockNotice, useFranchiseLock } from "@/components/console/franchise-lock";
import { EMPTY_LOCALISED, LocalisedField } from "@/components/console/fields";
import { Badge, Button, Callout, Drawer, Field, Input, Modal, SegmentedControl, Select, Textarea, cx } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

/** The lines a recipe currently stands for: its published version, else its newest. */
export function currentVersion(versions: RecipeVersion[] | null | undefined): RecipeVersion | null {
  if (!versions || versions.length === 0) return null;
  return versions.find((row) => row.status === "published") ?? versions[0] ?? null;
}

export function linesToInput(lines: RecipeLine[]): RecipeLineInput[] {
  return lines.map((line, index) => ({
    sequence: index + 1,
    componentType: line.componentType,
    ...(line.componentType === "stock_item" ? { stockItemId: line.componentId } : { subRecipeId: line.componentId }),
    quantity: line.quantity.value,
    unitId: line.quantity.unit,
    wastagePercentage: String(line.wastagePercentage ?? 0),
    isOptional: line.isOptional,
  }));
}

/** Every sub-recipe reachable from these lines, with its current lines and yield. Depth-limited. */
async function loadTree(lines: RecipeLine[], rootId: Id): Promise<Map<Id, RecipeNode>> {
  const tree = new Map<Id, RecipeNode>();
  const queue: { id: Id; depth: number }[] = lines
    .filter((line) => line.componentType === "sub_recipe")
    .map((line) => ({ id: line.componentId, depth: 1 }));
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (tree.has(next.id) || next.id === rootId || next.depth > 6) continue;
    const version = currentVersion(await services.production.versions(next.id).catch(() => []));
    if (!version) continue;
    tree.set(next.id, { lines: version.lines, yieldQuantity: version.yieldQuantity });
    for (const line of version.lines) {
      if (line.componentType === "sub_recipe") queue.push({ id: line.componentId, depth: next.depth + 1 });
    }
  }
  return tree;
}

// ---------------------------------------------------------------------------
// FR-MNU-050 — nutrition
// ---------------------------------------------------------------------------

const NUTRIENT_UNIT: Record<Nutrient, string> = {
  energyKcal: "kcal",
  proteinG: "g",
  fatG: "g",
  saturatedFatG: "g",
  carbohydrateG: "g",
  sugarsG: "g",
  fibreG: "g",
  sodiumMg: "mg",
};

export function NutritionPanel({ recipe, version }: { recipe: Recipe; version: RecipeVersion | null }) {
  const { t, tx, fmt } = useI18n();
  const canEdit = usePermission("recipe.edit");
  const [editing, setEditing] = useState<{ id: Id; name: Localised } | null>(null);
  const [nonce, setNonce] = useState(0);

  const lines = version?.lines ?? recipe.lines;
  const yieldQuantity = version?.yieldQuantity ?? recipe.yieldQuantity;

  const data = useAsync(async () => {
    const [tree, facts, profiles] = await Promise.all([
      loadTree(lines, recipe.id),
      services.menuRecipes.nutrition.all(),
      services.stockProfiles.all().catch(() => []),
    ]);
    return {
      tree,
      facts: new Map(facts.map((row) => [row.stockItemId, row])),
      density: new Map(profiles.map((row) => [row.itemId, row.densityGPerMl])),
    };
  }, [recipe.id, version?.id, nonce]);

  const result = useMemo(
    () =>
      data.data
        ? computeNutrition({ lines, yieldQuantity }, { ...data.data, rootId: recipe.id })
        : null,
    [data.data, lines, yieldQuantity, recipe.id],
  );

  return (
    <section className="space-y-3">
      {/* FR-MNU-050: informational only, explicitly not certified */}
      <Callout tone="warn" title={t("mnr.nutrition.notCertifiedTitle")}>
        {t("mnr.nutrition.notCertified")}
      </Callout>

      <AsyncPanel state={data}>
        {() =>
          result ? (
            <div className="space-y-3">
              <p className="text-fg-muted text-xs">
                {result.yieldIsCount
                  ? t("mnr.nutrition.perPortion").replace("{portions}", formatNumber(result.portions, fmt))
                  : t("mnr.nutrition.perBatch").replace("{yield}", formatQuantity(yieldQuantity, fmt))}
                {" · "}
                {t("mnr.nutrition.coverage")
                  .replace("{covered}", formatNumber(result.coveredLines, fmt))
                  .replace("{total}", formatNumber(result.totalLines, fmt))}
              </p>

              <table className="border-line w-full rounded-lg border text-sm">
                <caption className="sr-only">{t("mnr.nutrition.title")}</caption>
                <tbody className="divide-line divide-y">
                  {NUTRIENTS.map((key) => {
                    const partial = result.blanks[key].length > 0 || result.missing.length > 0;
                    return (
                      <tr key={key}>
                        <th scope="row" className="text-fg-muted px-3 py-1.5 text-start text-xs font-normal">
                          {t(`mnr.nutrient.${key}` as never)}
                        </th>
                        <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                          {formatNumber(result.perPortion[key], fmt, key === "energyKcal" || key === "sodiumMg" ? 0 : 1)}{" "}
                          <span className="text-fg-subtle text-xs">{NUTRIENT_UNIT[key]}</span>
                        </td>
                        <td className="w-24 px-3 py-1.5 text-end">
                          {partial ? <Badge tone="warn">{t("mnr.nutrition.partial")}</Badge> : <Badge tone="good">{t("mnr.nutrition.complete")}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {result.missing.length > 0 ? (
                <div>
                  <h4 className="text-fg mb-1 text-xs font-semibold">{t("mnr.nutrition.missingTitle")}</h4>
                  <ul className="border-line divide-line divide-y rounded-lg border">
                    {result.missing.map((row) => (
                      <li key={row.componentId} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="text-fg min-w-0 flex-1 truncate">{tx(row.componentName) || row.componentId}</span>
                        <Badge tone="muted">{t(`mnr.nutrition.reason.${row.reason}` as never)}</Badge>
                        {canEdit && (row.reason === "no_data" || row.reason === "unit") ? (
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ id: row.componentId, name: row.componentName })}>
                            {t("mnr.nutrition.editData")}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {canEdit ? (
                <div className="flex flex-wrap gap-1.5">
                  {lines
                    .filter((line) => line.componentType === "stock_item" && data.data?.facts.has(line.componentId))
                    .map((line) => (
                      <Button key={line.id} size="sm" variant="ghost" onClick={() => setEditing({ id: line.componentId, name: line.componentName })}>
                        {tx(line.componentName)}
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null
        }
      </AsyncPanel>

      {editing ? (
        <NutritionFactsDrawer
          stockItemId={editing.id}
          name={editing.name}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNonce((n) => n + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function NutritionFactsDrawer({
  stockItemId,
  name,
  onClose,
  onSaved,
}: {
  stockItemId: Id;
  name: Localised;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const actor = useActor();
  const existing = useAsync(() => services.menuRecipes.nutrition.get(stockItemId), [stockItemId]);
  const [draft, setDraft] = useState<Pick<NutritionFacts, "basisQuantity" | "basisUnit" | "values" | "source"> | null>(null);

  const current = draft ??
    (existing.data
      ? { basisQuantity: existing.data.basisQuantity, basisUnit: existing.data.basisUnit, values: existing.data.values, source: existing.data.source }
      : existing.loading
        ? null
        : { basisQuantity: "100", basisUnit: "g" as UnitCode, values: emptyNutrients(), source: "" });

  const invalid = current
    ? !(Number(current.basisQuantity) > 0) ||
      NUTRIENTS.some((key) => current.values[key] !== "" && !(Number(current.values[key]) >= 0))
    : true;

  async function save() {
    if (!current || invalid) return;
    await action.run(
      () => services.menuRecipes.saveNutrition({ stockItemId, ...current, updatedBy: actor }),
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("mnr.nutrition.dataTitle")} — ${tx(name)}`}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={invalid} onClick={() => void save()}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      {current ? (
        <div className="space-y-4">
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <Callout tone="muted">{t("mnr.nutrition.dataLocal")}</Callout>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("mnr.nutrition.basis")} required>
              <Input
                dir="ltr"
                inputMode="decimal"
                value={current.basisQuantity}
                onChange={(event) => setDraft({ ...current, basisQuantity: event.target.value })}
              />
            </Field>
            <Field label={t("mnr.nutrition.basisUnit")}>
              <Select value={current.basisUnit} onChange={(event) => setDraft({ ...current, basisUnit: event.target.value as UnitCode })}>
                {(["g", "kg", "ml", "l", "pc"] as UnitCode[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {NUTRIENTS.map((key) => (
              <Field key={key} label={`${t(`mnr.nutrient.${key}` as never)} (${NUTRIENT_UNIT[key]})`}>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={current.values[key]}
                  onChange={(event) => setDraft({ ...current, values: { ...current.values, [key]: event.target.value } })}
                />
              </Field>
            ))}
          </div>
          <Field label={t("mnr.nutrition.source")} hint={t("mnr.nutrition.sourceHint")}>
            <Input value={current.source} onChange={(event) => setDraft({ ...current, source: event.target.value })} />
          </Field>
        </div>
      ) : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-049 — reference images and instructions
// ---------------------------------------------------------------------------

export function ReferenceImagesField({
  value,
  onChange,
  disabled,
}: {
  value: RecipeReferenceImage[];
  onChange: (next: RecipeReferenceImage[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError(null);
    const next = [...value];
    for (const file of Array.from(files).slice(0, Math.max(0, 6 - value.length))) {
      try {
        next.push({ id: localId("img"), src: await thumbnailFrom(file, 640), caption: { ...EMPTY_LOCALISED } });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    onChange(next);
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-muted text-xs">{t("mnr.images.label")}</span>
        {!disabled && value.length < 6 ? (
          <Button size="sm" icon={<ImagePlus size={13} />} loading={busy} onClick={() => input.current?.click()}>
            {t("mnr.images.add")}
          </Button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      {value.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("mnr.images.none")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {value.map((image, index) => (
            <li key={image.id} className="border-line space-y-2 rounded-lg border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt={image.caption.en || image.caption.ar || ""} className="h-32 w-full rounded-md object-cover" />
              <LocalisedField
                label={t("mnr.images.caption").replace("{n}", String(index + 1))}
                value={image.caption}
                onChange={(caption) => onChange(value.map((row) => (row.id === image.id ? { ...row, caption } : row)))}
                maxLength={120}
              />
              {!disabled ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={12} />}
                  onClick={() => onChange(value.filter((row) => row.id !== image.id))}
                >
                  {t("common.remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-fg-subtle text-xs">{t("mnr.images.hint")}</p>
    </div>
  );
}

/**
 * Open a new draft with its instructions and reference images.
 *
 * `CreateRecipeVersionDto` is the only write that carries `instructions` and
 * `referenceImages`; `PUT …/lines` does not. So they are authored here, at
 * the moment the draft is created, rather than in an editor that would
 * appear to save them and silently drop them.
 */
export function NewDraftDrawer({
  recipe,
  base,
  onClose,
  onCreated,
}: {
  recipe: Recipe;
  base: RecipeVersion | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [instructions, setInstructions] = useState<Localised>(base?.instructions ?? recipe.instructions ?? { ...EMPTY_LOCALISED });
  const [images, setImages] = useState<RecipeReferenceImage[]>(base?.referenceImages ?? []);

  async function create() {
    const source = base ?? null;
    await action.run(
      () =>
        services.production.createVersion(recipe.id, {
          yieldQuantity: (source?.yieldQuantity ?? recipe.yieldQuantity).value,
          yieldUnitId: (source?.yieldQuantity ?? recipe.yieldQuantity).unit,
          yieldPercentage: String(source?.yieldPercentage ?? recipe.yieldPercentage),
          prepTimeSeconds: source?.prepTimeSeconds ?? recipe.prepTimeSeconds,
          instructions,
          referenceImages: images,
          lines: linesToInput(source?.lines ?? recipe.lines),
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("recipes.newDraft")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} onClick={() => void create()}>
            {t("recipes.newDraft")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("mnr.draft.note")}</Callout>
        {/* FR-MNU-049: localised preparation instructions */}
        <LocalisedField
          label={t("recipes.instructions")}
          hint={t("recipes.instructionsHint")}
          multiline
          value={instructions}
          onChange={setInstructions}
        />
        {/* FR-MNU-049: reference images per recipe */}
        <ReferenceImagesField value={images} onChange={setImages} />
      </div>
    </Drawer>
  );
}

/**
 * FR-MNU-049 — the prep card a cook reads.
 *
 * Built to be mounted by the KDS as well as the console: large type, the
 * language chosen per viewer, photos beside the method, and the components
 * with their quantities.
 */
export function RecipePrepCard({ recipe, version, large }: { recipe: Recipe; version: RecipeVersion | null; large?: boolean }) {
  const { t, tx, fmt, locale } = useI18n();
  const [language, setLanguage] = useState<"en" | "ar">(locale === "ar" ? "ar" : "en");
  const instructions = version?.instructions ?? recipe.instructions;
  const text = instructions[language] || instructions[language === "en" ? "ar" : "en"];
  const fellBack = !instructions[language] && Boolean(text);
  const images = version?.referenceImages ?? [];
  const lines = version?.lines ?? recipe.lines;

  return (
    <article className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={cx("text-fg font-semibold", large ? "text-2xl" : "text-base")}>{recipe.name[language] || tx(recipe.name)}</h3>
        <SegmentedControl
          value={language}
          onChange={setLanguage}
          label={t("mnr.prep.language")}
          options={[
            { value: "en" as const, label: "English" },
            { value: "ar" as const, label: "العربية" },
          ]}
        />
      </div>

      <ul className={cx("grid gap-1", large ? "text-lg sm:grid-cols-2" : "text-sm")}>
        {lines.map((line) => (
          <li key={line.id} className="flex items-baseline gap-2" dir={language === "ar" ? "rtl" : "ltr"}>
            <span className="font-mono tabular-nums font-semibold">{formatQuantity(line.quantity, fmt)}</span>
            <span className="text-fg">{line.componentName[language] || tx(line.componentName)}</span>
            {line.isOptional ? <Badge tone="muted">{t("recipes.optionalLine")}</Badge> : null}
          </li>
        ))}
      </ul>

      {text ? (
        <div dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
          {fellBack ? <Badge tone="warn">{t("mnr.prep.fallback")}</Badge> : null}
          <p className={cx("text-fg mt-1 whitespace-pre-line leading-relaxed", large ? "text-xl" : "text-sm")}>{text}</p>
        </div>
      ) : (
        <Callout tone="muted">{t("mnr.prep.noInstructions")}</Callout>
      )}

      {images.length > 0 ? (
        <ul className={cx("grid gap-3", large ? "sm:grid-cols-3" : "grid-cols-2")}>
          {images.map((image) => (
            <li key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt={image.caption[language] || image.caption.en || ""} className="w-full rounded-lg object-cover" />
              {image.caption[language] ? (
                <p className="text-fg-muted mt-1 text-xs" dir={language === "ar" ? "rtl" : "ltr"}>
                  {image.caption[language]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function PrepCardPanel({ recipe, version }: { recipe: Recipe; version: RecipeVersion | null }) {
  const { t } = useI18n();
  const [full, setFull] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-fg-subtle text-xs">{version ? t("mnr.prep.fromVersion").replace("{v}", String(version.version)) : ""}</p>
        <Button size="sm" icon={<Maximize2 size={13} />} onClick={() => setFull(true)}>
          {t("mnr.prep.fullScreen")}
        </Button>
      </div>
      <RecipePrepCard recipe={recipe} version={version} />
      <Modal open={full} onClose={() => setFull(false)} title={t("mnr.prep.title")} wide>
        <RecipePrepCard recipe={recipe} version={version} large />
      </Modal>
    </section>
  );
}

/**
 * FR-MNU-049 — the prep card for a menu item, for the KDS to mount.
 * Resolves the item's recipe (branch variant first, when a branch is given).
 */
export function RecipePrepCardForItem({ variantId, branchId }: { variantId: Id; branchId?: Id | null }) {
  const { t } = useI18n();
  const data = useAsync(async () => {
    const recipes = (await services.catalogue.recipes.list({ limit: 1000 })).rows.filter(
      (row) => row.recipeType === "menu_item" && row.targetId === variantId,
    );
    const recipe =
      (branchId ? recipes.find((row) => row.scope === "branch" && row.branchId === branchId) : undefined) ??
      recipes.find((row) => (row.scope ?? "tenant") !== "branch") ??
      null;
    if (!recipe) return null;
    return { recipe, version: currentVersion(await services.production.versions(recipe.id).catch(() => [])) };
  }, [variantId, branchId]);

  return (
    <AsyncPanel state={data} empty={<Callout tone="muted">{t("mnr.prep.noRecipe")}</Callout>}>
      {(value) => (value ? <RecipePrepCard recipe={value.recipe} version={value.version} large /> : null)}
    </AsyncPanel>
  );
}

/**
 * FR-MNU-049 — the same card from a KDS ticket line, which knows the menu
 * item but not the variant. The item's first variant carries the recipe;
 * an item that cannot be read shows the "no recipe" state, not a guess.
 */
export function RecipePrepCardForMenuItem({ menuItemId, branchId }: { menuItemId: Id; branchId?: Id | null }) {
  const { t } = useI18n();
  const item = useAsync(() => services.catalogue.items.get(menuItemId).catch(() => null), [menuItemId]);
  const variantId = item.data?.variants[0]?.id ?? null;
  if (item.loading) return null;
  if (!variantId) return <Callout tone="muted">{t("mnr.prep.noRecipe")}</Callout>;
  return <RecipePrepCardForItem variantId={variantId} branchId={branchId} />;
}

// ---------------------------------------------------------------------------
// FR-MNU-047 — branch variants
// ---------------------------------------------------------------------------

export function DeviationList({ summary }: { summary: DeviationSummary }) {
  const { t, tx, fmt } = useI18n();
  if (summary.deviations.length === 0) {
    return <p className="text-good text-xs">{t("mnr.variant.identical")}</p>;
  }
  return (
    <ul className="space-y-1">
      {summary.deviations.map((row) => (
        <li key={row.key} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fg">{tx(row.componentName) || row.componentId}</span>
          {row.kinds.map((kind) => (
            <Badge key={kind} tone={kind === "added" ? "accent" : kind === "removed" ? "bad" : "warn"}>
              {t(`mnr.variant.kind.${kind}` as never)}
            </Badge>
          ))}
          {row.standard && row.variant ? (
            <span className="text-fg-subtle font-mono" dir="ltr">
              {formatQuantity(row.standard.quantity, fmt)} → {formatQuantity(row.variant.quantity, fmt)}
              {row.quantityChange !== null && row.quantityChange !== 0
                ? ` (${row.quantityChange > 0 ? "+" : ""}${formatPercent(row.quantityChange * 100, fmt, 0)})`
                : ""}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function BranchVariantsPanel({
  recipe,
  onOpenRecipe,
  onChanged,
}: {
  recipe: Recipe;
  onOpenRecipe: (recipe: Recipe) => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canEdit = usePermission("recipe.edit");
  const confirm = useConfirm();
  const actor = useActor();
  const [creating, setCreating] = useState(false);
  const [nonce, setNonce] = useState(0);

  const isVariant = recipe.scope === "branch";

  const data = useAsync(async () => {
    const all = (await services.catalogue.recipes.list({ limit: 1000 })).rows.filter(
      (row) => row.recipeType === recipe.recipeType && row.targetId !== null && row.targetId === recipe.targetId,
    );
    const standard = isVariant ? (all.find((row) => (row.scope ?? "tenant") !== "branch") ?? null) : recipe;
    const variants = all.filter((row) => row.scope === "branch" && (isVariant ? row.id === recipe.id : true));
    const standardVersion = standard ? currentVersion(await services.production.versions(standard.id).catch(() => [])) : null;
    const rows = await Promise.all(
      variants.map(async (variant) => {
        const versions = await services.production.versions(variant.id).catch(() => []);
        const version = versions[0] ?? null;
        const note = await services.menuRecipes.variantNotes.get(variant.id);
        return {
          variant,
          version,
          note,
          summary: compareRecipes(standardVersion?.lines ?? standard?.lines ?? [], version?.lines ?? variant.lines),
        };
      }),
    );
    return { standard, standardVersion, rows };
  }, [recipe.id, nonce]);

  return (
    <section className="space-y-3">
      <Callout tone="muted">{isVariant ? t("mnr.variant.isVariant") : t("mnr.variant.intro")}</Callout>
      {!recipe.targetId ? <Callout tone="warn">{t("mnr.variant.noTarget")}</Callout> : null}

      <AsyncPanel state={data}>
        {(value) => (
          <div className="space-y-3">
            {isVariant && value.standard ? (
              <Button size="sm" variant="ghost" onClick={() => onOpenRecipe(value.standard!)}>
                {t("mnr.variant.openStandard")}
              </Button>
            ) : null}
            {value.rows.length === 0 ? (
              <p className="text-fg-subtle text-xs">{t("mnr.variant.none")}</p>
            ) : (
              <ul className="border-line divide-line divide-y rounded-lg border">
                {value.rows.map((row) => {
                  const branch = branches.find((entry) => entry.id === row.variant.branchId);
                  return (
                    <li key={row.variant.id} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-fg text-sm font-medium">{branch ? tx(branch.name) : row.variant.branchId}</span>
                        {row.version ? <Badge tone={row.version.status === "published" ? "good" : "warn"}>v{row.version.version} · {row.version.status}</Badge> : null}
                        <Badge tone={row.summary.deviations.length > 0 ? "warn" : "good"}>
                          {t("mnr.variant.deviations").replace("{count}", String(row.summary.deviations.length))}
                        </Badge>
                        {!isVariant ? (
                          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => onOpenRecipe(row.variant)}>
                            {t("mnr.variant.open")}
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-fg-muted text-xs">
                        {row.note?.reason ? `${t("mnr.variant.reason")}: ${row.note.reason}` : t("mnr.variant.noReason")}
                      </p>
                      <DeviationList summary={row.summary} />
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && !isVariant && recipe.targetId ? (
              <Button size="sm" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
                {t("mnr.variant.create")}
              </Button>
            ) : null}

            {creating ? (
              <NewVariantDrawer
                recipe={recipe}
                standardVersion={value.standardVersion}
                takenBranchIds={value.rows.map((row) => row.variant.branchId ?? "")}
                onClose={() => setCreating(false)}
                onCreated={async (created) => {
                  setCreating(false);
                  setNonce((n) => n + 1);
                  onChanged(t("mnr.variant.created"));
                  const ok = await confirm({
                    title: t("mnr.variant.openNowTitle"),
                    body: t("mnr.variant.openNowBody"),
                    confirmLabel: t("mnr.variant.open"),
                    tone: "neutral",
                  });
                  if (ok) onOpenRecipe(created);
                }}
                actor={actor}
              />
            ) : null}
          </div>
        )}
      </AsyncPanel>
    </section>
  );
}

function NewVariantDrawer({
  recipe,
  standardVersion,
  takenBranchIds,
  actor,
  onClose,
  onCreated,
}: {
  recipe: Recipe;
  standardVersion: RecipeVersion | null;
  takenBranchIds: Id[];
  actor: string;
  onClose: () => void;
  onCreated: (created: Recipe) => void;
}) {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const action = useAction();
  const [branchId, setBranchId] = useState("");
  const [reason, setReason] = useState("");
  // FR-BRN-035 — the chosen branch may be a franchise that keeps recipes with the brand.
  const lock = useFranchiseLock(branchId || null, "recipes");

  const valid = Boolean(branchId) && reason.trim().length >= 5 && !lock.locked;

  async function create() {
    if (!valid) return;
    const lines = standardVersion?.lines ?? recipe.lines;
    const input = linesToInput(lines);
    await action.run(
      async () => {
        const created = await services.catalogue.recipes.create({
          name: recipe.name,
          recipeType: recipe.recipeType,
          targetId: recipe.targetId,
          targetName: recipe.targetName,
          scope: "branch",
          branchId,
        });
        // Seed the variant with the standard, so the deviation starts at zero
        // and every difference afterwards is one somebody chose.
        const versions = await services.production.versions(created.id).catch(() => []);
        let draft = versions.find((row) => row.status === "draft") ?? null;
        if (!draft) {
          draft = await services.production.createVersion(created.id, {
            yieldQuantity: (standardVersion?.yieldQuantity ?? recipe.yieldQuantity).value,
            yieldUnitId: (standardVersion?.yieldQuantity ?? recipe.yieldQuantity).unit,
            yieldPercentage: String(standardVersion?.yieldPercentage ?? recipe.yieldPercentage),
            prepTimeSeconds: standardVersion?.prepTimeSeconds ?? recipe.prepTimeSeconds,
            instructions: standardVersion?.instructions ?? recipe.instructions,
            referenceImages: standardVersion?.referenceImages,
            lines: input,
          });
        }
        await services.production.replaceLines(created.id, draft.version, input);
        await services.menuRecipes.saveVariantNote({
          recipeId: created.id,
          standardRecipeId: recipe.id,
          reason: reason.trim(),
          approvedBy: null,
          updatedBy: actor,
        });
        return created;
      },
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mnr.variant.create")}
      subtitle={tx(recipe.name)}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void create()}>
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("mnr.variant.createNote")}</Callout>
        <Field label={t("mnp.list.branch")} required>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">—</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id} disabled={takenBranchIds.includes(branch.id)}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
        <FranchiseLockNotice lock={lock} domain="recipes" />
        <Field label={t("mnr.variant.reason")} hint={t("mnr.variant.reasonHint")} required>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

