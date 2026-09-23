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
 *                 available-unavailable(86) / variants (display + add).
 *
 * Deliberately NOT here: Combos (no backend at all), per-channel/per-size
 * price editing, modifier-group management, a "Hidden" status and item
 * duplication — every one of those needs either a backend endpoint that
 * does not exist yet or a canonical price-list write this slice does not
 * make. Building any of them here would be exactly the "fake success" this
 * workspace exists to avoid; they stay on `/menu/pricing`, `/menu/modifiers`
 * and `/menu/combos` until a later slice migrates them for real.
 */

import { useMemo, useState } from "react";
import { Ban, Check, CheckCircle2, ChevronDown, Pencil, Plus, Store, Tag, TriangleAlert } from "lucide-react";
import type { Currency, Menu, Localised, PriceList, PriceListEntry } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { currencyExponent, excessPrecision, formatMoney, formatNumber, minorFromInput } from "@/lib/console/format";
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

/**
 * `PriceList.orderTypes` — the full canonical set (FR-MNU-023/024's own six
 * values). Deliberately NOT `Sales.channel` (`pos`/`kiosk`/`qr`/`aggregator`/
 * `phone`/`api`) — a price list scopes by how the order was PLACED
 * (dine-in vs delivery vs...), never by which device or surface placed it.
 */
const PRICE_LIST_ORDER_TYPES = [
  "dine_in",
  "takeaway",
  "delivery",
  "drive_thru",
  "pickup",
  "aggregator",
] as const;

const ORDER_TYPE_LABEL_KEY: Record<(typeof PRICE_LIST_ORDER_TYPES)[number], ConsoleKey> = {
  dine_in: "menu.orderTypeDineIn",
  takeaway: "menu.orderTypeTakeaway",
  delivery: "menu.orderTypeDelivery",
  drive_thru: "menu.orderTypeDriveThru",
  pickup: "menu.orderTypePickup",
  aggregator: "menu.orderTypeAggregator",
};

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
  const [priceListId, setPriceListId] = useState<string | null>(null);
  const [creatingPriceList, setCreatingPriceList] = useState(false);

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

  // menu.price.read gates visibility of pricing data entirely — a session
  // that can't read prices never issues the request, not even to render a
  // disabled control (FR-SEC-045: the real gate is server-side, but nothing
  // here should even try).
  const priceLists = useAsync(
    () => (canReadPrice ? services.catalogue.priceLists.list({ limit: 200, scope }) : Promise.resolve({ rows: [], total: 0 })),
    [scope.tenantId, scope.brandId, scope.branchId, canReadPrice],
  );
  const priceListRows = useMemo(() => priceLists.data?.rows ?? [], [priceLists.data]);

  // Same render-time "reset on scope change, else fall back to the first
  // row" pattern as `effectiveMenuId` above — a price list scoped to a brand
  // or branch that just left view is never left silently selected.
  let effectivePriceListId = priceListId;
  if (currentScopeKey !== scopeKeySeen) {
    if (priceListId !== null) setPriceListId(null);
    effectivePriceListId = null;
  } else if (!priceLists.loading && (effectivePriceListId === null || !priceListRows.some((row) => row.id === effectivePriceListId))) {
    const fallback = priceListRows[0]?.id ?? null;
    if (fallback !== priceListId) setPriceListId(fallback);
    effectivePriceListId = fallback;
  }

  const priceListDetail = useAsync(
    () => (effectivePriceListId ? services.catalogue.priceLists.get(effectivePriceListId) : Promise.resolve(null)),
    [effectivePriceListId],
  );

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

          {/* Pricing context — a second, independent toolbar row: a price
              list is not scoped to any one menu, so it sits beside the menu
              switcher rather than inside it. Hidden entirely without
              `menu.price.read` (FR-SEC-045 — a courtesy hide, the real gate
              is server-side and enforced above by never issuing the read). */}
          {canReadPrice ? (
            <div className="border-line flex flex-wrap items-center gap-3 border-b p-3">
              <PriceListSwitcher
                priceLists={priceListRows}
                value={effectivePriceListId}
                loading={priceLists.loading}
                tx={tx}
                t={t}
                onChange={setPriceListId}
              />
              {priceLists.error ? <Callout tone="bad">{priceLists.error.message}</Callout> : null}
              {canChangePrice ? (
                <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setCreatingPriceList(true)}>
                  {t("menu.newPriceList")}
                </Button>
              ) : null}
            </div>
          ) : null}

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
        priceList={priceListDetail.data ?? null}
        currency={currentCurrency(session)}
        onClose={() => setEditorState(null)}
        onChanged={(note) => {
          setMessage(note);
          items.reload();
        }}
        onPriceChanged={(note) => {
          setMessage(note);
          priceListDetail.reload();
          priceLists.reload();
        }}
      />

      {canChangePrice ? (
        <NewPriceListDrawer
          open={creatingPriceList}
          onClose={() => setCreatingPriceList(false)}
          onCreated={(id) => {
            setCreatingPriceList(false);
            setMessage(t("menu.priceListCreated"));
            setPriceListId(id);
            priceLists.reload();
          }}
        />
      ) : null}

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
 * Status is shown, never mutated — `POST /catalogue/price-lists` has no
 * PATCH and no activate/deactivate route, so this workspace cannot offer
 * either (FR-MNU-021). `scheduled` reads as its own tone, not "disabled": a
 * scheduled list is fully eligible for resolution once its window opens —
 * only `expired` is excluded.
 */
