"use client";

/**
 * Menu Management — LIVE workspace (production/HTTP mode).
 *
 * Visual/structural target: commit `2d4a054` (`./menu-management.tsx` +
 * `./cards.tsx`/`./item-editor.tsx`/`./combo-editor.tsx`/
 * `./create-menu-modal.tsx`/`./menu-preview.tsx`, and their shared
 * `menu-management.css`, already token-based and dark-mode-safe — see that
 * file's own `.dark` block). This component reuses that SAME stylesheet and
 * class structure, but every read and write goes through the real
 * `/catalogue/*` API — it only offers what the backend actually supports:
 *
 *   Menus       — list / create / activate-deactivate / branch assignment /
 *                 branch resolution (no draft/publish lifecycle exists, so
 *                 there is no publish button here).
 *   Categories  — list / create (no delete or deactivate endpoint exists).
 *   Items       — create / edit / category placement / tax class /
 *                 available-unavailable(86) / variants, each directly
 *                 priced — there is no Price List concept anywhere in this
 *                 workspace; a variant's price is set in the same
 *                 create/edit step and edited directly.
 *   Combos      — REAL, COMBO-COMPONENT-IDENTITY-P0 (FR-POS-030/031/032):
 *                 `MenuItem.isCombo` + a directly-priced variant carrying
 *                 pricing-strategy/discount/allocation-basis metadata, each
 *                 slot a real `ModifierGroup`, each option a real `Modifier`
 *                 linked to an actual existing item's variant. CREATE and
 *                 EDIT: reopening a saved combo reads its real parts via
 *                 `GET items/:itemId/modifier-groups`
 *                 (CONSOLE-COMBO-READ-P0) and lets basic info/pricing/an
 *                 existing part's label, plus brand-new parts/options, be
 *                 changed through real mutations — see
 *                 `live-combo-editor.tsx`'s docblock for exactly which
 *                 single-option edits still have no backend mutation to
 *                 back them (never faked; rendered read-only instead).
 *   Availability — 86/restore through the real availability-rules flow,
 *                  with a truthful reason (audit-only, never read back) and
 *                  a genuine (lazily-evaluated) auto-re-enable time.
 *   Customizations — the reusable Modifier Group/Modifier catalogue
 *                  (create/read/update groups; read/create modifiers, no
 *                  edit/delete — the API supports none). Deliberately does
 *                  NOT manage ORDINARY item↔group attachment as its own
 *                  management UI: `POST /catalogue/items/:id/modifier-
 *                  groups` is still write-only for that purpose (the new
 *                  read endpoint above exists specifically to reopen a
 *                  COMBO's parts, not as a general attachment editor here).
 *   Customer preview — read-only, client-side, over already-loaded/read
 *                  data (a combo's real parts via the same
 *                  CONSOLE-COMBO-READ-P0 endpoint); no new backend
 *                  contract beyond that read, no channel switch (no
 *                  per-channel price exists to switch between).
 *
 * Deliberately NOT here: Recipes, a general item↔group attachment editor
 * (see above), a "Hidden" status (there is no such flag — "not placed in
 * any category" is a placement condition, never a boolean), and "Duplicate"
 * (no clone endpoint exists). They stay on `/menu/recipes`/`/menu/items` or
 * are simply absent, rather than faked.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Store, TriangleAlert } from "lucide-react";
import type { Currency, Localised, Menu, Modifier, ModifierGroup } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage, type AsyncState } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  currencyExponent,
  excessPrecision,
  formatMoney,
  formatNumber,
  signedMinorFromInput,
  type FormatOptions,
} from "@/lib/console/format";
import { MODIFIER_KIND, labelOf } from "@/lib/console/labels";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Drawer, Field, Select, Toast, Toggle } from "@/components/console/ui";
import {
  createMenuCategory,
  listItemsWithPlacements,
  listMenuCategories,
  type LiveCategory,
  type LiveItem,
} from "@/lib/console/menu-management/live-adapter";
import { EmptyState, Icon } from "./common";
import "./menu-management.css";
import { LiveComboCard, LiveItemCard } from "./live-cards";
import LiveItemEditor from "./live-item-editor";
import LiveComboEditor from "./live-combo-editor";
import LiveCreateMenuModal from "./live-create-menu-modal";
import LiveMenuPreview from "./live-menu-preview";

// "Sort by" choices — client-side, over the already-loaded canonical data.
type SortKey = "menu" | "name-asc" | "name-desc" | "price-asc" | "price-desc" | "status";
const SORTS: { key: SortKey; label: ConsoleKey }[] = [
  { key: "menu", label: "mm.sortMenuOrder" },
  { key: "name-asc", label: "mm.sortNameAsc" },
  { key: "name-desc", label: "mm.sortNameDesc" },
  { key: "price-asc", label: "mm.sortPriceAsc" },
  { key: "price-desc", label: "mm.sortPriceDesc" },
  { key: "status", label: "mm.sortAvailability" },
];

function sortItems(list: LiveItem[], sortBy: SortKey, tx: (v: Localised) => string): LiveItem[] {
  if (sortBy === "menu") return list;
  const byName = (a: LiveItem, b: LiveItem) => tx(a.name).localeCompare(tx(b.name), undefined, { sensitivity: "base", numeric: true });
  const priceOf = (row: LiveItem) => row.variants[0]?.basePrice.amount ?? 0;
  const cmp: Record<Exclude<SortKey, "menu">, (a: LiveItem, b: LiveItem) => number> = {
    "name-asc": byName,
    "name-desc": (a, b) => byName(b, a),
    "price-asc": (a, b) => priceOf(a) - priceOf(b) || byName(a, b),
    "price-desc": (a, b) => priceOf(b) - priceOf(a) || byName(a, b),
    status: (a, b) => Number(!a.available) - Number(!b.available) || byName(a, b),
  };
  return [...list].sort(cmp[sortBy]);
}

const COMBOS = "combos";
type View = "all" | typeof COMBOS | string;

/** A stable key for "has the tenant/brand/branch scope changed". */
function scopeKeyOf(scope: { tenantId: string; brandId: string | null; branchId: string | null }): string {
  return `${scope.tenantId}|${scope.brandId ?? ""}|${scope.branchId ?? ""}`;
}

