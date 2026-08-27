/**
 * Localised labels and tones for the domain enumerations.
 *
 * Enum values travel as machine strings (`partially_refunded`); this module
 * is the one place they become words a person reads, and the one place a
 * status decides whether it looks neutral, good, or alarming.
 */

import type {
  AlertKind,
  AnomalyKind,
  ApprovalKind,
  ApprovalStatus,
  AttendanceFlag,
  CashSessionStatus,
  ConnectorStatus,
  CostingMethod,
  CountMode,
  CountStatus,
  DayCloseStatus,
  EmploymentType,
  ExpenseStatus,
  IntegrationCategory,
  InvoiceStatus,
  Localised,
  MatchResult,
  MenuClassification,
  ModifierKind,
  MovementType,
  OrderChannel,
  OrderLineState,
  OrderState,
  OrderType,
  PlanTier,
  PurchaseOrderStatus,
  ReceiptStatus,
  ReportCategory,
  RequisitionStatus,
  ScopeLevel,
  Severity,
  StationType,
  StorageRequirement,
  SyncState,
  TableState,
  TaxClassCode,
  TenantState,
  TenderType,
  TerminalStatus,
  TicketState,
  TicketUrgency,
  TransferStatus,
  WasteCategory,
} from "./types";

/** How a badge should read: neutral, positive, cautionary, or bad. */
export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "muted";

type Entry = { label: Localised; tone: Tone };

function e(en: string, ar: string, tone: Tone = "neutral"): Entry {
  return { label: { en, ar }, tone };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const ORDER_STATE: Record<OrderState, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  open: e("Open", "مفتوح", "accent"),
  held: e("Held", "معلّق", "warn"),
  parked: e("Parked", "مؤجَّل", "warn"),
  partially_paid: e("Partially paid", "مدفوع جزئيًا", "warn"),
  completed: e("Completed", "مكتمل", "good"),
  cancelled: e("Cancelled", "ملغى", "bad"),
  partially_refunded: e("Partially refunded", "مسترد جزئيًا", "bad"),
  refunded: e("Refunded", "مسترد", "bad"),
};

/**
 * FR-LOC-002 asks for Modern Standard Arabic rather than a dialect, which
 * rules out the terms a Cairo floor actually says out loud: "سفري" for
 * takeaway and "دليفري" for delivery are Egyptian colloquial, and a Saudi or
 * Emirati branch running the same tenant would not use them.
 *
 * "طلب خارجي" (an order taken away) and "استلام" (collected after ordering
 * ahead) are the pair that keeps takeaway and pickup distinguishable, which
 * matters because they route and report differently.
 */
export const ORDER_TYPE: Record<OrderType, Entry> = {
  dine_in: e("Dine-in", "تناول في المطعم"),
  takeaway: e("Takeaway", "طلب خارجي"),
  delivery: e("Delivery", "توصيل"),
  drive_thru: e("Drive-through", "خدمة السيارة"),
  pickup: e("Pickup", "استلام من الفرع"),
  aggregator: e("Aggregator", "منصة توصيل"),
};

export const ORDER_CHANNEL: Record<OrderChannel, Entry> = {
  pos: e("POS", "نقطة بيع"),
  kiosk: e("Kiosk", "كشك"),
  qr: e("QR", "رمز QR"),
  aggregator: e("Aggregator", "منصة توصيل"),
  phone: e("Phone", "هاتف"),
  api: e("API", "واجهة برمجية"),
};

export const ORDER_LINE_STATE: Record<OrderLineState, Entry> = {
  pending: e("Pending", "قيد الانتظار", "muted"),
  fired: e("Fired", "أُرسل", "accent"),
  preparing: e("Preparing", "قيد التحضير", "accent"),
  ready: e("Ready", "جاهز", "good"),
  served: e("Served", "قُدّم", "good"),
  voided: e("Voided", "ملغى", "bad"),
  // "ضيافة" carries the goodwill sense a comp has; "مجاني" only says free.
  comped: e("Comped", "ضيافة", "warn"),
};

export const SYNC_STATE: Record<SyncState, Entry> = {
  local: e("Local only", "محلي فقط", "warn"),
  pending: e("Pending sync", "بانتظار المزامنة", "warn"),
  synced: e("Synced", "متزامن", "good"),
  conflicted: e("Conflicted", "متعارض", "bad"),
};

