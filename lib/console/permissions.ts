/**
 * Permission catalogue and standard roles — SRS §15.2, §15.3.
 *
 * The model is RBAC for *what* and ABAC for *where*: a permission answers
 * "may this action be performed?", a scope answers "on which data?", and
 * both must be satisfied (FR-SEC-001..004).
 *
 * FR-SEC-045 is worth restating here, because it governs how this file may
 * be used: client-side permission checks are presentation only. Hiding a
 * button is a courtesy to the user, never a security control. The real
 * check belongs on the server, on every endpoint.
 */

import type { Localised } from "./types";

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const PERMISSION_GROUPS = [
  "sales",
  "kitchen",
  "cash",
  "inventory",
  "catalogue",
  "procurement",
  "costing",
  "workforce",
  "reporting",
  "governance",
  "platform",
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface PermissionDefinition {
  key: string;
  group: PermissionGroup;
  label: Localised;
  /** FR-SEC-012 — a plain-language description of what the permission allows. */
  description: Localised;
  /** FR-SEC-012 — sensitive permissions carry a warning marker in the editor. */
  sensitive?: boolean;
}

const def = (
  key: string,
  group: PermissionGroup,
  en: string,
  ar: string,
  enDesc: string,
  arDesc: string,
  sensitive = false,
): PermissionDefinition => ({
  key,
  group,
  label: { en, ar },
  description: { en: enDesc, ar: arDesc },
  sensitive,
});

export const PERMISSION_CATALOGUE = [
  // -- Sales ---------------------------------------------------------------
  def("pos.order.view", "sales", "View orders", "عرض الطلبات",
    "See the order list and order detail.", "الاطلاع على قائمة الطلبات وتفاصيلها."),
  def("pos.order.create", "sales", "Create orders", "إنشاء الطلبات",
    "Create and modify orders.", "إنشاء الطلبات وتعديلها."),
  def("pos.order.void_line_prefire", "sales", "Void line before firing", "إلغاء صنف قبل الإرسال",
    "Void a line before it reaches the kitchen.", "إلغاء صنف قبل وصوله إلى المطبخ."),
  def("pos.order.void_line_postfire", "sales", "Void line after firing", "إلغاء صنف بعد الإرسال",
    "Void a line the kitchen has started; requires a waste disposition.", "إلغاء صنف بدأ المطبخ تحضيره؛ يتطلب تحديد مصير الهدر.", true),
  def("pos.order.cancel", "sales", "Cancel order", "إلغاء الطلب",
    "Cancel an entire order before payment.", "إلغاء طلب كامل قبل الدفع."),
  def("pos.order.cancel_after_production", "sales", "Cancel after production", "الإلغاء بعد الإنتاج",
    "Cancel an order after kitchen production has started.", "إلغاء طلب بعد بدء الإنتاج في المطبخ.", true),
  def("pos.discount.apply", "sales", "Apply discounts", "تطبيق الخصومات",
    "Apply discounts within the configured limit.", "تطبيق الخصومات ضمن الحد المسموح."),
  def("pos.discount.approve", "sales", "Approve discounts", "اعتماد الخصومات",
    "Approve discounts above another user's limit.", "اعتماد الخصومات التي تتجاوز حد مستخدم آخر.", true),
  def("pos.discount.unlimited", "sales", "Unlimited discounts", "خصومات بلا حد",
    "Apply discounts of any value without approval.", "تطبيق خصومات بأي قيمة دون اعتماد.", true),
  def("pos.comp.apply", "sales", "Comp items", "أصناف مجانية",
    "Give items free of charge; cost is still recognised.", "منح أصناف مجانًا مع الاعتراف بالتكلفة."),
  def("pos.price.override", "sales", "Override price", "تجاوز السعر",
    "Manually set a price at the point of sale.", "تحديد السعر يدويًا عند نقطة البيع.", true),
  def("pos.refund.issue", "sales", "Issue refunds", "إصدار المبالغ المستردة",
    "Refund against a completed order.", "رد مبلغ مقابل طلب مكتمل.", true),
  def("pos.refund.different_tender", "sales", "Refund to other tender", "الاسترداد بوسيلة مختلفة",
    "Refund to a payment method other than the original.", "الاسترداد بوسيلة دفع مختلفة عن الأصلية.", true),
  def("pos.reprint.receipt", "sales", "Reprint receipt", "إعادة طباعة الإيصال",
    "Reprint a receipt, marked as a duplicate.", "إعادة طباعة إيصال مع تمييزه كنسخة مكررة."),
  def("pos.order.transfer", "sales", "Transfer order", "نقل الطلب",
    "Move an order between tables or servers.", "نقل طلب بين الطاولات أو النُدُل."),
  def("pos.order.reopen", "sales", "Reopen closed order", "إعادة فتح طلب مغلق",
    "Reopen a completed order. Highly restricted.", "إعادة فتح طلب مكتمل. مقيّد للغاية.", true),

  // -- Kitchen and live operations -----------------------------------------
  def("kds.view", "kitchen", "View kitchen queue", "عرض طابور المطبخ",
    "See station queues and ticket timing.", "الاطلاع على طوابير المحطات وتوقيت التذاكر."),
  def("kds.station.manage", "kitchen", "Manage stations", "إدارة المحطات",
    "Configure stations, routing rules, and capacity.", "ضبط المحطات وقواعد التوجيه والسعة."),
  def("ops.live.view", "kitchen", "Live operations", "العمليات المباشرة",
    "See open orders, table states, and queue depth.", "عرض الطلبات المفتوحة وحالات الطاولات وعمق الطابور."),
  def("ops.terminal.view", "kitchen", "View terminals", "عرض الأجهزة",
    "See terminal status and sync backlog.", "عرض حالة الأجهزة وتراكم المزامنة."),
  def("ops.terminal.manage", "kitchen", "Manage terminals", "إدارة الأجهزة",
    "Register and revoke terminals.", "تسجيل الأجهزة وإلغاء تسجيلها.", true),

  // -- Cash and finance -----------------------------------------------------
  def("cash.session.view", "cash", "View cash sessions", "عرض جلسات النقد",
    "See drawer sessions and their variances.", "الاطلاع على جلسات الأدراج وفروقاتها."),
  def("cash.session.open", "cash", "Open shift", "فتح الوردية",
    "Open a cash session with a declared float.", "فتح جلسة نقدية برصيد افتتاحي معلن."),
  def("cash.session.close", "cash", "Close own shift", "إغلاق الوردية الخاصة",
    "Close your own cash session.", "إغلاق جلستك النقدية."),
  def("cash.session.close_other", "cash", "Close another shift", "إغلاق وردية أخرى",
    "Close a cash session belonging to another user.", "إغلاق جلسة نقدية تخص مستخدمًا آخر.", true),
  def("cash.drawer.open_no_sale", "cash", "No-sale drawer open", "فتح الدرج بلا بيع",
    "Open the drawer without a transaction.", "فتح الدرج دون معاملة.", true),
  def("cash.payin", "cash", "Record pay-in", "تسجيل إيداع",
    "Add cash to the drawer.", "إضافة نقد إلى الدرج."),
  def("cash.payout", "cash", "Record pay-out", "تسجيل صرف",
    "Remove cash from the drawer for an expense.", "سحب نقد من الدرج لمصروف."),
  def("cash.safedrop", "cash", "Safe drop", "إيداع الخزنة",
    "Move excess cash from the drawer to the safe.", "نقل النقد الزائد من الدرج إلى الخزنة."),
  def("cash.variance.approve", "cash", "Approve variance", "اعتماد الفرق النقدي",
    "Approve a cash variance beyond tolerance.", "اعتماد فرق نقدي يتجاوز الحد المسموح.", true),
  def("cash.day.close", "cash", "Close business day", "إغلاق يوم العمل",
    "Perform the branch day close and issue the Z report.", "تنفيذ إغلاق اليوم وإصدار تقرير Z.", true),
  def("finance.expense.view", "cash", "View expenses", "عرض المصروفات",
    "See branch operating expenses.", "الاطلاع على مصروفات تشغيل الفرع."),
  def("finance.expense.manage", "cash", "Manage expenses", "إدارة المصروفات",
    "Record and edit expenses.", "تسجيل المصروفات وتعديلها."),
  def("finance.expense.approve", "cash", "Approve expenses", "اعتماد المصروفات",
    "Approve expenses above the threshold.", "اعتماد المصروفات التي تتجاوز الحد.", true),
  def("finance.tax.view", "cash", "View tax summaries", "عرض ملخصات الضريبة",
    "See tax computed by class, rate and period.", "عرض الضريبة محسوبة حسب الفئة والنسبة والفترة."),

  // -- Inventory -----------------------------------------------------------
  def("inventory.view", "inventory", "View stock", "عرض المخزون",
    "See stock levels, batches and movements.", "الاطلاع على مستويات المخزون والدفعات والحركات."),
  def("inventory.item.manage", "inventory", "Manage stock items", "إدارة أصناف المخزون",
    "Create and edit the stock item master.", "إنشاء أصناف المخزون وتعديلها."),
  def("inventory.count.perform", "inventory", "Perform count", "تنفيذ الجرد",
    "Carry out a stock count.", "تنفيذ جرد للمخزون."),
  def("inventory.count.post", "inventory", "Post count", "ترحيل الجرد",
    "Post a count and create the adjustments.", "ترحيل الجرد وإنشاء التسويات.", true),
  def("inventory.approve_high_variance", "inventory", "Approve high variance", "اعتماد الفروقات الكبيرة",
    "Post counts whose variance exceeds the threshold.", "ترحيل جرد تتجاوز فروقاته الحد المسموح.", true),
  def("inventory.adjust", "inventory", "Adjust stock", "تسوية المخزون",
    "Make a manual stock adjustment with a reason.", "إجراء تسوية يدوية للمخزون مع ذكر السبب.", true),
  def("inventory.transfer.create", "inventory", "Create transfer", "إنشاء تحويل",
    "Dispatch stock to another location.", "إرسال مخزون إلى موقع آخر."),
  def("inventory.transfer.receive", "inventory", "Receive transfer", "استلام تحويل",
    "Receive stock dispatched from another location.", "استلام مخزون مُرسل من موقع آخر."),
  def("inventory.waste.record", "inventory", "Record waste", "تسجيل الهدر",
    "Record wasted stock with a reason code.", "تسجيل المخزون التالف مع رمز السبب."),
  def("inventory.waste.approve", "inventory", "Approve waste", "اعتماد الهدر",
    "Approve waste above the value threshold.", "اعتماد الهدر الذي يتجاوز حد القيمة.", true),
  def("inventory.cost.view", "inventory", "View item costs", "عرض تكاليف الأصناف",
    "See item valuation and cost per unit.", "عرض تقييم الأصناف والتكلفة لكل وحدة."),

  // -- Catalogue and recipes -----------------------------------------------
  def("menu.view", "catalogue", "View menu", "عرض القائمة",
    "See categories, items, modifiers and combos.", "الاطلاع على الفئات والأصناف والإضافات والوجبات."),
  def("menu.item.manage", "catalogue", "Manage menu items", "إدارة أصناف القائمة",
    "Create and edit menu items and modifiers.", "إنشاء أصناف القائمة والإضافات وتعديلها."),
  def("menu.price.change", "catalogue", "Change prices", "تغيير الأسعار",
    "Change prices and manage price lists.", "تغيير الأسعار وإدارة قوائم الأسعار.", true),
  def("menu.availability.toggle", "catalogue", "Toggle availability", "تبديل التوفر",
    "Mark an item unavailable (86) and restore it.", "وضع صنف كغير متوفر وإعادته."),
  def("recipe.view", "catalogue", "View recipes", "عرض الوصفات",
    "See recipes and their costing.", "الاطلاع على الوصفات وتكلفتها."),
  def("recipe.edit", "catalogue", "Edit recipes", "تعديل الوصفات",
    "Create and edit recipe drafts.", "إنشاء مسودات الوصفات وتعديلها."),
  def("recipe.publish", "catalogue", "Publish recipe", "نشر الوصفة",
    "Publish a recipe version, superseding the prior one.", "نشر نسخة وصفة تحل محل السابقة.", true),

  // -- Procurement ----------------------------------------------------------
  def("purchase.view", "procurement", "View purchasing", "عرض المشتريات",
    "See requisitions, orders, receipts and invoices.", "الاطلاع على الطلبات وأوامر الشراء والاستلام والفواتير."),
  def("purchase.requisition.create", "procurement", "Raise requisition", "إنشاء طلب شراء",
    "Raise a purchase requisition for review.", "إنشاء طلب شراء للمراجعة."),
  def("purchase.order.create", "procurement", "Create purchase order", "إنشاء أمر شراء",
    "Create a purchase order to a supplier.", "إنشاء أمر شراء لمورد."),
  def("purchase.order.approve_tier_1", "procurement", "Approve PO — tier 1", "اعتماد أمر شراء — الفئة ١",
    "Approve purchase orders in the lowest value band.", "اعتماد أوامر الشراء في أدنى نطاق قيمة."),
  def("purchase.order.approve_tier_2", "procurement", "Approve PO — tier 2", "اعتماد أمر شراء — الفئة ٢",
    "Approve purchase orders in the middle value band.", "اعتماد أوامر الشراء في النطاق المتوسط.", true),
  def("purchase.order.approve_tier_3", "procurement", "Approve PO — tier 3", "اعتماد أمر شراء — الفئة ٣",
    "Approve purchase orders of any value.", "اعتماد أوامر الشراء بأي قيمة.", true),
  def("purchase.receipt.post", "procurement", "Post goods receipt", "ترحيل الاستلام",
    "Receive goods and create stock movements.", "استلام البضائع وإنشاء حركات المخزون."),
  def("purchase.invoice.record", "procurement", "Record supplier invoice", "تسجيل فاتورة مورد",
    "Record an invoice against a goods receipt.", "تسجيل فاتورة مقابل استلام بضائع."),
  def("purchase.invoice.approve_payment", "procurement", "Approve payment", "اعتماد الدفع",
    "Approve a matched invoice for payment.", "اعتماد فاتورة مطابقة للدفع.", true),
  def("supplier.manage", "procurement", "Manage suppliers", "إدارة الموردين",
    "Create and edit supplier master data.", "إنشاء بيانات الموردين وتعديلها."),

  // -- Costing --------------------------------------------------------------
  def("costing.view", "costing", "View food cost", "عرض تكلفة الطعام",
    "See food cost percentage and its breakdown.", "عرض نسبة تكلفة الطعام وتفصيلها."),
  def("costing.variance.view", "costing", "View variance", "عرض الفروقات",
    "See theoretical versus actual usage and variance.", "عرض الاستهلاك النظري مقابل الفعلي والفروقات."),
  def("costing.margin.view", "costing", "View margins", "عرض هوامش الربح",
    "See contribution margin and menu engineering.", "عرض هامش المساهمة وهندسة القائمة."),

  // -- Workforce ------------------------------------------------------------
  def("hr.employee.view", "workforce", "View employees", "عرض الموظفين",
    "See employee records.", "الاطلاع على سجلات الموظفين."),
  def("hr.employee.manage", "workforce", "Manage employees", "إدارة الموظفين",
    "Create and edit employee records.", "إنشاء سجلات الموظفين وتعديلها."),
  def("hr.compensation.view", "workforce", "View pay rates", "عرض الأجور",
    "See employee compensation.", "الاطلاع على أجور الموظفين.", true),
  def("hr.schedule.manage", "workforce", "Manage schedules", "إدارة الجداول",
    "Build and publish shift schedules.", "إعداد جداول الورديات ونشرها."),
  def("hr.attendance.correct", "workforce", "Correct attendance", "تصحيح الحضور",
    "Correct clock records; the original is retained.", "تصحيح سجلات الحضور مع الاحتفاظ بالأصل.", true),
  def("hr.overtime.approve", "workforce", "Approve overtime", "اعتماد العمل الإضافي",
    "Approve overtime beyond the threshold.", "اعتماد العمل الإضافي فوق الحد."),
  def("hr.payroll.export", "workforce", "Export payroll", "تصدير الرواتب",
    "Export payroll input data.", "تصدير بيانات مدخلات الرواتب.", true),
  def("hr.performance.view", "workforce", "View performance", "عرض الأداء",
    "See per-employee performance metrics.", "عرض مؤشرات أداء الموظفين."),

  // -- Reporting ------------------------------------------------------------
  def("report.view.sales", "reporting", "Sales reports", "تقارير المبيعات",
    "View the sales report category.", "عرض فئة تقارير المبيعات."),
  def("report.view.inventory", "reporting", "Inventory reports", "تقارير المخزون",
    "View the inventory report category.", "عرض فئة تقارير المخزون."),
  def("report.view.kitchen", "reporting", "Kitchen reports", "تقارير المطبخ",
    "View the kitchen report category.", "عرض فئة تقارير المطبخ."),
  def("report.view.financial", "reporting", "Financial reports", "التقارير المالية",
    "View the financial report category.", "عرض فئة التقارير المالية."),
  def("report.view.workforce", "reporting", "Workforce reports", "تقارير القوى العاملة",
    "View the workforce report category.", "عرض فئة تقارير القوى العاملة."),
  def("report.view.governance", "reporting", "Governance reports", "تقارير الحوكمة",
    "View the governance report category.", "عرض فئة تقارير الحوكمة."),
  def("report.export", "reporting", "Export reports", "تصدير التقارير",
    "Export report data; every export is audited.", "تصدير بيانات التقارير؛ كل تصدير يُسجَّل."),

  // -- Governance -----------------------------------------------------------
  def("approval.act", "governance", "Act on approvals", "البت في الاعتمادات",
    "Approve or reject requests routed to you.", "اعتماد أو رفض الطلبات الموجهة إليك."),
  def("audit.view", "governance", "View audit log", "عرض سجل التدقيق",
    "Search the immutable audit log.", "البحث في سجل التدقيق غير القابل للتعديل."),
  def("governance.view_anomalies", "governance", "View anomaly flags", "عرض إشارات الشذوذ",
    "See fraud and anomaly flags with their evidence.", "عرض إشارات الاحتيال والشذوذ مع أدلتها.", true),
  def("security.user.manage", "governance", "Manage users", "إدارة المستخدمين",
    "Create users and assign roles. Requires MFA.", "إنشاء المستخدمين وإسناد الأدوار. يتطلب مصادقة ثنائية.", true),
  def("security.role.manage", "governance", "Manage roles", "إدارة الأدوار",
    "Create and modify roles and their permissions.", "إنشاء الأدوار وصلاحياتها وتعديلها.", true),
  def("settings.branch.manage", "governance", "Branch settings", "إعدادات الفرع",
    "Configure a branch.", "ضبط إعدادات الفرع."),
  def("settings.tenant.manage", "governance", "Tenant settings", "إعدادات المستأجر",
    "Configure the tenant. Requires MFA.", "ضبط إعدادات المستأجر. يتطلب مصادقة ثنائية.", true),
  def("org.manage", "governance", "Manage organisation", "إدارة المنشأة",
    "Create brands, branches, warehouses and central kitchens.", "إنشاء العلامات والفروع والمستودعات والمطابخ المركزية.", true),
  def("integration.manage", "governance", "Manage integrations", "إدارة التكاملات",
    "Configure connectors and their credentials.", "ضبط الموصّلات وبيانات اعتمادها.", true),
  def("api.key.manage", "governance", "Manage API keys", "إدارة مفاتيح الواجهة",
    "Create and revoke API credentials. Requires MFA.", "إنشاء بيانات اعتماد الواجهة وإلغاؤها. يتطلب مصادقة ثنائية.", true),

  // -- Platform (TRENDOW staff, cross-tenant) -----------------------------------
  def("platform.tenant.manage", "platform", "Manage tenants", "إدارة المستأجرين",
    "Cross-tenant administration from the platform console.", "إدارة عابرة للمستأجرين من وحدة تحكم المنصة.", true),
  def("platform.countrypack.manage", "platform", "Manage country packs", "إدارة حزم الدول",
    "Publish and version country packs.", "نشر حزم الدول وإصدار نسخها.", true),
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSION_CATALOGUE)[number]["key"];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_CATALOGUE.map(
  (p) => p.key as PermissionKey,
);

export const PERMISSION_BY_KEY = new Map<PermissionKey, PermissionDefinition>(
  PERMISSION_CATALOGUE.map((p) => [p.key as PermissionKey, p]),
);

/** Permissions in a group, in catalogue order. */
export function permissionsInGroup(group: PermissionGroup): PermissionDefinition[] {
  return PERMISSION_CATALOGUE.filter((p) => p.group === group);
}

/** FR-SEC-024 — MFA is mandatory for any role holding one of these. */
export const MFA_REQUIRED_PERMISSIONS: PermissionKey[] = [
  "security.user.manage",
  "settings.tenant.manage",
  "api.key.manage",
];

// ---------------------------------------------------------------------------
// Segregation of duties — FR-SEC-015, FR-SEC-016
// ---------------------------------------------------------------------------

export interface SodPair {
  a: PermissionKey;
  b: PermissionKey;
  risk: Localised;
  /** FR-SEC-016 — blocked outright rather than merely warned about. */
  blocking: boolean;
}

export const SOD_PAIRS: SodPair[] = [
  {
    a: "inventory.count.perform",
    b: "inventory.count.post",
    risk: { en: "Counter approves their own count.", ar: "القائم بالجرد يعتمد جرده بنفسه." },
    blocking: true,
  },
  {
    a: "purchase.order.create",
    b: "purchase.order.approve_tier_2",
    risk: { en: "Self-approved purchasing.", ar: "شراء معتمد ذاتيًا." },
    blocking: true,
  },
  {
    a: "purchase.receipt.post",
    b: "purchase.invoice.approve_payment",
    risk: { en: "Fictitious receipt paid.", ar: "دفع مقابل استلام وهمي." },
    blocking: false,
  },
  {
    a: "pos.discount.apply",
    b: "pos.discount.approve",
    risk: { en: "Self-approved discount.", ar: "خصم معتمد ذاتيًا." },
    blocking: true,
  },
  {
    a: "cash.session.close",
    b: "cash.variance.approve",
    risk: { en: "Self-approved shortage.", ar: "عجز نقدي معتمد ذاتيًا." },
    blocking: true,
  },
  {
    a: "hr.attendance.correct",
    b: "hr.payroll.export",
    risk: { en: "Inflated hours exported to payroll.", ar: "تصدير ساعات مضخّمة إلى الرواتب." },
    blocking: false,
  },
];

/** Every SoD pair both present in the supplied permission set. */
export function findSodConflicts(permissions: Iterable<PermissionKey>): SodPair[] {
  const held = new Set(permissions);
  return SOD_PAIRS.filter((pair) => held.has(pair.a) && held.has(pair.b));
}

// ---------------------------------------------------------------------------
// Standard roles — FR-SEC-010
// ---------------------------------------------------------------------------

export const ROLE_KEYS = [
  "owner",
  "operations_director",
  "brand_manager",
  "branch_manager",
  "shift_supervisor",
  "cashier",
  "waiter",
  "kitchen_staff",
  "head_chef",
  "storekeeper",
  "purchasing_officer",
  "central_kitchen_manager",
  "accountant",
  "auditor",
  "hr_officer",
  "franchisee",
  "platform_admin",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: Localised;
  character: Localised;
  defaultScope: "tenant" | "brand" | "branch_set" | "branch";
  permissions: PermissionKey[];
}

/** Every permission except the TRENDOW-staff platform group. */
const TENANT_WIDE: PermissionKey[] = ALL_PERMISSIONS.filter(
  (k) => !k.startsWith("platform."),
);

const READ_ONLY: PermissionKey[] = ALL_PERMISSIONS.filter(
  (k) =>
    !k.startsWith("platform.") &&
    (k.includes(".view") ||
      k.startsWith("report.view") ||
      k === "audit.view" ||
      k === "kds.view"),
);

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  owner: {
    key: "owner",
    name: { en: "Owner", ar: "المالك" },
    character: {
      en: "All permissions across every brand and branch of the tenant.",
      ar: "كل الصلاحيات عبر جميع علامات وفروع المستأجر.",
    },
    defaultScope: "tenant",
    permissions: TENANT_WIDE,
  },

  operations_director: {
    key: "operations_director",
    name: { en: "Operations Director", ar: "مدير العمليات" },
    character: {
      en: "All operational authority across assigned brands. No user or billing management.",
      ar: "كامل الصلاحية التشغيلية على العلامات المسندة. دون إدارة المستخدمين أو الفوترة.",
    },
    defaultScope: "brand",
    permissions: [
      "pos.order.view", "pos.order.cancel", "pos.discount.approve", "pos.refund.issue",
      "pos.order.reopen", "pos.reprint.receipt",
      "kds.view", "kds.station.manage", "ops.live.view", "ops.terminal.view", "ops.terminal.manage",
      "cash.session.view", "cash.session.close_other", "cash.variance.approve", "cash.day.close",
      "finance.expense.view", "finance.expense.manage", "finance.expense.approve", "finance.tax.view",
      "inventory.view", "inventory.item.manage", "inventory.count.post",
      "inventory.approve_high_variance", "inventory.adjust", "inventory.transfer.create",
      "inventory.transfer.receive", "inventory.waste.approve", "inventory.cost.view",
      "menu.view", "menu.item.manage", "menu.price.change", "menu.availability.toggle",
      "recipe.view", "recipe.edit", "recipe.publish",
      "purchase.view", "purchase.order.create", "purchase.order.approve_tier_1",
      "purchase.order.approve_tier_2", "purchase.invoice.record", "supplier.manage",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "hr.employee.view", "hr.schedule.manage", "hr.overtime.approve", "hr.performance.view",
      "report.view.sales", "report.view.inventory", "report.view.kitchen",
      "report.view.financial", "report.view.workforce", "report.export",
      "approval.act", "governance.view_anomalies", "settings.branch.manage",
    ],
  },

  brand_manager: {
    key: "brand_manager",
    name: { en: "Brand Manager", ar: "مدير العلامة" },
    character: {
      en: "Menu, pricing and reporting for one brand. No financial approval.",
      ar: "القائمة والتسعير والتقارير لعلامة واحدة. دون اعتماد مالي.",
    },
    defaultScope: "brand",
    permissions: [
      "pos.order.view",
      "kds.view", "ops.live.view", "ops.terminal.view",
      "inventory.view", "inventory.cost.view",
      "menu.view", "menu.item.manage", "menu.price.change", "menu.availability.toggle",
      "recipe.view", "recipe.edit", "recipe.publish",
      "purchase.view",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "hr.employee.view", "hr.performance.view",
      "report.view.sales", "report.view.inventory", "report.view.kitchen", "report.export",
    ],
  },

  branch_manager: {
    key: "branch_manager",
    name: { en: "Branch Manager", ar: "مدير الفرع" },
    character: {
      en: "Full operation of one branch, with approvals inside the configured band.",
      ar: "تشغيل كامل لفرع واحد، مع اعتمادات ضمن النطاق المحدد.",
    },
    defaultScope: "branch",
    permissions: [
      "pos.order.view", "pos.order.create", "pos.order.void_line_prefire",
      "pos.order.void_line_postfire", "pos.order.cancel", "pos.discount.apply",
      "pos.discount.approve", "pos.comp.apply", "pos.price.override", "pos.refund.issue",
      "pos.reprint.receipt", "pos.order.transfer",
      "kds.view", "kds.station.manage", "ops.live.view", "ops.terminal.view",
      "cash.session.view", "cash.session.open", "cash.session.close",
      "cash.session.close_other", "cash.drawer.open_no_sale", "cash.payin", "cash.payout",
      "cash.safedrop", "cash.variance.approve", "cash.day.close",
      "finance.expense.view", "finance.expense.manage", "finance.tax.view",
      "inventory.view", "inventory.count.perform", "inventory.count.post",
      "inventory.adjust", "inventory.transfer.create", "inventory.transfer.receive",
      "inventory.waste.record", "inventory.waste.approve", "inventory.cost.view",
      "menu.view", "menu.availability.toggle", "recipe.view",
      "purchase.view", "purchase.requisition.create", "purchase.order.create",
      "purchase.order.approve_tier_1", "purchase.receipt.post",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "hr.employee.view", "hr.schedule.manage", "hr.attendance.correct",
      "hr.overtime.approve", "hr.performance.view",
      "report.view.sales", "report.view.inventory", "report.view.kitchen",
      "report.view.financial", "report.view.workforce", "report.export",
      "approval.act", "settings.branch.manage",
    ],
  },

  shift_supervisor: {
    key: "shift_supervisor",
    name: { en: "Shift Supervisor", ar: "مشرف الوردية" },
    character: {
      en: "Runs the floor for one shift. Approves within a narrow band; no menu, no purchasing.",
      ar: "يدير الصالة خلال وردية واحدة. يعتمد ضمن نطاق ضيّق؛ دون قائمة أو مشتريات.",
    },
    defaultScope: "branch",
    permissions: [
      "pos.order.view", "pos.order.create", "pos.order.void_line_prefire",
      "pos.order.void_line_postfire", "pos.order.cancel", "pos.discount.apply",
      "pos.discount.approve", "pos.comp.apply", "pos.refund.issue",
      "pos.reprint.receipt", "pos.order.transfer",
      "kds.view", "ops.live.view", "ops.terminal.view",
      "cash.session.view", "cash.session.open", "cash.session.close",
      "cash.session.close_other", "cash.drawer.open_no_sale",
      "cash.payin", "cash.payout", "cash.safedrop",
      "inventory.view", "inventory.count.perform", "inventory.waste.record",
      "menu.view", "menu.availability.toggle", "recipe.view",
      "hr.employee.view", "hr.attendance.correct",
      "report.view.sales", "report.view.kitchen",
      "approval.act",
    ],
  },

  cashier: {
    key: "cashier",
    name: { en: "Cashier", ar: "أمين الصندوق" },
    character: {
      en: "Takes orders and payment on one terminal. No financial reporting, no cost visibility.",
      ar: "يأخذ الطلبات والمدفوعات على جهاز واحد. دون تقارير مالية أو رؤية للتكلفة.",
    },
    defaultScope: "branch",
    permissions: [
      "pos.order.view", "pos.order.create", "pos.order.void_line_prefire",
      "pos.discount.apply", "pos.reprint.receipt",
      "cash.session.open", "cash.session.close", "cash.payin", "cash.payout",
      "ops.live.view",
      "menu.view",
    ],
  },

  waiter: {
    key: "waiter",
    name: { en: "Waiter", ar: "النادل" },
    character: {
      en: "Takes table orders and fires courses. Cannot take payment or open a drawer.",
      ar: "يأخذ طلبات الطاولات ويرسل الأطباق. لا يستلم مدفوعات ولا يفتح الدرج.",
    },
    defaultScope: "branch",
    permissions: [
      "pos.order.view", "pos.order.create", "pos.order.void_line_prefire",
      "pos.order.transfer",
      "ops.live.view", "kds.view",
      "menu.view",
    ],
  },

  kitchen_staff: {
    key: "kitchen_staff",
    name: { en: "Kitchen Staff", ar: "طاقم المطبخ" },
    character: {
      en: "The kitchen display and nothing else. Marks items unavailable when they run out.",
      ar: "شاشة المطبخ فقط. يحدّد الأصناف غير المتاحة عند نفادها.",
    },
    defaultScope: "branch",
    permissions: [
      "kds.view",
      "menu.view", "menu.availability.toggle",
      "recipe.view",
      "inventory.waste.record",
    ],
  },

  head_chef: {
    key: "head_chef",
    name: { en: "Head Chef", ar: "رئيس الطهاة" },
    character: {
      en: "Kitchen, recipes, waste, and inventory visibility across assigned branches.",
      ar: "المطبخ والوصفات والهدر ورؤية المخزون عبر الفروع المسندة.",
    },
    defaultScope: "branch_set",
    permissions: [
      "pos.order.view",
      "kds.view", "kds.station.manage", "ops.live.view",
      "inventory.view", "inventory.count.perform", "inventory.waste.record",
      "inventory.cost.view",
      "menu.view", "menu.availability.toggle",
      "recipe.view", "recipe.edit", "recipe.publish",
      "purchase.view", "purchase.requisition.create",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "hr.performance.view",
      "report.view.kitchen", "report.view.inventory", "report.export",
    ],
  },

  storekeeper: {
    key: "storekeeper",
    name: { en: "Storekeeper", ar: "أمين المخزن" },
    character: {
      en: "Inventory, receiving and counting for one branch or warehouse.",
      ar: "المخزون والاستلام والجرد لفرع أو مستودع واحد.",
    },
    defaultScope: "branch",
    permissions: [
      "inventory.view", "inventory.item.manage", "inventory.count.perform",
      "inventory.transfer.create", "inventory.transfer.receive",
      "inventory.waste.record", "inventory.cost.view",
      "purchase.view", "purchase.requisition.create", "purchase.receipt.post",
      "menu.view", "recipe.view",
      "report.view.inventory",
    ],
  },

  purchasing_officer: {
    key: "purchasing_officer",
    name: { en: "Purchasing Officer", ar: "مسؤول المشتريات" },
    character: {
      en: "Procurement and supplier management across the tenant.",
      ar: "المشتريات وإدارة الموردين على مستوى المستأجر.",
    },
    defaultScope: "tenant",
    permissions: [
      "inventory.view", "inventory.cost.view",
      "purchase.view", "purchase.requisition.create", "purchase.order.create",
      "purchase.order.approve_tier_1", "purchase.receipt.post",
      "purchase.invoice.record", "supplier.manage",
      "menu.view", "recipe.view",
      "costing.view",
      "report.view.inventory", "report.export",
      "approval.act",
    ],
  },

  central_kitchen_manager: {
    key: "central_kitchen_manager",
    name: { en: "Central Kitchen Manager", ar: "مدير المطبخ المركزي" },
    character: {
      en: "Production, yield and distribution out of the central kitchen to the branches it supplies.",
      ar: "الإنتاج والعائد والتوزيع من المطبخ المركزي إلى الفروع التي يخدمها.",
    },
    defaultScope: "branch_set",
    permissions: [
      "kds.view", "ops.live.view",
      "inventory.view", "inventory.item.manage", "inventory.count.perform",
      "inventory.count.post", "inventory.adjust",
      "inventory.transfer.create", "inventory.transfer.receive",
      "inventory.waste.record", "inventory.waste.approve", "inventory.cost.view",
      "menu.view", "recipe.view", "recipe.edit", "recipe.publish",
      "purchase.view", "purchase.requisition.create", "purchase.receipt.post",
      "costing.view", "costing.variance.view",
      "hr.employee.view", "hr.schedule.manage",
      "report.view.inventory", "report.view.kitchen", "report.export",
      "approval.act",
    ],
  },

  accountant: {
    key: "accountant",
    name: { en: "Accountant", ar: "المحاسب" },
    character: {
      en: "Financial read and export across the tenant. No operational write access.",
      ar: "قراءة وتصدير مالي على مستوى المستأجر. دون صلاحية كتابة تشغيلية.",
    },
    defaultScope: "tenant",
    permissions: [
      "pos.order.view",
      "cash.session.view", "finance.expense.view", "finance.expense.approve",
      "finance.tax.view",
      "inventory.view", "inventory.cost.view",
      "purchase.view", "purchase.invoice.record", "purchase.invoice.approve_payment",
      "menu.view", "recipe.view",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "report.view.sales", "report.view.financial", "report.view.inventory", "report.export",
      "audit.view",
    ],
  },

  auditor: {
    key: "auditor",
    name: { en: "Auditor", ar: "المدقق" },
    character: {
      en: "Read-only across everything, including the audit log. Writes nothing.",
      ar: "قراءة فقط لكل شيء، بما في ذلك سجل التدقيق. لا يكتب شيئًا.",
    },
    defaultScope: "tenant",
    permissions: [...READ_ONLY, "governance.view_anomalies", "report.export"],
  },

  hr_officer: {
    key: "hr_officer",
    name: { en: "HR Officer", ar: "مسؤول الموارد البشرية" },
    character: {
      en: "Employee records, schedules and attendance across the tenant.",
      ar: "سجلات الموظفين والجداول والحضور على مستوى المستأجر.",
    },
    defaultScope: "tenant",
    permissions: [
      "hr.employee.view", "hr.employee.manage", "hr.compensation.view",
      "hr.schedule.manage", "hr.attendance.correct", "hr.overtime.approve",
      "hr.payroll.export", "hr.performance.view",
      "report.view.workforce", "report.export",
      "approval.act",
    ],
  },

  franchisee: {
    key: "franchisee",
    name: { en: "Franchisee", ar: "صاحب الامتياز" },
    character: {
      en: "Owns the branches in one territory. Sees its own trade and cost, never another franchisee's.",
      ar: "يملك فروع منطقة امتياز واحدة. يرى مبيعاته وتكلفته فقط، لا غيره.",
    },
    defaultScope: "branch_set",
    permissions: [
      "pos.order.view", "pos.discount.approve", "pos.refund.issue", "pos.reprint.receipt",
      "kds.view", "ops.live.view", "ops.terminal.view",
      "cash.session.view", "cash.variance.approve", "cash.day.close",
      "finance.expense.view", "finance.expense.manage", "finance.expense.approve",
      "finance.tax.view",
      "inventory.view", "inventory.count.post", "inventory.approve_high_variance",
      "inventory.waste.approve", "inventory.cost.view",
      "menu.view", "menu.availability.toggle", "recipe.view",
      "purchase.view", "purchase.order.create", "purchase.order.approve_tier_1",
      "purchase.order.approve_tier_2", "purchase.invoice.record",
      "costing.view", "costing.variance.view", "costing.margin.view",
      "hr.employee.view", "hr.schedule.manage", "hr.overtime.approve",
      "report.view.sales", "report.view.inventory", "report.view.kitchen",
      "report.view.financial", "report.view.workforce", "report.export",
      "approval.act", "settings.branch.manage",
    ],
  },

  platform_admin: {
    key: "platform_admin",
    name: { en: "Platform Administrator", ar: "مدير المنصة" },
    character: {
      en: "TRENDOW staff. Cross-tenant administration, country packs, and integrations.",
      ar: "طاقم TRENDOW. إدارة عابرة للمستأجرين وحزم الدول والتكاملات.",
    },
    defaultScope: "tenant",
    permissions: [
      "platform.tenant.manage", "platform.countrypack.manage",
      "org.manage", "security.user.manage", "security.role.manage",
      "settings.tenant.manage", "settings.branch.manage",
      "integration.manage", "api.key.manage",
      "audit.view", "governance.view_anomalies",
      "ops.terminal.view", "ops.terminal.manage",
      "report.view.governance", "report.export",
    ],
  },
};

