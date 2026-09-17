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
  BellRing,
  BookOpen,
  ArrowLeftRight,
  Banknote,
  BadgePercent,
  Contact,
  Gift,
  Boxes,
  Building2,
  CalendarClock,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileBarChart,
  FileDown,
  FileText,
  Factory,
  Gauge,
  GitMerge,
  Globe,
  Layers,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  Package,
  Percent,
  Plug,
  Printer,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShoppingCart,
  Sparkles,
  Store,
  Table2,
  Target,
  Tags,
  Trash2,
  TrendingUp,
  Trophy,
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
      { href: "/kds", labelKey: "nav.kds", icon: ChefHat, permissions: ["kds.operate"], external: true },
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
      { href: "/operations/floor-plan", labelKey: "nav.floorPlan", icon: LayoutDashboard, permissions: ["settings.branch.manage"] },
      { href: "/operations/kitchen", labelKey: "nav.kitchen", icon: ChefHat, permissions: ["kds.operate"] },
      { href: "/operations/terminals", labelKey: "nav.terminals", icon: MonitorSmartphone, permissions: ["ops.terminal.view"] },
      { href: "/operations/stations", labelKey: "nav.stations", icon: Layers, permissions: ["settings.branch.manage"] },
      { href: "/operations/kds-setup", labelKey: "nav.kdsSetup", icon: ChefHat, permissions: ["kds.station.manage", "settings.branch.manage"] },
      { href: "/operations/drawers", labelKey: "nav.drawers", icon: Banknote, permissions: ["settings.branch.manage"] },
      // FR-RPT-033 — live operations view.
      { href: "/operations/live", labelKey: "nav.liveOps", icon: Gauge, permissions: ["ops.live.view"] },
      { href: "/operations/conflicts", labelKey: "nav.conflicts", icon: GitMerge, permissions: ["ops.terminal.view", "ops.live.view", "settings.branch.manage"] },
      // FR-OFF-017/018 — fiscal sequence and number blocks; FR-OFF-050 conformance.
      { href: "/operations/fiscal-sequence", labelKey: "nav.fiscalSequence", icon: ScrollText, permissions: ["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"] },
      { href: "/operations/conformance", labelKey: "nav.conformance", icon: ListChecks, permissions: ["settings.tenant.manage", "platform.countrypack.manage", "audit.view"] },
      // NFR-OBS-007 — health view; FR-OPS-013 — release notes.
      { href: "/operations/health", labelKey: "nav.systemHealth", icon: ShieldCheck, permissions: ["ops.terminal.view", "settings.tenant.manage", "audit.view", "integration.manage"] },
      { href: "/operations/release-notes", labelKey: "nav.releaseNotes", icon: FileText, permissions: [] },
      { href: "/operations/receipts", labelKey: "nav.receipts", icon: Printer, permissions: ["settings.branch.manage", "settings.tenant.manage"] },
    ],
  },
  {
    id: "menu",
    labelKey: "nav.menu",
    icon: Utensils,
    items: [
      { href: "/menu/menus", labelKey: "nav.menus", icon: BookOpen, permissions: ["menu.item.read"] },
      { href: "/menu/categories", labelKey: "nav.categories", icon: Layers, permissions: ["menu.item.read"] },
      { href: "/menu/items", labelKey: "nav.items", icon: Utensils, permissions: ["menu.item.read"], matchPrefix: true },
      { href: "/menu/availability", labelKey: "nav.menuAvailability", icon: Gauge, permissions: ["menu.availability.read"] },
      { href: "/menu/modifiers", labelKey: "nav.modifiers", icon: Tags, permissions: ["menu.item.read"] },
      { href: "/menu/combos", labelKey: "nav.combos", icon: Sparkles, permissions: ["menu.item.read"] },
      { href: "/menu/pricing", labelKey: "nav.pricing", icon: Percent, permissions: ["menu.price.read"] },
      { href: "/menu/engineering", labelKey: "nav.menuEngineering", icon: Target, permissions: ["costing.margin.view"] },
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
      { href: "/inventory/waste", labelKey: "nav.waste", icon: Trash2, permissions: ["inventory.view"], matchPrefix: true },
      { href: "/inventory/items", labelKey: "nav.stockItems", icon: Package, permissions: ["inventory.view"] },
      { href: "/inventory/counts", labelKey: "nav.counts", icon: ListChecks, permissions: ["inventory.view"], matchPrefix: true },
      { href: "/inventory/transfers", labelKey: "nav.transfers", icon: ArrowLeftRight, permissions: ["inventory.view"] },
      { href: "/inventory/production", labelKey: "nav.production", icon: Factory, permissions: ["inventory.view", "org.manage"] },
      { href: "/inventory/batches", labelKey: "nav.batches", icon: Layers, permissions: ["inventory.view"] },
      { href: "/inventory/expiry", labelKey: "nav.expiry", icon: AlertTriangle, permissions: ["inventory.view"] },
      { href: "/inventory/adjustments", labelKey: "nav.adjustments", icon: ClipboardCheck, permissions: ["inventory.view"] },
      { href: "/inventory/reason-codes", labelKey: "nav.reasonCodes", icon: Tags, permissions: ["inventory.adjust"] },
      // FR-INV-015 / FR-INV-067…070 / FR-INV-027 / FR-INV-051
      { href: "/inventory/valuation", labelKey: "invx.val.title", icon: Scale, permissions: ["inventory.cost.view"] },
      { href: "/inventory/reorder", labelKey: "invx.ro.title", icon: ShoppingCart, permissions: ["inventory.view"] },
      { href: "/inventory/trace", labelKey: "invx.trace.title", icon: GitMerge, permissions: ["inventory.view"] },
      { href: "/inventory/reconciliation", labelKey: "invx.rec.title", icon: ShieldCheck, permissions: ["inventory.view"] },
    ],
  },
  {
    id: "customers",
    labelKey: "nav.customers",
    icon: Contact,
    items: [
      { href: "/customers", labelKey: "nav.customerList", icon: Contact, permissions: ["crm.customer.view"], matchPrefix: true },
      { href: "/customers/loyalty", labelKey: "nav.loyalty", icon: Gift, permissions: ["crm.loyalty.view"] },
      { href: "/customers/promotions", labelKey: "nav.promotions", icon: BadgePercent, permissions: ["crm.promotion.view"], matchPrefix: true },
      { href: "/customers/segments", labelKey: "nav.segments", icon: Target, permissions: ["crm.customer.view"] },
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
      { href: "/purchasing/invoices", labelKey: "nav.invoices", icon: FileText, permissions: ["purchase.view"], matchPrefix: true },
      // FR-PRC-001 … FR-PRC-046 — the rest of procure-to-pay.
      { href: "/purchasing/approvals", labelKey: "nav.prcApprovals", icon: ClipboardCheck, permissions: ["purchase.view"] },
      { href: "/purchasing/sourcing", labelKey: "nav.prcSourcing", icon: Tags, permissions: ["purchase.view"] },
      { href: "/purchasing/compliance", labelKey: "nav.prcCompliance", icon: ShieldCheck, permissions: ["purchase.view"] },
      { href: "/purchasing/credit-notes", labelKey: "nav.prcCreditNotes", icon: ReceiptText, permissions: ["purchase.view"] },
      { href: "/purchasing/statements", labelKey: "nav.prcStatements", icon: ScrollText, permissions: ["purchase.view"] },
      { href: "/purchasing/payments", labelKey: "nav.prcPayments", icon: Banknote, permissions: ["purchase.view"] },
      { href: "/purchasing/policy", labelKey: "nav.prcPolicy", icon: Settings, permissions: ["purchase.view"] },
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
      { href: "/costing/operating-expenses", labelKey: "nav.cstOperatingExpenses", icon: Building2, permissions: ["costing.margin.view", "costing.view"] },
      { href: "/costing/branch-ranking", labelKey: "nav.cstBranchRanking", icon: Trophy, permissions: ["costing.margin.view", "costing.view"] },
      { href: "/costing/break-even", labelKey: "nav.cstBreakEven", icon: Target, permissions: ["costing.margin.view", "costing.view"] },
    ],
  },
  {
    id: "workforce",
    labelKey: "nav.workforce",
    icon: Users,
    items: [
      { href: "/workforce/employees", labelKey: "nav.employees", icon: Users, permissions: ["hr.employee.view"], matchPrefix: true },
      { href: "/workforce/schedules", labelKey: "nav.schedules", icon: CalendarClock, permissions: ["hr.schedule.manage", "hr.employee.view"] },
      { href: "/workforce/leave", labelKey: "nav.leave", icon: CalendarClock, permissions: ["hr.employee.view"] },
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
      { href: "/finance/reconciliation", labelKey: "nav.fncReconciliation", icon: Scale, permissions: ["report.view.financial"] },
      { href: "/finance/day-close", labelKey: "nav.dayClose", icon: ClipboardCheck, permissions: ["cash.session.view", "report.view.financial"] },
      { href: "/finance/cash-close-policy", labelKey: "nav.cashClosePolicy", icon: ShieldCheck, permissions: ["settings.branch.manage"] },
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
      { href: "/organisation/scorecard", labelKey: "nav.scorecard", icon: Trophy, permissions: ["report.view.sales", "org.manage", "costing.view"] },
      { href: "/organisation/groups", labelKey: "nav.branchGroups", icon: Layers, permissions: ["org.manage", "settings.tenant.manage", "report.view.sales"] },
      { href: "/organisation/consolidated", labelKey: "nav.consolidated", icon: Banknote, permissions: ["report.view.sales", "report.view.financial", "org.manage"] },
      { href: "/organisation/deviations", labelKey: "nav.deviations", icon: GitMerge, permissions: ["org.manage", "menu.price.read", "recipe.view"] },
      { href: "/organisation/franchise", labelKey: "nav.franchise", icon: Target, permissions: ["org.manage", "report.view.financial"] },
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
      // FR-RPT-047 — natural-language report questions.
      { href: "/reports/ask", labelKey: "nav.askReports", icon: Sparkles, permissions: [] },
      { href: "/reports/exports", labelKey: "nav.exports", icon: FileDown, permissions: ["report.export", "audit.view"] },
      { href: "/reports/delivery", labelKey: "nav.delivery", icon: BellRing, permissions: ["report.export", "settings.branch.manage", "settings.tenant.manage", "report.view.sales", "report.view.financial"] },
      { href: "/approvals", labelKey: "nav.approvals", icon: ClipboardCheck, permissions: ["approval.act", "report.view.governance", "audit.view"] },
      { href: "/governance/anomalies", labelKey: "nav.anomalies", icon: ShieldQuestion, permissions: ["governance.view_anomalies"] },
      { href: "/governance/sod", labelKey: "nav.sod", icon: ShieldAlert, permissions: ["security.user.manage", "audit.view", "report.view.governance"] },
      // FR-SEC-062 — data subject request register.
      { href: "/governance/privacy", labelKey: "nav.privacyRequests", icon: ShieldCheck, permissions: ["crm.customer.erase", "crm.customer.export", "audit.view", "settings.tenant.manage"] },
    ],
  },
  {
    id: "administration",
    labelKey: "nav.administration",
    icon: Settings,
    items: [
      { href: "/settings", labelKey: "nav.settings", icon: Settings, permissions: [] },
      // FR-SEC-025/034/035/052/053/060 — tenant security configuration.
      { href: "/settings/security", labelKey: "nav.securitySettings", icon: ShieldAlert, permissions: ["settings.tenant.manage", "audit.view"] },
      // FR-PLT-021/022/023 — plan state, full export, termination.
      { href: "/settings/tenant", labelKey: "nav.organisationLifecycle", icon: Building2, permissions: ["settings.tenant.manage", "platform.tenant.manage"] },
      { href: "/users", labelKey: "nav.users", icon: UserCog, permissions: ["security.user.manage"] },
      { href: "/roles", labelKey: "nav.roles", icon: ShieldCheck, permissions: ["security.role.manage"] },
      { href: "/country-packs", labelKey: "nav.countryPacks", icon: Globe, permissions: ["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"] },
      { href: "/country-packs/languages", labelKey: "nav.languages", icon: Globe, permissions: [] },
      { href: "/country-packs/print-test", labelKey: "nav.printTest", icon: Printer, permissions: ["settings.tenant.manage", "settings.branch.manage", "platform.countrypack.manage"] },
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
