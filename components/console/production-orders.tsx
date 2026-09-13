"use client";

/**
 * Production orders — FR-BRN-021 … FR-BRN-025.
 *
 * A production order names what to make, how much and by when (021). Before
 * it starts, the recipe is expanded to what the target needs and checked
 * against what the kitchen holds, and any shortage is shown in the row it
 * belongs to (022) — starting anyway is allowed, because kitchens do borrow
 * from tomorrow's delivery, but it takes a written reason that stays on the
 * order. Completing records the actual output and the actual inputs, posts
 * both to the ledger, and names the output batch with its production and
 * expiry dates (023). Yield variance and output cost are worked out on the
 * way in (024, 025), so the number the yield report shows is the one the
 * cook saw when they pressed Complete.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, RotateCcw, Truck, XCircle } from "lucide-react";

import type { CentralKitchen, Id, Recipe, StockItem, StockLevel } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { ServiceError } from "@/lib/console/services/types";
import type { ProductionCompletion, ProductionOrder } from "@/lib/console/services/production";
import {
  checkAvailability,
  expandRecipe,
  productionCost,
  yieldVariance,
  type AvailabilityRow,
  type Expansion,
  type OverheadBasis,
} from "@/lib/console/production";
import { isPositiveDecimal, toScaled } from "@/lib/console/stock-units";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatQuantity } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { MoneyInput } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
} from "@/components/console/ui";

export const MIN_OVERRIDE_NOTE = 12;

// ---------------------------------------------------------------------------
// Shared data
// ---------------------------------------------------------------------------

export function useKitchenData() {
  return useAsync(async () => {
    const [kitchens, items, recipes, profiles] = await Promise.all([
      services.organisation.centralKitchens.list({ limit: 200 }).then((page) => page.rows),
      services.inventory.items.list({ limit: 5000 }).then((page) => page.rows),
      services.catalogue.recipes
        .list({ limit: 2000 })
        .then((page) => page.rows)
        .catch(() => [] as Recipe[]),
      services.stockProfiles.all().catch(() => []),
    ]);
    return {
      kitchens,
      items,
      itemById: new Map(items.map((row) => [row.id, row])),
      // A central kitchen makes stocked things: sub-recipes and production items.
      producing: recipes.filter((row) => row.recipeType !== "menu_item"),
      densities: new Map(profiles.map((row) => [row.itemId, row.densityGPerMl])),
    };
  }, []);
}

export type KitchenData = NonNullable<ReturnType<typeof useKitchenData>["data"]>;

export function kitchenLocation(kitchen: CentralKitchen): Id {
  return kitchen.locationId ?? kitchen.id;
}

/** The recipe and every sub-recipe under it, with their lines. */
export async function loadRecipeTree(recipeId: Id): Promise<Map<Id, Recipe>> {
  const out = new Map<Id, Recipe>();
  async function visit(id: Id, depth: number) {
    if (out.has(id) || depth > 4) return;
    const recipe = await services.catalogue.recipes.get(id);
    if (!recipe) return;
    out.set(id, recipe);
    for (const line of recipe.lines) {
      if (line.componentType === "sub_recipe") await visit(line.componentId, depth + 1);
    }
  }
  await visit(recipeId, 0);
  return out;
}

async function levelsAt(locationId: Id): Promise<StockLevel[]> {
  const page = await services.inventory.levels.list({ limit: 5000, filters: { locationId } });
  return page.rows.filter((row) => row.locationId === locationId);
}

/** Expansion plus availability, with the fetch keyed apart from the target. */
function useRequirements(
  recipeId: Id | null,
  output: StockItem | null,
  target: string,
  locationId: Id | null,
  data: KitchenData | null,
) {
  const source = useAsync(async () => {
    if (!recipeId || !locationId) return null;
    const [tree, levels] = await Promise.all([loadRecipeTree(recipeId), levelsAt(locationId)]);
    if (!tree.get(recipeId)) throw new ServiceError("NOT_FOUND", "That recipe could not be read.", 404);
    return { tree, onHand: new Map(levels.map((row) => [row.itemId, row.onHand.value])) };
  }, [recipeId, locationId]);

  const result = useMemo(() => {
    if (!source.data || !output || !data || !recipeId || !isPositiveDecimal(target)) return null;
    const recipe = source.data.tree.get(recipeId)!;
    const expansion = expandRecipe(recipe, target, output, {
      items: data.itemById,
      densities: data.densities,
      recipes: source.data.tree,
    });
    return { recipe, expansion, rows: checkAvailability(expansion.inputs, source.data.onHand) };
  }, [source.data, output, data, recipeId, target]);

  return { source, result };
}

