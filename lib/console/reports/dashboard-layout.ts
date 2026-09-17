/**
 * Dashboard widgets, role templates and layout arithmetic — SRS §19.4.
 *
 * Pure: no React, no storage. The dashboard page renders whatever list this
 * resolves to, the customise panel edits the list with the operations at the
 * bottom, and the layout service persists it. Keeping the arithmetic here is
 * what lets the keyboard path and the drag path share one implementation —
 * a drop and an Alt+Arrow both end in `moveTo`.
 *
 * FR-RPT-030 — role-appropriate default dashboards: `templateForRole` maps
 * each of the seventeen standard roles to a template.
 * FR-RPT-034 — user-customisable dashboards with a tenant default per role:
 * `resolveLayout` applies user layout → tenant role default → built-in
 * template, then drops what the session may not see.
 */

import type { ConsoleKey } from "@/content/console/en";
import type { PermissionKey, RoleKey } from "../permissions";

export type WidgetId =
  | "morning_brief"
  | "kpi_tiles"
  | "cost_tiles"
  // FR-RPT-031 — Executive
  | "exec_net_sales_target"
  | "exec_prime_cost"
  | "exec_branch_ranking"
  | "exec_top_bottom_items"
  | "exec_exceptions"
  | "exec_trend_sparklines"
  // FR-RPT-032 — Branch Manager
  | "mgr_today_vs_forecast"
  | "mgr_hourly_curve"
  | "mgr_food_cost_trend"
  | "mgr_reorder"
  | "mgr_expiry"
  | "mgr_staff_on_shift"
  // FR-RPT-033 — live operations summary
  | "live_ops"
  | "sales_trend"
  | "category_mix"
  | "profitability"
  | "waste_by_reason"
  | "alerts"
  | "order_activity";

export interface WidgetDefinition {
  id: WidgetId;
  titleKey: ConsoleKey;
  descriptionKey: ConsoleKey;
  /** Visible when the session holds any one. Empty means everyone. */
  permissions: PermissionKey[];
  /** Two-column span on wide screens. Half widgets pair up. */
  size: "full" | "half";
  spec: string;
}

const SALES: PermissionKey[] = ["report.view.sales"];
const FINANCIAL: PermissionKey[] = ["report.view.financial"];
const COSTS: PermissionKey[] = ["report.view.financial", "costing.view"];
const STOCK: PermissionKey[] = ["inventory.view", "report.view.inventory"];