function priceListStatusLabelKey(status: PriceList["status"]): ConsoleKey {
  if (status === "scheduled") return "menu.priceListStatusScheduled";
  if (status === "expired") return "menu.priceListStatusExpired";
  return "menu.priceListStatusActive";
}

function priceListStatusTone(status: PriceList["status"]): "good" | "muted" | "bad" {
  if (status === "expired") return "bad";
  if (status === "scheduled") return "muted";
  return "good";
}

/**
 * The price-list equivalent of `MenuSwitcher` — a small rebuild on the same
 * RTL-safe primitives rather than sharing code with it, since this list
 * carries a status badge per row that the menu switcher has no concept of.
 */
function PriceListSwitcher({
  priceLists,
  value,
  loading,
  tx,
  t,
  onChange,
}: {
  priceLists: PriceList[];
  value: string | null;
  loading: boolean;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = priceLists.find((row) => row.id === value) ?? null;

  if (!loading && priceLists.length === 0) {
    return (
      <span className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Tag size={14} /> {t("menu.noPriceLists")}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-line bg-sunken hover:border-accent flex min-w-52 items-center gap-2 rounded-lg border px-3 py-2 text-start transition-colors"
      >
        <Tag size={14} className="text-fg-subtle shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {current ? tx(current.name) : t("menu.priceListNone")}
        </span>
        {current ? (
          <Badge tone={priceListStatusTone(current.status)}>{t(priceListStatusLabelKey(current.status))}</Badge>
        ) : null}
        <ChevronDown size={15} className={`text-fg-subtle shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="border-line bg-raised absolute start-0 top-[calc(100%+6px)] z-20 max-h-72 w-72 overflow-auto rounded-lg border p-1 shadow-lg"
          >
            {priceLists.map((row) => (
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
                <span className="min-w-0 flex-1 truncate">{tx(row.name)}</span>
                <Badge tone={priceListStatusTone(row.status)}>{t(priceListStatusLabelKey(row.status))}</Badge>
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

/**
 * `POST /catalogue/price-lists` — a new list, scoped and prioritised.
 *
 * Migrated from the original `/menu/pricing` WIP's `NewPriceListDrawer`
 * (BUG-SCOPEID-P0): a brand/branch-scoped list needs a real `scopeId`, and
 * the only id that can ever be correct here is whichever brand/branch the
 * session is currently on. There is deliberately no id input and no second
 * brand/branch picker — a manual field would let someone paste a DISPLAY
 * NAME or an id belonging to a brand/branch nobody is looking at. `brand`/
 * `branch` are read from `useSession()` on every render — never copied into
 * local state — so a header change made while this drawer is still open is
 * picked up live, and a tenant/brand/branch switch can never leave a stale
 * id behind.
 */
function NewPriceListDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (priceListId: string) => void;
}) {
  const { t, tx } = useI18n();
  const { brand, branch } = useSession();
  const action = useAction();
  const [name, setName] = useState("");
  const [listScope, setListScope] = useState<"tenant" | "brand" | "branch">("tenant");
  const [priority, setPriority] = useState("10");
  const [orderType, setOrderType] = useState<"" | (typeof PRICE_LIST_ORDER_TYPES)[number]>("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  if (!open) return null;

  // `null` here is the header's own "no active brand/branch" state, not a
  // loading gap. Neither can stand in for a real id, so a brand/branch scope
  // with no active one is blocked rather than silently falling back to
  // anything — FR-SEC-004, a scope can never be invented client-side.
  const blocked =
    listScope === "brand" && !brand
      ? t("menu.priceListScopeNeedsBrand")
      : listScope === "branch" && !branch
        ? t("menu.priceListScopeNeedsBranch")
        : null;

  const canCreate = name.trim() !== "" && blocked === null;

  async function create() {
    if (!canCreate) return;

    const trimmedName = { en: name.trim(), ar: name.trim() };
    const priorityValue = Number(priority) || 0;
    const orderTypes = orderType ? [orderType] : undefined;
    const dates = {
      ...(validFrom ? { validFrom } : {}),
      ...(validTo ? { validTo } : {}),
    };

    // Built explicitly per scope, not one object with an optional field: a
    // tenant-scoped list must never carry a `scopeId` at all, not even
    // `undefined` — the backend rejects `brand`/`branch` scope without a
    // real one, and a tenant list is never scoped to anything. Read straight
    // from `useSession()` at submit time, same as `blocked` above.
    if (listScope === "tenant") {
      await action.run(
        () =>
          services.catalogue.priceLists.create({
            name: trimmedName,
            scope: "tenant",
            priority: priorityValue,
            orderTypes,
            ...dates,
          }),
        { onSuccess: (row) => onCreated(row.id) },
      );
      return;
    }

    const scopeId = listScope === "brand" ? brand?.id : branch?.id;
    if (!scopeId) return; // `canCreate`/`blocked` already refuse this; defensive only.

    await action.run(
      () =>
        services.catalogue.priceLists.create({
          name: trimmedName,
          scope: listScope,
          scopeId,
          priority: priorityValue,
          orderTypes,
          ...dates,
        }),
      { onSuccess: (row) => onCreated(row.id) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newPriceList")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!canCreate} onClick={create}>
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

        <Field label={t("menu.scope")}>
          <Select value={listScope} onChange={(event) => setListScope(event.target.value as "tenant" | "brand" | "branch")}>
            <option value="tenant">{t("menu.priceListScopeTenant")}</option>
            <option value="brand">{t("menu.priceListScopeBrand")}</option>
            <option value="branch">{t("menu.priceListScopeBranch")}</option>
          </Select>
        </Field>

        {/* The active brand/branch this list will actually be scoped to —
            named plainly rather than left implicit. This form has no way to
            change it; only the session header does. */}
        {listScope === "brand" ? (
          brand ? (
            <p className="text-fg-subtle text-xs">{t("menu.priceListScopeBrandActive").replace("{name}", tx(brand.name))}</p>
          ) : (
            <Callout tone="warn">{t("menu.priceListScopeNeedsBrand")}</Callout>
          )
        ) : null}

        {listScope === "branch" ? (
          branch ? (
            <p className="text-fg-subtle text-xs">{t("menu.priceListScopeBranchActive").replace("{name}", tx(branch.name))}</p>
          ) : (
            <Callout tone="warn">{t("menu.priceListScopeNeedsBranch")}</Callout>
          )
        ) : null}

        <Field label={t("menu.priceListOrderType")}>
          <Select value={orderType} onChange={(event) => setOrderType(event.target.value as typeof orderType)}>
            <option value="">{t("menu.priceListOrderTypeAny")}</option>
            {PRICE_LIST_ORDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(ORDER_TYPE_LABEL_KEY[type])}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("menu.priceListValidFrom")}>
            <Input type="date" dir="ltr" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
          </Field>
          <Field label={t("menu.priceListValidTo")}>
            <Input type="date" dir="ltr" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
          </Field>
        </div>

        <Field label={t("menu.priority")} hint={t("menu.priceListPriorityHint")}>
          <Input inputMode="numeric" dir="ltr" value={priority} onChange={(event) => setPriority(event.target.value)} />
        </Field>
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
  priceList,
  currency,
  onClose,
  onChanged,
  onPriceChanged,
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
  /** The selected price list, WITH its entries — `null` when none is selected. */
  priceList: PriceList | null;
  currency: Currency;
  onClose: () => void;
  onChanged: (message: string) => void;
  onPriceChanged: (message: string) => void;
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
    await action.run(
      async () => {
        const created = item
          ? await services.catalogue.items.update(item.id, {
              name: { en: name.trim(), ar: name.trim() },
              kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
              description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
              taxClassId: taxClassId || undefined,
            })
          : await services.catalogue.items.create({
              name: { en: name.trim(), ar: name.trim() },
              kitchenName: kitchenName.trim() ? { en: kitchenName.trim(), ar: kitchenName.trim() } : undefined,
              description: description.trim() ? { en: description.trim(), ar: description.trim() } : undefined,
              taxClassId: taxClassId || undefined,
            });
        // C-02 — moving/placing an item is a separate call; if the category
        // changed (or this is a new item), place it in the chosen one.
        if (categoryId && categoryId !== item?.categoryId) {
          await services.catalogue.placeItem(created.id, categoryId);
        }
        return created;
      },
      { onSuccess: () => onChanged(item ? t("menu.itemPlaced") : t("menu.itemCreated")) },
    );
    onClose();
  }

  async function setAvailability(available: boolean, reason?: string) {
    if (!item) return;
    await action.run(() => services.catalogue.toggleAvailability(item.id, available, reason), {
      onSuccess: () => {
        setPending86(false);
        onChanged(available ? t("menu.restored") : t("menu.eightySixed"));
        detail.reload();
      },
    });
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

  async function addVariant() {
    if (!item || !variantName.trim()) return;
    await action.run(
      () =>
        services.catalogue.addVariant(item.id, {
          name: { en: variantName.trim(), ar: variantName.trim() },
        }),
      {
        onSuccess: () => {
          setVariantName("");
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
        canManage ? (
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
              <Button variant="primary" loading={action.pending} disabled={!name.trim() || !categoryId} onClick={save}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {current && !current.available && current.unavailableReason ? (
          <Callout tone="bad" title={t("menu.unavailable")}>
            {current.unavailableReason}
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
                {current.variants.map((variant) => (
                  <li key={variant.id} className="flex items-center justify-between gap-4 py-2">
                    <span className="text-fg truncate text-sm">{tx(variant.name)}</span>
                    {canReadPrice ? (
                      <span className="text-fg font-mono text-sm tabular-nums">
                        {formatMoney({ amount: variant.basePrice.amount, currency: variant.basePrice.currency }, fmt)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {addingVariant ? (
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("menu.newVariant")} hint={t("menu.variantPriceNote")}>
                    <Input value={variantName} onChange={(event) => setVariantName(event.target.value)} maxLength={80} />
                  </Field>
                </div>
                <Button variant="secondary" disabled={!variantName.trim() || action.pending} onClick={addVariant}>
                  {t("common.add")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/*
          FR-MNU-023/024 — the selected price list's own PriceEntry per real
          variant. Deliberately NOT the generic `variant.basePrice` column
          above (that one blends whichever active lists exist, highest
          priority last-write-wins — see `variantPrices()` in
          `lib/console/services/http.ts`); this section is scoped to exactly
          the price list currently selected in the workspace toolbar, and
          only `menu.price.change` may write to it.
        */}
        {item && canReadPrice ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.priceInSelectedList")}</h3>

            {!current || current.variants.length === 0 ? (
              <Callout tone="muted">{t("menu.priceNeedsVariant")}</Callout>
            ) : !priceList ? (
              <Callout tone="muted">{t("menu.priceNeedsPriceList")}</Callout>
            ) : (
              <div className="space-y-2">
                {!canChangePrice ? <Callout tone="muted">{t("menu.priceReadOnly")}</Callout> : null}
                <ul className="divide-line divide-y">
                  {current.variants.map((variant) => (
                    <PriceRow
                      key={variant.id}
                      variantName={tx(variant.name)}
                      entry={priceList.entries.find((e) => e.variantId === variant.id) ?? null}
                      currency={currency}
                      canChangePrice={canChangePrice}
                      onSave={(minorAmount) =>
                        services.catalogue.setPrice(priceList.id, variant.id, { amount: minorAmount, currency })
                      }
                      onSaved={() => onPriceChanged(t("menu.priceSaved"))}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : null}

        <Callout tone="muted">{t("menu.hiddenNote")}</Callout>
      </div>

      {pending86 ? (
        <Eighty6Modal onCancel={() => setPending86(false)} onConfirm={(reason) => setAvailability(false, reason)} />
      ) : null}
    </Drawer>
  );
}

/**
 * One variant's row inside the pricing section — its own `useAction`, so one
 * row saving or failing never disturbs the others. On failure, `amount`
 * stays exactly what the person typed (never reset to the old server value
 * from inside this row) while `entry` — passed down from the parent's
 * reloaded price list — is what actually renders as "the current price"; a
 * failed write never overwrites it, since `onSaved` (which triggers that
 * reload) never fires on failure. No optimistic update happens anywhere in
 * this row.
 */
function PriceRow({
  variantName,
  entry,
  currency,
  canChangePrice,
  onSave,
  onSaved,
}: {
  variantName: string;
  entry: PriceListEntry | null;
  currency: Currency;
  canChangePrice: boolean;
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
          <span className="text-fg font-mono text-sm tabular-nums">
            {entry ? formatMoney(entry.price, fmt) : "—"}
          </span>
          {canChangePrice && !editing ? (
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

function Eighty6Modal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Modal
      open
      onClose={onCancel}
      title={t("menu.toggle86")}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={trimmed.length === 0} onClick={() => onConfirm(trimmed)}>
            {t("menu.toggle86")}
          </Button>
        </>
      }
    >
      <Field label={t("menu.86Reason")} required>
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("menu.86Placeholder")} />
      </Field>
    </Modal>
  );
}
