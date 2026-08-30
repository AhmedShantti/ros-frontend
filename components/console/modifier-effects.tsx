"use client";

/**
 * A modifier's recipe effects — FR-MNU-013.
 *
 * The price delta is what the guest pays; this is what the store loses.
 * "Extra cheese" is an `add` of 30 g against a stock item, "no cheese" is a
 * `remove_all` of it. Without these rows a customised sale depletes the base
 * recipe and the stock ledger drifts by exactly the modifier — which is the
 * failure this screen exists to prevent, and is invisible until a count.
 *
 * ## Two constraints the API imposes, and one it does not resolve
 *
 *  - `PUT /modifiers/{id}/recipe-effects` is a **full replace**. There is no
 *    per-effect edit, so the editor holds the whole set and sends it back
 *    whole. Anything it cannot express is carried through untouched rather
 *    than dropped — a save must never lose a row the UI merely did not
 *    understand.
 *  - A `remove_all` carries no quantity and no unit; sending either is a 400.
 *  - An `add` needs a **unit id**, and the API publishes no unit catalogue.
 *    The one place a real unit id is available is a stock item's own base
 *    unit, so an `add` is offered against stock items only. A sub-recipe
 *    `add` that already exists still renders, and still round-trips.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Modifier, Recipe, StockItem } from "@/lib/console/types";
import type { ModifierRecipeEffect, ModifierRecipeEffectInput } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission } from "@/lib/console/providers";
import { AsyncPanel } from "@/components/console/states";
import {
  Button,
  Callout,
  Drawer,
  Field,
  Input,
  Select,
} from "@/components/console/ui";

/** The read side: what this modifier currently does, in words. */
export function ModifierEffects({
  modifier,
  onSaved,
}: {
  modifier: Modifier;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const canManage = usePermission("menu.manage");
  const [editing, setEditing] = useState(false);
  const [nonce, setNonce] = useState(0);

  const effects = useAsync(
    () => services.production.modifierRecipeEffects(modifier.id),
    [modifier.id, nonce],
  );

  const catalogue = useCatalogueNames();

  return (
    <div className="mt-1.5">
      <AsyncPanel
        state={effects}
        skeleton={<span className="text-fg-subtle text-xs">…</span>}
        isEmpty={(rows) => rows.length === 0}
        empty={<p className="text-fg-subtle text-xs">{t("menu.noRecipeEffects")}</p>}
      >
        {(rows) => (
          <ul className="space-y-1">
            {rows.map((effect) => (
              <li
                key={effect.id}
                className="text-fg-subtle flex flex-wrap items-baseline gap-x-2 text-xs"
              >
                <span className="text-fg-muted">{catalogue.nameOf(effect)}</span>
                <span className="font-mono">
                  {effect.operation === "remove_all"
                    ? t("menu.effectRemoveAll")
                    : `+ ${effect.quantity ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>

      {canManage ? (
        <Button variant="ghost" className="mt-1" onClick={() => setEditing(true)}>
          {t("menu.editEffects")}
        </Button>
      ) : null}

      {editing ? (
        <EffectsEditor
          modifier={modifier}
          initial={effects.data ?? []}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNonce((n) => n + 1);
            onSaved(t("menu.effectsSaved"));
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A row being edited. `locked` rows are ones the editor cannot express. */
interface Row {
  key: string;
  operation: "add" | "remove_all";
  componentType: "stock_item" | "sub_recipe";
  componentId: string;
  quantity: string;
  /** The unit id to send. Derived from the stock item, or kept from the server. */
  unitId: string | null;
  locked: boolean;
}

function EffectsEditor({
  modifier,
  initial,
  onClose,
  onSaved,
}: {
  modifier: Modifier;
  initial: ModifierRecipeEffect[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const catalogue = useCatalogueNames();

  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((effect, index) => ({
      key: effect.id || `row-${index}`,
      operation: effect.operation,
      componentType: effect.componentType,
      componentId: effect.stockItemId ?? effect.subRecipeId ?? "",
      quantity: effect.quantity ?? "",
      unitId: effect.unitId,
      // A sub-recipe `add` needs a unit id this console cannot mint. It is
      // shown and preserved, but not edited.
      locked: effect.operation === "add" && effect.componentType === "sub_recipe",
    })),
  );

  const stockItems = catalogue.stockItems;
  const recipes = catalogue.recipes;

  function edit(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /**
   * A stock item's base unit is the unit the `add` is denominated in. It is
   * resolved at edit time rather than at save time, so a row whose item has
   * no unit id can be reported before the request goes out.
   */
  function pickComponent(key: string, componentId: string) {
    const item = stockItems.find((row) => row.id === componentId);
    edit(key, { componentId, unitId: item?.baseUnitId ?? null });
  }

  const incomplete = rows.some(
    (row) => !row.componentId || (row.operation === "add" && row.quantity.trim() === ""),
  );
  const missingUnit = rows.some(
    (row) => !row.locked && row.operation === "add" && !row.unitId,
  );

  async function save() {
    if (incomplete || missingUnit) return;

    const effects: ModifierRecipeEffectInput[] = rows.map((row, index) => ({
      sequence: index,
      operation: row.operation,
      componentType: row.componentType,
      stockItemId: row.componentType === "stock_item" ? row.componentId : undefined,
      subRecipeId: row.componentType === "sub_recipe" ? row.componentId : undefined,
      quantity: row.operation === "add" ? row.quantity.trim() : undefined,
      unitId: row.operation === "add" ? (row.unitId ?? undefined) : undefined,
    }));

    await action.run(() => services.production.replaceModifierRecipeEffects(modifier.id, effects), {
      onSuccess: onSaved,
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${tx(modifier.name)} · ${t("menu.recipeEffects")}`}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={incomplete || missingUnit}
            onClick={save}
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("menu.recipeEffectsNote")}</Callout>
        <Callout tone="muted">{t("menu.effectReplaceNote")}</Callout>
        {incomplete ? <Callout tone="warn">{t("menu.effectIncomplete")}</Callout> : null}
        {missingUnit ? <Callout tone="warn">{t("menu.effectNoUnit")}</Callout> : null}

        {rows.length === 0 ? (
          <p className="text-fg-subtle text-sm">{t("menu.noRecipeEffects")}</p>
        ) : null}

        {rows.map((row) => (
          <div key={row.key} className="border-line space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-subtle text-xs">
                {row.locked ? t("menu.effectSubRecipe") : ""}
              </span>
              <Button
                variant="ghost"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                <Trash2 size={13} aria-hidden />
                <span className="sr-only">{t("common.remove")}</span>
              </Button>
            </div>

            <Field label={t("menu.effectOperation")}>
              <Select
                value={row.operation}
                disabled={row.locked}
                onChange={(event) =>
                  edit(row.key, {
                    operation: event.target.value as Row["operation"],
                    // A `remove_all` takes out whatever is there; carrying a
                    // quantity forward would send a field the API refuses.
                    quantity: event.target.value === "add" ? row.quantity : "",
                  })
                }
              >
                <option value="add">{t("menu.effectAdd")}</option>
                <option value="remove_all">{t("menu.effectRemoveAll")}</option>
              </Select>
            </Field>

            <Field label={t("menu.effectComponent")} required>
              <Select
                value={row.componentType}
                disabled={row.locked}
                onChange={(event) =>
                  edit(row.key, {
                    componentType: event.target.value as Row["componentType"],
                    componentId: "",
                    unitId: null,
                  })
                }
              >
                <option value="stock_item">{t("menu.effectStockItem")}</option>
                <option value="sub_recipe">{t("menu.effectSubRecipe")}</option>
              </Select>
            </Field>

            <Field label={t("common.name")} required>
              <Select
                value={row.componentId}
                disabled={row.locked}
                onChange={(event) =>
                  row.componentType === "stock_item"
                    ? pickComponent(row.key, event.target.value)
                    : edit(row.key, { componentId: event.target.value })
                }
              >
                <option value="">—</option>
                {(row.componentType === "stock_item" ? stockItems : recipes).map((option) => (
                  <option key={option.id} value={option.id}>
                    {tx(option.name)}
                  </option>
                ))}
              </Select>
            </Field>

            {row.operation === "add" ? (
              <Field
                label={t("menu.effectQuantity")}
                hint={row.unitId ? undefined : t("menu.effectNoUnit")}
                required
              >
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  disabled={row.locked}
                  value={row.quantity}
                  onChange={(event) => edit(row.key, { quantity: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
        ))}

        <Button
          variant="ghost"
          icon={<Plus size={13} />}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: `new-${current.length}-${Date.now()}`,
                operation: "add",
                componentType: "stock_item",
                componentId: "",
                quantity: "",
                unitId: null,
                locked: false,
              },
            ])
          }
        >
          {t("menu.addEffect")}
        </Button>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * Stock items and recipes, once, for every effect row that needs a name.
 *
 * An effect references a component by id and nothing else, so without these
 * two lists the screen can only show a UUID. They are small tenant-level
 * tables, and React Query is not in play here, so the lists are fetched per
 * mount and shared down through props rather than refetched per row.
 */
function useCatalogueNames() {
  const items = useAsync(() => services.inventory.items.list({ limit: 500 }), []);
  const recipeRows = useAsync(() => services.catalogue.recipes.list({ limit: 500 }), []);

  const stockItems = useMemo<StockItem[]>(() => items.data?.rows ?? [], [items.data]);
  const recipes = useMemo<Recipe[]>(() => recipeRows.data?.rows ?? [], [recipeRows.data]);

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of stockItems) map.set(item.id, item.name.en || item.name.ar || item.sku);
    for (const recipe of recipes) map.set(recipe.id, recipe.name.en || recipe.name.ar);
    return map;
  }, [stockItems, recipes]);

  return {
    stockItems,
    recipes,
    nameOf: (effect: ModifierRecipeEffect) => {
      const id = effect.stockItemId ?? effect.subRecipeId ?? "";
      return byId.get(id) ?? id;
    },
  };
}
