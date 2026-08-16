/**
 * Navigation model.
 *
 * Each entry declares the permissions that make it visible. A section with
 * no visible children disappears entirely, so a Storekeeper does not see an
 * empty "Finance" heading — FR-SEC-001..004.
 *
 * Hiding a link is a courtesy, not a control. The server still authorises
 * every request behind it (FR-SEC-045).
 */

import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Boxes,
  Building2,
  CalendarClock,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  Layers,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  Package,
  Percent,
  Plug,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Table2,
  Tags,
  Trash2,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Utensils,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { ConsoleKey } from "@/content/console/en";
import type { PermissionKey } from "./permissions";

export interface NavItem {
  href: string;
  labelKey: ConsoleKey;
  icon: LucideIcon;
  /** Visible when the session holds any one of these. Empty means always. */
  permissions: PermissionKey[];
  /** Marks the item as active for nested routes such as /orders/{id}. */
  matchPrefix?: boolean;
  /**
   * Specified in the SRS but not implemented in this build. Rendered as a
   * disabled row rather than hidden: the shape of the product is part of what
   * this console is showing, and a link that 404s is worse than an honest one
   * that says so.
   */
  stub?: boolean;
  /** Leaves the console shell — the POS and KDS run full-screen. */
  external?: boolean;
}

