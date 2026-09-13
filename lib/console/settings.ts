/**
 * The configuration cascade — SRS §6.4, FR-PLT-025 … FR-PLT-028.
 *
 *   Platform default → Country pack → Tenant → Brand → Branch → Terminal
 *
 * A value set at a lower level overrides a higher one, unless a higher level
 * marked it locked (FR-PLT-026). This module is the resolver and the
 * catalogue of settings it resolves; it is pure on purpose. The inspector,
 * the editor, the day-close and the idle-timeout all ask it the same
 * question, and a resolver duplicated per screen is exactly how "why is the
 * service charge different at this branch?" becomes unanswerable.
 *
 * ## Financial settings are versions, not values (FR-PLT-028)
 *
 * Tax class, rounding and service charge change what a receipt *means*. So
 * at any level they are held as a list of versions, each with the date it
 * takes effect, and resolution always happens *as at* a moment. A sale from
 * last March is re-read with March's rounding, not today's — otherwise
 * every change to a financial setting silently rewrites the books.
 *
 * Non-financial settings keep one current value per level; changing an
 * autofire flag does not need a history to be interpreted correctly.
 */

import type { CountryCode, CountryPack, Id, IsoDate, IsoDateTime, Localised } from "./types";

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export type SettingLevel = "platform" | "country" | "tenant" | "brand" | "branch" | "terminal";

/** Highest precedence last — the order resolution walks in. */
export const SETTING_LEVELS: SettingLevel[] = [
  "platform",
  "country",
  "tenant",
  "brand",
  "branch",
  "terminal",
];

/** The levels a tenant user may write to. Platform and country are read-only here. */
export const WRITABLE_LEVELS: SettingLevel[] = ["tenant", "brand", "branch", "terminal"];

export const LEVEL_LABEL: Record<SettingLevel, Localised> = {
  platform: { en: "Platform default", ar: "افتراضي المنصة" },
  country: { en: "Country pack", ar: "حزمة الدولة" },
  tenant: { en: "Tenant", ar: "المستأجر" },
  brand: { en: "Brand", ar: "العلامة" },
  branch: { en: "Branch", ar: "الفرع" },
  terminal: { en: "Terminal", ar: "الجهاز" },
};

export function levelIndex(level: SettingLevel): number {
  return SETTING_LEVELS.indexOf(level);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export type SettingValue = boolean | number | string;

export type SettingKind = "boolean" | "integer" | "percent" | "money" | "minutes" | "enum";

export type SettingGroup = "pos" | "kitchen" | "financial" | "cash" | "inventory" | "security" | "localisation";

export const SETTING_GROUPS: { id: SettingGroup; label: Localised }[] = [
  { id: "pos", label: { en: "Point of sale", ar: "نقطة البيع" } },
  { id: "kitchen", label: { en: "Kitchen display", ar: "شاشة المطبخ" } },
  { id: "financial", label: { en: "Tax, pricing and charges", ar: "الضريبة والتسعير والرسوم" } },
  { id: "cash", label: { en: "Cash handling", ar: "إدارة النقد" } },
  { id: "inventory", label: { en: "Inventory", ar: "المخزون" } },
  { id: "security", label: { en: "Security and sessions", ar: "الأمان والجلسات" } },
  { id: "localisation", label: { en: "Language and format", ar: "اللغة والتنسيق" } },
];

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  label: Localised;
  hint: Localised;
  spec: string;
  /** FR-PLT-028 — versioned with effective dates. */
  financial: boolean;
  platformDefault: SettingValue;
  /** The lowest level it can meaningfully differ at. Tax is not per-terminal. */
  lowestLevel: SettingLevel;
  options?: { value: string; label: Localised }[];
  min?: number;
  max?: number;
  /** What the country pack supplies, when it supplies anything. */
  fromCountry?: (pack: CountryPack) => SettingValue | undefined;
}

