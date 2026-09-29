"use client";

/**
 * Menu Management — the Recipe section of Add / Edit item (SRS §10.6).
 *
 * The owner builds the recipe one ingredient at a time: "Add ingredient"
 * opens a searchable list of the stock items already in Inventory, and the
 * row that appears asks for the amount one portion uses — a weight for an
 * item stocked by weight, a volume for one stocked by volume, a quantity
 * for one stocked by the piece.
 *
 * When the item has several sizes, each size has its own recipe
 * (FR-MNU-006), shown as one tab per size.
 *
 * Which of the three it is comes from the server's units of measure
 * (`GET /inventory/uoms`): the dimension of the stock item's base unit.
 *
 * Nothing is saved from here: `useItemRecipe` holds the drafts and exposes
 * `saveAll`, which the item editor calls inside its own Save, so the owner
 * never has to press a second Save. Data rules live in
 * `lib/console/menu-management/item-recipe.ts`.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { ConsoleKey } from "@/content/console/en";
import type { Id, Localised, StockItem } from "@/lib/console/types";
import { unitLabel } from "@/lib/console/format";
import {
  EMPTY_RECIPE,
  UnitsUnavailableError,
  defaultUnitFor,
  factorToBase,
  ingredientProblem,
  ingredientsChanged,
  isUnitCode,
  loadStockItems,
  loadUnitCatalogue,
  loadVariantRecipe,
  matchesSearch,
  measureOfItem,
  newKey,
  saveVariantRecipe,
  trimDecimal,
  unitsFor,
  type IngredientDraft,
  type Measure,
  type RecipeUnit,
  type UnitCatalogue,
  type VariantRecipe,
} from "@/lib/console/menu-management/item-recipe";
import { Icon } from "./common";

type T = (key: ConsoleKey) => string;

/** One size of the item. `variantId` is null only for an item not yet created. */
export interface RecipeSize {
  key: string;
  variantId: Id | null;
  name: string;
}

export interface RecipeAccess {
  /** `recipe.view` — see the section at all. */
  view: boolean;
  /** `recipe.edit` (and the right to save the item) — change ingredients. */
  edit: boolean;
  /** `recipe.publish` — a save goes live; without it, it stays a draft. */
  publish: boolean;
  /** `inventory.view` — list stock items for the picker. */
  stock: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** What stops one ingredient being saved as typed. */
export type LineIssue = "amount" | "unit" | "item";

export function lineIssue(line: IngredientDraft, item: StockItem | undefined, units: UnitCatalogue | null): LineIssue | null {
  if (!item) return "item";
  if (ingredientProblem(line)) return "amount";
  if (units && factorToBase(units, item, line.unitId) === null) return "unit";
  return null;
}

export interface ItemRecipeState {
  /** `noUnits`: the server publishes no units of measure, so nothing can be measured. */
  status: "loading" | "ready" | "error" | "noUnits";
  units: UnitCatalogue | null;
  stockItems: StockItem[];
  stockById: Map<Id, StockItem>;
  loaded: Record<string, VariantRecipe>;
  drafts: Record<string, IngredientDraft[]>;
  activeKey: string;
  setActiveKey: (key: string) => void;
  setDraft: (key: string, next: IngredientDraft[]) => void;
  /** Some size's ingredients differ from what was loaded. */
  dirty: boolean;
  /** The first ingredient that can't be saved as typed, if any. */
  problem: { sizeKey: string; index: number; issue: LineIssue } | null;
  /** A menu-item recipe yields one piece; without a piece unit nothing can be saved. */
  missingPieceUnit: boolean;
  /** Save every changed size. `variantIdOf` resolves sizes created in the same Save. */
  saveAll: (variantIdOf: (size: RecipeSize) => Id | null, itemName: Localised) => Promise<void>;
}

export function useItemRecipe(sizes: RecipeSize[], access: RecipeAccess): ItemRecipeState {
  const [status, setStatus] = useState<ItemRecipeState["status"]>("loading");
  const [units, setUnits] = useState<UnitCatalogue | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loaded, setLoaded] = useState<Record<string, VariantRecipe>>({});
  const [drafts, setDrafts] = useState<Record<string, IngredientDraft[]>>({});
  const [activeKey, setActiveKey] = useState(sizes[0]?.key ?? "");

  // Sizes are fixed for the life of the drawer; key the load on their ids.
  const sizeSignature = sizes.map((s) => `${s.key}:${s.variantId ?? ""}`).join("|");

