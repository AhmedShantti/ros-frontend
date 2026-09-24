"use client";

/**
 * Menu Management — LIVE workspace (production/HTTP mode).
 *
 * The demo workspace (`./menu-management.tsx`) simulates a full menu editor
 * — combos, per-channel/per-size pricing, a "Hidden" status, a fake
 * publish/dirty flag — against an empty in-memory store, because the
 * backend does not implement any of it. This component is the truthful
 * counterpart shown once a real backend is configured (`DATA_MODE ===
 * "http"`, see `app/(console)/menu/management/page.tsx`): it only offers
 * what `/catalogue/*` actually supports —
 *
 *   Menus       — list / create / activate-deactivate / branch assignment /
 *                 branch resolution (no draft/publish lifecycle exists).
 *   Categories  — list / create (no delete or deactivate endpoint exists).
 *   Items       — create / edit / category placement / tax class /
 *                 available-unavailable(86) / variants (display + add, each
 *                 directly priced — there is no Price List concept anywhere
 *                 in this workspace; a variant's price is set in the same
 *                 create/edit step and edited directly, never through a
 *                 separate pricing workspace).
 *
 * Phase 3 adds:
 *
 *   Availability — 86/restore through the real availability-rules flow,
 *                  with a truthful reason (audit-only, never read back) and
 *                  a genuine (lazily-evaluated) auto-re-enable time.
 *   Customizations — the reusable Modifier Group/Modifier catalogue
 *                  (create/read/update groups; read/create modifiers, no
 *                  edit/delete — the API supports none). Deliberately does
 *                  NOT manage item↔group attachment: `POST
 *                  /catalogue/items/:id/modifier-groups` is write-only, with
 *                  no read/update/unlink endpoint at all, so a management UI
 *                  here would create durable state this workspace could
 *                  never show again after a reload. That stays absent until
 *                  the backend adds a read path — see `/menu/items`'s
 *                  `ModifierGroupLinker` for the same honest constraint.
 *
 * Deliberately NOT here: Combos (no backend at all), Recipes, item↔group
 * attachment (see above), and a "Hidden" status (there is no such flag —
 * "not placed in any category" is a placement condition, never a boolean).
 * They stay on `/menu/combos`, `/menu/recipes` and `/menu/items` until a
 * later slice migrates them for real.
 */

import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Pencil,
  Plus,
  SlidersHorizontal,
  Store,
  Tag,
  TriangleAlert,
} from "lucide-react";
import type { Currency, Menu, Localised, Modifier, ModifierGroup, Money } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage, type AsyncState } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  currencyExponent,
  excessPrecision,
  formatDateTime,
  formatMoney,
  formatNumber,
  minorFromInput,
  signedMinorFromInput,
  type FormatOptions,
} from "@/lib/console/format";
import { MODIFIER_KIND, labelOf } from "@/lib/console/labels";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  Toast,
  Toggle,
} from "@/components/console/ui";
import { TaxClassField, useTaxClassLabel } from "@/components/console/catalogue/tax-class-field";
import {
  createMenuCategory,
  listItemsWithPlacements,
  listMenuCategories,
  type LiveCategory,
  type LiveItem,
} from "@/lib/console/menu-management/live-adapter";

const ORDER_TYPE_CHOICES = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup"] as const;

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

