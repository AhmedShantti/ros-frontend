"use client";

/**
 * Menu Management — FR-MNU (one-workspace take on menu editing).
 *
 * Menus → categories → items, with prices (single / by channel / by size),
 * availability (available / sold out / hidden), combos and customization
 * groups, a customer preview and publish — all on one screen.
 *
 * Lives beside the existing `/menu/*` screens on purpose so both approaches
 * can be compared; it shares no state with them. Every read and write goes
 * through `menuManagementApi` (`lib/console/menu-management/api.ts`), which
 * is an empty in-memory store until the backend endpoints in
 * `docs/MENU_MANAGEMENT_API.md` exist.
 *
 * Brand and branch options come from the console session (the same lists as
 * the top-bar switcher), so they are real organisation data in both modes.
 */

import { useEffect, useMemo, useState } from "react";
import { menuManagementApi as api } from "@/lib/console/menu-management/api";
import type {
  MmBranch,
  MmBrand,
  MmCategory,
  MmCombo,
  MmComboInput,
  MmCreateMenuInput,
  MmId,
  MmItem,
  MmItemInput,
  MmListedItem,
  MmMenu,
  MmModifierGroup,
  MmModifierGroupInput,
  MmStatus,
} from "@/lib/console/menu-management/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { channelPrice, comboPrice, normalizeCategory, normalizeItem, toItemPayload } from "@/lib/console/menu-management/menu";
import { EmptyState, Icon, type IconName } from "./common";
import "./menu-management.css";
import { ComboCard, ItemCard } from "./cards";
import ItemEditor from "./item-editor";
import ComboEditor from "./combo-editor";
import ModifierModal from "./modifier-modal";
import MenuPreview from "./menu-preview";
import CreateMenuModal from "./create-menu-modal";

const ALL = "all";

// "Sort by" choices. "menu" keeps the order items were added / arranged in.
type SortKey = "menu" | "name-asc" | "name-desc" | "price-asc" | "price-desc" | "status";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "menu", label: "Menu order" },
  { key: "name-asc", label: "Name (A–Z)" },
  { key: "name-desc", label: "Name (Z–A)" },
  { key: "price-asc", label: "Price (low to high)" },
  { key: "price-desc", label: "Price (high to low)" },
  { key: "status", label: "Availability" }
];
const STATUS_ORDER: Record<MmStatus, number> = { available: 0, unavailable: 1, hidden: 2 };

type Sortable = { name: string; status: MmStatus };

function sortList<T extends Sortable>(list: T[], sortBy: SortKey, priceOf: (row: T) => number): T[] {
  if (sortBy === "menu") return list;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const cmp: Record<Exclude<SortKey, "menu">, (a: T, b: T) => number> = {
    "name-asc": byName,
    "name-desc": (a, b) => byName(b, a),
    "price-asc": (a, b) => priceOf(a) - priceOf(b) || byName(a, b),
    "price-desc": (a, b) => priceOf(b) - priceOf(a) || byName(a, b),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || byName(a, b)
  };
  return [...list].sort(cmp[sortBy]);
}
const COMBOS = "combos";

type View = typeof ALL | typeof COMBOS | MmId;

interface ContentState {
  /** The menu this content belongs to; while it differs from the shown menu, the list is loading. */
  forMenuId: MmId | null;
  error: string;
  categories: MmCategory[];
  combos: MmCombo[];
}

interface ModifierModalState {
  focusId?: MmId;
  newGroupName?: string;
  fromEditor?: boolean;
}

const EMPTY_CONTENT: Pick<ContentState, "categories" | "combos"> = { categories: [], combos: [] };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