export const TENDER_TYPE: Record<TenderType, Entry> = {
  cash: e("Cash", "نقدًا"),
  card: e("Card", "بطاقة"),
  wallet: e("Digital wallet", "محفظة رقمية"),
  gift_card: e("Gift card", "بطاقة هدية"),
  loyalty_points: e("Loyalty points", "نقاط الولاء"),
  store_credit: e("Store credit", "رصيد المتجر"),
  voucher: e("Voucher", "قسيمة"),
  bank_transfer: e("Bank transfer", "تحويل بنكي"),
  on_account: e("On account", "على الحساب"),
  aggregator_settled: e("Aggregator settled", "تسوية المنصة"),
};

export const TABLE_STATE: Record<TableState, Entry> = {
  available: e("Available", "متاحة", "good"),
  seated: e("Seated", "مشغولة", "accent"),
  ordered: e("Ordered", "طلبت", "accent"),
  food_served: e("Food served", "قُدّم الطعام", "accent"),
  bill_requested: e("Bill requested", "طلبت الحساب", "warn"),
  payment_in_progress: e("Payment in progress", "الدفع جارٍ", "warn"),
  needs_cleaning: e("Needs cleaning", "تحتاج تنظيفًا", "muted"),
};

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

export const TICKET_STATE: Record<TicketState, Entry> = {
  queued: e("Queued", "في الطابور", "muted"),
  started: e("Started", "بدأ", "accent"),
  ready: e("Ready", "جاهز", "good"),
  bumped: e("Bumped", "أُنهي", "good"),
  recalled: e("Recalled", "مُستعاد", "warn"),
  cancelled: e("Cancelled", "ملغي", "bad"),
};

export const TICKET_URGENCY: Record<TicketUrgency, Entry> = {
  on_target: e("On target", "ضمن المستهدف", "good"),
  approaching: e("Approaching", "يقترب", "warn"),
  exceeded: e("Exceeded", "تجاوز", "bad"),
  critical: e("Critically late", "متأخر بشدة", "bad"),
};

export const STATION_TYPE: Record<StationType, Entry> = {
  grill: e("Grill", "الشواية"),
  fryer: e("Fryer", "المقلاة"),
  cold: e("Cold line", "الخط البارد"),
  hot_line: e("Hot line", "الخط الساخن"),
  beverage: e("Beverage", "المشروبات"),
  barista: e("Barista", "الباريستا"),
  dessert: e("Dessert", "الحلويات"),
  bakery: e("Bakery", "المخبز"),
  shawarma: e("Shawarma", "الشاورما"),
  packaging: e("Packaging", "التغليف"),
  // The pass is the counter food is handed over at, not an act of passing.
  pass: e("Pass", "التسليم"),
};

