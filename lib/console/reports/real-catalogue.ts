/**
 * The live report catalogue — SRS §19.3.
 *
 * `services.platform.reports()` used to be a fetch against a backend
 * "report catalogue" resource that has never existed (FRONTEND-REAL-UX-
 * BATCH-1A). The two real reporting endpoints
 * (`GET /reports/branches/{id}/daily-trading/{day}`,
 * `GET /reports/branches/{id}/overview`) were never what this page called
 * in the first place — it, and the generic runner at `/reports/[id]`, read
 * report *bodies* from `lib/console/reports/engine.ts`, whose builders
 * already aggregate real data client-side from `services.sales.orders` and
 * `services.inventory.*` (see that file's own header comment).
 *
 * This catalogue is therefore a static, frontend-only list — no backend
 * fetch — restricted to exactly the report ids that:
 *
 *   1. have a working builder in `reports/engine.ts` (or, for `z-report`,
 *      an existing real screen to hand off to), and
 *   2. read from a service call that is genuinely live-wired, not
 *      `unsupported`/`absentCollection` (this rules out every workforce
 *      report — `services.workforce.attendance` is `absentCollection`,
 *      confirmed in `lib/console/services/unsupported.ts` — and `prep-time`,
 *      whose only data source, the KDS station-queue route, is gated
 *      `@AllowKdsSession()` server-side and therefore can never answer a
 *      Console/back-office bearer session, only a PIN-issued KDS terminal
 *      one — see `kitchen.controller.ts`).
 *
 * `requiredPermission` is set to the real backend permission code that
 * actually guards the underlying data call (`pos.order.create` for every
 * order-derived report — `GET /orders`; `inventory.view` for the two
 * inventory-derived reports — `GET /inventory/waste` and
 * `GET /inventory/levels`; `report.view.financial` for `z-report`, which is
 * the one report already backed by the real `daily-trading` endpoint via
 * the existing `/finance/day-close` screen) — never the SRS-only
 * `report.view.<category>` vocabulary the fixture catalogue used, most of
 * which (`report.view.inventory`, `report.view.kitchen`,
 * `report.view.workforce`, `report.view.governance`) the backend has never
 * defined and could never grant to anyone.
 *
 * Deliberately excluded, per the same rule (do not port a card that leads
 * nowhere real): `sales-by-tender`'s sibling `cash-reconciliation` (no
 * cash-session index exists — `/reports/cashier` already self-disables live,
 * see that page), `tax-summary` (routes to `/finance/tax`, whose own `Gate`
 * is `["finance.tax.view"]` alone — a permission the backend never defines,
 * so that screen can never open for anyone; flagged, not fixed here — out
 * of this batch's scope), and every `delivery`/`exports`/`costing.*` entry
 * (no backend counterpart at all, confirmed in
 * `docs/reports/claude/2026-09-19_FRONTEND-UI-TO-REAL-BACKEND-MASTER-
 * INVENTORY_investigation.md`).
 */

import type { ReportDefinition } from "../types";

export const REAL_REPORT_CATALOGUE: ReportDefinition[] = [
  // Sales — GET /orders, permission pos.order.create (sales.permissions.ts)
  {
    id: "sales-summary",
    category: "sales",
    name: { en: "Sales Summary", ar: "ملخص المبيعات" },
    description: {
      en: "Gross, discounts, refunds, net and tax by period.",
      ar: "الإجمالي والخصومات والمرتجعات والصافي والضريبة حسب الفترة.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "sales-by-branch",
    category: "sales",
    name: { en: "Sales by Branch", ar: "المبيعات حسب الفرع" },
    description: {
      en: "Comparative, with variance to prior period and to target.",
      ar: "مقارن، مع الفرق عن الفترة السابقة والمستهدف.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "sales-by-item",
    category: "sales",
    name: { en: "Sales by Category and Item", ar: "المبيعات حسب الفئة والصنف" },
    description: {
      en: "Units, revenue, margin and mix percentage.",
      ar: "الوحدات والإيراد والهامش ونسبة المزيج.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "sales-by-employee",
    category: "sales",
    name: { en: "Sales by Employee", ar: "المبيعات حسب الموظف" },
    description: {
      en: "Revenue, order count and average order value.",
      ar: "الإيراد وعدد الطلبات ومتوسط قيمة الطلب.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "sales-by-tender",
    category: "sales",
    name: { en: "Sales by Tender", ar: "المبيعات حسب وسيلة الدفع" },
    description: {
      en: "The reconciliation basis for every settlement.",
      ar: "أساس المطابقة لكل تسوية.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "sales-by-hour",
    category: "sales",
    name: { en: "Sales by Hour and Day-part", ar: "المبيعات حسب الساعة والفترة" },
    description: {
      en: "The demand curve the roster should match.",
      ar: "منحنى الطلب الذي ينبغي أن يطابقه الجدول.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "discount-analysis",
    category: "sales",
    name: { en: "Discount and Comp Analysis", ar: "تحليل الخصومات والمجانيات" },
    description: {
      en: "By reason, at order and line level.",
      ar: "حسب السبب، على مستوى الطلب والصنف.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "void-refund-analysis",
    category: "sales",
    name: { en: "Void and Refund Analysis", ar: "تحليل الإلغاءات والمرتجعات" },
    description: {
      en: "By reason and timing relative to payment.",
      ar: "حسب السبب والتوقيت بالنسبة للدفع.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },
  {
    id: "menu-mix",
    category: "sales",
    name: { en: "Menu Mix", ar: "مزيج القائمة" },
    description: {
      en: "Item share of units and of revenue.",
      ar: "حصة الصنف من الوحدات ومن الإيراد.",
    },
    requiredPermission: "pos.order.create",
    async: false,
    specRef: "§19.3",
  },

  // Inventory — GET /inventory/waste, GET /inventory/levels, permission inventory.view
  {
    id: "waste-analysis",
    category: "inventory",
    name: { en: "Waste Analysis", ar: "تحليل الهدر" },
    description: {
      en: "By reason, item, location and category.",
      ar: "حسب السبب والصنف والموقع والفئة.",
    },
    requiredPermission: "inventory.view",
    async: false,
    specRef: "FR-CST-020",
  },
  {
    id: "stock-valuation",
    category: "inventory",
    name: { en: "Current Stock Valuation", ar: "تقييم المخزون الحالي" },
    description: {
      en: "By location and item.",
      ar: "حسب الموقع والصنف.",
    },
    requiredPermission: "inventory.view",
    async: false,
    specRef: "§19.3",
  },

  // Financial — the real daily-trading report, via the existing day-close
  // screen (`/finance/day-close`); permission report.view.financial is the
  // real code guarding both `ReportingController` routes.
  {
    id: "z-report",
    category: "financial",
    name: { en: "Z Report", ar: "تقرير Z" },
    description: {
      en: "The statutory day close, sequentially numbered per branch.",
      ar: "إغلاق اليوم القانوني، مرقم تسلسليًا لكل فرع.",
    },
    requiredPermission: "report.view.financial",
    async: false,
    specRef: "FR-FIN-022",
  },
];