const d = (definition: SettingDefinition) => definition;

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // -- Point of sale ---------------------------------------------------------
  d({
    key: "pos.autoFire",
    group: "pos",
    kind: "boolean",
    label: { en: "Fire to the kitchen on line entry", ar: "إرسال الصنف للمطبخ فور إدخاله" },
    hint: {
      en: "Fast-casual mode. Off is table service, where the waiter fires each course.",
      ar: "وضع الخدمة السريعة. الإيقاف يعني خدمة الطاولات حيث يرسل النادل كل طبق.",
    },
    spec: "FR-POS-035",
    financial: false,
    platformDefault: false,
    lowestLevel: "terminal",
  }),
  d({
    key: "pos.requireTable",
    group: "pos",
    kind: "boolean",
    label: { en: "Require a table before firing dine-in", ar: "اشتراط طاولة قبل إرسال طلب الصالة" },
    hint: {
      en: "A dine-in order cannot reach the kitchen without somewhere to take it.",
      ar: "لا يصل طلب الصالة إلى المطبخ دون تحديد مكان تقديمه.",
    },
    spec: "FR-POS-080",
    financial: false,
    platformDefault: true,
    lowestLevel: "branch",
  }),
  d({
    key: "pos.discountApprovalPercent",
    group: "pos",
    kind: "percent",
    label: { en: "Discount allowed without approval", ar: "الخصم المسموح دون اعتماد" },
    hint: {
      en: "Above this share of the order a manager must approve with a PIN.",
      ar: "فوق هذه النسبة من الطلب يلزم اعتماد مدير برمز PIN.",
    },
    spec: "FR-POS-047",
    financial: false,
    platformDefault: 10,
    lowestLevel: "branch",
    min: 0,
    max: 100,
  }),
  d({
    key: "pos.receiptLanguages",
    group: "pos",
    kind: "enum",
    label: { en: "Receipt languages", ar: "لغات الإيصال" },
    hint: {
      en: "Which languages the printed receipt carries, and which comes first.",
      ar: "اللغات التي يحملها الإيصال المطبوع وأيّها أولًا.",
    },
    spec: "FR-POS-102",
    financial: false,
    platformDefault: "ar_en",
    lowestLevel: "terminal",
    options: [
      { value: "ar_en", label: { en: "Arabic, then English", ar: "العربية ثم الإنجليزية" } },
      { value: "en_ar", label: { en: "English, then Arabic", ar: "الإنجليزية ثم العربية" } },
      { value: "ar", label: { en: "Arabic only", ar: "العربية فقط" } },
      { value: "en", label: { en: "English only", ar: "الإنجليزية فقط" } },
    ],
  }),
  d({
    key: "pos.lockAfterMinutes",
    group: "pos",
    kind: "minutes",
    label: { en: "Lock the till after inactivity", ar: "قفل الطرفية بعد الخمول" },
    hint: {
      en: "The next person to touch the screen signs on with their own PIN.",
      ar: "الشخص التالي الذي يلمس الشاشة يسجّل الدخول برمزه الخاص.",
    },
    spec: "FR-SEC-022",
    financial: false,
    platformDefault: 2,
    lowestLevel: "terminal",
    min: 1,
    max: 60,
  }),

  // -- Kitchen ---------------------------------------------------------------
  d({
    key: "kds.ticketTargetMinutes",
    group: "kitchen",
    kind: "minutes",
    label: { en: "Ticket target time", ar: "الزمن المستهدف للتذكرة" },
    hint: {
      en: "When a ticket turns amber. It turns red at one and a half times this.",
      ar: "متى تتحول التذكرة إلى اللون الكهرماني، وتصبح حمراء عند مرة ونصف منه.",
    },
    spec: "FR-KDS-020",
    financial: false,
    platformDefault: 12,
    lowestLevel: "branch",
    min: 1,
    max: 120,
  }),
  d({
    key: "kds.staggeredRelease",
    group: "kitchen",
    kind: "boolean",
    label: { en: "Prep-time-aware staggered release", ar: "إطلاق متدرّج حسب زمن التحضير" },
    hint: {
      en: "Hold the salad back so it does not wilt while the steak cooks.",
      ar: "تأخير السلطة كي لا تذبل بينما تُطهى شريحة اللحم.",
    },
    spec: "FR-KDS-012",
    financial: false,
    platformDefault: false,
    lowestLevel: "branch",
  }),
  d({
    key: "kds.bumpConfirm",
    group: "kitchen",
    kind: "boolean",
    label: { en: "Require a deliberate interaction to bump", ar: "اشتراط تفاعل مقصود لإنهاء التذكرة" },
    hint: {
      en: "A long press rather than a tap, so a greasy sleeve does not clear a ticket.",
      ar: "ضغطة مطوّلة بدل النقرة، كي لا يُنهي كمٌّ دهني تذكرة بالخطأ.",
    },
    spec: "FR-KDS-031",
    financial: false,
    platformDefault: true,
    lowestLevel: "terminal",
  }),

  // -- Financial (versioned) -------------------------------------------------
  d({
    key: "fin.pricingMode",
    group: "financial",
    kind: "enum",
    label: { en: "Price display", ar: "طريقة عرض السعر" },
    hint: {
      en: "Whether shelf prices include tax. Set by the country pack in most markets.",
      ar: "هل تشمل الأسعار المعروضة الضريبة. تحدده حزمة الدولة في أغلب الأسواق.",
    },
    spec: "FR-TAX-003",
    financial: true,
    platformDefault: "tax_inclusive",
    lowestLevel: "branch",
    options: [
      { value: "tax_inclusive", label: { en: "Tax inclusive", ar: "شامل الضريبة" } },
      { value: "tax_exclusive", label: { en: "Tax exclusive", ar: "غير شامل الضريبة" } },
    ],
    fromCountry: (pack) => pack.pricingMode,
  }),
  d({
    key: "fin.roundingMode",
    group: "financial",
    kind: "enum",
    label: { en: "Rounding policy", ar: "سياسة التقريب" },
    hint: {
      en: "How a computed tax or charge is rounded to the currency's smallest unit.",
      ar: "كيفية تقريب الضريبة أو الرسم المحسوب إلى أصغر وحدة للعملة.",
    },
    spec: "FR-TAX-010",
    financial: true,
    platformDefault: "HALF_UP",
    lowestLevel: "branch",
    options: [
      { value: "HALF_UP", label: { en: "Half up", ar: "نصف لأعلى" } },
      { value: "HALF_EVEN", label: { en: "Half even (banker's)", ar: "نصف زوجي (مصرفي)" } },
      { value: "DOWN", label: { en: "Always down", ar: "لأسفل دائمًا" } },
    ],
    fromCountry: (pack) => pack.roundingMode,
  }),
  d({
    key: "fin.defaultTaxClass",
    group: "financial",
    kind: "enum",
    label: { en: "Default tax class for new items", ar: "فئة الضريبة الافتراضية للأصناف الجديدة" },
    hint: {
      en: "Applied when an item is created without one. Each item can still carry its own.",
      ar: "تُطبّق عند إنشاء صنف دون فئة. يبقى لكل صنف أن يحمل فئته.",
    },
    spec: "FR-TAX-002",
    financial: true,
    platformDefault: "standard",
    lowestLevel: "brand",
    options: [
      { value: "standard", label: { en: "Standard", ar: "قياسي" } },
      { value: "reduced", label: { en: "Reduced", ar: "مخفّض" } },
      { value: "zero", label: { en: "Zero-rated", ar: "نسبة صفرية" } },
      { value: "exempt", label: { en: "Exempt", ar: "معفى" } },
    ],
    fromCountry: (pack) =>
      pack.taxClasses.some((row) => row.code === "standard")
        ? "standard"
        : (pack.taxClasses[0]?.code ?? undefined),
  }),
  d({
    key: "fin.serviceChargePercent",
    group: "financial",
    kind: "percent",
    label: { en: "Service charge", ar: "رسوم الخدمة" },
    hint: {
      en: "Percentage added to dine-in orders. Zero switches it off.",
      ar: "نسبة تُضاف إلى طلبات الصالة. الصفر يوقفها.",
    },
    spec: "FR-POS-055",
    financial: true,
    platformDefault: 0,
    lowestLevel: "branch",
    min: 0,
    max: 30,
  }),
  d({
    key: "fin.serviceChargeTaxable",
    group: "financial",
    kind: "boolean",
    label: { en: "Service charge is taxable", ar: "رسوم الخدمة خاضعة للضريبة" },
    hint: {
      en: "Whether tax is computed on the service charge as well as the food.",
      ar: "هل تُحسب الضريبة على رسوم الخدمة كما على الطعام.",
    },
    spec: "FR-POS-058",
    financial: true,
    platformDefault: true,
    lowestLevel: "branch",
  }),

  // -- Cash ------------------------------------------------------------------
  d({
    key: "cash.blindCount",
    group: "cash",
    kind: "boolean",
    label: { en: "Blind cash count at shift close", ar: "عدّ نقدي أعمى عند إغلاق الوردية" },
    hint: {
      en: "A cashier who can see the expected figure can count it instead of the cash.",
      ar: "أمين الصندوق الذي يرى المبلغ المتوقع قد يعدّه بدل النقد.",
    },
    spec: "FR-POS-095",
    financial: false,
    platformDefault: true,
    lowestLevel: "branch",
  }),
  d({
    key: "cash.varianceTolerance",
    group: "cash",
    kind: "money",
    label: { en: "Cash variance tolerance", ar: "حد الفرق النقدي المسموح" },
    hint: {
      en: "A close within this amount needs no manager. Beyond it, it does.",
      ar: "الإغلاق ضمن هذا المبلغ لا يحتاج مديرًا، وما زاد يحتاج.",
    },
    spec: "FR-POS-096",
    financial: false,
    platformDefault: 2_000,
    lowestLevel: "branch",
    min: 0,
  }),
  d({
    key: "cash.drawerLimit",
    group: "cash",
    kind: "money",
    label: { en: "Drawer cash limit", ar: "حد النقد في الدرج" },
    hint: {
      en: "Above this the till prompts for a safe drop.",
      ar: "فوق هذا المبلغ تطلب الطرفية إيداعًا في الخزنة.",
    },
    spec: "FR-POS-092",
    financial: false,
    platformDefault: 500_000,
    lowestLevel: "terminal",
    min: 0,
  }),

  // -- Inventory -------------------------------------------------------------
  d({
    key: "inv.blindStockCount",
    group: "inventory",
    kind: "boolean",
    label: { en: "Blind stock count by default", ar: "جرد أعمى افتراضيًا" },
    hint: {
      en: "Counters see the item, never the expected quantity.",
      ar: "يرى القائم بالجرد الصنف دون الكمية المتوقعة.",
    },
    spec: "FR-INV-044",
    financial: false,
    platformDefault: true,
    lowestLevel: "branch",
  }),
  d({
    key: "inv.countVariancePercent",
    group: "inventory",
    kind: "percent",
    label: { en: "Count variance needing a recount", ar: "فرق الجرد الذي يستوجب إعادة العدّ" },
    hint: {
      en: "A line off by more than this is sent back for a second count before posting.",
      ar: "السطر الذي يتجاوز فرقه هذه النسبة يُعاد عدّه قبل الترحيل.",
    },
    spec: "FR-INV-046",
    financial: false,
    platformDefault: 5,
    lowestLevel: "branch",
    min: 0,
    max: 100,
  }),
  d({
    key: "inv.countVarianceValue",
    group: "inventory",
    kind: "money",
    label: { en: "Count variance value needing a recount", ar: "قيمة فرق الجرد التي تستوجب إعادة العدّ" },
    hint: {
      en: "A line whose variance is worth more than this also needs a recount or an explanation.",
      ar: "السطر الذي تتجاوز قيمة فرقه هذا المبلغ يحتاج أيضًا إعادة عدّ أو تفسيرًا.",
    },
    spec: "FR-INV-046",
    financial: false,
    platformDefault: 20_000,
    lowestLevel: "branch",
    min: 0,
  }),
  d({
    key: "inv.wasteApprovalThreshold",
    group: "inventory",
    kind: "money",
    label: { en: "Waste approval threshold", ar: "حد اعتماد الهدر" },
    hint: {
      en: "A single waste entry worth more than this needs a manager.",
      ar: "قيد الهدر الواحد الذي تتجاوز قيمته هذا المبلغ يحتاج مديرًا.",
    },
    spec: "FR-INV-058",
    financial: false,
    platformDefault: 50_000,
    lowestLevel: "branch",
    min: 0,
  }),

  // -- Security --------------------------------------------------------------
  d({
    key: "sec.consoleIdleMinutes",
    group: "security",
    kind: "minutes",
    label: { en: "Console idle timeout", ar: "مهلة خمول لوحة التحكم" },
    hint: {
      en: "After this long without activity the console asks for the password again.",
      ar: "بعد هذه المدة دون نشاط تطلب لوحة التحكم كلمة المرور مجددًا.",
    },
    spec: "FR-SEC-026",
    financial: false,
    // FR-SEC-026 — "default … 60 minutes on dashboard".
    platformDefault: 60,
    lowestLevel: "tenant",
    min: 2,
    max: 240,
  }),
  d({
    key: "sec.posIdleMinutes",
    group: "security",
    kind: "minutes",
    label: { en: "Till session idle timeout", ar: "مهلة خمول جلسة الطرفية" },
    hint: {
      en: "After this long untouched, the cashier is signed off the till. Their drawer stays open in their name.",
      ar: "بعد هذه المدة دون لمس يُسجَّل خروج أمين الصندوق من الطرفية، ويبقى درجه مفتوحًا باسمه.",
    },
    spec: "FR-SEC-026",
    financial: false,
    platformDefault: 15,
    lowestLevel: "terminal",
    min: 2,
    max: 240,
  }),
  d({
    key: "sec.kdsIdleMinutes",
    group: "security",
    kind: "minutes",
    label: { en: "Kitchen display session timeout", ar: "مهلة جلسة شاشة المطبخ" },
    hint: {
      en: "Kitchen screens run all service without being touched, so this is long by design.",
      ar: "شاشات المطبخ تعمل طوال الخدمة دون لمس، لذا المهلة طويلة عمدًا.",
    },
    spec: "FR-SEC-026",
    financial: false,
    platformDefault: 480,
    lowestLevel: "terminal",
    min: 30,
    max: 1440,
  }),
  d({
    key: "sync.clockSkewMinutes",
    group: "security",
    kind: "minutes",
    label: { en: "Device clock skew alert", ar: "تنبيه انحراف ساعة الجهاز" },
    hint: {
      en: "A device whose clock is this far from the server's is flagged on every sync. Its own timestamps are kept beside the corrected ones.",
      ar: "يُعلَّم الجهاز الذي تبتعد ساعته عن ساعة الخادم بهذا القدر عند كل مزامنة، وتُحفظ طوابعه الزمنية بجانب المصححة.",
    },
    spec: "FR-OFF-042",
    financial: false,
    platformDefault: 5,
    lowestLevel: "branch",
    min: 1,
    max: 120,
  }),
  d({
    key: "sec.mfaForManagers",
    group: "security",
    kind: "boolean",
    label: { en: "Require MFA for every manager role", ar: "اشتراط المصادقة الثنائية لكل أدوار الإدارة" },
    hint: {
      en: "Beyond the roles the platform already forces it on.",
      ar: "إضافةً إلى الأدوار التي تفرضها المنصة أصلًا.",
    },
    spec: "FR-SEC-024",
    financial: false,
    platformDefault: false,
    lowestLevel: "tenant",
  }),

  // -- Localisation ----------------------------------------------------------
  d({
    key: "loc.defaultLanguage",
    group: "localisation",
    kind: "enum",
    label: { en: "Default language", ar: "اللغة الافتراضية" },
    hint: {
      en: "What a new user or a fresh terminal starts in. Each person can still choose.",
      ar: "اللغة التي يبدأ بها مستخدم جديد أو جهاز جديد، ولكل شخص أن يختار.",
    },
    spec: "FR-LOC-001",
    financial: false,
    platformDefault: "en",
    lowestLevel: "terminal",
    options: [
      { value: "ar", label: { en: "Arabic", ar: "العربية" } },
      { value: "en", label: { en: "English", ar: "الإنجليزية" } },
    ],
    fromCountry: () => "ar",
  }),
  d({
    key: "loc.arabicIndicNumerals",
    group: "localisation",
    kind: "boolean",
    label: { en: "Arabic-Indic numerals in Arabic", ar: "الأرقام الهندية في العربية" },
    hint: {
      en: "Show ١٢٣ rather than 123 when the interface is in Arabic.",
      ar: "عرض ١٢٣ بدل 123 عندما تكون الواجهة بالعربية.",
    },
    spec: "FR-LOC-005",
    financial: false,
    platformDefault: false,
    lowestLevel: "terminal",
  }),
];