// ---------------------------------------------------------------------------
// Availability — FR-BRN-022
// ---------------------------------------------------------------------------

function AvailabilityTable({ expansion, rows }: { expansion: Expansion; rows: AvailabilityRow[] }) {
  const { t, tx, fmt } = useI18n();
  const columns: Column<AvailabilityRow>[] = [
    {
      key: "item",
      header: t("prd.input"),
      render: (row) => (
        <span className="text-fg text-sm">
          {tx(row.name)}
          {row.optional ? <span className="text-fg-subtle"> · {t("prd.optional")}</span> : null}
        </span>
      ),
    },
    {
      key: "required",
      header: t("prd.required"),
      numeric: true,
      render: (row) => <span className="font-mono">{formatQuantity({ value: row.required, unit: row.unit }, fmt)}</span>,
    },
    {
      key: "onHand",
      header: t("prd.onHandKitchen"),
      numeric: true,
      render: (row) => <span className="font-mono">{formatQuantity({ value: row.onHand, unit: row.unit }, fmt)}</span>,
    },
    {
      key: "shortage",
      header: "",
      render: (row) =>
        row.shortage ? (
          <Badge tone={row.optional ? "warn" : "bad"}>
            {t("prd.short")} {formatQuantity({ value: row.shortage, unit: row.unit }, fmt)}
          </Badge>
        ) : (
          <Badge tone="good">{t("prd.enough")}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-2">
      {expansion.yieldProblem ? (
        <Callout tone="bad">{t(`prd.problem.${expansion.yieldProblem}` as ConsoleKey)} — {t("prd.yieldUnit")}</Callout>
      ) : null}
      {expansion.issues.map((issue, index) => (
        <Callout key={index} tone="warn">
          {tx(issue.componentName)}: {t(`prd.problem.${issue.problem}` as ConsoleKey)}
        </Callout>
      ))}
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.itemId} caption={t("prd.requirements")} dense />
    </div>
  );
}

export function hasShortage(rows: AvailabilityRow[]): boolean {
  return rows.some((row) => row.shortage && !row.optional);
}

// ---------------------------------------------------------------------------
// New order — FR-BRN-021
// ---------------------------------------------------------------------------

export interface OrderPrefill {
  kitchenId?: Id;
  recipeId?: Id;
  outputItemId?: Id;
  quantity?: string;
  targetDate?: string;
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return todayIso(date);
}

export function NewOrderDrawer({
  open,
  data,
  prefill,
  onClose,
  onCreated,
}: {
  open: boolean;
  data: KitchenData;
  prefill: OrderPrefill | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const [kitchenId, setKitchenId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [targetDate, setTargetDate] = useState(tomorrow());
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setKitchenId(prefill?.kitchenId ?? data.kitchens[0]?.id ?? "");
    setRecipeId(prefill?.recipeId ?? "");
    setOutputItemId(prefill?.outputItemId ?? "");
    setQuantity(prefill?.quantity ?? "");
    setTargetDate(prefill?.targetDate ?? tomorrow());
    setNotes("");
    action.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const kitchen = data.kitchens.find((row) => row.id === kitchenId) ?? null;
  const recipe = data.producing.find((row) => row.id === recipeId) ?? null;
  // A recipe that names the stock item it makes decides the output.
  const fixedOutput = recipe?.targetId && data.itemById.has(recipe.targetId) ? recipe.targetId : null;
  const output = data.itemById.get(fixedOutput ?? outputItemId) ?? null;

  const { source, result } = useRequirements(
    recipeId || null,
    output,
    quantity,
    kitchen ? kitchenLocation(kitchen) : null,
    data,
  );

  const valid = kitchen && recipe && output && isPositiveDecimal(quantity) && targetDate;

  async function submit() {
    if (!valid) return;
    await action.run(
      () =>
        services.centralKitchen.createOrder({
          kitchenId: kitchen.id,
          kitchenName: kitchen.name,
          locationId: kitchenLocation(kitchen),
          recipeId: recipe.id,
          recipeName: recipe.name,
          outputItemId: output.id,
          outputName: output.name,
          unit: output.baseUnit,
          targetQuantity: quantity.trim(),
          targetDate,
          currency: output.unitCost.currency,
          notes: notes.trim() || null,
          createdBy: session?.user.email ?? null,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("prd.newOrder")}
      subtitle={t("prd.newOrderHint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={action.pending} disabled={!valid || action.pending}>
            {t("prd.createOrder")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {data.kitchens.length === 0 ? <Callout tone="warn">{t("prd.noKitchens")}</Callout> : null}
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("prd.kitchen")} required>
          <Select value={kitchenId} onChange={(event) => setKitchenId(event.target.value)}>
            {data.kitchens.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("prd.recipe")} required hint={data.producing.length === 0 ? t("prd.noRecipes") : undefined}>
          <Select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
            <option value="">{t("prd.chooseRecipe")}</option>
            {data.producing.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
                {row.status !== "published" ? ` (${row.status})` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("prd.output")} required hint={fixedOutput ? t("prd.outputFixed") : t("prd.outputHint")}>
          <Select
            value={fixedOutput ?? outputItemId}
            disabled={Boolean(fixedOutput)}
            onChange={(event) => setOutputItemId(event.target.value)}
          >
            <option value="">{t("prd.chooseOutput")}</option>
            {data.items.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)} · {row.sku}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("prd.target")} required hint={output ? t("prd.inUnit").replace("{unit}", output.baseUnit) : undefined}>
            <Input dir="ltr" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="font-mono" />
          </Field>
          <Field label={t("prd.targetDate")} required>
            <Input type="date" dir="ltr" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          </Field>
        </div>

        <Field label={t("common.notes")}>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </Field>

        {recipeId && output && isPositiveDecimal(quantity) ? (
          <section className="space-y-2">
            <h3 className="text-fg text-sm font-semibold">{t("prd.requirements")}</h3>
            <AsyncPanel state={source}>
              {() =>
                result ? (
                  <>
                    <p className="text-fg-muted text-xs">
                      {t("prd.batches")
                        .replace("{n}", result.expansion.batches ? formatNumber(Number(result.expansion.batches), fmt, 2) : "—")
                        .replace(
                          "{yield}",
                          result.expansion.yieldPerBatch
                            ? formatQuantity({ value: result.expansion.yieldPerBatch, unit: output.baseUnit }, fmt)
                            : "—",
                        )}
                    </p>
                    <AvailabilityTable expansion={result.expansion} rows={result.rows} />
                    {hasShortage(result.rows) ? <Callout tone="warn">{t("prd.shortageAtCreate")}</Callout> : null}
                  </>
                ) : null
              }
            </AsyncPanel>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// One order
// ---------------------------------------------------------------------------

export const STATUS_TONE: Record<ProductionOrder["status"], "neutral" | "accent" | "warn" | "good" | "muted" | "bad"> = {
  planned: "neutral",
  in_progress: "accent",
  posting_failed: "bad",
  completed: "good",
  cancelled: "muted",
};

export function OrderDrawer({
  order,
  data,
  onClose,
  onChanged,
  onDistribute,
}: {
  order: ProductionOrder;
  data: KitchenData;
  onClose: () => void;
  onChanged: (order: ProductionOrder, message: string) => void;
  onDistribute: (order: ProductionOrder) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const canRun = usePermission("inventory.adjust");
  const action = useAction();
  const [overrideNote, setOverrideNote] = useState("");

  const output = data.itemById.get(order.outputItemId) ?? null;
  const live = order.status === "planned" || order.status === "in_progress";
  const { source, result } = useRequirements(
    live ? order.recipeId : null,
    output,
    order.targetQuantity,
    order.locationId,
    data,
  );
  const short = result ? hasShortage(result.rows) : false;

  async function start() {
    const note = short ? overrideNote.trim() : "";
    if (short && note.length < MIN_OVERRIDE_NOTE) return;
    await action.run(() => services.centralKitchen.start(order.id, { by: session?.user.email ?? null, shortageNote: note || null }), {
      onSuccess: (next) => onChanged(next, t("prd.started")),
    });
  }

  async function cancel() {
    const ok = await confirm({
      title: t("prd.cancelTitle").replace("{number}", order.number),
      body: t("prd.cancelBody"),
      confirmLabel: t("prd.cancelOrder"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.centralKitchen.cancel(order.id), {
      onSuccess: (next) => onChanged(next, t("prd.cancelled")),
    });
  }

  async function retry() {
    await action.run(() => services.centralKitchen.retryPosting(order.id, services.inventory), {
      onSuccess: (next) => onChanged(next, next.status === "completed" ? t("prd.posted") : t("prd.stillFailing")),
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${order.number} · ${tx(order.outputName)}`}
      subtitle={
        <Badge tone={STATUS_TONE[order.status]} dot>
          {t(`prd.status.${order.status}` as ConsoleKey)}
        </Badge>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("prd.kitchen")}>{tx(order.kitchenName)}</DescRow>
          <DescRow label={t("prd.recipe")}>{tx(order.recipeName)}</DescRow>
          <DescRow label={t("prd.target")} mono>
            {formatQuantity({ value: order.targetQuantity, unit: order.unit }, fmt)}
          </DescRow>
          <DescRow label={t("prd.targetDate")}>{formatDate(order.targetDate, fmt)}</DescRow>
          <DescRow label={t("prd.createdBy")}>{order.createdBy ?? "—"}</DescRow>
          {order.startedAt ? (
            <DescRow label={t("prd.startedAt")}>
              {formatDateTime(order.startedAt, fmt)} · {order.startedBy ?? "—"}
            </DescRow>
          ) : null}
          {order.notes ? <DescRow label={t("common.notes")}>{order.notes}</DescRow> : null}
        </DescList>

        {order.shortageOverride ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("prd.overrideOnRecord")}>
            “{order.shortageOverride.note}” — {order.shortageOverride.by ?? "—"}, {formatDateTime(order.shortageOverride.at, fmt)}
          </Callout>
        ) : null}

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {live ? (
          <section className="space-y-2">
            <h3 className="text-fg text-sm font-semibold">{t("prd.requirements")}</h3>
            <AsyncPanel state={source}>
              {() => (result ? <AvailabilityTable expansion={result.expansion} rows={result.rows} /> : null)}
            </AsyncPanel>
          </section>
        ) : null}

        {order.status === "planned" && canRun ? (
          <section className="space-y-3">
            {short ? (
              <Field
                label={t("prd.overrideNote")}
                hint={t("prd.overrideHint").replace("{n}", String(MIN_OVERRIDE_NOTE))}
                error={overrideNote.trim().length > 0 && overrideNote.trim().length < MIN_OVERRIDE_NOTE ? t("prd.overrideShort") : null}
              >
                <Textarea value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} rows={2} />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<Play size={14} />}
                onClick={start}
                loading={action.pending}
                disabled={!result || Boolean(result.expansion.yieldProblem) || (short && overrideNote.trim().length < MIN_OVERRIDE_NOTE)}
              >
                {short ? t("prd.startAnyway") : t("prd.start")}
              </Button>
              <Button variant="ghost" icon={<XCircle size={14} />} onClick={cancel} disabled={action.pending}>
                {t("prd.cancelOrder")}
              </Button>
            </div>
          </section>
        ) : null}

        {order.status === "in_progress" && canRun && result && output ? (
          <CompleteForm
            order={order}
            output={output}
            kitchen={data.kitchens.find((row) => row.id === order.kitchenId) ?? null}
            rows={result.rows}
            yieldPerBatch={result.expansion.yieldPerBatch}
            itemById={data.itemById}
            onDone={(next) => onChanged(next, next.status === "completed" ? t("prd.completed") : t("prd.partlyPosted"))}
            onCancel={cancel}
          />
        ) : null}

        {order.completion ? (
          <CompletionSummary order={order} onRetry={canRun ? retry : undefined} retrying={action.pending} />
        ) : null}

        {order.status === "completed" ? (
          <Button variant="secondary" icon={<Truck size={14} />} onClick={() => onDistribute(order)}>
            {t("prd.distribute")}
          </Button>
        ) : null}

        {!canRun && live ? <Callout tone="muted">{t("prd.needAdjust")}</Callout> : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Complete — FR-BRN-023 / 024 / 025
// ---------------------------------------------------------------------------

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

function CompleteForm({
  order,
  output,
  kitchen,
  rows,
  yieldPerBatch,
  itemById,
  onDone,
  onCancel,
}: {
  order: ProductionOrder;
  output: StockItem;
  kitchen: CentralKitchen | null;
  rows: AvailabilityRow[];
  yieldPerBatch: string | null;
  itemById: Map<Id, StockItem>;
  onDone: (order: ProductionOrder) => void;
  onCancel: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const today = todayIso();
  const [actualOutput, setActualOutput] = useState(order.targetQuantity);
  const [actual, setActual] = useState<Record<Id, string>>(() => Object.fromEntries(rows.map((row) => [row.itemId, row.required])));
  const [labour, setLabour] = useState<number | null>(0);
  const [energy, setEnergy] = useState<number | null>(0);
  const [basis, setBasis] = useState<OverheadBasis>("per_batch");
  const [batchNumber, setBatchNumber] = useState(
    `${kitchen?.code ?? "CK"}-${today.replaceAll("-", "")}-${order.number.replace(/\D/g, "")}`,
  );
  const [productionDate, setProductionDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(output.shelfLifeDays ? addDays(today, output.shelfLifeDays) : "");

  const currency = output.unitCost.currency;
  const inputsValid = rows.every((row) => toScaled(actual[row.itemId] ?? "") !== null && Number(actual[row.itemId]) >= 0);
  const outputValid = toScaled(actualOutput) !== null && Number(actualOutput) >= 0;

  const preview = useMemo(() => {
    if (!inputsValid || !outputValid || !yieldPerBatch) return null;
    const used = new Map(rows.map((row) => [row.itemId, actual[row.itemId] ?? "0"]));
    const variance = yieldVariance(rows, used, yieldPerBatch, actualOutput);
    const cost = productionCost(
      rows.map((row) => ({ quantity: actual[row.itemId] ?? "0", unitCostMinor: itemById.get(row.itemId)?.unitCost.amount ?? 0 })),
      { labourMinor: labour ?? 0, energyMinor: energy ?? 0, basis },
      actualOutput,
    );
    return { variance, cost };
  }, [inputsValid, outputValid, yieldPerBatch, rows, actual, actualOutput, itemById, labour, energy, basis]);

  const expiryBeforeProduction = expiryDate !== "" && expiryDate < productionDate;
  const ready = preview && batchNumber.trim() && productionDate && !expiryBeforeProduction && (!output.expiryTracked || expiryDate);

  async function submit() {
    if (!ready || !preview || !yieldPerBatch) return;
    const completion: ProductionCompletion = {
      actualOutput: actualOutput.trim(),
      inputs: rows.map((row) => ({
        itemId: row.itemId,
        name: row.name,
        unit: row.unit,
        theoretical: row.required,
        actual: (actual[row.itemId] ?? "0").trim(),
        perBatch: row.perBatch,
        optional: row.optional,
        unitCostMinor: itemById.get(row.itemId)?.unitCost.amount ?? 0,
        movementId: null,
        error: null,
      })),
      outputMovementId: null,
      outputError: null,
      overhead: { labourMinor: labour ?? 0, energyMinor: energy ?? 0, basis },
      inputsCostMinor: preview.cost.inputsMinor,
      overheadMinor: preview.cost.overheadMinor,
      totalCostMinor: preview.cost.totalMinor,
      unitCostMinor: preview.cost.perUnitMinor,
      yieldPerBatch,
      theoreticalOutput: preview.variance.theoretical,
      yieldVariance: preview.variance.variance,
      yieldVariancePercent: preview.variance.percent,
      batchNumber: batchNumber.trim(),
      productionDate,
      expiryDate: expiryDate || null,
      completedAt: new Date().toISOString(),
      completedBy: session?.user.email ?? null,
    };
    await action.run(() => services.centralKitchen.complete(order.id, completion, services.inventory), { onSuccess: onDone });
  }

  return (
    <section className="border-line space-y-4 rounded-lg border p-4">
      <h3 className="text-fg text-sm font-semibold">{t("prd.complete")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("prd.actualOutput")} required hint={t("prd.inUnit").replace("{unit}", output.baseUnit)}>
        <Input dir="ltr" inputMode="decimal" value={actualOutput} onChange={(event) => setActualOutput(event.target.value)} className="w-40 font-mono" />
      </Field>

      <div>
        <p className="text-fg mb-1 text-xs font-medium">{t("prd.actualInputs")}</p>
        <p className="text-fg-subtle mb-2 text-xs">{t("prd.actualInputsHint")}</p>
        <ul className="border-line divide-line divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.itemId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-fg min-w-0 flex-1 truncate">{tx(row.name)}</span>
              <span className="text-fg-subtle font-mono text-xs">{formatQuantity({ value: row.required, unit: row.unit }, fmt)}</span>
              <Input
                dir="ltr"
                inputMode="decimal"
                aria-label={tx(row.name)}
                value={actual[row.itemId] ?? ""}
                onChange={(event) => setActual((current) => ({ ...current, [row.itemId]: event.target.value }))}
                className="w-28 font-mono"
              />
              <span className="text-fg-muted w-8 text-xs">{row.unit}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("prd.labour")}>
          <MoneyInput value={labour} onChange={setLabour} currency={currency} min={0} />
        </Field>
        <Field label={t("prd.energy")}>
          <MoneyInput value={energy} onChange={setEnergy} currency={currency} min={0} />
        </Field>
        <Field label={t("prd.overheadBasis")}>
          <SegmentedControl<OverheadBasis>
            value={basis}
            onChange={setBasis}
            options={[
              { value: "per_batch", label: t("prd.perBatch") },
              { value: "per_unit", label: t("prd.perUnit").replace("{unit}", output.baseUnit) },
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("prd.batchNumber")} required>
          <Input dir="ltr" value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} className="font-mono" />
        </Field>
        <Field label={t("prd.productionDate")} required>
          <Input type="date" dir="ltr" value={productionDate} onChange={(event) => setProductionDate(event.target.value)} />
        </Field>
        <Field
          label={t("prd.expiryDate")}
          required={output.expiryTracked}
          hint={output.shelfLifeDays ? t("prd.shelfLife").replace("{n}", String(output.shelfLifeDays)) : undefined}
          error={expiryBeforeProduction ? t("prd.expiryBefore") : null}
        >
          <Input type="date" dir="ltr" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
        </Field>
      </div>

      {preview ? (
        <DescList>
          <DescRow label={t("prd.theoretical")} mono>
            {preview.variance.theoretical ? formatQuantity({ value: preview.variance.theoretical, unit: output.baseUnit }, fmt) : "—"}
          </DescRow>
          <DescRow label={t("prd.yieldVariance")} mono>
            <VarianceText value={preview.variance.variance} percent={preview.variance.percent} unit={output.baseUnit} />
          </DescRow>
          <DescRow label={t("prd.inputsCost")} mono>
            {formatMoney({ amount: preview.cost.inputsMinor, currency }, fmt)}
          </DescRow>
          <DescRow label={t("prd.overhead")} mono>
            {formatMoney({ amount: preview.cost.overheadMinor, currency }, fmt)}
          </DescRow>
          <DescRow label={t("prd.totalCost")} mono>
            {formatMoney({ amount: preview.cost.totalMinor, currency }, fmt)}
          </DescRow>
          <DescRow label={t("prd.unitCost").replace("{unit}", output.baseUnit)} mono>
            {preview.cost.perUnitMinor === null ? "—" : formatMoney({ amount: Math.round(preview.cost.perUnitMinor), currency }, fmt)}
          </DescRow>
        </DescList>
      ) : (
        <Callout tone="muted">{t("prd.fillToPreview")}</Callout>
      )}

      <Callout tone="muted">{t("prd.postingNote")}</Callout>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={submit} loading={action.pending} disabled={!ready || action.pending}>
          {t("prd.completeAndPost")}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={action.pending}>
          {t("prd.cancelOrder")}
        </Button>
      </div>
    </section>
  );
}

export function VarianceText({ value, percent, unit }: { value: string | null; percent: number | null; unit: string }) {
  const { fmt } = useI18n();
  if (value === null) return <span>—</span>;
  const n = Number(value);
  return (
    <span className={n < 0 ? "text-bad" : n > 0 ? "text-good" : undefined}>
      {n > 0 ? "+" : ""}
      {formatNumber(n, fmt, 3)} {unit}
      {percent !== null ? ` (${n > 0 ? "+" : ""}${formatPercent(percent, fmt)})` : ""}
    </span>
  );
}

function CompletionSummary({
  order,
  onRetry,
  retrying,
}: {
  order: ProductionOrder;
  onRetry?: () => void;
  retrying: boolean;
}) {
  const { t, tx, fmt } = useI18n();
  const c = order.completion!;
  const failed = order.status === "posting_failed";

  return (
    <section className="space-y-3">
      <h3 className="text-fg text-sm font-semibold">{t("prd.run")}</h3>
      <DescList>
        <DescRow label={t("prd.actualOutput")} mono>
          {formatQuantity({ value: c.actualOutput, unit: order.unit }, fmt)}
        </DescRow>
        <DescRow label={t("prd.theoretical")} mono>
          {c.theoreticalOutput ? formatQuantity({ value: c.theoreticalOutput, unit: order.unit }, fmt) : "—"}
        </DescRow>
        <DescRow label={t("prd.yieldVariance")} mono>
          <VarianceText value={c.yieldVariance} percent={c.yieldVariancePercent} unit={order.unit} />
        </DescRow>
        <DescRow label={t("prd.batchNumber")} mono>
          {c.batchNumber}
        </DescRow>
        <DescRow label={t("prd.productionDate")}>{formatDate(c.productionDate, fmt)}</DescRow>
        <DescRow label={t("prd.expiryDate")}>{c.expiryDate ? formatDate(c.expiryDate, fmt) : "—"}</DescRow>
        <DescRow label={t("prd.totalCost")} mono>
          {formatMoney({ amount: c.totalCostMinor, currency: order.currency }, fmt)}
        </DescRow>
        <DescRow label={t("prd.operator")}>
          {c.completedBy ?? "—"} · {formatDateTime(c.completedAt, fmt)}
        </DescRow>
      </DescList>

      <ul className="border-line divide-line divide-y rounded-lg border text-sm">
        {c.inputs.map((leg) => (
          <li key={leg.itemId} className="flex items-center gap-2 px-3 py-2">
            <span className="text-fg min-w-0 flex-1 truncate">
              {tx(leg.name)} <span className="text-fg-subtle font-mono text-xs">−{formatQuantity({ value: leg.actual, unit: leg.unit }, fmt)}</span>
              {leg.error && !leg.movementId ? <span className="text-bad block text-xs">{leg.error}</span> : null}
            </span>
            <LegBadge posted={Boolean(leg.movementId)} error={leg.error} skipped={Number(leg.actual) <= 0} />
          </li>
        ))}
        <li className="flex items-center gap-2 px-3 py-2">
          <span className="text-fg min-w-0 flex-1 truncate">
            {tx(order.outputName)} <span className="text-fg-subtle font-mono text-xs">+{formatQuantity({ value: c.actualOutput, unit: order.unit }, fmt)}</span>
            {c.outputError && !c.outputMovementId ? <span className="text-bad block text-xs">{c.outputError}</span> : null}
          </span>
          <LegBadge posted={Boolean(c.outputMovementId)} error={c.outputError} skipped={Number(c.actualOutput) <= 0} />
        </li>
      </ul>

      {failed ? (
        <Callout tone="bad" title={t("prd.postingFailed")}>
          {t("prd.postingFailedBody")}
        </Callout>
      ) : null}
      {failed && onRetry ? (
        <Button variant="primary" icon={<RotateCcw size={14} />} onClick={onRetry} loading={retrying}>
          {t("prd.retry")}
        </Button>
      ) : null}
    </section>
  );
}

function LegBadge({ posted, error, skipped }: { posted: boolean; error: string | null; skipped: boolean }) {
  const { t } = useI18n();
  if (posted) return <Badge tone="good">{t("prd.legPosted")}</Badge>;
  if (skipped) return <Badge tone="muted">{t("prd.legNothing")}</Badge>;
  if (error)
    return (
<Badge tone="bad">{t("prd.legFailed")}</Badge>
    );
  return <Badge tone="warn">{t("prd.legPending")}</Badge>;
}