export interface NavSection {
  id: string;
  labelKey: ConsoleKey;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "overview",
    labelKey: "nav.dashboard",
    icon: LayoutDashboard,
    items: [
      { href: "/dashboard", labelKey: "nav.dashboard", icon: Gauge, permissions: [] },
    ],
  },
  {
    id: "terminals",
    labelKey: "nav.terminalsGroup",
    icon: MonitorSmartphone,
    items: [
      { href: "/pos", labelKey: "nav.pos", icon: ShoppingCart, permissions: [], external: true },
      { href: "/kds", labelKey: "nav.kds", icon: ChefHat, permissions: ["kds.view"], external: true },
    ],
  },
  {
    id: "operations",
    labelKey: "nav.operations",
    icon: ReceiptText,
    items: [
      { href: "/orders", labelKey: "nav.orders", icon: ReceiptText, permissions: ["pos.order.view"], matchPrefix: true },
      { href: "/operations/open-orders", labelKey: "nav.openOrders", icon: ClipboardList, permissions: ["ops.live.view", "pos.order.view"] },
      { href: "/operations/tables", labelKey: "nav.tables", icon: Table2, permissions: ["ops.live.view"] },
      { href: "/operations/kitchen", labelKey: "nav.kitchen", icon: ChefHat, permissions: ["kds.view"] },
      { href: "/operations/terminals", labelKey: "nav.terminals", icon: MonitorSmartphone, permissions: ["ops.terminal.view"] },
    ],
  },
  {
    id: "menu",
    labelKey: "nav.menu",
    icon: Utensils,
    items: [
      { href: "/menu/categories", labelKey: "nav.categories", icon: Layers, permissions: ["menu.view"] },
      { href: "/menu/items", labelKey: "nav.items", icon: Utensils, permissions: ["menu.view"], matchPrefix: true },
      { href: "/menu/modifiers", labelKey: "nav.modifiers", icon: Tags, permissions: ["menu.view"] },
      { href: "/menu/combos", labelKey: "nav.combos", icon: Sparkles, permissions: ["menu.view"] },
      { href: "/menu/pricing", labelKey: "nav.pricing", icon: Percent, permissions: ["menu.view"] },
      { href: "/menu/recipes", labelKey: "nav.recipes", icon: ClipboardCheck, permissions: ["recipe.view"], matchPrefix: true },
    ],
  },
  {
    id: "inventory",
    labelKey: "nav.inventory",
    icon: Boxes,
    items: [
      { href: "/inventory/levels", labelKey: "nav.stockLevels", icon: Boxes, permissions: ["inventory.view"] },
      { href: "/inventory/movements", labelKey: "nav.movements", icon: ScrollText, permissions: ["inventory.view"] },
      { href: "/inventory/waste", labelKey: "nav.waste", icon: Trash2, permissions: ["inventory.view"] },
      { href: "/inventory/items", labelKey: "nav.stockItems", icon: Package, permissions: ["inventory.view"] },
      { href: "/inventory/counts", labelKey: "nav.counts", icon: ListChecks, permissions: ["inventory.view"], matchPrefix: true },
      { href: "/inventory/transfers", labelKey: "nav.transfers", icon: ArrowLeftRight, permissions: ["inventory.view"] },
      { href: "/inventory/batches", labelKey: "nav.batches", icon: Layers, permissions: ["inventory.view"] },
      { href: "/inventory/expiry", labelKey: "nav.expiry", icon: AlertTriangle, permissions: ["inventory.view"] },
      { href: "/inventory/adjustments", labelKey: "nav.adjustments", icon: ClipboardCheck, permissions: ["inventory.view"] },
    ],
  },
  {
    id: "purchasing",
    labelKey: "nav.purchasing",
    icon: ShoppingCart,
    items: [
      { href: "/purchasing/suppliers", labelKey: "nav.suppliers", icon: Truck, permissions: ["purchase.view"], matchPrefix: true },
      { href: "/purchasing/requisitions", labelKey: "nav.requisitions", icon: ClipboardList, permissions: ["purchase.view"] },
      { href: "/purchasing/orders", labelKey: "nav.purchaseOrders", icon: ShoppingCart, permissions: ["purchase.view"], matchPrefix: true },
      { href: "/purchasing/receiving", labelKey: "nav.receiving", icon: Package, permissions: ["purchase.view"] },
      { href: "/purchasing/invoices", labelKey: "nav.invoices", icon: FileText, permissions: ["purchase.view"] },
    ],
  },
  {
    id: "costing",
    labelKey: "nav.costing",
    icon: TrendingUp,
    items: [
      { href: "/costing/food-cost", labelKey: "nav.foodCost", icon: Percent, permissions: ["costing.view"] },
      { href: "/costing/variance", labelKey: "nav.variance", icon: TrendingUp, permissions: ["costing.variance.view"] },
      { href: "/costing/waste", labelKey: "nav.wasteAnalysis", icon: Trash2, permissions: ["costing.view", "report.view.inventory"] },
      { href: "/costing/margin", labelKey: "nav.margin", icon: Gauge, permissions: ["costing.margin.view"] },
    ],
  },
  {
    id: "workforce",
    labelKey: "nav.workforce",
    icon: Users,
    items: [
      { href: "/workforce/employees", labelKey: "nav.employees", icon: Users, permissions: ["hr.employee.view"], matchPrefix: true },
      { href: "/workforce/schedules", labelKey: "nav.schedules", icon: CalendarClock, permissions: ["hr.schedule.manage", "hr.employee.view"] },
      { href: "/workforce/attendance", labelKey: "nav.attendance", icon: Clock, permissions: ["hr.employee.view", "report.view.workforce"] },
      { href: "/workforce/overtime", labelKey: "nav.overtime", icon: Clock, permissions: ["hr.overtime.approve", "report.view.workforce"] },
      { href: "/workforce/performance", labelKey: "nav.performance", icon: TrendingUp, permissions: ["hr.performance.view"] },
    ],
  },
  {
    id: "finance",
    labelKey: "nav.finance",
    icon: Banknote,
    items: [
      { href: "/finance/cash-sessions", labelKey: "nav.cashSessions", icon: Banknote, permissions: ["cash.session.view"] },
      { href: "/finance/payments", labelKey: "nav.payments", icon: Banknote, permissions: ["report.view.financial"] },
      { href: "/finance/expenses", labelKey: "nav.expenses", icon: ReceiptText, permissions: ["finance.expense.view"] },
      { href: "/finance/day-close", labelKey: "nav.dayClose", icon: ClipboardCheck, permissions: ["cash.session.view", "report.view.financial"] },
      { href: "/finance/tax", labelKey: "nav.tax", icon: Percent, permissions: ["finance.tax.view"] },
    ],
  },
  {
    id: "organisation",
    labelKey: "nav.organisation",
    icon: Building2,
    items: [
      { href: "/organisation/tenants", labelKey: "nav.tenants", icon: Globe, permissions: ["platform.tenant.manage"] },
      { href: "/organisation/brands", labelKey: "nav.brands", icon: Store, permissions: ["org.manage", "settings.tenant.manage", "report.view.sales"] },
      { href: "/organisation/branches", labelKey: "nav.branches", icon: Building2, permissions: ["org.manage", "settings.branch.manage", "report.view.sales"] },
      { href: "/organisation/warehouses", labelKey: "nav.warehouses", icon: Warehouse, permissions: ["org.manage", "inventory.view"] },
      { href: "/organisation/central-kitchens", labelKey: "nav.centralKitchens", icon: ChefHat, permissions: ["org.manage", "inventory.view"] },
    ],
  },
  {
    id: "governance",
    labelKey: "nav.governance",
    icon: ShieldCheck,
    items: [
      { href: "/audit", labelKey: "nav.audit", icon: ScrollText, permissions: ["audit.view"] },
      { href: "/reports", labelKey: "nav.reports", icon: FileBarChart, permissions: [] },
      { href: "/approvals", labelKey: "nav.approvals", icon: ClipboardCheck, permissions: ["approval.act", "report.view.governance", "audit.view"] },
    ],
  },
  {
    id: "administration",
    labelKey: "nav.administration",
    icon: Settings,
    items: [
      { href: "/settings", labelKey: "nav.settings", icon: Settings, permissions: [] },
      { href: "/users", labelKey: "nav.users", icon: UserCog, permissions: ["security.user.manage"] },
      { href: "/roles", labelKey: "nav.roles", icon: ShieldCheck, permissions: ["security.role.manage"] },
      { href: "/country-packs", labelKey: "nav.countryPacks", icon: Globe, permissions: ["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"] },
      { href: "/integrations", labelKey: "nav.integrations", icon: Plug, permissions: ["integration.manage"] },
    ],
  },
];

/** Flat list of every route, used to resolve the page title from a pathname. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function isItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.matchPrefix) && pathname.startsWith(`${item.href}/`);
}

/** The most specific nav item matching a pathname. */
export function findNavItem(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