  useEffect(() => {
    if (!access.view) return;
    let cancelled = false;
    (async () => {
      try {
        const [catalogue, items, recipes] = await Promise.all([
          loadUnitCatalogue(),
          access.stock ? loadStockItems() : Promise.resolve([] as StockItem[]),
          Promise.all(sizes.map((size) => (size.variantId ? loadVariantRecipe(size.variantId) : Promise.resolve(EMPTY_RECIPE)))),
        ]);
        if (cancelled) return;
        const byKey: Record<string, VariantRecipe> = {};
        const draftByKey: Record<string, IngredientDraft[]> = {};
        sizes.forEach((size, index) => {
          byKey[size.key] = recipes[index] ?? EMPTY_RECIPE;
          draftByKey[size.key] = (recipes[index] ?? EMPTY_RECIPE).ingredients;
        });
        setUnits(catalogue);
        setStockItems(items);
        setLoaded(byKey);
        setDrafts(draftByKey);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof UnitsUnavailableError ? "noUnits" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `sizes` is captured through its signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeSignature, access.view, access.stock]);

  const stockById = useMemo(() => new Map(stockItems.map((item) => [item.id, item])), [stockItems]);

  const changedKeys = useMemo(
    () =>
      status === "ready"
        ? sizes.filter((size) => ingredientsChanged(loaded[size.key]?.ingredients ?? [], drafts[size.key] ?? [])).map((s) => s.key)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, loaded, drafts, sizeSignature],
  );

  let problem: ItemRecipeState["problem"] = null;
  for (const size of sizes) {
    // Only what the user changed can block Save; an untouched size is left as it is.
    if (!changedKeys.includes(size.key)) continue;
    const lines = drafts[size.key] ?? [];
    const index = lines.findIndex((line) => lineIssue(line, stockById.get(line.stockItemId), units) !== null);
    if (index !== -1) {
      problem = { sizeKey: size.key, index, issue: lineIssue(lines[index]!, stockById.get(lines[index]!.stockItemId), units)! };
      break;
    }
  }
  const missingPieceUnit = status === "ready" && units !== null && units.pieceUnitId === null;

  async function saveAll(variantIdOf: (size: RecipeSize) => Id | null, itemName: Localised) {
    if (!access.edit || !units) return;
    for (const size of sizes) {
      if (!changedKeys.includes(size.key)) continue;
      const variantId = variantIdOf(size);
      if (!variantId) continue;
      await saveVariantRecipe({
        variantId,
        name: sizes.length > 1 ? { en: `${itemName.en} — ${size.name}`, ar: `${itemName.ar} — ${size.name}` } : itemName,
        loaded: loaded[size.key] ?? EMPTY_RECIPE,
        ingredients: drafts[size.key] ?? [],
        stockItems: stockById,
        units,
        publish: access.publish,
      });
    }
  }

  return {
    status,
    units,
    stockItems,
    stockById,
    loaded,
    drafts,
    activeKey,
    setActiveKey,
    setDraft: (key, next) => setDrafts((current) => ({ ...current, [key]: next })),
    dirty: changedKeys.length > 0,
    problem: access.edit ? problem : null,
    missingPieceUnit,
    saveAll,
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const MEASURE_LABEL: Record<Measure, ConsoleKey> = {
  weight: "rcp.byWeight",
  volume: "rcp.byVolume",
  count: "rcp.byPiece",
};

const AMOUNT_PLACEHOLDER: Record<Measure, ConsoleKey> = {
  weight: "rcp.weight",
  volume: "rcp.volume",
  count: "rcp.quantity",
};

export function ItemRecipeSection({
  sizes,
  state,
  access,
  t,
  tx,
  locale,
}: {
  sizes: RecipeSize[];
  state: ItemRecipeState;
  access: RecipeAccess;
  t: T;
  tx: (value: Localised) => string;
  locale: "en" | "ar";
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);

  if (state.status === "loading") return <p className="section-help">{t("rcp.loading")}</p>;
  if (state.status === "noUnits") return <p className="warn-text">{t("rcp.unitsUnavailable")}</p>;
  if (state.status === "error" || !state.units) return <p className="warn-text">{t("rcp.loadError")}</p>;
  const units = state.units;

  const size = sizes.find((s) => s.key === state.activeKey) ?? sizes[0];
  if (!size) return null;
  const lines = state.drafts[size.key] ?? [];
  const loaded = state.loaded[size.key] ?? EMPTY_RECIPE;
  const editable = access.edit && !state.missingPieceUnit;
  const used = new Set(lines.map((line) => line.stockItemId));

  function update(key: string, patch: Partial<IngredientDraft>) {
    state.setDraft(
      size!.key,
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function add(item: StockItem) {
    const key = newKey();
    state.setDraft(size!.key, [...lines, { key, stockItemId: item.id, amount: "", unitId: defaultUnitFor(units, item) }]);
    setFocusKey(key);
  }

  function remove(key: string) {
    state.setDraft(
      size!.key,
      lines.filter((line) => line.key !== key),
    );
  }

  return (
    <div className="recipe">
      <p className="section-help">{t("rcp.help")}</p>

      {sizes.length > 1 ? (
        <div className="recipe-sizes" role="tablist" aria-label={t("rcp.size")}>
          {sizes.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={s.key === size.key}
              className={s.key === size.key ? "chosen" : ""}
              onClick={() => state.setActiveKey(s.key)}
            >
              {s.name}
              {state.problem?.sizeKey === s.key ? <span className="recipe-dot" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {loaded.version ? (
        <p className="section-help">
          {(loaded.version.status === "published" ? t("rcp.live") : t("rcp.draft")).replace("{n}", String(loaded.version.number))}
        </p>
      ) : null}
      {state.missingPieceUnit ? <p className="warn-text">{t("rcp.noPieceUnit")}</p> : null}
      {editable && !access.publish ? <p className="warn-text">{t("rcp.draftOnly")}</p> : null}
      {!access.edit ? <p className="section-help">{t("rcp.readOnly")}</p> : null}

      {lines.length > 0 || loaded.kept.length > 0 ? (
        <div className="recipe-lines">
          <div className="recipe-head">
            <span>{t("rcp.ingredient")}</span>
            <span>{t("rcp.amountPerItem")}</span>
            <span></span>
          </div>
          {lines.map((line) => {
            const item = state.stockById.get(line.stockItemId);
            return (
              <IngredientRow
                key={line.key}
                line={line}
                item={item}
                units={units}
                editable={editable}
                autoFocus={focusKey === line.key}
                t={t}
                tx={tx}
                locale={locale}
                onChange={(patch) => update(line.key, patch)}
                onRemove={() => remove(line.key)}
              />
            );
          })}
          {loaded.kept.map((line) => (
            <div key={line.id} className="recipe-row kept">
              <div className="recipe-name">
                <strong>{tx(line.componentName)}</strong>
                <small>{t("rcp.prepItem")}</small>
              </div>
              <div className="static-price">
                {trimDecimal(Number(line.quantity.value))} {labelOfUnit(units.byId.get(line.unitId ?? line.quantity.unit), line.quantity.unit, locale)}
              </div>
              <span></span>
            </div>
          ))}
          {loaded.kept.length > 0 ? <p className="section-help">{t("rcp.prepItemNote")}</p> : null}
        </div>
      ) : (
        <p className="recipe-empty">{t("rcp.empty")}</p>
      )}

      {editable ? (
        !access.stock ? (
          <p className="warn-text">{t("rcp.needInventory")}</p>
        ) : state.stockItems.length === 0 ? (
          <p className="section-help">
            {t("rcp.noStockItems")}{" "}
            <Link className="link-button" href="/inventory/items">
              {t("rcp.goToInventory")}
            </Link>
          </p>
        ) : (
          <IngredientPicker items={state.stockItems} used={used} units={units} t={t} tx={tx} onPick={add} />
        )
      ) : null}
    </div>
  );
}

/** A unit as the user reads it: the console's localised label for a known code, else the server's code. */
function labelOfUnit(unit: RecipeUnit | undefined, fallback: string, locale: "en" | "ar"): string {
  const code = unit?.code ?? fallback;
  return isUnitCode(code) ? unitLabel(code, locale) : code;
}

function IngredientRow({
  line,
  item,
  units,
  editable,
  autoFocus,
  t,
  tx,
  locale,
  onChange,
  onRemove,
}: {
  line: IngredientDraft;
  item: StockItem | undefined;
  units: UnitCatalogue;
  editable: boolean;
  autoFocus: boolean;
  t: T;
  tx: (value: Localised) => string;
  locale: "en" | "ar";
  onChange: (patch: Partial<IngredientDraft>) => void;
  onRemove: () => void;
}) {
  const measure: Measure = item ? measureOfItem(units, item) : "count";
  const options = item ? unitsFor(units, item) : [];
  // A saved line in a unit that no longer converts is still shown, so it can be fixed.
  if (!options.some((unit) => unit.id === line.unitId)) {
    const current = units.byId.get(line.unitId);
    options.push(current ?? { id: line.unitId, code: line.unitId, dimension: "" });
  }
  const issue = lineIssue(line, item, units);
  const invalid = (issue === "amount" && line.amount.trim() !== "") || issue === "unit";
  const name = item ? tx(item.name) : t("rcp.unknownItem");

  return (
    <div className="recipe-row">
      <div className="recipe-name">
        <strong>{name}</strong>
        <small>{t(MEASURE_LABEL[measure])}</small>
      </div>
      <div className={invalid ? "amount-field invalid" : "amount-field"}>
        <input
          type="number"
          min="0"
          step={measure === "count" ? "1" : "any"}
          inputMode="decimal"
          value={line.amount}
          placeholder={t(AMOUNT_PLACEHOLDER[measure])}
          aria-label={`${name} — ${t(AMOUNT_PLACEHOLDER[measure])}`}
          autoFocus={autoFocus}
          disabled={!editable}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
        {options.length > 1 ? (
          <select
            aria-label={`${name} — ${t("rcp.unit")}`}
            value={line.unitId}
            disabled={!editable}
            onChange={(e) => onChange({ unitId: e.target.value })}
          >
            {options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {labelOfUnit(unit, unit.code, locale)}
              </option>
            ))}
          </select>
        ) : (
          <span>{labelOfUnit(options[0], line.unitId, locale)}</span>
        )}
      </div>
      {editable ? (
        <button className="row-remove" aria-label={`${t("rcp.remove")} — ${name}`} onClick={onRemove}>
          <Icon name="trash" size={14} />
        </button>
      ) : (
        <span></span>
      )}
    </div>
  );
}

/**
 * "Add ingredient" → a search box over the stock items not yet in this
 * recipe. Arrow keys move, Enter picks, Escape closes (without closing the
 * item drawer behind it).
 */
function IngredientPicker({
  items,
  used,
  units,
  t,
  tx,
  onPick,
}: {
  items: StockItem[];
  used: Set<Id>;
  units: UnitCatalogue;
  t: T;
  tx: (value: Localised) => string;
  onPick: (item: StockItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = useMemo(
    () => items.filter((item) => !used.has(item.id) && matchesSearch(item, query)),
    [items, used, query],
  );

  useEffect(() => {
    if (!open) return;
    // Bring the whole list into view, not just the search box.
    wrapRef.current?.scrollIntoView?.({ block: "nearest" });
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }

  function pick(item: StockItem) {
    onPick(item);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = options[highlight];
      if (item) pick(item);
    } else if (event.key === "Escape") {
      // Close the list only — not the item drawer, which listens on window.
      event.stopPropagation();
      close();
    }
  }

  const allUsed = items.every((item) => used.has(item.id));

  return (
    <div className="ingredient-picker" ref={wrapRef}>
      {open ? (
        <div className="picker-panel">
          <div className="search">
            <Icon name="search" size={15} />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={options[highlight] ? `${listId}-${options[highlight]!.id}` : undefined}
              value={query}
              placeholder={t("rcp.searchStock")}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listId} role="listbox" className="picker-list">
            {options.map((item, index) => (
              <li
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={index === highlight}
                className={index === highlight ? "active" : ""}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
              >
                <span>
                  <strong>{tx(item.name)}</strong>
                  <small>{tx(item.category)}</small>
                </span>
                <em>{t(MEASURE_LABEL[measureOfItem(units, item)])}</em>
              </li>
            ))}
            {options.length === 0 ? (
              <li className="picker-empty" role="presentation">
                {allUsed ? t("rcp.allAdded") : t("rcp.noMatches").replace("{q}", query.trim())}
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <button className="add-ingredient" onClick={() => setOpen(true)} disabled={allUsed}>
          <Icon name="plus" size={15} /> {t("rcp.addIngredient")}
        </button>
      )}
    </div>
  );
}

/** "Recipe — Chicken breast (Large): enter an amount above zero" */
export function recipeProblemText(state: ItemRecipeState, sizes: RecipeSize[], t: T, tx: (value: Localised) => string): string {
  if (!state.problem) return "";
  const { sizeKey, index, issue } = state.problem;
  const line = state.drafts[sizeKey]?.[index];
  const item = line ? state.stockById.get(line.stockItemId) : undefined;
  const size = sizes.length > 1 ? ` (${sizes.find((s) => s.key === sizeKey)?.name ?? ""})` : "";
  const why: Record<LineIssue, ConsoleKey> = { amount: "rcp.errAmount", unit: "rcp.errUnit", item: "rcp.errItem" };
  return `${t("rcp.title")} — ${item ? tx(item.name) : t("rcp.unknownItem")}${size}: ${t(why[issue])}`;
}