export default function MenuManagement() {
  const { tx } = useI18n();
  const { availableBrands, availableBranches } = useSession();

  // ----- Data from the API -----
  const [boot, setBoot] = useState({ loading: true, error: "" });
  const [menus, setMenus] = useState<MmMenu[]>([]);
  const [groups, setGroups] = useState<MmModifierGroup[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<MmId | null>(null);
  const [content, setContent] = useState<ContentState>({ forMenuId: null, error: "", categories: [], combos: [] });

  // Brand / branch options are the console session's own (same as the top-bar switcher).
  const brands = useMemo<MmBrand[]>(() => availableBrands.map(b => ({ id: b.id, name: tx(b.name) })), [availableBrands, tx]);
  const branches = useMemo<MmBranch[]>(() => availableBranches.map(b => ({ id: b.id, name: tx(b.name), brandId: b.brandId ?? null })), [availableBranches, tx]);

  // ----- UI state -----
  const [view, setView] = useState<View>(ALL);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("menu");
  const [menuOpen, setMenuOpen] = useState(false);
  const [brandId, setBrandId] = useState<MmId | null>(null);   // null = all brands
  const [branchId, setBranchId] = useState<MmId | null>(null); // null = all branches
  const [categoryForm, setCategoryForm] = useState<string | null>(null); // null = closed, string = typing
  const [categorySaving, setCategorySaving] = useState(false);
  const [editor, setEditor] = useState<{ item?: MmListedItem; categoryId?: MmId } | null>(null);
  const [attachGroupId, setAttachGroupId] = useState<MmId | null>(null);
  const [comboEditor, setComboEditor] = useState<{ combo?: MmCombo } | null>(null);
  const [modifierModal, setModifierModal] = useState<ModifierModalState | null>(null);
  const [showMenuCreate, setShowMenuCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");

  const showError = (e: unknown) => setToast(errorMessage(e, "Something went wrong. Try again."));
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 5000); return () => clearTimeout(t); }, [toast]);

  // Enter submits whatever form is open (drawer / modal): it clicks that form's
  // main button. Inputs with their own Enter action call e.preventDefault() to opt out.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.shiftKey) return;
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return; // not textarea, select or buttons
      const scope = el.closest(".drawer, .modal");
      if (!scope) return;
      const btn =
        scope.querySelector<HTMLButtonElement>("[data-enter]:not(:disabled)") ||
        scope.querySelector<HTMLButtonElement>(".drawer-footer button.primary:not(:disabled)");
      if (btn) { e.preventDefault(); btn.click(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ----- Initial load -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, g] = await Promise.all([api.listMenus(), api.listModifierGroups()]);
        if (cancelled) return;
        setMenus(m || []);
        setGroups(g || []);
        setSelectedMenuId(m?.[0]?.id ?? null);
        setBoot({ loading: false, error: "" });
      } catch (e) {
        if (!cancelled) setBoot({ loading: false, error: errorMessage(e, "Could not load menus.") });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ----- Load the selected menu's categories, items and combos -----
  const [reloadNonce, setReloadNonce] = useState(0);

  // ----- Derived -----
  // Brand / branch filters narrow the menu list. A menu with no brand / no branches applies everywhere.
  const scopedBranches = branches.filter(b => brandId == null || b.brandId == null || b.brandId === brandId);
  const scopedMenus = menus.filter(m =>
    (brandId == null || m.brandId == null || m.brandId === brandId) &&
    (branchId == null || !m.branchIds?.length || m.branchIds.includes(branchId))
  );
  // When the brand / branch filter hides the chosen menu, the first visible one is shown instead.
  const currentMenu = scopedMenus.find(m => m.id === selectedMenuId) || scopedMenus[0] || null;
  const menuId = currentMenu?.id ?? null;

  // Load the shown menu's content whenever it changes.
  // Same shape as `useAsync` in lib/console/hooks: state is only set once the request settles,
  // a stale response is dropped, and "loading" is derived rather than stored.
  useEffect(() => {
    if (menuId == null) return;
    let cancelled = false;
    api.getMenuContent(menuId)
      .then(data => {
        if (cancelled) return;
        setContent({ forMenuId: menuId, error: "", categories: (data?.categories || []).map(normalizeCategory), combos: data?.combos || [] });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setContent({ forMenuId: menuId, error: errorMessage(e, "Could not load this menu."), categories: [], combos: [] });
      });
    return () => { cancelled = true; };
  }, [menuId, reloadNonce]);
  const contentLoading = menuId != null && content.forMenuId !== menuId;
  const contentError = content.forMenuId === menuId ? content.error : "";
  const { categories, combos } = content.forMenuId === menuId ? content : EMPTY_CONTENT;

  // A different menu starts on "All items" with an empty search.
  const [shownMenuId, setShownMenuId] = useState<MmId | null>(menuId);
  if (menuId !== shownMenuId) {
    setShownMenuId(menuId);
    setView(ALL);
    setSearch("");
  }

  const category = categories.find(c => c.id === view) || null;
  const allItems = useMemo<MmListedItem[]>(() => categories.flatMap(c => c.items.map(i => ({ ...i, categoryId: c.id, categoryName: c.name }))), [categories]);
  const itemById = useMemo<Record<string, MmItem>>(() => Object.fromEntries(allItems.map(i => [String(i.id), i])), [allItems]);
  const q = search.trim().toLowerCase();
  const listItems = sortList(
    (view === ALL ? allItems : allItems.filter(i => i.categoryId === view))
      .filter(i => !q || `${i.name} ${i.kitchenName} ${i.categoryName}`.toLowerCase().includes(q)),
    sortBy, i => channelPrice(i)
  );
  const listCombos = sortList(combos.filter(c => !q || c.name.toLowerCase().includes(q)), sortBy, c => comboPrice(c, itemById));

  // ----- Local state helpers -----
  const markDirty = () => setMenus(ms => ms.map(m => (m.id === menuId ? { ...m, hasUnpublishedChanges: true } : m)));
  const setCategories = (fn: (cats: MmCategory[]) => MmCategory[]) => setContent(c => ({ ...c, categories: fn(c.categories) }));
  const setCombos = (fn: (combos: MmCombo[]) => MmCombo[]) => setContent(c => ({ ...c, combos: fn(c.combos) }));

  /** Every write inside a menu needs one; the controls that call these only render when a menu is selected. */
  function requireMenuId(): MmId {
    if (menuId == null) throw new Error("Select a menu first.");
    return menuId;
  }

  function placeItem(saved: MmItem) {
    const item = normalizeItem(saved);
    setCategories(cats => cats.map(c => {
      const had = c.items.some(i => i.id === item.id);
      if (c.id === item.categoryId) return { ...c, items: had ? c.items.map(i => (i.id === item.id ? item : i)) : [...c.items, item] };
      return had ? { ...c, items: c.items.filter(i => i.id !== item.id) } : c;
    }));
  }

  // ----- Menus -----
  async function createMenu(data: MmCreateMenuInput) {
    const menu = await api.createMenu(data);
    setMenus(ms => [...ms, menu]);
    setSelectedMenuId(menu.id);
    setShowMenuCreate(false);
    setMenuOpen(false);
  }

  async function publish() {
    setPublishing(true);
    try {
      const menu = await api.publishMenu(requireMenuId());
      setMenus(ms => ms.map(m => (m.id === menuId ? { ...m, ...menu, hasUnpublishedChanges: false } : m)));
    } catch (e) { showError(e); }
    finally { setPublishing(false); }
  }

  // ----- Categories -----
  function openCategoryForm() {
    setCategoryForm(f => (f === null ? "" : null));
  }

  async function addCategory() {
    const name = (categoryForm || "").trim();
    if (!name || categorySaving) return;
    setCategorySaving(true);
    try {
      const cat = await api.createCategory(requireMenuId(), { name });
      setCategories(cats => [...cats, normalizeCategory(cat)]);
      setView(cat.id);
      setCategoryForm(null);
      markDirty();
    } catch (e) { showError(e); }
    finally { setCategorySaving(false); }
  }

  // ----- Items -----
  function openItemEditor(opts: { item?: MmListedItem; categoryId?: MmId }) {
    setAttachGroupId(null);
    setEditor(opts);
  }

  async function saveItem(payload: MmItemInput) {
    const saved = editor?.item
      ? await api.updateItem(editor.item.id, payload)
      : await api.createItem(requireMenuId(), payload);
    placeItem({ ...payload, ...saved });
    markDirty();
    setEditor(null);
  }

  async function setItemStatus(item: MmItem, status: MmStatus) {
    try {
      const saved = await api.setItemStatus(item.id, status);
      placeItem({ ...item, ...saved, status });
      markDirty();
    } catch (e) { showError(e); }
  }

  async function duplicateItem(item: MmListedItem) {
    try {
      // New size rows get fresh temporary ids; the server replaces them.
      const payload: MmItemInput = { ...toItemPayload(item), name: `${item.name} (copy)`, sizes: item.sizes.map(s => ({ ...s, id: `size-copy-${s.id}` })) };
      const saved = await api.createItem(requireMenuId(), payload);
      placeItem({ ...payload, ...saved });
      markDirty();
    } catch (e) { showError(e); }
  }

  async function deleteItem(itemId: MmId) {
    await api.deleteItem(itemId);
    setCategories(cats => cats.map(c => ({ ...c, items: c.items.filter(i => i.id !== itemId) })));
    setCombos(cs => cs.map(cb => ({ ...cb, slots: cb.slots.map(s => ({ ...s, itemIds: s.itemIds.filter(id => id !== itemId) })) })));
    markDirty();
    setEditor(null);
  }

  // ----- Combos -----
  function putCombo(saved: MmCombo) {
    setCombos(cs => (cs.some(c => c.id === saved.id) ? cs.map(c => (c.id === saved.id ? saved : c)) : [...cs, saved]));
  }

  async function saveCombo(payload: MmComboInput) {
    const saved = comboEditor?.combo
      ? await api.updateCombo(comboEditor.combo.id, payload)
      : await api.createCombo(requireMenuId(), payload);
    putCombo({ ...payload, ...saved });
    markDirty();
    setView(COMBOS);
    setComboEditor(null);
  }

  async function setComboStatus(combo: MmCombo, status: MmStatus) {
    try {
      const saved = await api.setComboStatus(combo.id, status);
      putCombo({ ...combo, ...saved, status });
      markDirty();
    } catch (e) { showError(e); }
  }

  async function duplicateCombo(combo: MmCombo) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, menuId, ...rest } = combo;
      const payload: MmComboInput = { ...rest, name: `${combo.name} (copy)`, slots: combo.slots.map(s => ({ ...s, id: `slot-copy-${s.id}` })) };
      const saved = await api.createCombo(requireMenuId(), payload);
      putCombo({ ...payload, ...saved });
      markDirty();
    } catch (e) { showError(e); }
  }

  async function deleteCombo(comboId: MmId) {
    await api.deleteCombo(comboId);
    setCombos(cs => cs.filter(c => c.id !== comboId));
    markDirty();
    setComboEditor(null);
  }

  // ----- Customization groups -----
  /** Re-read menus so every menu's "unpublished changes" flag comes from the server. */
  async function refreshMenus() {
    try {
      const fresh = await api.listMenus();
      if (fresh) setMenus(fresh);
    } catch { /* keep current list; not critical */ }
  }

  async function createGroup(payload: MmModifierGroupInput) {
    const saved = await api.createModifierGroup(payload);
    setGroups(gs => [...gs, saved]);
    return saved;
  }

  async function updateGroup(id: MmId, payload: MmModifierGroupInput) {
    const saved = await api.updateModifierGroup(id, payload);
    setGroups(gs => gs.map(g => (g.id === id ? saved : g)));
    await refreshMenus(); // a shared group can change several menus
    return saved;
  }

  async function deleteGroup(id: MmId) {
    await api.deleteModifierGroup(id);
    setGroups(gs => gs.filter(g => g.id !== id));
    setCategories(cats => cats.map(c => ({ ...c, items: c.items.map(i => ({ ...i, modifierGroupIds: i.modifierGroupIds.filter(x => x !== id) })) })));
    await refreshMenus();
  }

  const itemProps = (item: MmListedItem) => ({
    onEdit: () => openItemEditor({ item }),
    onStatus: (status: MmStatus) => setItemStatus(item, status),
    onDuplicate: () => duplicateItem(item),
    onDelete: () => deleteItem(item.id).catch(showError)
  });

  // ----- Render -----
  if (boot.loading) return <div className="mm-root"><div className="page-state">Loading menus…</div></div>;
  if (boot.error) return <div className="mm-root"><div className="page-state error"><strong>Couldn&apos;t load Menu Management</strong><p>{boot.error}</p><button className="secondary" onClick={() => window.location.reload()}>Try again</button></div></div>;

  const published = Boolean(currentMenu && !currentMenu.hasUnpublishedChanges);

  return (
    <div className="mm-root menu-page" dir="ltr">

      <section className="content">
        <div className="scope-bar">
          <ScopeSelect
            icon="store" label="Brand" allLabel="All brands"
            options={brands} value={brandId}
            onChange={id => { setBrandId(id); setBranchId(null); }}
          />
          <ScopeSelect
            icon="pin" label="Branch" allLabel="All branches"
            options={scopedBranches} value={branchId}
            onChange={setBranchId}
          />
        </div>

        <div className="page-head">
          <div>
            <div className="breadcrumb">MENU & RECIPES</div>
            <h1>Menu Management</h1>
            <p>Build your menu, add items and customize them — all in one place.</p>
          </div>
          {currentMenu && (
            <div className="head-actions">
              <button className="secondary" onClick={() => setComboEditor({})}><Icon name="combo" size={16}/> Create combo</button>
              <button className="primary" onClick={() => openItemEditor({ categoryId: category?.id })}><Icon name="plus" size={17}/> Add item</button>
            </div>
          )}
        </div>

        {!currentMenu ? (
          <div className="workspace single">
            {menus.length === 0
              ? <EmptyState icon="book" title="No menus yet" text="Create your first menu, then add categories and items to it." actionLabel="Create menu" onAction={() => setShowMenuCreate(true)}/>
              : <EmptyState icon="book" title="No menus for this brand / branch" text="Pick another brand or branch above, or create a menu here." actionLabel="Create menu" onAction={() => setShowMenuCreate(true)}/>}
          </div>
        ) : <>
          <div className="menu-toolbar">
            <div className="menu-select-wrap">
              <button className={`menu-select ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(v => !v)} aria-haspopup="listbox" aria-expanded={menuOpen}>
                <span className="menu-select-text">
                  <span className="small-label">MENU</span>
                  <strong>{currentMenu.name}</strong>
                </span>
                <span className="menu-select-chev"><Icon name="chevron" size={16}/></span>
              </button>
              {menuOpen && <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)}></div>
                <div className="menu-dropdown">
                  <div className="dropdown-title">Your menus</div>
                  {scopedMenus.map(m =>
                    <button key={m.id} onClick={() => { setSelectedMenuId(m.id); setMenuOpen(false); }} className={m.id === menuId ? "selected" : ""}>
                      {m.name}{m.id === menuId && <Icon name="check" size={15}/>}
                    </button>
                  )}
                  <button className="add-menu" onClick={() => { setShowMenuCreate(true); setMenuOpen(false); }}>+ Create new menu</button>
                </div>
              </>}
            </div>
            <div className="menu-stats">
              <span><b>{categories.length}</b> categories</span>
              <span><b>{allItems.length}</b> items</span>
              <span><b>{combos.length}</b> combos</span>
              <span><b>{groups.length}</b> customizations</span>
            </div>
            <button className="preview-btn" onClick={() => setShowPreview(true)}>Preview menu <Icon name="arrow" size={15}/></button>
            <button className={`publish-btn ${published ? "done" : ""}`} disabled={publishing || published} onClick={publish}>
              {publishing ? "Publishing…" : published ? "Published ✓" : "Publish changes"}
            </button>
          </div>

          <div className="workspace">
            <aside className="category-panel">
              <div className="panel-title">
                <div>
                  <span className="small-label">CATEGORIES</span>
                  <h3>{currentMenu.name}</h3>
                </div>
              </div>

              <button className={`category-row all ${view === ALL ? "chosen" : ""}`} onClick={() => setView(ALL)}>
                <span>All items</span><span className="count">{allItems.length}</span>
              </button>

              {categories.map(c => (
                <button key={c.id} className={`category-row ${view === c.id ? "chosen" : ""}`} onClick={() => { setView(c.id); setSearch(""); }}>
                  <span>{c.name}</span><span className="count">{c.items.length}</span>
                </button>
              ))}

              {categoryForm !== null && (
                <div className="category-form">
                  <input autoFocus value={categoryForm} onChange={e => setCategoryForm(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } if (e.key === "Escape") setCategoryForm(null); }} placeholder="Category name, e.g. Burgers"/>
                  <div><button onClick={() => setCategoryForm(null)}>Cancel</button><button className="primary small" disabled={!categoryForm.trim() || categorySaving} onClick={addCategory}>{categorySaving ? "Adding…" : "Add"}</button></div>
                </div>
              )}

              {categoryForm === null && <button className="add-category" onClick={openCategoryForm}>+ Add category</button>}

              <div className="panel-divider"><span className="small-label">DEALS</span></div>
              <button className={`category-row ${view === COMBOS ? "chosen" : ""}`} onClick={() => { setView(COMBOS); setSearch(""); }}>
                <span className="row-with-icon"><Icon name="combo" size={15}/> Combos</span><span className="count">{combos.length}</span>
              </button>
            </aside>

            <section className="items-panel">
              <div className="items-head">
                <div>
                  <span className="small-label">{view === COMBOS ? "DEALS" : view === ALL ? "ALL ITEMS" : "CATEGORY"}</span>
                  <h2>{view === COMBOS ? "Combos" : view === ALL ? "All menu items" : category?.name}</h2>
                </div>
                <div className="items-actions">
                  <div className="search">
                    <Icon name="search" size={17}/>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={view === COMBOS ? "Search combos..." : "Search items..."}/>
                  </div>
                  <SortSelect value={sortBy} onChange={setSortBy}/>
                  <button className="secondary" onClick={() => setModifierModal({})}><Icon name="settings" size={16}/> Customizations</button>
                  {view === COMBOS
                    ? <button className="primary" onClick={() => setComboEditor({})}><Icon name="plus" size={16}/> Create combo</button>
                    : <button className="primary" onClick={() => openItemEditor({ categoryId: category?.id })}><Icon name="plus" size={16}/> Add item</button>}
                </div>
              </div>

              <div className="item-list">
                {contentLoading ? (
                  <div className="list-state">Loading…</div>
                ) : contentError ? (
                  <div className="list-state error">{contentError} <button className="link-button" onClick={() => { setContent(c => ({ ...c, forMenuId: null })); setReloadNonce(n => n + 1); }}>Retry</button></div>
                ) : view === COMBOS ? (
                  listCombos.length === 0
                    ? <EmptyState icon="combo" title={combos.length ? "No combos match your search" : "No combos yet"} text="Bundle items into a meal deal — e.g. a burger, a side and a drink — with its own price." actionLabel="Create combo" onAction={() => setComboEditor({})}/>
                    : listCombos.map(combo => (
                      <ComboCard key={combo.id} combo={combo} itemById={itemById}
                        onEdit={() => setComboEditor({ combo })}
                        onStatus={status => setComboStatus(combo, status)}
                        onDuplicate={() => duplicateCombo(combo)}
                        onDelete={() => deleteCombo(combo.id).catch(showError)}/>
                    ))
                ) : categories.length === 0 ? (
                  <EmptyState icon="folder" title="No categories yet" text="Start by adding a category — for example Starters, Burgers or Drinks — then add items inside it." actionLabel="Add category" onAction={() => setCategoryForm("")}/>
                ) : listItems.length === 0 ? (
                  q ? <EmptyState icon="search" title="No items match your search" text="Try a different name."/> : <EmptyState onAction={() => openItemEditor({ categoryId: category?.id })}/>
                ) : listItems.map(item => (
                  <ItemCard key={item.id} item={item} groups={groups} showCategory={view === ALL} {...itemProps(item)}/>
                ))}
              </div>
            </section>
          </div>
        </>}
      </section>

      {toast && <div className="toast" role="alert">{toast}<button onClick={() => setToast("")}>×</button></div>}

      {editor && (
        <ItemEditor
          item={editor.item}
          defaultCategoryId={editor.categoryId}
          categories={categories}
          groups={groups}
          attachGroupId={attachGroupId}
          onClose={() => setEditor(null)}
          onSave={saveItem}
          onDelete={async () => { if (editor.item) await deleteItem(editor.item.id); }}
          onNewGroup={name => setModifierModal({ newGroupName: name, fromEditor: true })}
          onEditGroup={id => setModifierModal({ focusId: id })}
        />
      )}

      {comboEditor && (
        <ComboEditor
          combo={comboEditor.combo}
          categories={categories}
          itemById={itemById}
          onClose={() => setComboEditor(null)}
          onSave={saveCombo}
          onDelete={async () => { if (comboEditor.combo) await deleteCombo(comboEditor.combo.id); }}
        />
      )}

      {modifierModal && (
        <ModifierModal
          groups={groups}
          items={allItems}
          focusId={modifierModal.focusId}
          newGroupName={modifierModal.newGroupName}
          onCreate={createGroup}
          onUpdate={updateGroup}
          onDelete={deleteGroup}
          onCreated={g => { if (modifierModal.fromEditor) setAttachGroupId(g.id); }}
          onClose={() => setModifierModal(null)}
        />
      )}

      {showMenuCreate && <CreateMenuModal brands={brands} branches={branches} defaultBrandId={brandId} defaultBranchId={branchId} onClose={() => setShowMenuCreate(false)} onCreate={createMenu}/>}

      {showPreview && currentMenu && (
        <MenuPreview menu={currentMenu} categories={categories} combos={combos} itemById={itemById} groups={groups} onClose={() => setShowPreview(false)}/>
      )}
    </div>
  );
}

/** Brand / branch filter button with a dropdown list. Options come from the API. */
function ScopeSelect({
  icon,
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  icon: IconName;
  label: string;
  allLabel: string;
  options: { id: MmId; name: string }[];
  value: MmId | null;
  onChange: (id: MmId | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);
  const pick = (id: MmId | null) => { onChange(id); setOpen(false); };
  return (
    <div className="scope-select">
      <button className={`scope-btn ${open ? "open" : ""}`} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name={icon} size={15}/>
        <span className="scope-text"><small>{label}</small>{selected ? selected.name : allLabel}</span>
        <span className="menu-select-chev"><Icon name="chevron" size={15}/></span>
      </button>
      {open && <>
        <div className="menu-backdrop" onClick={() => setOpen(false)}></div>
        <div className="scope-dropdown" role="listbox">
          <button className={value == null ? "selected" : ""} onClick={() => pick(null)}>{allLabel}{value == null && <Icon name="check" size={14}/>}</button>
          {options.map(o => (
            <button key={o.id} className={o.id === value ? "selected" : ""} onClick={() => pick(o.id)}>{o.name}{o.id === value && <Icon name="check" size={14}/>}</button>
          ))}
          {options.length === 0 && <div className="scope-empty">No {allLabel.replace(/^All /, "")} set up yet</div>}
        </div>
      </>}
    </div>
  );
}

/** "Sort by" dropdown for the item / combo list. */
function SortSelect({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const current = SORTS.find(o => o.key === value) || SORTS[0];
  return (
    <div className="scope-select">
      <button className={`sort-btn ${open ? "open" : ""} ${value !== "menu" ? "active" : ""}`} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="sort" size={15}/>
        <span>Sort: <b>{current.label}</b></span>
        <span className="sort-chev"><Icon name="chevron" size={14}/></span>
      </button>
      {open && <>
        <div className="menu-backdrop" onClick={() => setOpen(false)}></div>
        <div className="scope-dropdown sort-dropdown" role="listbox">
          <div className="dropdown-title">Sort by</div>
          {SORTS.map(o => (
            <button key={o.key} className={o.key === value ? "selected" : ""} onClick={() => { onChange(o.key); setOpen(false); }}>
              {o.label}{o.key === value && <Icon name="check" size={14}/>}
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}