export const TERMINAL_STATUS: Record<TerminalStatus, Entry> = {
  online: e("Online", "متصل", "good"),
  offline: e("Offline", "غير متصل", "bad"),
  degraded: e("Degraded", "متدهور", "warn"),
  revoked: e("Revoked", "ملغى التسجيل", "muted"),
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const TAX_CLASS: Record<TaxClassCode, Entry> = {
  standard: e("Standard", "قياسي"),
  reduced: e("Reduced", "مخفّض"),
  zero: e("Zero-rated", "نسبة صفرية"),
  exempt: e("Exempt", "معفى"),
};

export const MODIFIER_KIND: Record<ModifierKind, Entry> = {
  addition: e("Addition", "إضافة", "good"),
  removal: e("Removal", "إزالة", "warn"),
  substitution: e("Substitution", "استبدال", "accent"),
};

export const MENU_CLASSIFICATION: Record<MenuClassification, Entry> = {
  star: e("Star", "نجم", "good"),
  plough_horse: e("Plough-horse", "حصان الحرث", "accent"),
  puzzle: e("Puzzle", "لغز", "warn"),
  dog: e("Dog", "خاسر", "bad"),
};

export const MENU_CLASSIFICATION_ACTION: Record<MenuClassification, Localised> = {
  star: {
    en: "Protect: maintain quality and feature prominently.",
    ar: "احمِه: حافظ على الجودة وأبرزه في القائمة.",
  },
  plough_horse: {
    en: "Re-engineer: reduce cost, or raise price carefully.",
    ar: "أعد هندسته: خفّض التكلفة أو ارفع السعر بحذر.",
  },
  puzzle: {
    en: "Promote: reposition, rename, train the upsell.",
    ar: "روّج له: أعد تموضعه أو تسميته ودرّب على البيع الإضافي.",
  },
  dog: { en: "Remove or reinvent.", ar: "احذفه أو أعد ابتكاره." },
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const STOCK_STATUS: Record<
  "ok" | "low" | "critical" | "negative" | "overstocked",
  Entry
> = {
  ok: e("Healthy", "سليم", "good"),
  low: e("Low", "منخفض", "warn"),
  critical: e("Critical", "حرج", "bad"),
  negative: e("Negative", "سالب", "bad"),
  overstocked: e("Overstocked", "فائض", "warn"),
};

export const BATCH_STATUS: Record<"fresh" | "expiring" | "critical" | "expired", Entry> = {
  fresh: e("Fresh", "طازج", "good"),
  expiring: e("Expiring", "يقترب الانتهاء", "warn"),
  critical: e("Expires today", "ينتهي اليوم", "bad"),
  expired: e("Expired", "منتهي", "bad"),
};

export const MOVEMENT_TYPE: Record<MovementType, Entry> = {
  purchase_receipt: e("Purchase receipt", "استلام مشتريات", "good"),
  purchase_return: e("Purchase return", "مرتجع مشتريات", "warn"),
  sale_depletion: e("Sale depletion", "استهلاك بيع"),
  sale_reversal: e("Sale reversal", "عكس بيع", "warn"),
  transfer_out: e("Transfer out", "تحويل صادر"),
  transfer_in: e("Transfer in", "تحويل وارد"),
  production_input: e("Production input", "مدخل إنتاج"),
  production_output: e("Production output", "مخرج إنتاج", "good"),
  waste: e("Waste", "هدر", "bad"),
  count_adjustment: e("Count adjustment", "تسوية جرد", "warn"),
  manual_adjustment: e("Manual adjustment", "تسوية يدوية", "warn"),
  opening_balance: e("Opening balance", "رصيد افتتاحي", "muted"),
  expiry_writeoff: e("Expiry write-off", "إعدام لانتهاء الصلاحية", "bad"),
};

export const COUNT_STATUS: Record<CountStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  counting: e("Counting", "جارٍ العد", "accent"),
  submitted: e("Submitted", "مُرسل", "warn"),
  posted: e("Posted", "مُرحّل", "good"),
  cancelled: e("Cancelled", "ملغى", "bad"),
};

export const COUNT_MODE: Record<CountMode, Entry> = {
  blind: e("Blind", "أعمى", "good"),
  open: e("Open", "مفتوح", "warn"),
};

export const TRANSFER_STATUS: Record<TransferStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  requested: e("Requested", "مطلوب", "warn"),
  dispatched: e("Dispatched", "أُرسل", "accent"),
  in_transit: e("In transit", "في الطريق", "accent"),
  received: e("Received", "مستلم", "good"),
  discrepancy: e("Discrepancy", "فارق", "bad"),
  cancelled: e("Cancelled", "ملغى", "muted"),
};

export const WASTE_CATEGORY: Record<WasteCategory, Entry> = {
  storage: e("Storage", "التخزين", "warn"),
  supplier: e("Supplier", "المورد", "warn"),
  kitchen: e("Kitchen", "المطبخ", "warn"),
  service: e("Service", "الخدمة", "warn"),
  policy: e("Policy", "السياسة", "muted"),
  facility: e("Facility", "المرافق", "warn"),
  control: e("Control", "الرقابة", "bad"),
};

export const COSTING_METHOD: Record<CostingMethod, Entry> = {
  weighted_average: e("Weighted average", "المتوسط المرجح"),
  fifo: e("FIFO", "الوارد أولًا"),
  standard: e("Standard cost", "التكلفة المعيارية"),
};

export const STORAGE: Record<StorageRequirement, Entry> = {
  ambient: e("Ambient", "حرارة الغرفة"),
  chilled: e("Chilled", "مبرد"),
  frozen: e("Frozen", "مجمد"),
};

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

export const REQUISITION_STATUS: Record<RequisitionStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  submitted: e("Submitted", "مُرسل", "warn"),
  approved: e("Approved", "معتمد", "good"),
  consolidated: e("Consolidated", "مُجمّع", "accent"),
  rejected: e("Rejected", "مرفوض", "bad"),
  cancelled: e("Cancelled", "ملغى", "muted"),
};