export const SETTING_BY_KEY = new Map(SETTING_DEFINITIONS.map((row) => [row.key, row]));

/** True when a level may carry its own value for this setting. */
export function levelApplies(definition: SettingDefinition, level: SettingLevel): boolean {
  return levelIndex(level) <= levelIndex(definition.lowestLevel);
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export interface SettingOverride {
  id: Id;
  key: string;
  level: Exclude<SettingLevel, "platform" | "country">;
  /** The tenant, brand, branch or terminal id the value belongs to. */
  targetId: Id;
  /**
   * `null` is a financial version that hands the setting back to the level
   * above from its effective date. History cannot be deleted, so "stop
   * overriding" has to be a version of its own.
   */
  value: SettingValue | null;
  /** FR-PLT-026 — prevents every lower level from overriding. */
  locked: boolean;
  /**
   * FR-PLT-028 — when a financial version takes effect. Null for
   * non-financial settings, which have no history to interpret.
   */
  effectiveFrom: IsoDate | null;
  note: string | null;
  createdAt: IsoDateTime;
  createdBy: string | null;
}

/** Where a resolution is being asked from. Ids that do not apply are null. */
export interface SettingContext {
  countryCode: CountryCode | null;
  tenantId: Id;
  brandId: Id | null;
  branchId: Id | null;
  terminalId: Id | null;
}

export interface ResolvedLevel {
  level: SettingLevel;
  targetId: Id | null;
  /** What this level says, or undefined when it says nothing. */
  value: SettingValue | undefined;
  locked: boolean;
  override: SettingOverride | null;
  /** This level's value is the effective one. */
  supplies: boolean;
  /** A lock above this level made its own value irrelevant. */
  blockedBy: SettingLevel | null;
  /** The setting cannot differ at this level at all (e.g. tax per terminal). */
  notApplicable: boolean;
}

export interface ResolvedSetting {
  definition: SettingDefinition;
  value: SettingValue;
  suppliedBy: SettingLevel;
  lockedAt: SettingLevel | null;
  chain: ResolvedLevel[];
}

function targetFor(level: SettingLevel, context: SettingContext): Id | null {
  switch (level) {
    case "tenant":
      return context.tenantId;
    case "brand":
      return context.brandId;
    case "branch":
      return context.branchId;
    case "terminal":
      return context.terminalId;
    case "country":
      return context.countryCode;
    default:
      return null;
  }
}

/** Today as a calendar date, which is what effective dates are compared on. */
export function todayIso(now = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The override a level holds *as at* a date.
 *
 * Financial settings keep every version; the one in force is the latest
 * whose effective date is not after `asAt`. Anything else keeps a single
 * row, and the newest wins should a duplicate ever sneak in.
 */
export function overrideAt(
  overrides: SettingOverride[],
  key: string,
  level: SettingOverride["level"],
  targetId: Id,
  asAt: IsoDate,
): SettingOverride | null {
  const candidates = overrides.filter(
    (row) => row.key === key && row.level === level && row.targetId === targetId,
  );
  if (candidates.length === 0) return null;

  const definition = SETTING_BY_KEY.get(key);
  if (!definition?.financial) {
    return [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  const inForce = candidates
    .filter((row) => (row.effectiveFrom ?? "0000-01-01") <= asAt)
    .sort(
      (a, b) =>
        (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") ||
        b.createdAt.localeCompare(a.createdAt),
    );
  return inForce[0] ?? null;
}

/**
 * Resolve one setting for one context — FR-PLT-025, FR-PLT-026.
 *
 * Walks top-down. The first lock met freezes the value: every level below it
 * is reported as blocked, with the locking level named, rather than silently
 * ignored — "your branch override is not taking effect because the tenant
 * locked it" is the sentence the inspector exists to say.
 */
export function resolveSetting(
  definition: SettingDefinition,
  overrides: SettingOverride[],
  context: SettingContext,
  options: { packs?: CountryPack[]; asAt?: IsoDate } = {},
): ResolvedSetting {
  const asAt = options.asAt ?? todayIso();
  const pack = context.countryCode
    ? (options.packs ?? []).find((row) => row.code === context.countryCode)
    : undefined;

  let value: SettingValue = definition.platformDefault;
  let suppliedBy: SettingLevel = "platform";
  let lockedAt: SettingLevel | null = null;
  const chain: ResolvedLevel[] = [];

  for (const level of SETTING_LEVELS) {
    const targetId = targetFor(level, context);
    const notApplicable = !levelApplies(definition, level);

    let levelValue: SettingValue | undefined;
    let locked = false;
    let override: SettingOverride | null = null;

    if (level === "platform") {
      levelValue = definition.platformDefault;
    } else if (level === "country") {
      levelValue = pack && definition.fromCountry ? definition.fromCountry(pack) : undefined;
    } else if (targetId && !notApplicable) {
      override = overrideAt(overrides, definition.key, level, targetId, asAt);
      if (override && override.value !== null) {
        levelValue = override.value;
        locked = override.locked;
      }
    }

    const blockedBy = lockedAt;
    if (!blockedBy && levelValue !== undefined) {
      value = levelValue;
      suppliedBy = level;
      if (locked) lockedAt = level;
    }

    chain.push({
      level,
      targetId,
      value: levelValue,
      locked,
      override,
      supplies: false,
      blockedBy: levelValue !== undefined ? blockedBy : null,
      notApplicable,
    });
  }

  for (const entry of chain) entry.supplies = entry.level === suppliedBy;

  return { definition, value, suppliedBy, lockedAt, chain };
}

export function resolveAll(
  overrides: SettingOverride[],
  context: SettingContext,
  options: { packs?: CountryPack[]; asAt?: IsoDate } = {},
): ResolvedSetting[] {
  return SETTING_DEFINITIONS.map((definition) =>
    resolveSetting(definition, overrides, context, options),
  );
}

/**
 * The context a level/target pair edits against. Editing at brand level has
 * no branch or terminal in play; editing a terminal carries all of them.
 */
export function contextFor(
  level: SettingLevel,
  base: SettingContext,
): SettingContext {
  const at = levelIndex(level);
  return {
    countryCode: base.countryCode,
    tenantId: base.tenantId,
    brandId: at >= levelIndex("brand") ? base.brandId : null,
    branchId: at >= levelIndex("branch") ? base.branchId : null,
    terminalId: at >= levelIndex("terminal") ? base.terminalId : null,
  };
}

/** Plain-text rendering of a value — for the inspector, the history, an export. */
export function describeValue(
  definition: SettingDefinition,
  value: SettingValue | undefined,
  locale: "en" | "ar",
  formatMoneyMinor: (minor: number) => string,
): string {
  if (value === undefined) return "—";
  switch (definition.kind) {
    case "boolean":
      return value ? (locale === "ar" ? "مفعّل" : "On") : locale === "ar" ? "متوقف" : "Off";
    case "percent":
      return `${value}%`;
    case "money":
      return formatMoneyMinor(Number(value));
    case "minutes":
      return locale === "ar" ? `${value} دقيقة` : `${value} min`;
    case "enum": {
      const option = definition.options?.find((row) => row.value === value);
      return option ? option.label[locale] || option.label.en : String(value);
    }
    default:
      return String(value);
  }
}