export const ROLE_LIST: RoleDefinition[] = ROLE_KEYS.map((k) => ROLE_DEFINITIONS[k]);

/**
 * Effective permissions for a role. In the real system this is the union
 * across a user's role assignments, each within its own scope, and scopes
 * do not leak into one another (FR-SEC-004). The demo carries one active
 * role at a time, so the union is the role's own set.
 */
export function permissionsForRole(role: RoleKey): Set<PermissionKey> {
  return new Set(ROLE_DEFINITIONS[role].permissions);
}

/** FR-SEC-024 — does this role oblige the user to enrol in MFA? */
export function roleRequiresMfa(role: RoleKey): boolean {
  const held = permissionsForRole(role);
  return MFA_REQUIRED_PERMISSIONS.some((p) => held.has(p));
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The three front ends a role may be sent to. A role that holds no console
 * permission has no business landing on the console: kitchen staff go to the
 * kitchen display, a cashier goes to the till. Signing in should put you where
 * you work, not on a dashboard you are not allowed to read.
 */
export type Surface = "console" | "pos" | "kds";

/** Permissions that justify opening the management console at all. */
const CONSOLE_PERMISSIONS: PermissionKey[] = [
  "report.view.sales", "report.view.inventory", "report.view.kitchen",
  "report.view.financial", "report.view.workforce", "report.view.governance",
  "inventory.view", "menu.view", "purchase.view", "costing.view",
  "hr.employee.view", "cash.session.view", "audit.view", "org.manage",
  "security.user.manage", "settings.tenant.manage", "settings.branch.manage",
  "platform.tenant.manage",
];

export function surfacesForRole(role: RoleKey): Surface[] {
  const held = permissionsForRole(role);
  const surfaces: Surface[] = [];
  if (CONSOLE_PERMISSIONS.some((p) => held.has(p))) surfaces.push("console");
  if (held.has("pos.order.create")) surfaces.push("pos");
  if (held.has("kds.view")) surfaces.push("kds");
  return surfaces.length > 0 ? surfaces : ["console"];
}

/**
 * Where the role lands after sign-in. A cashier is at a till, not a desk, so
 * the till wins even though the role can read the live operations view.
 */
export function homeRouteForRole(role: RoleKey): string {
  switch (role) {
    case "cashier":
    case "waiter":
      return "/pos";
    case "kitchen_staff":
      return "/kds";
    default:
      return "/dashboard";
  }
}