export const PO_STATUS: Record<PurchaseOrderStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  pending_approval: e("Pending approval", "بانتظار الاعتماد", "warn"),
  approved: e("Approved", "معتمد", "good"),
  sent: e("Sent to supplier", "أُرسل للمورد", "accent"),
  partially_received: e("Partially received", "مستلم جزئيًا", "warn"),
  received: e("Received", "مستلم", "good"),
  cancelled: e("Cancelled", "ملغى", "muted"),
};

export const RECEIPT_STATUS: Record<ReceiptStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  posted: e("Posted", "مُرحّل", "good"),
  disputed: e("Disputed", "متنازع عليه", "bad"),
};

export const MATCH_RESULT: Record<MatchResult, Entry> = {
  matched: e("Matched", "مطابق", "good"),
  within_tolerance: e("Within tolerance", "ضمن التسامح", "good"),
  disputed: e("Disputed", "متنازع عليه", "bad"),
  unmatched: e("Unmatched", "غير مطابق", "warn"),
};

export const INVOICE_STATUS: Record<InvoiceStatus, Entry> = {
  recorded: e("Recorded", "مسجّلة", "muted"),
  matched: e("Matched", "مطابقة", "accent"),
  disputed: e("Disputed", "متنازع عليها", "bad"),
  approved_for_payment: e("Approved for payment", "معتمدة للدفع", "good"),
  paid: e("Paid", "مدفوعة", "good"),
};

// ---------------------------------------------------------------------------
// Workforce and finance
// ---------------------------------------------------------------------------

export const EMPLOYMENT_TYPE: Record<EmploymentType, Entry> = {
  full_time: e("Full-time", "دوام كامل"),
  part_time: e("Part-time", "دوام جزئي"),
  casual: e("Casual", "مؤقت"),
  contractor: e("Contractor", "متعاقد"),
  trainee: e("Trainee", "متدرب"),
};

export const EMPLOYEE_STATUS: Record<string, Entry> = {
  active: e("Active", "نشط", "good"),
  on_leave: e("On leave", "في إجازة", "warn"),
  suspended: e("Suspended", "موقوف", "bad"),
  terminated: e("Terminated", "منتهي الخدمة", "muted"),
};

export const ATTENDANCE_FLAG: Record<AttendanceFlag, Entry> = {
  late_arrival: e("Late arrival", "وصول متأخر", "warn"),
  early_departure: e("Early departure", "مغادرة مبكرة", "warn"),
  missing_clock_out: e("Missing clock-out", "خروج غير مسجّل", "bad"),
  outside_geofence: e("Outside geofence", "خارج النطاق الجغرافي", "bad"),
  no_scheduled_shift: e("No scheduled shift", "بلا وردية مجدولة", "warn"),
  auto_closed: e("Auto-closed", "أُغلق تلقائيًا", "warn"),
};

export const CASH_SESSION_STATUS: Record<CashSessionStatus, Entry> = {
  open: e("Open", "مفتوحة", "accent"),
  closing: e("Closing", "قيد الإغلاق", "warn"),
  closed: e("Closed", "مغلقة", "good"),
  force_closed: e("Force-closed", "أُغلقت قسرًا", "warn"),
};

export const EXPENSE_STATUS: Record<ExpenseStatus, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  pending_approval: e("Pending approval", "بانتظار الاعتماد", "warn"),
  approved: e("Approved", "معتمد", "good"),
  rejected: e("Rejected", "مرفوض", "bad"),
  posted: e("Posted", "مُرحّل", "good"),
};

export const DAY_CLOSE_STATUS: Record<DayCloseStatus, Entry> = {
  open: e("Open", "مفتوح", "accent"),
  blocked: e("Blocked", "محظور", "warn"),
  closed: e("Closed", "مغلق", "good"),
};

export const APPROVAL_STATE: Record<string, Entry> = {
  not_required: e("Not required", "غير مطلوب", "muted"),
  pending: e("Pending", "قيد الانتظار", "warn"),
  approved: e("Approved", "معتمد", "good"),
  rejected: e("Rejected", "مرفوض", "bad"),
};

// ---------------------------------------------------------------------------
// Governance and platform
// ---------------------------------------------------------------------------

export const APPROVAL_KIND: Record<ApprovalKind, Entry> = {
  discount: e("Discount", "خصم"),
  refund: e("Refund", "استرداد"),
  purchase_order: e("Purchase order", "أمر شراء"),
  waste: e("Waste", "هدر"),
  count_adjustment: e("Count adjustment", "تسوية جرد"),
  expense: e("Expense", "مصروف"),
  price_change: e("Price change", "تغيير سعر"),
  overtime: e("Overtime", "عمل إضافي"),
  stock_adjustment: e("Stock adjustment", "تسوية مخزون"),
};