export const WIDGETS: WidgetDefinition[] = [
  { id: "exec_net_sales_target", titleKey: "dashw.netSalesTarget", descriptionKey: "dashw.netSalesTargetDesc", permissions: SALES, size: "half", spec: "FR-RPT-031" },
  { id: "exec_prime_cost", titleKey: "dashw.primeCost", descriptionKey: "dashw.primeCostDesc", permissions: COSTS, size: "half", spec: "FR-RPT-031" },
  { id: "exec_exceptions", titleKey: "dashw.exceptions", descriptionKey: "dashw.exceptionsDesc", permissions: [], size: "half", spec: "FR-RPT-031" },
  { id: "exec_trend_sparklines", titleKey: "dashw.sparklines", descriptionKey: "dashw.sparklinesDesc", permissions: SALES, size: "half", spec: "FR-RPT-031" },
  { id: "exec_branch_ranking", titleKey: "dashw.branchRanking", descriptionKey: "dashw.branchRankingDesc", permissions: ["report.view.sales", "report.view.financial"], size: "full", spec: "FR-RPT-031" },
  { id: "exec_top_bottom_items", titleKey: "dashw.topBottom", descriptionKey: "dashw.topBottomDesc", permissions: SALES, size: "full", spec: "FR-RPT-031" },
  { id: "mgr_today_vs_forecast", titleKey: "dashw.todayForecast", descriptionKey: "dashw.todayForecastDesc", permissions: SALES, size: "half", spec: "FR-RPT-032" },
  { id: "mgr_staff_on_shift", titleKey: "dashw.staff", descriptionKey: "dashw.staffDesc", permissions: ["hr.employee.view", "report.view.workforce", "ops.live.view"], size: "half", spec: "FR-RPT-032" },
  { id: "mgr_hourly_curve", titleKey: "dashw.hourly", descriptionKey: "dashw.hourlyDesc", permissions: SALES, size: "full", spec: "FR-RPT-032" },
  { id: "mgr_food_cost_trend", titleKey: "dashw.foodCostTrend", descriptionKey: "dashw.foodCostTrendDesc", permissions: COSTS, size: "half", spec: "FR-RPT-032" },
  { id: "mgr_reorder", titleKey: "dashw.reorder", descriptionKey: "dashw.reorderDesc", permissions: STOCK, size: "half", spec: "FR-RPT-032" },
  { id: "mgr_expiry", titleKey: "dashw.expiry", descriptionKey: "dashw.expiryDesc", permissions: STOCK, size: "half", spec: "FR-RPT-032" },
  { id: "live_ops", titleKey: "dashw.live", descriptionKey: "dashw.liveDesc", permissions: ["ops.live.view", "report.view.sales"], size: "full", spec: "FR-RPT-033" },
  { id: "morning_brief", titleKey: "dash.briefTitle", descriptionKey: "dash.briefHint", permissions: [], size: "full", spec: "FR-RPT-041" },
  { id: "kpi_tiles", titleKey: "dashw.kpis", descriptionKey: "dashw.kpisDesc", permissions: SALES, size: "full", spec: "§19.4" },
  { id: "cost_tiles", titleKey: "dashw.costs", descriptionKey: "dashw.costsDesc", permissions: COSTS, size: "full", spec: "§13.5" },
  { id: "sales_trend", titleKey: "dash.salesTrend", descriptionKey: "dash.salesTrendHint", permissions: SALES, size: "half", spec: "§19.4" },
  { id: "category_mix", titleKey: "dash.categoryMix", descriptionKey: "dashw.categoryMixDesc", permissions: SALES, size: "half", spec: "§19.4" },
  { id: "profitability", titleKey: "dash.profitability", descriptionKey: "dashw.profitabilityDesc", permissions: FINANCIAL, size: "half", spec: "§13.4" },
  { id: "waste_by_reason", titleKey: "dash.wasteByReason", descriptionKey: "dashw.wasteDesc", permissions: ["report.view.inventory", "costing.view", "inventory.view"], size: "half", spec: "FR-CST-020" },
  { id: "alerts", titleKey: "dash.alerts", descriptionKey: "dash.alertsHint", permissions: [], size: "full", spec: "FR-ALT-001" },
  { id: "order_activity", titleKey: "dash.activityTitle", descriptionKey: "dash.activityHint", permissions: SALES, size: "full", spec: "§19.4" },
];

export const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

// ---------------------------------------------------------------------------
// Role templates — FR-RPT-030
// ---------------------------------------------------------------------------

export type DashboardTemplate =
  | "executive"
  | "branch_manager"
  | "kitchen"
  | "stock"
  | "finance"
  | "people"
  | "frontline";

export const TEMPLATE_LABEL: Record<DashboardTemplate, ConsoleKey> = {
  executive: "dashw.tpl.executive",
  branch_manager: "dashw.tpl.branchManager",
  kitchen: "dashw.tpl.kitchen",
  stock: "dashw.tpl.stock",
  finance: "dashw.tpl.finance",
  people: "dashw.tpl.people",
  frontline: "dashw.tpl.frontline",
};