export default function LiveMenuManagement() {
  const { t, tx, fmt } = useI18n();
  const session = useSession();
  const { scope, availableBranches } = session;
  const canManage = usePermission("menu.item.manage");
  const canToggleAvailability = usePermission("menu.availability.toggle");
  const canReadPrice = usePermission("menu.price.read");
  const canChangePrice = usePermission("menu.price.change");

  const [message, setMessage] = useTransientMessage();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [view, setView] = useState<"all" | string>("all");
  const [creatingMenu, setCreatingMenu] = useState(false);
  const [managingBranches, setManagingBranches] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editorState, setEditorState] = useState<{ item?: LiveItem } | null>(null);
  const [customizationsOpen, setCustomizationsOpen] = useState(false);

  const menus = useAsync(
    () => services.catalogue.menus.list({ limit: 200, scope }),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const menuRows = useMemo(() => menus.data?.rows ?? [], [menus.data]);

  // Adjusted during render, not in an effect (react-hooks/set-state-in-effect;
  // the same "storing information from previous renders" pattern the demo
  // workspace already uses for its own menu switch) — so a scope change or
  // the menu list resolving is reflected before anything paints, and a
  // stale-scope menu is never shown even for one frame.
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

  // Items placed in one of THIS menu's categories, or "All items" across them.
  const categoryIds = useMemo(() => new Set(categoryRows.map((row) => row.id)), [categoryRows]);
  const menuItemRows = useMemo(
    () => allItemRows.filter((row) => row.placements.some((p) => categoryIds.has(p.categoryId))),
    [allItemRows, categoryIds],
  );
  const shownItems = useMemo(
    () =>
      view === "all"
        ? menuItemRows
        : menuItemRows.filter((row) => row.placements.some((p) => p.categoryId === view)),
    [menuItemRows, view],
  );

  // A different menu always starts on "All items" — same render-time
  // adjustment as above, not an effect.
  const [viewForMenuId, setViewForMenuId] = useState(effectiveMenuId);
  if (effectiveMenuId !== viewForMenuId) {
    setViewForMenuId(effectiveMenuId);
    setView("all");
  }

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

  if (menus.loading && menuRows.length === 0) {
    return (
      <div className="space-y-4">
        <WorkspaceHeader t={t} />
        <AsyncPanel state={menus}>{() => null}</AsyncPanel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WorkspaceHeader t={t} action={canManage ? { label: t("menu.newMenu"), onClick: () => setCreatingMenu(true) } : null} />

      {/* Customizations — the reusable Modifier Group/Modifier catalogue.
          Not scoped to any one menu, so it sits beside the menu switcher
          rather than inside it. */}
      <div>
        <Button variant="ghost" icon={<SlidersHorizontal size={14} />} onClick={() => setCustomizationsOpen(true)}>
          {t("menu.customizations")}
        </Button>
      </div>

      {menus.error ? <Callout tone="bad">{menus.error.message}</Callout> : null}

      {menuRows.length === 0 ? (
        <Callout tone="muted" title={t("menu.menusTitle")}>
          {t("menu.managementEmpty")}
        </Callout>
      ) : (
        <div className="border-line bg-surface overflow-hidden rounded-xl border">
          {/* One workspace toolbar: the menu switcher IS the context switch —
              there is no separate list-of-menus page here, by design. */}
          <div className="border-line flex flex-wrap items-center gap-3 border-b p-3">
            <MenuSwitcher
              menus={menuRows}
              value={effectiveMenuId}
              tx={tx}
              onChange={setMenuId}
            />
            {currentMenu ? (
              <>
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
                <div className="text-fg-subtle ms-auto flex items-center gap-4 text-xs">
                  <span>
                    <b className="text-fg">{formatNumber(categoryRows.length, fmt)}</b> {t("menu.categoriesTitle")}
                  </span>
                  <span>
                    <b className="text-fg">{formatNumber(menuItemRows.length, fmt)}</b> {t("menu.itemsTitle")}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          {currentMenu ? (
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
              <aside className="border-line space-y-1 border-b p-3 md:border-b-0 md:border-e">
                <button
                  type="button"
                  onClick={() => setView("all")}
                  className={`hover:bg-sunken flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-sm transition-colors ${view === "all" ? "bg-accent-soft text-accent font-medium" : "text-fg"}`}
                >
                  <span>{t("menu.allItems")}</span>
                  <span className="text-fg-subtle text-xs">{formatNumber(menuItemRows.length, fmt)}</span>
                </button>
                {categoryRows.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setView(category.id)}
                    className={`hover:bg-sunken flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-sm transition-colors ${view === category.id ? "bg-accent-soft text-accent font-medium" : "text-fg"}`}
                  >
                    <span className="truncate">{tx(category.name)}</span>
                    <span className="text-fg-subtle text-xs">
                      {formatNumber(
                        menuItemRows.filter((row) => row.placements.some((p) => p.categoryId === category.id))
                          .length,
                        fmt,
                      )}
                    </span>
                  </button>
                ))}

                {canManage ? (
                  creatingCategory ? (
                    <div className="space-y-2 p-1">
                      <Input
                        autoFocus
                        value={categoryName}
                        onChange={(event) => setCategoryName(event.target.value)}
                        placeholder={t("menu.categoryNamePlaceholder")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitCategory();
                          }
                          if (event.key === "Escape") setCreatingCategory(false);
                        }}
                      />
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setCreatingCategory(false)}>
                          {t("common.cancel")}
                        </Button>
                        <Button variant="primary" disabled={!categoryName.trim()} onClick={submitCategory}>
                          {t("common.add")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreatingCategory(true)}
                      className="text-accent flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-start text-sm"
                    >
                      <Plus size={14} /> {t("menu.newCategory")}
                    </button>
                  )
                ) : null}
              </aside>

              <section className="min-w-0 space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-fg text-sm font-semibold">
                    {view === "all"
                      ? t("menu.allItems")
                      : tx(categoryRows.find((row) => row.id === view)?.name ?? { en: "", ar: "" })}
                  </h2>
                  {canManage ? (
                    <Button
                      variant="primary"
                      icon={<Plus size={14} />}
                      disabled={categoryRows.length === 0}
                      onClick={() => setEditorState({})}
                    >
                      {t("menu.newItem")}
                    </Button>
                  ) : null}
                </div>

                {categoryRows.length === 0 ? (
                  <Callout tone="muted">{t("menu.placementHint")}</Callout>
                ) : items.loading ? (
                  <Callout tone="muted">{t("state.loading")}</Callout>
                ) : shownItems.length === 0 ? (
                  <Callout tone="muted">{t("menu.categoriesEmpty")}</Callout>
                ) : (
                  <div className="space-y-2">
                    {shownItems.map((row) => (
                      <ItemRow key={row.id} item={row} t={t} tx={tx} onOpen={() => setEditorState({ item: row })} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      )}

      <NewMenuDrawer
        open={creatingMenu}
        availableBranches={availableBranches}
        onClose={() => setCreatingMenu(false)}
        onCreated={(id) => {
          setCreatingMenu(false);
          setMessage(t("menu.menuCreated"));
          setMenuId(id);
          menus.reload();
        }}
      />

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

      <ItemEditorDrawer
        open={editorState !== null}
        item={editorState?.item ?? null}
        categories={categoryRows}
        defaultCategoryId={view !== "all" ? view : undefined}
        branchId={scope.branchId}
        canManage={canManage}
        canToggleAvailability={canToggleAvailability}
        canReadPrice={canReadPrice}
        canChangePrice={canChangePrice}
        currency={currentCurrency(session)}
        onClose={() => setEditorState(null)}
        onChanged={(note) => {
          setMessage(note);
          items.reload();
        }}
      />

      <CustomizationsDrawer
        open={customizationsOpen}
        canManage={canManage}
        currency={currentCurrency(session)}
        onClose={() => setCustomizationsOpen(false)}
        onChanged={setMessage}
      />

      <Toast message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The workspace's own compact header — a breadcrumb-style label, the title,
 * and the one primary action. Deliberately not `PageHeader`/`TileGrid`
 * (the generic list-page chrome `/menu/menus` etc. use): this is a single
 * workspace, not an index of rows, and dashboard-style metric tiles above a
 * menu switcher read as "yet another admin table page" rather than the
 * one-screen editor the new Menu Management UX is.
 */
function WorkspaceHeader({
  t,
  action,
}: {
  t: (key: ConsoleKey) => string;
  action?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-fg-subtle text-[10px] font-semibold tracking-wide uppercase">{t("nav.menu")}</p>
        <h1 className="text-fg text-xl font-semibold tracking-tight">{t("nav.menuManagement")}</h1>
      </div>
      {action ? (
        <Button variant="primary" icon={<Plus size={14} />} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The menu switcher — a button naming the current menu that opens a small
 * dropdown of every other menu, the same "this IS the context, not a link to
 * another page" interaction the demo workspace uses. RTL-safe (logical
 * `start-0`/`ms-auto`, no hardcoded `left`/`right`), unlike the demo's own
 * `.menu-select` (LTR-only CSS, see `menu-management.css`), which is why this
 * is a small rebuild rather than a literal import of that component.
 */
function MenuSwitcher({
  menus,
  value,
  tx,
  onChange,
}: {
  menus: Menu[];
  value: string | null;
  tx: (value: Localised) => string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = menus.find((row) => row.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-line bg-sunken hover:border-accent flex min-w-52 items-center gap-2 rounded-lg border px-3 py-2 text-start transition-colors"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{current ? tx(current.name) : ""}</span>
        <ChevronDown size={15} className={`text-fg-subtle shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="border-line bg-raised absolute start-0 top-[calc(100%+6px)] z-20 max-h-72 w-64 overflow-auto rounded-lg border p-1 shadow-lg"
          >
            {menus.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={row.id === value}
                onClick={() => {
                  onChange(row.id);
                  setOpen(false);
                }}
                className={`hover:bg-sunken flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-start text-sm ${row.id === value ? "text-accent font-medium" : "text-fg"}`}
              >
                <span className="truncate">{tx(row.name)}</span>
                {row.id === value ? <Check size={14} className="shrink-0" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * One item, as a card — the same information density and card-based list
 * concept as the demo's `ItemCard` (name, status, price, an edit affordance)
 * reconstructed on the console's own RTL-safe primitives rather than a
 * literal import (see `MenuSwitcher` for why).
 */
function ItemRow({
  item,
  t,
  tx,
  onOpen,
}: {
  item: LiveItem;
  t: (key: ConsoleKey) => string;
  tx: (value: Localised) => string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-line hover:border-accent bg-surface flex w-full items-center gap-3 rounded-lg border p-3 text-start transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-fg truncate text-sm font-medium">{tx(item.name)}</p>
        {tx(item.kitchenName) ? <p className="text-fg-subtle truncate text-xs">{tx(item.kitchenName)}</p> : null}
      </div>
      <Badge tone={item.available ? "good" : "bad"} dot>
        {item.available ? t("menu.available") : t("menu.unavailable")}
      </Badge>
      <Pencil size={14} className="text-fg-subtle shrink-0" aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------

function NewMenuDrawer({
  open,
  availableBranches,
  onClose,
  onCreated,
}: {
  open: boolean;
  availableBranches: { id: string; name: { en: string; ar: string } }[];
  onClose: () => void;
  onCreated: (menuId: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("10");
  const [orderTypes, setOrderTypes] = useState<string[]>(["dine_in"]);
  const [branchIds, setBranchIds] = useState<string[]>([]);

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      async () => {
        const menu = await services.catalogue.menus.create({
          name: { en: name.trim(), ar: name.trim() },
          priority: Number(priority) || 0,
          orderTypes,
        });
        // Assign every requested branch. A failure partway through is
        // surfaced (not swallowed) and the caller reloads from the server,
        // so a half-assigned menu is never presented as fully assigned.
        for (const branchId of branchIds) {
          await services.catalogue.assignMenuToBranch(menu.id, branchId);
        }
        return menu;
      },
      { onSuccess: (menu: Menu) => onCreated(menu.id) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newMenu")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!name.trim()} onClick={create}>
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

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("menu.priority")} hint={t("menu.menuPriorityHint")}>
          <Input inputMode="numeric" dir="ltr" value={priority} onChange={(event) => setPriority(event.target.value)} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-fg-subtle mb-1 text-xs font-medium">{t("menu.orderTypes")}</legend>
          {ORDER_TYPE_CHOICES.map((type) => (
            <Toggle
              key={type}
              checked={orderTypes.includes(type)}
              onChange={(next) =>
                setOrderTypes((current) => (next ? [...current, type] : current.filter((row) => row !== type)))
              }
              label={type}
            />
          ))}
        </fieldset>

        {availableBranches.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-fg-subtle mb-1 text-xs font-medium">{t("menu.assignedBranches")}</legend>
            {availableBranches.map((branch) => (
              <Toggle
                key={branch.id}
                checked={branchIds.includes(branch.id)}
                onChange={(next) =>
                  setBranchIds((current) =>
                    next ? [...current, branch.id] : current.filter((id) => id !== branch.id),
                  )
                }
                label={tx(branch.name)}
              />
            ))}
          </fieldset>
        ) : null}
      </div>
    </Drawer>
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

function ItemEditorDrawer({
  open,
  item,
  categories,
  defaultCategoryId,
  branchId,
  canManage,
  canToggleAvailability,
  canReadPrice,
  canChangePrice,
  currency,
  onClose,
  onChanged,
}: {
  open: boolean;
  item: LiveItem | null;
  categories: LiveCategory[];
  defaultCategoryId?: string;
  branchId: string | null;
  canManage: boolean;
  canToggleAvailability: boolean;
  canReadPrice: boolean;
  canChangePrice: boolean;
  currency: Currency;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [name, setName] = useState(item ? tx(item.name) : "");
  const [kitchenName, setKitchenName] = useState(item ? tx(item.kitchenName) : "");
  const [description, setDescription] = useState(item ? tx(item.description) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId || defaultCategoryId || "");
  const [taxClassId, setTaxClassId] = useState(item?.taxClassId ?? "");
  const [pending86, setPending86] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [variantName, setVariantName] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  // The default variant's price, entered in the SAME create form — an item
  // is never created without one, so there is no second workflow required
  // to make it sellable.
  const [price, setPrice] = useState("");

  const exponent = currencyExponent(currency);
  const priceTooPrecise = excessPrecision(price, exponent);
  const variantPriceTooPrecise = excessPrecision(variantPrice, exponent);

  // Re-read on open so the drawer always reflects server truth, including
  // variants (`GET /catalogue/items` never returns them — only `get()` does).
  const detail = useAsync(
    async () => (item ? services.catalogue.items.get(item.id) : null),
    [item?.id, open],
  );
  const taxLabel = useTaxClassLabel((detail.data ?? item)?.taxClassId ?? null, branchId);

  if (!open) return null;

  const current = detail.data ?? item;

  async function save() {
    if (!name.trim()) return;

    if (!item) {
      // Create flow: price is required in this SAME form, and the item plus
      // its default variant are created atomically in one call — never
      // "create the item, then separately add a variant" to price it.
      const minorAmount = minorFromInput(price, exponent);
      if (minorAmount === null || priceTooPrecise) return;
      await action.run(
        async () => {
          const created = await services.catalogue.items.create({
            name: { en: name.trim(), ar: name.trim() },
            kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
            description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
            taxClassId: taxClassId || undefined,
            variants: [
              {
                name: { en: name.trim(), ar: name.trim() },
                price: { amount: minorAmount, currency },
              },
            ],
          });
          if (categoryId) {
            await services.catalogue.placeItem(created.id, categoryId);
          }
          return created;
        },
        { onSuccess: () => onChanged(t("menu.itemCreated")) },
      );
      onClose();
      return;
    }

    await action.run(
      async () => {
        const updated = await services.catalogue.items.update(item.id, {
          name: { en: name.trim(), ar: name.trim() },
          kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
          description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
          taxClassId: taxClassId || undefined,
        });
        // C-02 — moving/placing an item is a separate call; if the category
        // changed, place it in the chosen one.
        if (categoryId && categoryId !== item.categoryId) {
          await services.catalogue.placeItem(item.id, categoryId);
        }
        return updated;
      },
      { onSuccess: () => onChanged(t("menu.itemPlaced")) },
    );
    onClose();
  }

  async function setAvailability(available: boolean, reason?: string, autoReenableAt?: string) {
    if (!item) return;
    await action.run(
      () => services.catalogue.toggleAvailability(item.id, available, reason, autoReenableAt),
      {
        onSuccess: () => {
          setPending86(false);
          // The reason is an action-time note, never persistent item state
          // (the API records it to the audit trail only — see
          // `MenuItem.unavailableReason`'s own doc comment) — echoing it
          // into this transient toast is the one honest place to show it,
          // since a toast disappears rather than implying it was saved.
          onChanged(
            available ? t("menu.restored") : reason ? `${t("menu.eightySixed")} — ${reason}` : t("menu.eightySixed"),
          );
          detail.reload();
        },
      },
    );
  }

  async function deactivate() {
    if (!item) return;
    await action.run(() => services.catalogue.items.remove(item.id), {
      onSuccess: () => {
        onChanged(t("common.deactivate"));
        onClose();
      },
    });
  }

  /** A FURTHER variant on an item that already exists (and is therefore already sellable). */
  async function addVariant() {
    if (!item || !variantName.trim()) return;
    const minorAmount = minorFromInput(variantPrice, exponent);
    if (minorAmount === null || variantPriceTooPrecise) return;
    await action.run(
      () =>
        services.catalogue.addVariant(item.id, {
          name: { en: variantName.trim(), ar: variantName.trim() },
          price: { amount: minorAmount, currency },
        }),
      {
        onSuccess: () => {
          setVariantName("");
          setVariantPrice("");
          setAddingVariant(false);
          detail.reload();
          onChanged(t("menu.variantAdded"));
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? tx(item.name) : t("menu.newItem")}
      footer={
        // The two permissions gate independently — a session with ONLY
        // `menu.availability.toggle` (no `menu.item.manage`) must still see
        // the 86/restore control; nesting it under `canManage` would hide a
        // mutation this exact session is allowed to perform.
        canManage || canToggleAvailability ? (
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {item && canManage ? (
                <Button variant="ghost" disabled={action.pending} onClick={deactivate}>
                  {t("common.deactivate")}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              {item && canToggleAvailability ? (
                current?.available ? (
                  <Button variant="danger" icon={<Ban size={14} />} onClick={() => setPending86(true)}>
                    {t("menu.toggle86")}
                  </Button>
                ) : (
                  <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => setAvailability(true)}>
                    {t("menu.toggleAvailable")}
                  </Button>
                )
              ) : null}
              {canManage ? (
                <Button
                  variant="primary"
                  loading={action.pending}
                  disabled={
                    !name.trim() ||
                    !categoryId ||
                    (!item && (!price.trim() || priceTooPrecise))
                  }
                  onClick={save}
                >
                  {t("common.save")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {/* `unavailableReason` is truthy exactly while a manual 86 is in
            effect — never the operator's typed reason (the API never
            returns that; see the field's own doc comment). Shown as a
            truthful status, not as if it were the reason read back. */}
        {current?.unavailableReason ? (
          <Callout tone="bad" title={t("menu.unavailable")}>
            <p>{t("menu.eightySixedNotice")}</p>
            {current.autoReenableAt ? (
              <p className="mt-1">
                {t("menu.autoReenableActive").replace("{time}", formatDateTime(current.autoReenableAt, fmt))}
              </p>
            ) : null}
          </Callout>
        ) : null}

        {/* `isActive === false` with no manual 86 in effect — a distinct,
            master-data lifecycle state (menu.item.manage), never conflated
            with 86 (menu.availability.toggle) or a "hidden" flag (there is
            no such thing). */}
        {current && !current.available && !current.unavailableReason ? (
          <Callout tone="muted" title={t("menu.deactivated")}>
            {t("menu.deactivatedNotice")}
          </Callout>
        ) : null}

        <Field label={t("common.name")} required>
          <Input autoFocus={!item} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} disabled={!canManage} />
        </Field>

        <Field label={t("menu.kitchenName")} hint={t("menu.kitchenNameHint")}>
          <Input value={kitchenName} onChange={(event) => setKitchenName(event.target.value)} maxLength={120} disabled={!canManage} />
        </Field>

        <Field label={t("common.category")} hint={t("menu.placementHint")} required>
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={!canManage}>
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {tx(category.name)}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          Direct price entry, in the SAME create form — no Price List, no
          separate pricing workspace, no second step before the item is
          sellable. Only shown while creating: an existing item's price is
          edited per-variant, below.
        */}
        {!item ? (
          <div>
            <Field label={t("menu.price")} required hint={`${currency} · ${t("menu.priceHint")}`}>
              <Input
                inputMode="decimal"
                dir="ltr"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            {priceTooPrecise ? (
              <div className="mt-1">
                <Callout tone="bad">{t("menu.priceExcessPrecision")}</Callout>
              </div>
            ) : null}
          </div>
        ) : null}

        <Field label={t("common.description")}>
          <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canManage} />
        </Field>

        {canManage ? (
          <TaxClassField branchId={branchId} value={taxClassId} disabled={action.pending} onChange={setTaxClassId} />
        ) : (
          <DescList>
            <DescRow label={t("menu.taxClass")}>
              <Badge tone={taxLabel.tone}>{taxLabel.text}</Badge>
            </DescRow>
          </DescList>
        )}

        {/*
          Every variant's direct price, edited right here — no separate
          pricing workspace, no Price List to create or select first.
        */}
        {item ? (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-fg text-sm font-semibold">{t("menu.variants")}</h3>
              {canManage ? (
                <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAddingVariant(true)}>
                  {t("common.add")}
                </Button>
              ) : null}
            </div>

            {!current || current.variants.length === 0 ? (
              <Callout tone="muted">{t("menu.noVariants")}</Callout>
            ) : (
              <ul className="divide-line divide-y">
                {current.variants.map((variant) =>
                  canChangePrice ? (
                    <PriceRow
                      key={variant.id}
                      variantName={tx(variant.name)}
                      currentPrice={variant.basePrice}
                      currency={currency}
                      onSave={(minorAmount) =>
                        services.catalogue.updateVariantPrice(variant.id, { amount: minorAmount, currency })
                      }
                      onSaved={() => {
                        detail.reload();
                        onChanged(t("menu.priceSaved"));
                      }}
                    />
                  ) : (
                    <li key={variant.id} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-fg truncate text-sm">{tx(variant.name)}</span>
                      {canReadPrice ? (
                        <span className="text-fg font-mono text-sm tabular-nums">
                          {formatMoney(variant.basePrice, fmt)}
                        </span>
                      ) : null}
                    </li>
                  ),
                )}
              </ul>
            )}

            {addingVariant ? (
              <div className="mt-2 space-y-2">
                <Field label={t("menu.newVariant")}>
                  <Input value={variantName} onChange={(event) => setVariantName(event.target.value)} maxLength={80} />
                </Field>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label={t("menu.price")} hint={`${currency} · ${t("menu.priceHint")}`}>
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        value={variantPrice}
                        onChange={(event) => setVariantPrice(event.target.value)}
                      />
                    </Field>
                    {variantPriceTooPrecise ? (
                      <div className="mt-1">
                        <Callout tone="bad">{t("menu.priceExcessPrecision")}</Callout>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!variantName.trim() || !variantPrice.trim() || variantPriceTooPrecise || action.pending}
                    onClick={addVariant}
                  >
                    {t("common.add")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <Callout tone="muted">{t("menu.hiddenNote")}</Callout>
      </div>

      {pending86 ? (
        <Eighty6Modal
          onCancel={() => setPending86(false)}
          onConfirm={(reason, autoReenableAt) => setAvailability(false, reason, autoReenableAt)}
        />
      ) : null}
    </Drawer>
  );
}

/**
 * One variant's direct price — its own `useAction`, so one row saving or
 * failing never disturbs the others. On failure, `amount` stays exactly what
 * the person typed (never reset) while `currentPrice` — passed down from the
 * parent's reloaded item — is what actually renders as "the current price";
 * a failed write never overwrites it, since `onSaved` (which triggers that
 * reload) never fires on failure. No optimistic update happens in this row.
 */
function PriceRow({
  variantName,
  currentPrice,
  currency,
  onSave,
  onSaved,
}: {
  variantName: string;
  currentPrice: Money;
  currency: Currency;
  onSave: (minorAmount: number) => Promise<unknown>;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const exponent = currencyExponent(currency);
  // A currency-aware guard, not a hardcoded "2 decimals": a 3-exponent
  // currency (e.g. a future BHD/KWD tenant) permits a third digit here.
  const tooPrecise = excessPrecision(amount, exponent);

  async function save() {
    if (tooPrecise) return;
    const minorAmount = minorFromInput(amount, exponent);
    if (minorAmount === null) return;
    await action.run(() => onSave(minorAmount), {
      onSuccess: () => {
        setEditing(false);
        setAmount("");
        onSaved();
      },
    });
  }

  return (
    <li className="space-y-2 py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-fg truncate text-sm">{variantName}</span>
        <div className="flex items-center gap-2">
          <span className="text-fg font-mono text-sm tabular-nums">{formatMoney(currentPrice, fmt)}</span>
          {!editing ? (
            <Button
              variant="ghost"
              icon={<Pencil size={12} />}
              onClick={() => {
                setAmount("");
                setEditing(true);
              }}
            >
              {t("common.edit")}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label={t("menu.price")} hint={`${currency} · ${t("menu.priceHint")}`}>
              <Input
                autoFocus
                inputMode="decimal"
                dir="ltr"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    save();
                  }
                  if (event.key === "Escape") setEditing(false);
                }}
              />
            </Field>
            {tooPrecise ? (
              <div className="mt-1">
                <Callout tone="bad">{t("menu.priceExcessPrecision")}</Callout>
              </div>
            ) : null}
          </div>
          <Button
            variant="secondary"
            loading={action.pending}
            disabled={amount.trim() === "" || tooPrecise}
            onClick={save}
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : null}

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
    </li>
  );
}

function Eighty6Modal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  // `autoReenableAt` is an ISO datetime, only ever set — never undefined
  // just because the field was left blank vs. genuinely omitted; the caller
  // only cares whether one was entered.
  onConfirm: (reason: string, autoReenableAt?: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [autoReenableAt, setAutoReenableAt] = useState("");
  const trimmed = reason.trim();

  function confirm() {
    // `datetime-local` has no timezone of its own — read in the browser's
    // own local time, which is exactly what a manager means by "6pm".
    const iso = autoReenableAt ? new Date(autoReenableAt).toISOString() : undefined;
    onConfirm(trimmed, iso);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title={t("menu.toggle86")}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={trimmed.length === 0} onClick={confirm}>
            {t("menu.toggle86")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("menu.86Reason")} hint={t("menu.86ReasonHint")} required>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("menu.86Placeholder")} />
        </Field>

        <Field label={t("menu.autoReenableAt")} hint={t("menu.autoReenableHint")}>
          <Input
            type="datetime-local"
            dir="ltr"
            value={autoReenableAt}
            onChange={(event) => setAutoReenableAt(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
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
  const { t, tx, fmt } = useI18n();
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

  return (
    <Drawer
      open
      onClose={() => {
        setSelectedId(null);
        setCreatingGroup(false);
        onClose();
      }}
      title={selectedId && detail.data ? tx(detail.data.name) : t("menu.customizations")}
      subtitle={!selectedId && !creatingGroup ? t("menu.customizationsHint") : undefined}
    >
      <div className="space-y-4">
        {groups.error ? <Callout tone="bad">{groups.error.message}</Callout> : null}

        {selectedId ? (
          <GroupDetailPanel
            detail={detail}
            canManage={canManage}
            currency={currency}
            onBack={() => setSelectedId(null)}
            onChanged={reload}
          />
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
          <>
            {canManage ? (
              <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setCreatingGroup(true)}>
                {t("menu.newGroup")}
              </Button>
            ) : null}

            {groups.loading ? (
              <Callout tone="muted">{t("state.loading")}</Callout>
            ) : rows.length === 0 ? (
              <Callout tone="muted">{t("menu.noModifierGroups")}</Callout>
            ) : (
              <ul className="divide-line divide-y">
                {rows.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(group.id)}
                      className="hover:bg-sunken flex w-full items-center justify-between gap-3 rounded-md px-1 py-2.5 text-start"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{tx(group.name)}</span>
                      <Badge tone={group.required ? "accent" : "muted"}>
                        {group.required ? t("menu.required") : t("common.optional")}
                      </Badge>
                      <span dir="ltr" className="text-fg-subtle shrink-0 text-xs">
                        {formatNumber(group.minSelections, fmt)}/{formatNumber(group.maxSelections, fmt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Drawer>
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
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("common.name")} required>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("menu.minSelections")}>
          <Input inputMode="numeric" dir="ltr" value={minInput} onChange={(event) => setMinInput(event.target.value)} />
        </Field>
        <Field label={t("menu.maxSelections")}>
          <Input inputMode="numeric" dir="ltr" value={maxInput} onChange={(event) => setMaxInput(event.target.value)} />
        </Field>
      </div>

      <Toggle checked={required} onChange={setRequired} label={t("menu.required")} />
      <Toggle checked={allowRepeat} onChange={setAllowRepeat} label={t("menu.allowRepeat")} />

      {ruleError ? <Callout tone="bad">{ruleError}</Callout> : null}

      <div className="flex gap-2">
        <Button variant="primary" loading={action.pending} disabled={!canCreate} onClick={create}>
          {t("common.create")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** A selected group's own config (PATCH) plus its modifiers (view + create). */
function GroupDetailPanel({
  detail,
  canManage,
  currency,
  onBack,
  onChanged,
}: {
  detail: AsyncState<ModifierGroup | null>;
  canManage: boolean;
  currency: Currency;
  onBack: () => void;
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
      <div className="space-y-3">
        <Button variant="ghost" icon={<ChevronLeft size={14} />} onClick={onBack}>
          {t("common.back")}
        </Button>
        {detail.error ? (
          <Callout tone="bad">{detail.error.message}</Callout>
        ) : (
          <Callout tone="muted">{t("state.loading")}</Callout>
        )}
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
    <div className="space-y-4">
      <Button variant="ghost" icon={<ChevronLeft size={14} />} onClick={onBack}>
        {t("common.back")}
      </Button>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("common.name")} required>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} disabled={!canManage} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("menu.minSelections")}>
          <Input
            inputMode="numeric"
            dir="ltr"
            value={minInput}
            onChange={(event) => setMinInput(event.target.value)}
            disabled={!canManage}
          />
        </Field>
        <Field label={t("menu.maxSelections")}>
          <Input
            inputMode="numeric"
            dir="ltr"
            value={maxInput}
            onChange={(event) => setMaxInput(event.target.value)}
            disabled={!canManage}
          />
        </Field>
      </div>

      <Toggle checked={required} onChange={setRequired} label={t("menu.required")} disabled={!canManage} />
      <Toggle checked={allowRepeat} onChange={setAllowRepeat} label={t("menu.allowRepeat")} disabled={!canManage} />

      {ruleError ? <Callout tone="bad">{ruleError}</Callout> : null}

      {canManage ? (
        <Button variant="primary" loading={action.pending} disabled={!canSave} onClick={save}>
          {t("common.save")}
        </Button>
      ) : null}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-fg text-sm font-semibold">{t("nav.modifiers")}</h3>
          {canManage && !addingModifier ? (
            <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAddingModifier(true)}>
              {t("common.add")}
            </Button>
          ) : null}
        </div>

        {group.modifiers.length === 0 ? (
          <Callout tone="muted">{t("menu.noModifiers")}</Callout>
        ) : (
          <ul className="divide-line divide-y">
            {group.modifiers.map((modifier) => (
              <ModifierRow key={modifier.id} modifier={modifier} currency={currency} fmt={fmt} tx={tx} t={t} />
            ))}
          </ul>
        )}

        {group.modifiers.length > 0 ? <Callout tone="muted">{t("menu.existingModifiersNote")}</Callout> : null}

        {canManage ? (
          <div className="mt-3">
            <NewModifierForm
              open={addingModifier}
              groupId={group.id}
              currency={currency}
              onCancel={() => setAddingModifier(false)}
              onCreated={() => {
                setAddingModifier(false);
                onChanged(t("menu.modifierAdded"));
              }}
            />
          </div>
        ) : null}
      </section>
    </div>
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
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-fg truncate text-sm">{tx(modifier.name)}</span>
        <Badge tone={kind.tone}>{tx(kind.label)}</Badge>
      </div>
      <div className="shrink-0 text-end">
        <div className="text-fg font-mono text-sm tabular-nums">
          {amount === 0 ? "—" : `${amount > 0 ? "+" : ""}${formatMoney({ amount, currency }, fmt)}`}
        </div>
        <div className="text-fg-subtle text-xs">{signLabel}</div>
      </div>
    </li>
  );
}

/**
 * `POST /catalogue/modifier-groups/:id/modifiers`. `kind` is required by the
 * DTO with no server-accepted default, so it is always a real choice here.
 */
function NewModifierForm({
  open,
  groupId,
  currency,
  onCancel,
  onCreated,
}: {
  open: boolean;
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

  if (!open) return null;

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
    <div className="border-line space-y-4 rounded-lg border p-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("common.name")} required>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Field>

      <Field label={t("menu.modifierKind")} hint={t("menu.modifierKindHint")} required>
        <Select value={kind} onChange={(event) => setKind(event.target.value as Modifier["kind"])}>
          {(["addition", "removal", "substitution"] as const).map((value) => (
            <option key={value} value={value}>
              {tx(labelOf(MODIFIER_KIND, value).label)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("menu.priceDelta")} hint={`${currency} · ${t("menu.priceHint")}`}>
        <Input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      {tooPrecise ? <Callout tone="bad">{t("menu.priceExcessPrecision")}</Callout> : null}

      <div className="flex gap-2">
        <Button variant="primary" loading={action.pending} disabled={!canCreate} onClick={create}>
          {t("common.create")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