export const APPROVAL_STATUS: Record<ApprovalStatus, Entry> = {
  pending: e("Pending", "قيد الانتظار", "warn"),
  approved: e("Approved", "معتمد", "good"),
  rejected: e("Rejected", "مرفوض", "bad"),
  expired: e("Expired", "منتهٍ", "muted"),
  escalated: e("Escalated", "مُصعّد", "warn"),
};

export const ANOMALY_KIND: Record<AnomalyKind, Entry> = {
  excessive_voids: e("Excessive voids", "إلغاءات مفرطة", "warn"),
  post_payment_void: e("Post-payment void", "إلغاء بعد الدفع", "bad"),
  refund_concentration: e("Refund concentration", "تركّز المرتجعات", "warn"),
  discount_concentration: e("Discount concentration", "تركّز الخصومات", "warn"),
  no_sale_drawer_opens: e("No-sale drawer opens", "فتح الدرج بلا بيع", "warn"),
  cash_variance_pattern: e("Cash variance pattern", "نمط فروقات نقدية", "bad"),
  waste_concentration: e("Waste concentration", "تركّز الهدر", "warn"),
  count_adjustment_pattern: e("Count adjustment pattern", "نمط تسويات الجرد", "warn"),
  price_override_frequency: e("Price override frequency", "تكرار تجاوز السعر", "warn"),
  outside_trading_hours: e("Outside trading hours", "خارج ساعات العمل", "bad"),
};

export const SEVERITY: Record<Severity, Entry> = {
  info: e("Info", "معلومة", "muted"),
  low: e("Low", "منخفضة", "muted"),
  medium: e("Medium", "متوسطة", "warn"),
  high: e("High", "عالية", "bad"),
  critical: e("Critical", "حرجة", "bad"),
};

export const ALERT_KIND: Record<AlertKind, Entry> = {
  cash_variance: e("Cash variance", "فرق نقدي", "bad"),
  discount_threshold: e("Discount threshold", "حد الخصم", "warn"),
  void_after_payment: e("Void after payment", "إلغاء بعد الدفع", "bad"),
  stock_zero: e("Stock at zero", "نفاد المخزون", "bad"),
  expiry: e("Expiry", "الصلاحية", "warn"),
  order_delayed: e("Order delayed", "طلب متأخر", "warn"),
  sales_below_forecast: e("Below forecast", "دون التوقع", "warn"),
  terminal_offline: e("Terminal offline", "جهاز غير متصل", "bad"),
  sync_backlog: e("Sync backlog", "تراكم المزامنة", "warn"),
  fiscal_submission_failed: e("Fiscal submission failed", "فشل الإرسال الضريبي", "bad"),
  document_expiring: e("Document expiring", "وثيقة على وشك الانتهاء", "warn"),
  negative_stock: e("Negative stock", "مخزون سالب", "warn"),
};

export const CONNECTOR_STATUS: Record<ConnectorStatus, Entry> = {
  healthy: e("Healthy", "سليم", "good"),
  degraded: e("Degraded", "متدهور", "warn"),
  failing: e("Failing", "فاشل", "bad"),
  disabled: e("Disabled", "معطّل", "muted"),
  not_configured: e("Not configured", "غير مضبوط", "muted"),
};

export const INTEGRATION_CATEGORY: Record<IntegrationCategory, Entry> = {
  payment: e("Payments", "المدفوعات"),
  aggregator: e("Aggregators", "منصات التوصيل"),
  accounting: e("Accounting", "المحاسبة"),
  notification: e("Notifications", "الإشعارات"),
  identity: e("Identity", "الهوية"),
  hardware: e("Hardware", "الأجهزة"),
};

export const REPORT_CATEGORY: Record<ReportCategory, Entry> = {
  sales: e("Sales", "المبيعات"),
  inventory: e("Inventory", "المخزون"),
  kitchen: e("Kitchen", "المطبخ"),
  financial: e("Financial", "المالية"),
  workforce: e("Workforce", "القوى العاملة"),
  governance: e("Governance", "الحوكمة"),
};

export const TENANT_STATE: Record<TenantState, Entry> = {
  provisioning: e("Provisioning", "قيد التهيئة", "muted"),
  trial: e("Trial", "تجريبي", "accent"),
  active: e("Active", "نشط", "good"),
  past_due: e("Past due", "متأخر السداد", "warn"),
  restricted: e("Restricted", "مقيّد", "warn"),
  suspended: e("Suspended", "موقوف", "bad"),
  terminating: e("Terminating", "قيد الإنهاء", "bad"),
};