export const TEMPLATES: Record<DashboardTemplate, WidgetId[]> = {
  // FR-RPT-031 — net sales against target, prime cost %, branch ranking,
  // top and bottom items, exception count, trend sparklines.
  executive: [
    "exec_net_sales_target",
    "exec_prime_cost",
    "exec_exceptions",
    "exec_trend_sparklines",
    "exec_branch_ranking",
    "exec_top_bottom_items",
    "morning_brief",
    "profitability",
    "category_mix",
  ],
  // FR-RPT-032 — today against forecast, hourly curve with labour overlay,
  // food cost trend, reorder, expiry watch, open exceptions, staff on shift.
  branch_manager: [
    "mgr_today_vs_forecast",
    "mgr_staff_on_shift",
    "mgr_hourly_curve",
    "live_ops",
    "alerts",
    "mgr_food_cost_trend",
    "mgr_reorder",
    "mgr_expiry",
    "waste_by_reason",
  ],
  kitchen: ["live_ops", "mgr_expiry", "mgr_reorder", "waste_by_reason", "alerts"],
  stock: ["mgr_reorder", "mgr_expiry", "waste_by_reason", "alerts"],
  finance: ["kpi_tiles", "cost_tiles", "profitability", "exec_exceptions", "sales_trend", "alerts"],
  people: ["mgr_staff_on_shift", "alerts"],
  frontline: ["live_ops", "alerts"],
};

const ROLE_TEMPLATE: Record<RoleKey, DashboardTemplate> = {
  owner: "executive",
  operations_director: "executive",
  brand_manager: "executive",
  franchisee: "executive",
  platform_admin: "executive",
  branch_manager: "branch_manager",
  shift_supervisor: "branch_manager",
  head_chef: "kitchen",
  kitchen_staff: "kitchen",
  central_kitchen_manager: "kitchen",
  storekeeper: "stock",
  purchasing_officer: "stock",
  accountant: "finance",
  auditor: "finance",
  hr_officer: "people",
  cashier: "frontline",
  waiter: "frontline",
};

/** FR-RPT-030 — the built-in template a role starts from. */
export function templateForRole(role: RoleKey): DashboardTemplate {
  return ROLE_TEMPLATE[role] ?? "frontline";
}

// ---------------------------------------------------------------------------
// Resolution — FR-RPT-034
// ---------------------------------------------------------------------------

export type LayoutSource = "user" | "role_default" | "template";

export interface ResolvedLayout {
  widgets: WidgetId[];
  source: LayoutSource;
  template: DashboardTemplate;
  /** Widgets the stored layout names that this session may not see. */
  hidden: WidgetId[];
}

/** Drops unknown ids and duplicates, keeping first occurrence order. */
export function sanitise(ids: readonly string[]): WidgetId[] {
  const seen = new Set<WidgetId>();
  const out: WidgetId[] = [];
  for (const raw of ids) {
    const id = raw as WidgetId;
    if (!WIDGET_BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function widgetAllowed(id: WidgetId, canAny: (permissions: PermissionKey[]) => boolean): boolean {
  const definition = WIDGET_BY_ID.get(id);
  return Boolean(definition) && canAny(definition!.permissions);
}

/**
 * The most specific layout wins: the user's own, then the tenant's default
 * for the role, then the built-in template. Permissions filter last, so a
 * tenant default that names a financial widget still works for a role that
 * can see it and quietly omits it for one that cannot.
 */
export function resolveLayout(input: {
  role: RoleKey;
  user: readonly string[] | null;
  roleDefault: readonly string[] | null;
  canAny: (permissions: PermissionKey[]) => boolean;
}): ResolvedLayout {
  const template = templateForRole(input.role);
  const source: LayoutSource = input.user ? "user" : input.roleDefault ? "role_default" : "template";
  const raw = sanitise(input.user ?? input.roleDefault ?? TEMPLATES[template]);
  const widgets = raw.filter((id) => widgetAllowed(id, input.canAny));
  const hidden = raw.filter((id) => !widgets.includes(id));
  return { widgets, source, template, hidden };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Moves the widget at `from` so it lands at index `to`. Out-of-range is a no-op. */
export function moveTo(list: readonly WidgetId[], from: number, to: number): WidgetId[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from === target) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** One step earlier (-1) or later (+1) — the keyboard path. */
export function moveBy(list: readonly WidgetId[], id: WidgetId, delta: number): WidgetId[] {
  const index = list.indexOf(id);
  return index === -1 ? [...list] : moveTo(list, index, index + delta);
}

/** Adds at the end, or removes; never duplicates. */
export function toggleWidget(list: readonly WidgetId[], id: WidgetId): WidgetId[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export function sameLayout(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