/**
 * FR-FIN — canonical currency source: the current branch's own currency,
 * falling back to the tenant's default when no branch is in scope (a
 * tenant-wide view). Never `NEXT_PUBLIC_MENU_CURRENCY` and never a hardcoded
 * code — see `lib/console/menu-management/menu.ts` for the legacy demo's env
 * var, which this live workspace does not import.
 */
function currentCurrency(session: { branch: { currency: Currency } | null; tenant: { baseCurrency: Currency } }): Currency {
  return session.branch?.currency ?? session.tenant.baseCurrency;
}

/**
 * Reference-style scope selector (`.scope-bar`/`.scope-select`/`.scope-
 * dropdown` — the SAME classes the demo `menu-management.tsx`'s own
 * `ScopeSelect` already uses). Unlike the demo's local-only filter, this one
 * drives the REAL console session scope (`useSession().setBrandId`/
 * `setBranchId` — the exact function the console's own top-bar switcher
 * calls) rather than a second, disconnected filtering mechanism: picking a
 * brand/branch here changes what `menus`/`items` below actually fetch.
 */
function ScopeSelect({
  icon,
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  icon: "store" | "pin";
  label: string;
  allLabel: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <div className="scope-select">
      <button className={`scope-btn ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name={icon} size={15} />
        <span className="scope-text">
          <small>{label}</small>
          {selected ? selected.name : allLabel}
        </span>
        <span className="menu-select-chev">
          <Icon name="chevron" size={15} />
        </span>
      </button>
      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)}></div>
          <div className="scope-dropdown" role="listbox">
            <button className={value == null ? "selected" : ""} onClick={() => pick(null)}>
              {allLabel}
              {value == null ? <Icon name="check" size={14} /> : null}
            </button>
            {options.map((o) => (
              <button key={o.id} className={o.id === value ? "selected" : ""} onClick={() => pick(o.id)}>
                {o.name}
                {o.id === value ? <Icon name="check" size={14} /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function LiveMenuManagement() {
  const { t, tx, fmt } = useI18n();
  const session = useSession();
  const { scope, availableBranches, availableBrands, setBrandId, setBranchId } = session;
  const canManage = usePermission("menu.item.manage");
  const canToggleAvailability = usePermission("menu.availability.toggle");
  const canChangePrice = usePermission("menu.price.change");
  const currency = currentCurrency(session);

  const [message, setMessage] = useTransientMessage();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("menu");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [creatingMenu, setCreatingMenu] = useState(false);
  const [managingBranches, setManagingBranches] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editorState, setEditorState] = useState<{ item?: LiveItem } | null>(null);
  const [comboEditor, setComboEditor] = useState<{ item: LiveItem | null } | null>(null);
  const [customizationsOpen, setCustomizationsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const menus = useAsync(
    () => services.catalogue.menus.list({ limit: 200, scope }),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const menuRows = useMemo(() => menus.data?.rows ?? [], [menus.data]);

  // Adjusted during render, not in an effect — the same "storing information
  // from previous renders" pattern the demo workspace uses for its own menu
  // switch — so a scope change or the menu list resolving is reflected
  // before anything paints.
  const [scopeKeySeen, setScopeKeySeen] = useState(() => scopeKeyOf(scope));
  const currentScopeKey = scopeKeyOf(scope);
  let effectiveMenuId = menuId;
  if (currentScopeKey !== scopeKeySeen) {
    setScopeKeySeen(currentScopeKey);
    setMenuId(null);
    effectiveMenuId = null;
  } else if (!menus.loading && (effectiveMenuId === null || !menuRows.some((row) => row.id === effectiveMenuId))) {
    const fallback = menuRows[0]?.id ?? null;
    if (fallback !== menuId) setMenuId(fallback);
    effectiveMenuId = fallback;
  }

  const currentMenu = menuRows.find((row) => row.id === effectiveMenuId) ?? null;

  const categories = useAsync(
    () => (effectiveMenuId ? listMenuCategories(effectiveMenuId) : Promise.resolve([] as LiveCategory[])),
    [effectiveMenuId],
  );
  const categoryRows = useMemo(() => categories.data ?? [], [categories.data]);

  const items = useAsync(
    () => listItemsWithPlacements(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const allItemRows = useMemo(() => items.data ?? [], [items.data]);

  // Items placed in one of THIS menu's categories.
  const categoryIds = useMemo(() => new Set(categoryRows.map((row) => row.id)), [categoryRows]);
  const menuItemRows = useMemo(
    () => allItemRows.filter((row) => row.placements.some((p) => categoryIds.has(p.categoryId))),
    [allItemRows, categoryIds],
  );
  const nonComboRows = useMemo(() => menuItemRows.filter((row) => !row.isCombo), [menuItemRows]);
  const comboRows = useMemo(() => menuItemRows.filter((row) => row.isCombo), [menuItemRows]);

  // Scope bar — the branch selector's own option list narrows to the
  // currently-selected brand's branches, exactly like the reference.
  const scopedBranchOptions = useMemo(
    () => availableBranches.filter((b) => scope.brandId == null || b.brandId === scope.brandId),
    [availableBranches, scope.brandId],
  );

  // A different menu always starts on "All items" with an empty search —
  // the same render-time adjustment as above, not an effect.
  const [viewForMenuId, setViewForMenuId] = useState(effectiveMenuId);
  if (effectiveMenuId !== viewForMenuId) {
    setViewForMenuId(effectiveMenuId);
    setView("all");
    setSearch("");
  }

  const category = categoryRows.find((row) => row.id === view) ?? null;
  const q = search.trim().toLowerCase();
  const matches = (row: LiveItem) => !q || `${tx(row.name)} ${tx(row.description)}`.toLowerCase().includes(q);
  const baseList =
    view === COMBOS ? comboRows : view === "all" ? nonComboRows : nonComboRows.filter((row) => row.placements.some((p) => p.categoryId === view));
  const shownItems = sortItems(baseList.filter(matches), sortBy, tx);

  async function toggleMenuActive() {
    if (!currentMenu) return;
    await services.catalogue.setMenuActive(currentMenu.id, !currentMenu.active).then(
      () => {
        setMessage(currentMenu.active ? t("menu.menuDeactivated") : t("menu.menuActivated"));
        menus.reload();
      },
      (error: unknown) => setMessage(error instanceof Error ? error.message : t("state.errorTitle")),
    );
  }

  async function submitCategory() {
    if (!effectiveMenuId || !categoryName.trim()) return;
    try {
      await createMenuCategory(effectiveMenuId, { name: categoryName.trim(), sortOrder: categoryRows.length });
      setCategoryName("");
      setCreatingCategory(false);
      setMessage(t("menu.categoryCreated"));
      categories.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("state.errorTitle"));
    }
  }

  async function toggle86(item: LiveItem) {
    if (item.available) {
      // Opens the reason prompt inside the item editor — a genuine 86 always
      // requires a reason, so the quick toolbar action opens the full
      // editor rather than skipping that step.
      setEditorState({ item });
      return;
    }
    try {
      await services.catalogue.toggleAvailability(item.id, true);
      setMessage(t("menu.restored"));
      items.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("state.errorTitle"));
    }
  }

  /** The row menu's real "Deactivate" — same `items.remove()` the item editor's own footer button already uses. */
  async function deactivateItem(item: LiveItem) {
    try {
      await services.catalogue.items.remove(item.id);
      setMessage(t("common.deactivate"));
      items.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("state.errorTitle"));
    }
  }

  if (menus.loading && menuRows.length === 0) {
    return (
      <div className="mm-root menu-page">
        <AsyncPanel state={menus}>{() => null}</AsyncPanel>
      </div>
    );
  }

  return (
    <div className="mm-root menu-page">
      <section className="content">
        <div className="scope-bar">
          <ScopeSelect
            icon="store"
            label={t("common.brand")}
            allLabel={t("menu.allBrands")}
            options={availableBrands.map((b) => ({ id: b.id, name: tx(b.name) }))}
            value={scope.brandId}
            onChange={(id) => {
              setBrandId(id);
              setBranchId(null);
            }}
          />
          <ScopeSelect
            icon="pin"
            label={t("common.branch")}
            allLabel={t("menu.allBranches")}
            options={scopedBranchOptions.map((b) => ({ id: b.id, name: tx(b.name) }))}
            value={scope.branchId}
            onChange={setBranchId}
          />
        </div>

        <div className="page-head">
          <div>
            <div className="breadcrumb">{t("nav.menu")}</div>
            <h1>{t("nav.menuManagement")}</h1>
            <p>{t("menu.workspaceSubtitle")}</p>
          </div>
          {currentMenu && canManage ? (
            <div className="head-actions">
              <button className="secondary" onClick={() => setComboEditor({ item: null })}>
                <Icon name="combo" size={16} /> {t("menu.createCombo")}
              </button>
              <button className="primary" onClick={() => setEditorState({ item: undefined })}>
                <Icon name="plus" size={17} /> {t("menu.addItemButton")}
              </button>
            </div>
          ) : null}
        </div>

        {menus.error ? <Callout tone="bad">{menus.error.message}</Callout> : null}

        {!currentMenu ? (
          <div className="workspace single">
            <EmptyState
              icon="book"
              title={t("menu.menusTitle")}
              text={t("menu.managementEmpty")}
              actionLabel={canManage ? t("menu.newMenu") : undefined}
              onAction={canManage ? () => setCreatingMenu(true) : undefined}
            />
          </div>
        ) : (
          <>
            <div className="menu-toolbar">
              <div className="menu-select-wrap">
                <button className={`menu-select ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={menuOpen}>
                  <span className="menu-select-text">
                    <span className="small-label">{t("mm.menuLabel")}</span>
                    <strong>{tx(currentMenu.name)}</strong>
                  </span>
                  <span className="menu-select-chev">
                    <Icon name="chevron" size={16} />
                  </span>
                </button>
                {menuOpen ? (
                  <>
                    <div className="menu-backdrop" onClick={() => setMenuOpen(false)}></div>
                    <div className="menu-dropdown">
                      <div className="dropdown-title">{t("mm.yourMenus")}</div>
                      {menuRows.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setMenuId(m.id);
                            setMenuOpen(false);
                          }}
                          className={m.id === effectiveMenuId ? "selected" : ""}
                        >
                          {tx(m.name)}
                          {m.id === effectiveMenuId && <Icon name="check" size={15} />}
                        </button>
                      ))}
                      {canManage ? (
                        <button
                          className="add-menu"
                          onClick={() => {
                            setCreatingMenu(true);
                            setMenuOpen(false);
                          }}
                        >
                          + {t("mm.createNewMenu")}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>

              <Badge tone={currentMenu.active ? "good" : "muted"} dot>
                {currentMenu.active ? t("common.active") : t("common.inactive")}
              </Badge>
              {canManage ? (
                <Button variant="ghost" onClick={toggleMenuActive}>
                  {currentMenu.active ? t("common.deactivate") : t("common.activate")}
                </Button>
              ) : null}
              <Button variant="ghost" icon={<Store size={14} />} onClick={() => setManagingBranches(true)}>
                {t("menu.assignedBranches")}
              </Button>

              <div className="menu-stats">
                <span>
                  <b>{formatNumber(categoryRows.length, fmt)}</b> categories
                </span>
                <span>
                  <b>{formatNumber(nonComboRows.length, fmt)}</b> items
                </span>
                <span>
                  <b>{formatNumber(comboRows.length, fmt)}</b> combos
                </span>
              </div>
              <button className="secondary" onClick={() => setCustomizationsOpen(true)}>
                <Icon name="settings" size={16} /> {t("menu.customizations")}
              </button>
              <button className="preview-btn" onClick={() => setPreviewOpen(true)}>
                {t("mm.previewMenu")} <Icon name="arrow" size={15} />
              </button>
            </div>

            <div className="workspace">
              <aside className="category-panel">
                <div className="panel-title">
                  <div>
                    <span className="small-label">{t("mm.categoriesLabel")}</span>
                    <h3>{tx(currentMenu.name)}</h3>
                  </div>
                </div>

                <button className={`category-row all ${view === "all" ? "chosen" : ""}`} onClick={() => setView("all")}>
                  <span>{t("menu.allItems")}</span>
                  <span className="count">{formatNumber(nonComboRows.length, fmt)}</span>
                </button>

                {categoryRows.map((c) => (
                  <button
                    key={c.id}
                    className={`category-row ${view === c.id ? "chosen" : ""}`}
                    onClick={() => {
                      setView(c.id);
                      setSearch("");
                    }}
                  >
                    <span className="truncate">{tx(c.name)}</span>
                    <span className="count">{formatNumber(nonComboRows.filter((row) => row.placements.some((p) => p.categoryId === c.id)).length, fmt)}</span>
                  </button>
                ))}

                {canManage ? (
                  creatingCategory ? (
                    <div className="category-form">
                      <input
                        autoFocus
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitCategory();
                          }
                          if (e.key === "Escape") setCreatingCategory(false);
                        }}
                        placeholder={t("menu.categoryNamePlaceholder")}
                      />
                      <div>
                        <button onClick={() => setCreatingCategory(false)}>{t("common.cancel")}</button>
                        <button className="primary small" disabled={!categoryName.trim()} onClick={submitCategory}>
                          {t("common.add")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="add-category" onClick={() => setCreatingCategory(true)}>
                      + {t("menu.newCategory")}
                    </button>
                  )
                ) : null}

                <div className="panel-divider">
                  <span className="small-label">{t("mm.dealsLabel")}</span>
                </div>
                <button
                  className={`category-row ${view === COMBOS ? "chosen" : ""}`}
                  onClick={() => {
                    setView(COMBOS);
                    setSearch("");
                  }}
                >
                  <span className="row-with-icon">
                    <Icon name="combo" size={15} /> {t("mm.combos")}
                  </span>
                  <span className="count">{formatNumber(comboRows.length, fmt)}</span>
                </button>
              </aside>

              <section className="items-panel">
                <div className="items-head">
                  <div>
                    <span className="small-label">{view === COMBOS ? t("mm.dealsLabel") : view === "all" ? t("mm.allItemsLabel") : t("mm.categoryLabel")}</span>
                    <h2>{view === COMBOS ? t("mm.combos") : view === "all" ? t("menu.allItems") : category ? tx(category.name) : ""}</h2>
                  </div>
                  <div className="items-actions">
                    <div className="search">
                      <Icon name="search" size={17} />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === COMBOS ? t("mm.searchCombos") : t("mm.searchItems")} />
                    </div>
                    <SortSelect value={sortBy} onChange={setSortBy} open={sortOpen} setOpen={setSortOpen} />
                    {canManage ? (
                      view === COMBOS ? (
                        <button className="primary" onClick={() => setComboEditor({ item: null })}>
                          <Icon name="plus" size={16} /> {t("menu.createCombo")}
                        </button>
                      ) : (
                        <button className="primary" disabled={categoryRows.length === 0} onClick={() => setEditorState({ item: undefined })}>
                          <Icon name="plus" size={16} /> {t("menu.newItem")}
                        </button>
                      )
                    ) : null}
                  </div>
                </div>

                <div className="item-list">
                  {categoryRows.length === 0 && view !== COMBOS ? (
                    <EmptyState
                      icon="folder"
                      title={t("mm.noCategoriesTitle")}
                      text={t("mm.noCategoriesText")}
                      actionLabel={canManage ? t("mm.addCategory") : undefined}
                      onAction={canManage ? () => setCreatingCategory(true) : undefined}
                    />
                  ) : items.loading || categories.loading ? (
                    <div className="list-state">{t("state.loading")}</div>
                  ) : items.error ? (
                    <div className="list-state error">
                      {items.error.message}{" "}
                      <button className="link-button" onClick={() => items.reload()}>
                        {t("form.retry")}
                      </button>
                    </div>
                  ) : shownItems.length === 0 ? (
                    view === COMBOS ? (
                      <EmptyState
                        icon="combo"
                        title={comboRows.length ? t("mm.noCombosMatch") : t("mm.noCombosTitle")}
                        text={t("mm.noCombosText")}
                        actionLabel={canManage ? t("menu.createCombo") : undefined}
                        onAction={canManage ? () => setComboEditor({ item: null }) : undefined}
                      />
                    ) : q ? (
                      <EmptyState icon="search" title={t("mm.noItemsMatch")} text={t("mm.tryDifferentName")} />
                    ) : (
                      <EmptyState
                        title={t("mm.noItemsTitle")}
                        text={t("mm.noItemsText")}
                        actionLabel={t("mm.addItem")}
                        onAction={canManage ? () => setEditorState({ item: undefined }) : undefined}
                      />
                    )
                  ) : view === COMBOS ? (
                    shownItems.map((item) => (
                      <LiveComboCard
                        key={item.id}
                        item={item}
                        fmt={fmt}
                        tx={tx}
                        t={t}
                        onEdit={() => setComboEditor({ item })}
                        onToggle86={() => toggle86(item)}
                        onDeactivate={canManage ? () => deactivateItem(item) : undefined}
                        canToggleAvailability={canToggleAvailability}
                        canManage={canManage}
                      />
                    ))
                  ) : (
                    shownItems.map((item) => (
                      <LiveItemCard
                        key={item.id}
                        item={item}
                        currency={currency}
                        fmt={fmt}
                        tx={tx}
                        t={t}
                        showCategory={view === "all"}
                        categoryName={categoryRows.find((c) => item.placements.some((p) => p.categoryId === c.id))?.name && tx(categoryRows.find((c) => item.placements.some((p) => p.categoryId === c.id))!.name)}
                        onEdit={() => setEditorState({ item })}
                        onToggle86={() => toggle86(item)}
                        onDeactivate={canManage ? () => deactivateItem(item) : undefined}
                        canToggleAvailability={canToggleAvailability}
                        canManage={canManage}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </section>

      {creatingMenu ? (
        <LiveCreateMenuModal
          availableBranches={availableBranches}
          defaultBranchId={scope.branchId}
          tx={tx}
          t={t}
          onClose={() => setCreatingMenu(false)}
          onCreated={(menu) => {
            setCreatingMenu(false);
            setMessage(t("menu.menuCreated"));
            setMenuId(menu.id);
            menus.reload();
          }}
        />
      ) : null}

      {currentMenu ? (
        <MenuBranchesDrawer
          open={managingBranches}
          menu={currentMenu}
          canManage={canManage}
          onClose={() => setManagingBranches(false)}
          onChanged={(note) => {
            setMessage(note);
            menus.reload();
          }}
        />
      ) : null}

      {editorState ? (
        <LiveItemEditor
          item={editorState.item ?? null}
          categories={categoryRows}
          defaultCategoryId={view !== "all" && view !== COMBOS ? view : undefined}
          branchId={scope.branchId}
          currency={currency}
          canManage={canManage}
          canToggleAvailability={canToggleAvailability}
          canChangePrice={canChangePrice}
          onClose={() => setEditorState(null)}
          onChanged={(note) => {
            setMessage(note);
            items.reload();
          }}
          onOpenCustomizations={() => {
            setEditorState(null);
            setCustomizationsOpen(true);
          }}
        />
      ) : null}

      {comboEditor && currentMenu ? (
        <LiveComboEditor
          existingItem={comboEditor.item ?? undefined}
          categories={categoryRows}
          nonComboItems={nonComboRows}
          defaultCategoryId={view !== "all" && view !== COMBOS ? view : undefined}
          currency={currency}
          fmt={fmt}
          tx={tx}
          t={t}
          onClose={() => setComboEditor(null)}
          onCreated={(note) => {
            setComboEditor(null);
            setView(COMBOS);
            setMessage(note);
            items.reload();
          }}
        />
      ) : null}

      {previewOpen && currentMenu ? (
        <LiveMenuPreview
          menuName={tx(currentMenu.name)}
          categories={categoryRows}
          items={menuItemRows}
          currency={currency}
          fmt={fmt}
          tx={tx}
          t={t}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      <CustomizationsDrawer
        open={customizationsOpen}
        canManage={canManage}
        currency={currency}
        onClose={() => setCustomizationsOpen(false)}
        onChanged={setMessage}
      />

      <Toast message={message} />
    </div>
  );
}

/** "Sort by" dropdown for the item / combo list — client-side only. */
function SortSelect({
  value,
  onChange,
  open,
  setOpen,
}: {
  value: SortKey;
  onChange: (key: SortKey) => void;
  open: boolean;
  setOpen: (v: boolean | ((was: boolean) => boolean)) => void;
}) {
  const { t } = useI18n();
  const current = SORTS.find((o) => o.key === value) || SORTS[0]!;
  return (
    <div className="scope-select">
      <button className={`sort-btn ${open ? "open" : ""} ${value !== "menu" ? "active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="sort" size={15} />
        <span>
          {t("mm.sortLabel")} <b>{t(current.label)}</b>
        </span>
        <span className="sort-chev">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)}></div>
          <div className="scope-dropdown sort-dropdown" role="listbox">
            <div className="dropdown-title">{t("mm.sortBy")}</div>
            {SORTS.map((o) => (
              <button
                key={o.key}
                className={o.key === value ? "selected" : ""}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
              >
                {t(o.label)}
                {o.key === value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MenuBranchesDrawer({
  open,
  menu,
  canManage,
  onClose,
  onChanged,
}: {
  open: boolean;
  menu: Menu;
  canManage: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const action = useAction();
  const [assigning, setAssigning] = useState("");

  const detail = useAsync(() => services.catalogue.menus.get(menu.id), [menu.id, open]);
  const current = detail.data ?? menu;
  const unassigned = availableBranches.filter((branch) => !current.branchIds.includes(branch.id));

  if (!open) return null;

  async function assign(branchId: string) {
    await action.run(() => services.catalogue.assignMenuToBranch(menu.id, branchId), {
      onSuccess: () => {
        setAssigning("");
        detail.reload();
        onChanged(t("menu.branchAssigned"));
      },
    });
  }

  async function unassign(branchId: string) {
    await action.run(() => services.catalogue.unassignMenuFromBranch(menu.id, branchId), {
      onSuccess: () => {
        detail.reload();
        onChanged(t("menu.branchUnassigned"));
      },
    });
  }

  return (
    <Drawer open onClose={onClose} title={tx(current.name)}>
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.assignedBranches")}</h3>
          {current.branchIds.length === 0 ? (
            <Callout tone="muted">{t("menu.noBranches")}</Callout>
          ) : (
            <ul className="border-line divide-line divide-y rounded-lg border">
              {current.branchIds.map((branchId) => {
                const branch = availableBranches.find((row) => row.id === branchId);
                return (
                  <li key={branchId} className="flex items-center gap-2 px-3 py-2">
                    <Store size={13} className="text-fg-subtle shrink-0" aria-hidden />
                    <span className="text-fg min-w-0 flex-1 truncate text-xs">
                      {branch ? tx(branch.name) : branchId}
                    </span>
                    {canManage ? (
                      <Button variant="ghost" disabled={action.pending} onClick={() => unassign(branchId)}>
                        {t("common.remove")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && unassigned.length > 0 ? (
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Field label={t("menu.assignBranch")}>
                  <Select value={assigning} onChange={(event) => setAssigning(event.target.value)} disabled={action.pending}>
                    <option value="">—</option>
                    {unassigned.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {tx(branch.name)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" disabled={!assigning || action.pending} onClick={() => assign(assigning)}>
                {t("common.add")}
              </Button>
            </div>
          ) : null}
        </section>

        <BranchResolution branchIds={current.branchIds} />
      </div>
    </Drawer>
  );
}

/** FR-MNU-003 — what a branch actually resolves to right now, straight from the server. */
function BranchResolution({ branchIds }: { branchIds: string[] }) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const [branchId, setBranchId] = useState(branchIds[0] ?? "");
  const effective = branchIds.includes(branchId) ? branchId : (branchIds[0] ?? "");

  const resolution = useAsync(
    async () => (effective ? services.catalogue.resolveBranchMenus(effective) : null),
    [effective],
  );

  if (branchIds.length === 0) return null;

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.resolutionTitle")}</h3>

      {branchIds.length > 1 ? (
        <Field label={t("common.branch")}>
          <Select value={effective} onChange={(event) => setBranchId(event.target.value)}>
            {branchIds.map((id) => {
              const branch = availableBranches.find((row) => row.id === id);
              return (
                <option key={id} value={id}>
                  {branch ? tx(branch.name) : id}
                </option>
              );
            })}
          </Select>
        </Field>
      ) : null}

      <div className="mt-2">
        <AsyncPanel state={resolution}>
          {(data) =>
            data === null ? null : (
              <div className="space-y-2">
                {data.ambiguous ? (
                  <Callout tone="warn" icon={<TriangleAlert size={14} />}>
                    {data.warning ?? t("menu.ambiguousNote")}
                  </Callout>
                ) : (
                  <Callout tone="good" icon={<CheckCircle2 size={14} />}>
                    {t("menu.resolutionClear")}
                  </Callout>
                )}
                <ol className="border-line divide-line divide-y rounded-lg border">
                  {data.menus.map((row, index) => (
                    <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-fg-subtle w-4 shrink-0 text-xs tabular-nums">{index + 1}</span>
                      <span className="text-fg min-w-0 flex-1 truncate text-xs">{tx(row.name)}</span>
                      <Badge tone={index === 0 ? "good" : "muted"}>
                        {t("menu.priority")} {row.priority}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </div>
            )
          }
        </AsyncPanel>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Only `min <= max`, and `required` implies `min >= 1` — the same two
 * rules the backend enforces (`violatesSelectionRules`); checked here for
 * immediate feedback, but the server call is still the authority — its own
 * 400 is what actually stops a bad save, this is only a head start. */
function selectionRuleError(
  min: number,
  max: number,
  required: boolean,
  t: (key: ConsoleKey) => string,
): string | null {
  if (min > max) return t("menu.selectionRuleError");
  if (required && min < 1) return t("menu.requiredMinError");
  return null;
}

/**
 * Customizations — the reusable Modifier Group/Modifier catalogue.
 * `GET/POST/PATCH /catalogue/modifier-groups`,
 * `GET/POST /catalogue/modifier-groups/:id/modifiers`.
 *
 * Deliberately does NOT manage which items a group is attached to:
 * `POST /catalogue/items/:id/modifier-groups` has no read, update or unlink
 * endpoint at all — verified against the full controller route list, the
 * same constraint `/menu/items`'s `ModifierGroupLinker` already documents.
 * A management UI here (attach/detach, "currently attached to") would
 * create or imply durable state this workspace could never show again
 * after a reload — that stays absent until the backend adds a read path.
 */
/**
 * Reference-style Customizations editor (`.overlay`/`.modal.wide`/
 * `.modifier-layout`/`.modifier-list`/`.modifier-editor` — the SAME shape
 * `modifier-modal.tsx` uses in the reference), wired to the real canonical
 * CRUD unchanged from before this restyle:
 *  - Groups: list/create/update (`modifierGroups.list/create/update`) — no
 *    delete, no active/inactive flag; neither exists on this backend.
 *  - Modifiers: list (via `modifierGroups.get`)/create (`addModifier`) — no
 *    edit, no delete; the API supports neither, so an existing modifier
 *    renders read-only, never a fake editable/removable row.
 *  - No "used by" section, no unlink control: there is no endpoint that
 *    returns which items a group is attached to, or that detaches one — see
 *    `live-item-editor.tsx`'s own docblock for the same documented gap.
 */
function CustomizationsDrawer({
  open,
  canManage,
  currency,
  onClose,
  onChanged,
}: {
  open: boolean;
  canManage: boolean;
  currency: Currency;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const groups = useAsync(() => services.catalogue.modifierGroups.list({ limit: 200 }), [open]);
  const rows = groups.data?.rows ?? [];

  const detail = useAsync(
    () => (selectedId ? services.catalogue.modifierGroups.get(selectedId) : Promise.resolve(null)),
    [selectedId],
  );

  if (!open) return null;

  function reload(note: string) {
    onChanged(note);
    groups.reload();
    detail.reload();
  }

  function close() {
    setSelectedId(null);
    setCreatingGroup(false);
    onClose();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide">
        <div className="drawer-head">
          <div>
            <span className="small-label">{t("menu.customizationsLabel")}</span>
            <h2>{t("menu.customizations")}</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label={t("common.close")}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modifier-layout">
          <aside className="modifier-list">
            {groups.error ? <p className="warn-text">{groups.error.message}</p> : null}
            {groups.loading && rows.length === 0 ? <p className="section-help">{t("state.loading")}</p> : null}
            {rows.map((group) => (
              <button
                key={group.id}
                className={selectedId === group.id ? "active" : ""}
                onClick={() => {
                  setCreatingGroup(false);
                  setSelectedId(group.id);
                }}
              >
                {tx(group.name)}
                <span>{group.required ? t("menu.required") : t("common.optional")}</span>
              </button>
            ))}
            {canManage ? (
              <button
                className="add-category"
                onClick={() => {
                  setSelectedId(null);
                  setCreatingGroup(true);
                }}
              >
                + {t("menu.newGroup")}
              </button>
            ) : null}
          </aside>
          <div className="modifier-editor">
            {selectedId ? (
              <GroupDetailPanel detail={detail} canManage={canManage} currency={currency} onChanged={reload} />
            ) : creatingGroup ? (
              <NewGroupForm
                onCancel={() => setCreatingGroup(false)}
                onCreated={(id) => {
                  setCreatingGroup(false);
                  onChanged(t("menu.groupCreated"));
                  groups.reload();
                  setSelectedId(id);
                }}
              />
            ) : (
              <div className="empty">
                <div className="empty-icon">
                  <Icon name="sliders" size={22} />
                </div>
                {rows.length === 0 && !groups.loading ? <h3>{t("menu.noModifierGroups")}</h3> : null}
                <p>{t("menu.customizationsHint")}</p>
                {canManage ? (
                  <button className="primary" onClick={() => setCreatingGroup(true)}>
                    <Icon name="plus" size={16} /> {t("menu.newGroup")}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** `POST /catalogue/modifier-groups` — the reusable group itself. */
function NewGroupForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [minInput, setMinInput] = useState("0");
  const [maxInput, setMaxInput] = useState("1");
  const [required, setRequired] = useState(false);
  const [allowRepeat, setAllowRepeat] = useState(false);

  const min = Number(minInput) || 0;
  const max = Number(maxInput) || 0;
  const ruleError = selectionRuleError(min, max, required, t);
  const canCreate = name.trim() !== "" && ruleError === null;

  async function create() {
    if (!canCreate) return;
    await action.run(
      () =>
        services.catalogue.modifierGroups.create({
          name: { en: name.trim(), ar: name.trim() },
          minSelections: min,
          maxSelections: max,
          required,
          allowRepeat,
        }),
      { onSuccess: (row) => onCreated(row.id) },
    );
  }

  return (
    <>
      <label>
        {t("common.name")}
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("mm.placeholderGroup")} />
      </label>

      <div className="rules">
        <div className="modifier-rule-grid">
          <label>
            {t("menu.minSelections")}
            <input inputMode="numeric" dir="ltr" value={minInput} onChange={(event) => setMinInput(event.target.value)} />
          </label>
          <label>
            {t("menu.maxSelections")}
            <input inputMode="numeric" dir="ltr" value={maxInput} onChange={(event) => setMaxInput(event.target.value)} />
          </label>
        </div>
        <Toggle checked={required} onChange={setRequired} label={t("menu.required")} />
        <Toggle checked={allowRepeat} onChange={setAllowRepeat} label={t("menu.allowRepeat")} />
      </div>

      {ruleError ? <p className="warn-text">{ruleError}</p> : null}
      {action.error ? <p className="warn-text">{action.error}</p> : null}

      <div className="drawer-footer">
        <div></div>
        <div className="footer-right">
          <button className="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={!canCreate || action.pending} onClick={create}>
            {action.pending ? `${t("common.saving")}…` : t("common.create")}
          </button>
        </div>
      </div>
    </>
  );
}

/** A selected group's own config (PATCH) plus its modifiers (view + create). */
function GroupDetailPanel({
  detail,
  canManage,
  currency,
  onChanged,
}: {
  detail: AsyncState<ModifierGroup | null>;
  canManage: boolean;
  currency: Currency;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const group = detail.data;

  const [name, setName] = useState("");
  const [minInput, setMinInput] = useState("0");
  const [maxInput, setMaxInput] = useState("1");
  const [required, setRequired] = useState(false);
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [addingModifier, setAddingModifier] = useState(false);

  // Seeded once, the moment the group's data first arrives — this panel is
  // always a fresh mount per selected group (the parent only renders it
  // while exactly one group is selected), so there is no later id to
  // re-seed against; a saved edit is never clobbered by its own reload.
  const [seeded, setSeeded] = useState(false);
  if (group && !seeded) {
    setSeeded(true);
    setName(tx(group.name));
    setMinInput(String(group.minSelections));
    setMaxInput(String(group.maxSelections));
    setRequired(group.required);
    setAllowRepeat(group.allowRepeat);
  }

  if (!group) {
    return (
      <div className="empty">
        {detail.error ? <p className="warn-text">{detail.error.message}</p> : <p className="section-help">{t("state.loading")}</p>}
      </div>
    );
  }

  const min = Number(minInput) || 0;
  const max = Number(maxInput) || 0;
  const ruleError = selectionRuleError(min, max, required, t);
  const canSave = name.trim() !== "" && ruleError === null;

  async function save() {
    if (!canSave) return;
    await action.run(
      () =>
        services.catalogue.modifierGroups.update(group!.id, {
          name: { en: name.trim(), ar: name.trim() },
          minSelections: min,
          maxSelections: max,
          required,
          allowRepeat,
        }),
      { onSuccess: () => onChanged(t("menu.groupUpdated")) },
    );
  }

  return (
    <>
      <label>
        {t("common.name")}
        <input value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} />
      </label>

      <div className="rules">
        <div className="modifier-rule-grid">
          <label>
            {t("menu.minSelections")}
            <input
              inputMode="numeric"
              dir="ltr"
              value={minInput}
              onChange={(event) => setMinInput(event.target.value)}
              disabled={!canManage}
            />
          </label>
          <label>
            {t("menu.maxSelections")}
            <input
              inputMode="numeric"
              dir="ltr"
              value={maxInput}
              onChange={(event) => setMaxInput(event.target.value)}
              disabled={!canManage}
            />
          </label>
        </div>
        <Toggle checked={required} onChange={setRequired} label={t("menu.required")} disabled={!canManage} />
        <Toggle checked={allowRepeat} onChange={setAllowRepeat} label={t("menu.allowRepeat")} disabled={!canManage} />
      </div>

      {ruleError ? <p className="warn-text">{ruleError}</p> : null}
      {action.error ? <p className="warn-text">{action.error}</p> : null}

      {canManage ? (
        <div className="drawer-footer">
          <div></div>
          <div className="footer-right">
            <button className="primary" disabled={!canSave || action.pending} onClick={save}>
              {action.pending ? `${t("common.saving")}…` : t("common.save")}
            </button>
          </div>
        </div>
      ) : null}

      <h3>{t("nav.modifiers")}</h3>

      {group.modifiers.length === 0 ? (
        <p className="section-help">{t("menu.noModifiers")}</p>
      ) : (
        <div className="option-table">
          <div className="option-head">
            <span>{t("common.name")}</span>
            <span>{t("menu.priceDelta")}</span>
            <span></span>
          </div>
          {group.modifiers.map((modifier) => (
            <ModifierRow key={modifier.id} modifier={modifier} currency={currency} fmt={fmt} tx={tx} t={t} />
          ))}
        </div>
      )}
      {group.modifiers.length > 0 ? <p className="section-help">{t("menu.existingModifiersNote")}</p> : null}

      {canManage ? (
        addingModifier ? (
          <NewModifierForm
            groupId={group.id}
            currency={currency}
            onCancel={() => setAddingModifier(false)}
            onCreated={() => {
              setAddingModifier(false);
              onChanged(t("menu.modifierAdded"));
            }}
          />
        ) : (
          <button className="link-button" onClick={() => setAddingModifier(true)}>
            <Icon name="plus" size={13} /> {t("common.add")}
          </button>
        )
      ) : null}
    </>
  );
}

/** One existing modifier — view only, no edit/delete control (the API
 * supports neither). */
function ModifierRow({
  modifier,
  currency,
  fmt,
  tx,
  t,
}: {
  modifier: Modifier;
  currency: Currency;
  fmt: FormatOptions;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
}) {
  const kind = labelOf(MODIFIER_KIND, modifier.kind);
  // Never `modifier.priceDelta.currency` — the wire carries no currency for
  // a modifier at all, so that field is only ever a mapping-layer
  // placeholder. The canonical CURRENT currency is the only truthful one.
  const amount = modifier.priceDelta.amount;
  const signLabel =
    amount > 0 ? t("menu.priceDeltaExtra") : amount < 0 ? t("menu.priceDeltaDiscount") : t("menu.priceDeltaNone");

  return (
    <div className="option-row">
      <span>
        {tx(modifier.name)} <span className="category-badge">{tx(kind.label)}</span>
        {modifier.linkedVariantId ? <span className="category-badge">{t("menu.comboComponentBadge")}</span> : null}
      </span>
      <span>
        {amount === 0 ? "—" : `${amount > 0 ? "+" : ""}${formatMoney({ amount, currency }, fmt)}`}
        <br />
        <small>{signLabel}</small>
      </span>
      <span></span>
    </div>
  );
}

/**
 * `POST /catalogue/modifier-groups/:id/modifiers`. `kind` is required by the
 * DTO with no server-accepted default, so it is always a real choice here.
 */
function NewModifierForm({
  groupId,
  currency,
  onCancel,
  onCreated,
}: {
  groupId: string;
  currency: Currency;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Modifier["kind"]>("addition");
  const [amount, setAmount] = useState("0");
  const exponent = currencyExponent(currency);
  const tooPrecise = excessPrecision(amount, exponent);

  const parsedAmount = signedMinorFromInput(amount, exponent);
  const canCreate = name.trim() !== "" && !tooPrecise && parsedAmount !== null;

  async function create() {
    if (!canCreate || parsedAmount === null) return;
    await action.run(
      () =>
        services.catalogue.addModifier(groupId, {
          name: { en: name.trim(), ar: name.trim() },
          kind,
          priceDelta: { amount: parsedAmount, currency },
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <div className="used-by">
      <label>
        {t("common.name")}
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("mm.placeholderModifier")} />
      </label>

      <label>
        {t("menu.modifierKind")}
        <select value={kind} onChange={(event) => setKind(event.target.value as Modifier["kind"])}>
          {(["addition", "removal", "substitution"] as const).map((value) => (
            <option key={value} value={value}>
              {tx(labelOf(MODIFIER_KIND, value).label)}
            </option>
          ))}
        </select>
        <small>{t("menu.modifierKindHint")}</small>
      </label>

      <label>
        {t("menu.priceDelta")}
        <div className="price-field">
          <span>{currency}</span>
          <input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <small>{t("menu.priceHint")}</small>
      </label>
      {tooPrecise ? <p className="warn-text">{t("menu.priceExcessPrecision")}</p> : null}
      {action.error ? <p className="warn-text">{action.error}</p> : null}

      <div className="drawer-footer">
        <div></div>
        <div className="footer-right">
          <button className="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={!canCreate || action.pending} onClick={create}>
            {action.pending ? `${t("common.saving")}…` : t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