export const PLAN_TIER: Record<PlanTier, Entry> = {
  starter: e("Starter", "الأساسية"),
  professional: e("Professional", "الاحترافية", "accent"),
  enterprise: e("Enterprise", "المؤسسية", "good"),
};

export const SCOPE_LEVEL: Record<ScopeLevel, Entry> = {
  tenant: e("Tenant-wide", "على مستوى المستأجر"),
  brand: e("Brand", "علامة"),
  branch_set: e("Branch set", "مجموعة فروع"),
  branch: e("Single branch", "فرع واحد"),
};

export const COUNTRY_PACK_STATUS: Record<string, Entry> = {
  active: e("Active", "نشطة", "good"),
  scheduled: e("Scheduled", "مجدولة", "accent"),
  draft: e("Draft", "مسودة", "muted"),
  superseded: e("Superseded", "مستبدلة", "muted"),
};

export const USER_STATUS: Record<string, Entry> = {
  active: e("Active", "نشط", "good"),
  invited: e("Invited", "مدعو", "warn"),
  suspended: e("Suspended", "موقوف", "bad"),
};

export const ATTENDANCE_METHOD: Record<string, Entry> = {
  pin: e("Terminal PIN", "رمز الجهاز"),
  mobile: e("Mobile app", "تطبيق الجوال"),
  biometric: e("Biometric", "بصمة"),
  manual: e("Manual entry", "إدخال يدوي", "warn"),
};

export const SHIFT_STATUS: Record<string, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  published: e("Published", "منشورة", "accent"),
  acknowledged: e("Acknowledged", "مُقرّة", "good"),
  completed: e("Completed", "مكتملة", "good"),
};

export const PAYMENT_METHOD: Record<string, Entry> = {
  petty_cash: e("Petty cash", "نثرية"),
  bank_transfer: e("Bank transfer", "تحويل بنكي"),
  card: e("Card", "بطاقة"),
  on_account: e("On account", "على الحساب"),
};

export const RECIPE_STATUS: Record<string, Entry> = {
  draft: e("Draft", "مسودة", "muted"),
  published: e("Published", "منشورة", "good"),
  superseded: e("Superseded", "مستبدلة", "muted"),
  archived: e("Archived", "مؤرشفة", "muted"),
};

export const RECIPE_TYPE: Record<string, Entry> = {
  menu_item: e("Menu item", "صنف قائمة"),
  sub_recipe: e("Sub-recipe", "وصفة فرعية", "accent"),
  production_item: e("Production item", "صنف إنتاج"),
};

export const LOCATION_KIND: Record<string, Entry> = {
  branch: e("Branch", "فرع"),
  warehouse: e("Warehouse", "مستودع", "accent"),
  central_kitchen: e("Central kitchen", "مطبخ مركزي", "accent"),
};

export const COMBO_STRATEGY: Record<string, Entry> = {
  fixed: e("Fixed price", "سعر ثابت"),
  sum_minus_discount: e("Sum minus discount", "المجموع ناقص خصم"),
  component_override: e("Component override", "تجاوز سعر المكوّن"),
};

export const PRICE_LIST_SCOPE: Record<string, Entry> = {
  tenant: e("Tenant", "المستأجر"),
  brand: e("Brand", "العلامة"),
  branch: e("Branch", "الفرع"),
};

export const AGEING_BUCKET: Record<string, Entry> = {
  current: e("Current", "جارية", "good"),
  "30": e("30 days", "٣٠ يومًا", "warn"),
  "60": e("60 days", "٦٠ يومًا", "warn"),
  "90+": e("90+ days", "٩٠+ يومًا", "bad"),
};

export const ACTOR_TYPE: Record<string, Entry> = {
  user: e("User", "مستخدم"),
  system: e("System", "النظام", "muted"),
  device: e("Device", "جهاز"),
  integration: e("Integration", "تكامل", "accent"),
};

/** Safe lookup — an unmapped value renders as itself rather than crashing. */
export function labelOf(
  map: Record<string, Entry>,
  key: string | null | undefined,
): Entry {
  if (!key) return e("—", "—", "muted");
  return map[key] ?? e(key.replace(/_/g, " "), key.replace(/_/g, " "), "neutral");
}
