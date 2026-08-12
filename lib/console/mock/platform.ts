/**
 * Platform fixtures — country packs, integration connectors, operational
 * alerts and the report catalogue. SRS ch.19.3, ch.22, ch.23.
 */

import type {
  AlertKind,
  CountryPack,
  Integration,
  IntegrationCategory,
  OperationalAlert,
  ReportDefinition,
  Severity,
} from "../types";
import { branches, terminals } from "./org";
import { expiringBatches, lowStockLevels } from "./inventory";
import { delayedTickets } from "./sales";
import { varianceSessions } from "./finance";
import { expiringDocuments } from "./workforce";
import { chance, createRng, float, int, pick, seqId } from "./rng";
import { hoursAgo, minutesAgo } from "./clock";

const rng = createRng(0x8b44);

// ---------------------------------------------------------------------------
// Country packs — SRS §22.2, §22.3
// ---------------------------------------------------------------------------

export const countryPacks: CountryPack[] = [
  {
    code: "EG",
    name: { en: "Egypt", ar: "مصر" },
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    status: "active",
    signed: true,
    currency: "EGP",
    currencyExponent: 2,
    taxEngine: "vat_standard",
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [
      { code: "standard", rate: 14, label: { en: "Standard", ar: "قياسي" } },
      { code: "reduced", rate: 5, label: { en: "Reduced", ar: "مخفّض" } },
      { code: "zero", rate: 0, label: { en: "Zero-rated", ar: "نسبة صفرية" } },
      { code: "exempt", rate: null, label: { en: "Exempt", ar: "معفى" } },
    ],
    fiscalProvider: "eta_egypt",
    fiscalMode: "e_receipt",
    weekStart: "saturday",
    weekend: ["friday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.35,
    dataRetentionYears: 5,
    branchCount: branches.length,
    conformancePassed: true,
  },
  {
    code: "SA",
    name: { en: "Saudi Arabia", ar: "السعودية" },
    version: "2026.2",
    effectiveFrom: "2026-04-01",
    status: "active",
    signed: true,
    currency: "SAR",
    currencyExponent: 2,
    taxEngine: "vat_zatca_phase2",
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [
      { code: "standard", rate: 15, label: { en: "Standard", ar: "قياسي" } },
      { code: "zero", rate: 0, label: { en: "Zero-rated", ar: "نسبة صفرية" } },
      { code: "exempt", rate: null, label: { en: "Exempt", ar: "معفى" } },
    ],
    fiscalProvider: "zatca_fatoora",
    fiscalMode: "reporting_and_clearance",
    weekStart: "sunday",
    weekend: ["friday", "saturday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.5,
    dataRetentionYears: 6,
    branchCount: 0,
    conformancePassed: true,
  },
  {
    code: "AE",
    name: { en: "United Arab Emirates", ar: "الإمارات العربية المتحدة" },
    version: "2026.1",
    effectiveFrom: "2026-01-01",
    status: "active",
    signed: true,
    currency: "AED",
    currencyExponent: 2,
    taxEngine: "vat_standard",
    pricingMode: "tax_exclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [
      { code: "standard", rate: 5, label: { en: "Standard", ar: "قياسي" } },
      { code: "zero", rate: 0, label: { en: "Zero-rated", ar: "نسبة صفرية" } },
      { code: "exempt", rate: null, label: { en: "Exempt", ar: "معفى" } },
    ],
    fiscalProvider: null,
    fiscalMode: null,
    weekStart: "monday",
    weekend: ["saturday", "sunday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.25,
    dataRetentionYears: 5,
    branchCount: 0,
    conformancePassed: true,
  },
  {
    code: "JO",
    name: { en: "Jordan", ar: "الأردن" },
    version: "2026.0-rc2",
    effectiveFrom: "2026-10-01",
    status: "scheduled",
    signed: true,
    currency: "EGP",
    currencyExponent: 3,
    taxEngine: "vat_standard",
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [
      { code: "standard", rate: 16, label: { en: "Standard", ar: "قياسي" } },
      { code: "reduced", rate: 4, label: { en: "Reduced", ar: "مخفّض" } },
    ],
    fiscalProvider: "jofotara",
    fiscalMode: "e_invoice",
    weekStart: "sunday",
    weekend: ["friday", "saturday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.25,
    dataRetentionYears: 4,
    branchCount: 0,
    conformancePassed: true,
  },
  {
    code: "KW",
    name: { en: "Kuwait", ar: "الكويت" },
    version: "2026.0-draft",
    effectiveFrom: "2027-01-01",
    status: "draft",
    signed: false,
    currency: "AED",
    currencyExponent: 3,
    taxEngine: "no_vat",
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [{ code: "zero", rate: 0, label: { en: "No VAT", ar: "بدون ضريبة" } }],
    fiscalProvider: null,
    fiscalMode: null,
    weekStart: "sunday",
    weekend: ["friday", "saturday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.25,
    dataRetentionYears: 5,
    branchCount: 0,
    // FR-LOC-031 — cannot activate until the conformance suite passes.
    conformancePassed: false,
  },
  {
    code: "QA",
    name: { en: "Qatar", ar: "قطر" },
    version: "2025.4",
    effectiveFrom: "2025-07-01",
    status: "superseded",
    signed: true,
    currency: "AED",
    currencyExponent: 2,
    taxEngine: "no_vat",
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [{ code: "zero", rate: 0, label: { en: "No VAT", ar: "بدون ضريبة" } }],
    fiscalProvider: null,
    fiscalMode: null,
    weekStart: "sunday",
    weekend: ["friday", "saturday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.25,
    dataRetentionYears: 5,
    branchCount: 0,
    conformancePassed: true,
  },
];

// ---------------------------------------------------------------------------
// Integrations — SRS ch.23
// ---------------------------------------------------------------------------

interface IntegrationSeed {
  name: string;
  vendor: string;
  category: IntegrationCategory;
  en: string;
  ar: string;
  status: Integration["status"];
}

const INTEGRATION_SEEDS: IntegrationSeed[] = [
  { name: "Network International", vendor: "Network International", category: "payment", status: "healthy",
    en: "Card terminal integration across all Cairo branches.", ar: "تكامل أجهزة البطاقات في جميع فروع القاهرة." },
  { name: "Geidea", vendor: "Geidea", category: "payment", status: "healthy",
    en: "Secondary acquirer for Alexandria and Zamalek.", ar: "مستحوذ ثانوي للإسكندرية والزمالك." },
  { name: "Fawry", vendor: "Fawry", category: "payment", status: "degraded",
    en: "Wallet and voucher settlement.", ar: "تسوية المحافظ والقسائم." },
  { name: "PayTabs", vendor: "PayTabs", category: "payment", status: "not_configured",
    en: "Not yet configured for this tenant.", ar: "لم يُضبط بعد لهذا المستأجر." },
  { name: "Talabat", vendor: "Talabat", category: "aggregator", status: "healthy",
    en: "Inbound orders and status callbacks.", ar: "الطلبات الواردة وردود الحالة." },
  { name: "Elmenus", vendor: "Elmenus", category: "aggregator", status: "healthy",
    en: "Inbound orders, menu sync enabled.", ar: "الطلبات الواردة مع مزامنة القائمة." },
  { name: "Careem Food", vendor: "Careem", category: "aggregator", status: "failing",
    en: "Menu mapping rejected four items since the last publish.", ar: "رفض ربط القائمة أربعة أصناف منذ آخر نشر." },
  { name: "HungerStation", vendor: "HungerStation", category: "aggregator", status: "disabled",
    en: "Disabled pending the Saudi expansion.", ar: "معطّل بانتظار التوسع السعودي." },
  { name: "QuickBooks Online", vendor: "Intuit", category: "accounting", status: "healthy",
    en: "Daily journal export with chart-of-accounts mapping.", ar: "تصدير يومي للقيود مع ربط دليل الحسابات." },
  { name: "Xero", vendor: "Xero", category: "accounting", status: "not_configured",
    en: "Available; no credentials supplied.", ar: "متاح؛ لم تُقدَّم بيانات اعتماد." },
  { name: "WhatsApp Business", vendor: "Meta", category: "notification", status: "healthy",
    en: "Digital receipts and approval notifications.", ar: "الإيصالات الرقمية وإشعارات الاعتماد." },
  { name: "SMS Gateway", vendor: "Vodafone", category: "notification", status: "degraded",
    en: "Elevated failure rate on international numbers.", ar: "ارتفاع معدل الفشل على الأرقام الدولية." },
  { name: "Microsoft Entra ID", vendor: "Microsoft", category: "identity", status: "healthy",
    en: "SSO for head-office users on the Enterprise tier.", ar: "الدخول الموحّد لمستخدمي المقر في الفئة المؤسسية." },
  { name: "Epson TM-T88 fleet", vendor: "Epson", category: "hardware", status: "healthy",
    en: "Thermal receipt printers, Arabic bitmap fallback enabled.", ar: "طابعات حرارية مع تفعيل الطباعة النقطية للعربية." },
  { name: "Star kitchen printers", vendor: "Star Micronics", category: "hardware", status: "degraded",
    en: "One printer offline at Nasr City.", ar: "طابعة واحدة غير متصلة في مدينة نصر." },
];

export const integrations: Integration[] = INTEGRATION_SEEDS.map((seed, i) => {
  const enabled = seed.status !== "disabled" && seed.status !== "not_configured";
  return {
    id: seqId("int", i + 1),
    name: seed.name,
    category: seed.category,
    vendor: seed.vendor,
    status: seed.status,
    enabled,
    lastSuccessAt: enabled ? minutesAgo(int(rng, 1, seed.status === "healthy" ? 12 : 900)) : null,
    errorRate:
      seed.status === "failing" ? float(rng, 22, 68, 1)
        : seed.status === "degraded" ? float(rng, 4, 18, 1)
          : enabled ? float(rng, 0, 1.4, 2) : 0,
    queueDepth:
      seed.status === "failing" ? int(rng, 40, 320)
        : seed.status === "degraded" ? int(rng, 4, 40)
          : enabled ? int(rng, 0, 6) : 0,
    circuitOpen: seed.status === "failing",
    branchCount: enabled ? int(rng, 1, branches.length) : 0,
    description: { en: seed.en, ar: seed.ar },
  };
});

// ---------------------------------------------------------------------------
// Operational alerts — SRS FR-RPT-045
// ---------------------------------------------------------------------------

function alert(
  index: number,
  kind: AlertKind,
  severity: Severity,
  titleEn: string,
  titleAr: string,
  detailEn: string,
  detailAr: string,
  branchIndex: number | null,
  href: string | null,
  specRef: string,
  ageMinutes: number,
): OperationalAlert {
  const branch = branchIndex === null ? null : branches[branchIndex % branches.length]!;
  return {
    id: seqId("alt", index),
    kind,
    severity,
    title: { en: titleEn, ar: titleAr },
    detail: { en: detailEn, ar: detailAr },
    branchId: branch?.id ?? null,
    branchName: branch?.name ?? null,
    raisedAt: minutesAgo(ageMinutes),
    acknowledged: chance(rng, 0.25),
    href,
    specRef,
  };
}

const offlineTerminals = terminals.filter((t) => t.status === "offline");
const criticalBatch = expiringBatches[0];
const worstVariance = varianceSessions[0];
const lowest = lowStockLevels[0];
const expiringDoc = expiringDocuments[0];

export const operationalAlerts: OperationalAlert[] = [
  alert(1, "cash_variance", "high",
    "Cash variance beyond tolerance",
    "فرق نقدي يتجاوز الحد المسموح",
    worstVariance
      ? `${worstVariance.branchName.en} · ${worstVariance.drawerName} closed ${(worstVariance.variance.amount / 100).toFixed(2)} EGP against expected.`
      : "A drawer closed outside the configured tolerance.",
    worstVariance
      ? `${worstVariance.branchName.ar} · ${worstVariance.drawerName} أغلق بفارق ${(worstVariance.variance.amount / 100).toFixed(2)} جنيه عن المتوقع.`
      : "أُغلق درج خارج حدود التسامح المضبوطة.",
    0, "/finance/cash-sessions", "FR-FIN-006", 42),

  alert(2, "terminal_offline", offlineTerminals.length > 2 ? "high" : "medium",
    "Terminals offline beyond threshold",
    "أجهزة غير متصلة تتجاوز الحد",
    `${offlineTerminals.length} terminals have not reported in over 15 minutes. Sales continue offline; sync backlog is accumulating.`,
    `${offlineTerminals.length} أجهزة لم ترسل تقريرًا منذ أكثر من ١٥ دقيقة. البيع مستمر دون اتصال ويتراكم تأخر المزامنة.`,
    null, "/operations/terminals", "FR-RPT-045", 18),

  alert(3, "expiry", "medium",
    "Batches expiring within 24 hours",
    "دفعات تنتهي خلال ٢٤ ساعة",
    criticalBatch
      ? `${criticalBatch.itemName.en} at ${criticalBatch.locationName.en} expires in ${criticalBatch.daysToExpiry} day(s). ${expiringBatches.length} batches are inside the 7-day horizon.`
      : "Batches are approaching their expiry horizon.",
    criticalBatch
      ? `${criticalBatch.itemName.ar} في ${criticalBatch.locationName.ar} تنتهي خلال ${criticalBatch.daysToExpiry} يوم. ${expiringBatches.length} دفعة ضمن أفق السبعة أيام.`
      : "دفعات تقترب من أفق انتهاء الصلاحية.",
    3, "/inventory/expiry", "FR-INV-024", 300),

  alert(4, "stock_zero", "high",
    "Stock reached zero on a recipe ingredient",
    "نفاد مخزون مكوّن في وصفة",
    lowest
      ? `${lowest.itemName.en} at ${lowest.locationName.en} is at ${lowest.onHand.value}. Dependent menu items are being auto-86'd.`
      : "An ingredient has reached zero.",
    lowest
      ? `${lowest.itemName.ar} في ${lowest.locationName.ar} عند ${lowest.onHand.value}. يتم إيقاف الأصناف المرتبطة تلقائيًا.`
      : "نفد أحد المكونات.",
    1, "/inventory/levels", "FR-MNU-031", 76),

  alert(5, "order_delayed", delayedTickets.length > 6 ? "high" : "medium",
    "Kitchen tickets beyond target time",
    "تذاكر مطبخ تجاوزت الزمن المستهدف",
    `${delayedTickets.length} tickets are past their target preparation time. The grill station carries the deepest queue.`,
    `${delayedTickets.length} تذكرة تجاوزت زمن التحضير المستهدف. محطة الشواية تحمل أعمق طابور.`,
    0, "/operations/kitchen", "FR-KDS-022", 6),

  alert(6, "sync_backlog", "medium",
    "Sync backlog above threshold",
    "تراكم المزامنة يتجاوز الحد",
    "One terminal is holding 620 queued operations after a four-hour partition. No sales were lost.",
    "جهاز واحد يحتفظ بـ ٦٢٠ عملية في الطابور بعد انقطاع دام أربع ساعات. لم تُفقد أي مبيعات.",
    2, "/operations/terminals", "FR-OFF-001", 55),

  alert(7, "fiscal_submission_failed", "critical",
    "Fiscal submission failed after final retry",
    "فشل الإرسال الضريبي بعد آخر محاولة",
    "Three e-receipt documents were rejected by the ETA endpoint with a schema validation error. They remain queued and are not lost.",
    "رفضت بوابة مصلحة الضرائب ثلاث وثائق إيصال إلكتروني بخطأ في التحقق من المخطط. لا تزال في الطابور ولم تُفقد.",
    0, "/integrations", "IR-LOC-EG-003", 128),

  alert(8, "discount_threshold", "low",
    "Discount above threshold applied",
    "تطبيق خصم يتجاوز الحد",
    "A 25% discount was applied and approved by manager PIN at the terminal. Recorded with actor, approver and reason.",
    "طُبّق خصم ٢٥٪ واعتُمد برمز المدير على الجهاز. سُجّل مع المنفّذ والمعتمد والسبب.",
    5, "/approvals", "FR-POS-047", 24),

  alert(9, "sales_below_forecast", "medium",
    "Sales significantly below forecast",
    "المبيعات أقل بكثير من التوقع",
    "Maadi is 31% below the hourly forecast for the 13:00–14:00 band, a −2.4σ deviation from the same weekday baseline.",
    "المعادي أقل بنسبة ٣١٪ من التوقع الساعي لنطاق ١٣:٠٠–١٤:٠٠، بانحراف −٢٫٤ سيغما عن خط أساس اليوم نفسه.",
    2, "/dashboard", "FR-RPT-045", 34),

  alert(10, "document_expiring", "medium",
    "Employee document expiring",
    "وثيقة موظف على وشك الانتهاء",
    expiringDoc
      ? `${expiringDoc.employee.name.en}'s ${expiringDoc.document.type.en.toLowerCase()} expires in ${expiringDoc.document.daysToExpiry} day(s).`
      : "An employee compliance document is approaching expiry.",
    expiringDoc
      ? `${expiringDoc.document.type.ar} الخاصة بـ ${expiringDoc.employee.name.ar} تنتهي خلال ${expiringDoc.document.daysToExpiry} يوم.`
      : "وثيقة امتثال لموظف تقترب من الانتهاء.",
    4, "/workforce/employees", "FR-HRM-004", 640),

  alert(11, "negative_stock", "medium",
    "Negative stock recorded",
    "تسجيل مخزون سالب",
    "Six item-location pairs are negative. Each indicates a receipt that was never entered, not a blocked sale.",
    "ستة أزواج صنف-موقع بقيم سالبة. كل منها يشير إلى استلام لم يُسجَّل، لا إلى بيع محظور.",
    1, "/inventory/levels", "FR-INV-014", 210),

  alert(12, "void_after_payment", "high",
    "Void after payment initiation",
    "إلغاء بعد بدء الدفع",
    "Two lines were voided after payment had begun on the same terminal within one shift. Flagged for review with full evidence.",
    "أُلغي صنفان بعد بدء الدفع على الجهاز نفسه خلال وردية واحدة. مُعلَّم للمراجعة مع الأدلة الكاملة.",
    6, "/audit", "FR-CST-040", 88),
].sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime());

// ---------------------------------------------------------------------------
// Report catalogue — SRS §19.3
// ---------------------------------------------------------------------------

export const reportCatalogue: ReportDefinition[] = [
  // Sales
  { id: "sales-summary", category: "sales", name: { en: "Sales Summary", ar: "ملخص المبيعات" }, description: { en: "Gross, discounts, refunds, net and tax by period.", ar: "الإجمالي والخصومات والمرتجعات والصافي والضريبة حسب الفترة." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "sales-by-branch", category: "sales", name: { en: "Sales by Branch", ar: "المبيعات حسب الفرع" }, description: { en: "Comparative, with variance to prior period and to target.", ar: "مقارن، مع الفرق عن الفترة السابقة والمستهدف." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "sales-by-item", category: "sales", name: { en: "Sales by Category and Item", ar: "المبيعات حسب الفئة والصنف" }, description: { en: "Units, revenue, margin and mix percentage.", ar: "الوحدات والإيراد والهامش ونسبة المزيج." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "sales-by-employee", category: "sales", name: { en: "Sales by Employee", ar: "المبيعات حسب الموظف" }, description: { en: "Revenue, order count, average order value and upsell rate.", ar: "الإيراد وعدد الطلبات ومتوسط قيمة الطلب ومعدل البيع الإضافي." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "sales-by-tender", category: "sales", name: { en: "Sales by Tender", ar: "المبيعات حسب وسيلة الدفع" }, description: { en: "The reconciliation basis for every settlement.", ar: "أساس المطابقة لكل تسوية." }, requiredPermission: "report.view.financial", async: false, specRef: "§19.3" },
  { id: "sales-by-hour", category: "sales", name: { en: "Sales by Hour and Day-part", ar: "المبيعات حسب الساعة والفترة" }, description: { en: "The demand curve the roster should match.", ar: "منحنى الطلب الذي ينبغي أن يطابقه الجدول." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "discount-analysis", category: "sales", name: { en: "Discount and Comp Analysis", ar: "تحليل الخصومات والمجانيات" }, description: { en: "By reason, employee and approver.", ar: "حسب السبب والموظف والمعتمد." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "void-refund-analysis", category: "sales", name: { en: "Void and Refund Analysis", ar: "تحليل الإلغاءات والمرتجعات" }, description: { en: "By reason, employee, and timing relative to payment.", ar: "حسب السبب والموظف والتوقيت بالنسبة للدفع." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },
  { id: "menu-mix", category: "sales", name: { en: "Menu Mix", ar: "مزيج القائمة" }, description: { en: "Item share of units and of revenue.", ar: "حصة الصنف من الوحدات ومن الإيراد." }, requiredPermission: "report.view.sales", async: false, specRef: "§19.3" },

  // Inventory
  { id: "stock-valuation", category: "inventory", name: { en: "Current Stock Valuation", ar: "تقييم المخزون الحالي" }, description: { en: "By location, category and item.", ar: "حسب الموقع والفئة والصنف." }, requiredPermission: "report.view.inventory", async: false, specRef: "§19.3" },
  { id: "movement-ledger", category: "inventory", name: { en: "Stock Movement Ledger", ar: "دفتر حركة المخزون" }, description: { en: "The full auditable movement history.", ar: "سجل الحركات الكامل القابل للتدقيق." }, requiredPermission: "report.view.inventory", async: true, specRef: "§7.4.3" },
  { id: "low-stock", category: "inventory", name: { en: "Low Stock and Reorder", ar: "نقص المخزون وإعادة الطلب" }, description: { en: "With suggested order quantities.", ar: "مع كميات الطلب المقترحة." }, requiredPermission: "report.view.inventory", async: false, specRef: "FR-INV-067" },
  { id: "expiry-watch", category: "inventory", name: { en: "Expiry Watch", ar: "مراقبة الصلاحية" }, description: { en: "Items by days to expiry, with value at risk.", ar: "الأصناف حسب أيام الصلاحية المتبقية والقيمة المعرّضة." }, requiredPermission: "report.view.inventory", async: false, specRef: "FR-INV-025" },
  { id: "count-variance", category: "inventory", name: { en: "Stock Count Variance", ar: "فروقات الجرد" }, description: { en: "By session, item and value.", ar: "حسب الجلسة والصنف والقيمة." }, requiredPermission: "report.view.inventory", async: false, specRef: "FR-INV-045" },
  { id: "theoretical-actual", category: "inventory", name: { en: "Theoretical vs Actual Usage", ar: "الاستهلاك النظري مقابل الفعلي" }, description: { en: "The variance report. Sorted by value, not quantity.", ar: "تقرير الفروقات. مرتب حسب القيمة لا الكمية." }, requiredPermission: "costing.variance.view", async: true, specRef: "FR-CST-010" },
  { id: "waste-analysis", category: "inventory", name: { en: "Waste Analysis", ar: "تحليل الهدر" }, description: { en: "By item, reason, employee and shift.", ar: "حسب الصنف والسبب والموظف والوردية." }, requiredPermission: "report.view.inventory", async: false, specRef: "FR-CST-020" },
  { id: "dead-stock", category: "inventory", name: { en: "Dead Stock", ar: "المخزون الراكد" }, description: { en: "Items with no movement in N days.", ar: "أصناف بلا حركة خلال عدد محدد من الأيام." }, requiredPermission: "report.view.inventory", async: false, specRef: "§19.3" },

  // Kitchen
  { id: "prep-time", category: "kitchen", name: { en: "Preparation Time by Item", ar: "زمن التحضير حسب الصنف" }, description: { en: "Average, p50 and p90 against target.", ar: "المتوسط والوسيط والمئين ٩٠ مقابل المستهدف." }, requiredPermission: "report.view.kitchen", async: false, specRef: "FR-KDS-041" },
  { id: "station-performance", category: "kitchen", name: { en: "Station Performance", ar: "أداء المحطات" }, description: { en: "Throughput, queue depth and bottleneck hours.", ar: "الإنتاجية وعمق الطابور وساعات الاختناق." }, requiredPermission: "report.view.kitchen", async: false, specRef: "FR-KDS-043" },
  { id: "delayed-orders", category: "kitchen", name: { en: "Delayed Orders", ar: "الطلبات المتأخرة" }, description: { en: "Count and duration by hour, station and item.", ar: "العدد والمدة حسب الساعة والمحطة والصنف." }, requiredPermission: "report.view.kitchen", async: false, specRef: "§19.3" },

  // Financial
  { id: "z-report", category: "financial", name: { en: "Z Report", ar: "تقرير Z" }, description: { en: "The statutory day close, sequentially numbered per branch.", ar: "إغلاق اليوم القانوني، مرقم تسلسليًا لكل فرع." }, requiredPermission: "report.view.financial", async: false, specRef: "FR-FIN-022" },
  { id: "cash-reconciliation", category: "financial", name: { en: "Cash Reconciliation", ar: "مطابقة النقدية" }, description: { en: "By session, cashier, drawer and variance.", ar: "حسب الجلسة والكاشير والدرج والفرق." }, requiredPermission: "report.view.financial", async: false, specRef: "§19.3" },
  { id: "tax-summary", category: "financial", name: { en: "Tax Summary", ar: "ملخص الضريبة" }, description: { en: "By rate, class, jurisdiction and period.", ar: "حسب النسبة والفئة والولاية القضائية والفترة." }, requiredPermission: "finance.tax.view", async: false, specRef: "§19.3" },
  { id: "expense-summary", category: "financial", name: { en: "Expense Summary", ar: "ملخص المصروفات" }, description: { en: "By category, branch and period.", ar: "حسب الفئة والفرع والفترة." }, requiredPermission: "finance.expense.view", async: false, specRef: "§19.3" },
  { id: "branch-pl", category: "financial", name: { en: "Branch P&L", ar: "أرباح وخسائر الفرع" }, description: { en: "Down to branch operating profit.", ar: "وصولًا إلى الربح التشغيلي للفرع." }, requiredPermission: "report.view.financial", async: true, specRef: "FR-CST-035" },
  { id: "prime-cost", category: "financial", name: { en: "Prime Cost", ar: "التكلفة الأولية" }, description: { en: "COGS plus labour against net sales.", ar: "تكلفة البضاعة زائد العمالة مقابل صافي المبيعات." }, requiredPermission: "report.view.financial", async: false, specRef: "FR-CST-031" },

  // Workforce
  { id: "attendance", category: "workforce", name: { en: "Attendance", ar: "الحضور" }, description: { en: "Scheduled versus actual, lateness and absence.", ar: "المجدول مقابل الفعلي والتأخير والغياب." }, requiredPermission: "report.view.workforce", async: false, specRef: "§19.3" },
  { id: "overtime", category: "workforce", name: { en: "Overtime", ar: "العمل الإضافي" }, description: { en: "Approved versus unapproved.", ar: "المعتمد مقابل غير المعتمد." }, requiredPermission: "report.view.workforce", async: false, specRef: "FR-HRM-034" },
  { id: "labour-cost", category: "workforce", name: { en: "Labour Cost", ar: "تكلفة العمالة" }, description: { en: "By branch, position and hour.", ar: "حسب الفرع والوظيفة والساعة." }, requiredPermission: "report.view.workforce", async: false, specRef: "FR-CST-030" },
  { id: "sales-per-labour-hour", category: "workforce", name: { en: "Sales per Labour Hour", ar: "المبيعات لكل ساعة عمل" }, description: { en: "Productivity against the demand curve.", ar: "الإنتاجية مقابل منحنى الطلب." }, requiredPermission: "report.view.workforce", async: false, specRef: "FR-CST-031" },
  { id: "employee-performance", category: "workforce", name: { en: "Employee Performance", ar: "أداء الموظفين" }, description: { en: "The composite scorecard per employee.", ar: "بطاقة الأداء المركبة لكل موظف." }, requiredPermission: "hr.performance.view", async: false, specRef: "FR-HRM-030" },

  // Governance
  { id: "audit-log", category: "governance", name: { en: "Audit Log", ar: "سجل التدقيق" }, description: { en: "Filterable full activity history, hash-chained.", ar: "سجل نشاط كامل قابل للتصفية ومسلسل بالتجزئة." }, requiredPermission: "audit.view", async: true, specRef: "FR-AUD-008" },
  { id: "approval-history", category: "governance", name: { en: "Approval History", ar: "سجل الاعتمادات" }, description: { en: "Requests, approvers and timings.", ar: "الطلبات والمعتمدون والتوقيتات." }, requiredPermission: "report.view.governance", async: false, specRef: "§19.3" },
  { id: "anomaly-flags", category: "governance", name: { en: "Anomaly Flags", ar: "إشارات الشذوذ" }, description: { en: "Every flag carries its evidence and baseline.", ar: "كل إشارة مصحوبة بأدلتها وخط أساسها." }, requiredPermission: "governance.view_anomalies", async: false, specRef: "FR-CST-042" },
  { id: "sod-conflicts", category: "governance", name: { en: "SoD Conflicts", ar: "تعارضات فصل المهام" }, description: { en: "Users whose effective permissions contain an incompatible pair.", ar: "المستخدمون الذين تحتوي صلاحياتهم الفعلية على زوج متعارض." }, requiredPermission: "security.role.manage", async: false, specRef: "FR-SEC-017" },
  { id: "config-change-log", category: "governance", name: { en: "Configuration Change Log", ar: "سجل تغييرات الإعدادات" }, description: { en: "Price, recipe, permission and setting changes.", ar: "تغييرات الأسعار والوصفات والصلاحيات والإعدادات." }, requiredPermission: "audit.view", async: false, specRef: "§19.3" },
];

void hoursAgo;
