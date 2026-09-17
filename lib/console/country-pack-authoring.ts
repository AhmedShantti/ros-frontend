/**
 * Country pack versions, tax strategies, validation and distribution —
 * SRS ch.22: FR-LOC-021, FR-LOC-024, FR-LOC-025, FR-LOC-030.
 *
 * A country pack is data. What makes that claim safe is the machinery in
 * this file:
 *
 *   - **Versions with effective dates** (FR-LOC-021). A pack is never edited
 *     once certified; a change is a new version with its own `effectiveFrom`.
 *     `versionInForce` answers "which rules applied to this sale?" from the
 *     sale's business day, so last year's receipt is re-read under last
 *     year's pack.
 *   - **A registered set of tax strategies** (FR-LOC-025). A pack names one of
 *     `TAX_STRATEGIES` and supplies its parameters — rates, classes,
 *     rounding. It cannot carry code. A genuinely new tax model is a new
 *     entry in that registry, shipped with the product.
 *   - **Validation and a conformance suite** (FR-LOC-030). `validatePack`
 *     returns every problem with the field it concerns; `runConformance`
 *     runs golden cases against the chosen strategy and invariant checks
 *     against the pack's own rates. A pack that fails either cannot be
 *     certified.
 *   - **Distribution ahead of the effective date** (FR-LOC-024). A terminal
 *     picks up every certified pack for its country on sync and activates it
 *     locally by date; `distributionState` reads, from the terminal's last
 *     sync and the version's publication, whether a given device already
 *     holds it — and flags the ones that will cross the date without it.
 */

import type { Id, IsoDate, IsoDateTime, Localised } from "./types";

// ---------------------------------------------------------------------------
// Tax strategies — FR-LOC-025
// ---------------------------------------------------------------------------

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "DOWN";
export type PricingMode = "tax_inclusive" | "tax_exclusive";
export type ComputationLevel = "line" | "order";

export interface TaxInputLine {
  /** Minor units: gross when inclusive, net when exclusive. */
  amount: number;
  /** Percent, up to 3 decimals. Null = exempt. */
  rate: number | null;
}

export interface TaxComputation {
  /** Tax per component (e.g. VAT, levy), minor units. */
  components: { code: string; amount: number }[];
  total: number;
}

export interface TaxContext {
  pricingMode: PricingMode;
  rounding: RoundingMode;
  level: ComputationLevel;
  params: Record<string, number>;
}

export interface TaxStrategy {
  id: string;
  label: Localised;
  description: Localised;
  /** Parameters the pack must supply, with the range each may take. */
  params: { key: string; label: Localised; min: number; max: number }[];
  /** A fiscal provider must be named when this strategy is used. */
  requiresFiscalProvider: string[] | null;
  compute(lines: TaxInputLine[], context: TaxContext): TaxComputation;
}

/** round(numerator / denominator) under a rounding mode, BigInt-exact. */
export function roundDivide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  let result = quotient;
  if (mode === "HALF_UP") {
    if (remainder * 2n >= d) result += 1n;
  } else if (mode === "HALF_EVEN") {
    if (remainder * 2n > d || (remainder * 2n === d && quotient % 2n === 1n)) result += 1n;
  }
  return negative ? -result : result;
}

/** Rate percent with up to 3 dp, as an integer in thousandths of a percent. */
function rateMilli(rate: number): bigint {
  return BigInt(Math.round(rate * 1000));
}

/** Tax on one amount at one rate. */
function taxOn(amount: number, rate: number, mode: PricingMode, rounding: RoundingMode): number {
  const a = BigInt(amount);
  const r = rateMilli(rate);
  if (mode === "tax_exclusive") return Number(roundDivide(a * r, 100_000n, rounding));
  // Inclusive: round the net, and the tax is what is left — gross stays exact.
  const net = roundDivide(a * 100_000n, 100_000n + r, rounding);
  return Number(a - net);
}

function vatCompute(lines: TaxInputLine[], context: TaxContext, code = "vat"): TaxComputation {
  const taxable = lines.filter((line): line is { amount: number; rate: number } => line.rate !== null);
  let total = 0;
  if (context.level === "line") {
    total = taxable.reduce((sum, line) => sum + taxOn(line.amount, line.rate, context.pricingMode, context.rounding), 0);
  } else {
    const byRate = new Map<number, number>();
    for (const line of taxable) byRate.set(line.rate, (byRate.get(line.rate) ?? 0) + line.amount);
    for (const [rate, amount] of byRate) total += taxOn(amount, rate, context.pricingMode, context.rounding);
  }
  return { components: [{ code, amount: total }], total };
}

export const TAX_STRATEGIES: TaxStrategy[] = [
  {
    id: "vat_standard",
    label: { en: "VAT — single rate per class", ar: "ضريبة القيمة المضافة — نسبة لكل فئة" },
    description: {
      en: "Value-added tax at the tax class rate, inclusive or exclusive, per line or per order.",
      ar: "ضريبة القيمة المضافة بنسبة فئة الضريبة، شاملة أو غير شاملة، لكل سطر أو للطلب.",
    },
    params: [],
    requiresFiscalProvider: null,
    compute: (lines, context) => vatCompute(lines, context),
  },
  {
    id: "vat_zatca_phase2",
    label: { en: "VAT — ZATCA e-invoicing (phase 2)", ar: "ضريبة القيمة المضافة — الفوترة الإلكترونية (المرحلة الثانية)" },
    description: {
      en: "VAT computed as standard, with invoices cleared or reported through FATOORA. Requires the ZATCA fiscal provider.",
      ar: "تُحتسب الضريبة كالمعتاد مع اعتماد الفواتير أو الإبلاغ عنها عبر فاتورة. يتطلب مزوّد زاتكا.",
    },
    params: [],
    requiresFiscalProvider: ["zatca_fatoora"],
    compute: (lines, context) => vatCompute(lines, context),
  },
  {
    id: "vat_plus_levy",
    label: { en: "VAT plus a taxable levy", ar: "ضريبة القيمة المضافة مع رسم خاضع للضريبة" },
    description: {
      en: "A percentage levy (municipality or tourism fee) is added first, and VAT is charged on the amount including it.",
      ar: "يُضاف رسم بنسبة مئوية (بلدية أو سياحة) أولًا، ثم تُحتسب الضريبة على المبلغ شاملًا الرسم.",
    },
    params: [{ key: "levyPercent", label: { en: "Levy percent", ar: "نسبة الرسم" }, min: 0, max: 30 }],
    requiresFiscalProvider: null,
    compute: (lines, context) => {
      const levyRate = context.params.levyPercent ?? 0;
      // The levy is always computed on the net; VAT then on net + levy.
      const exclusive: TaxContext = { ...context, pricingMode: "tax_exclusive" };
      const nets = lines.map((line) => {
        if (context.pricingMode === "tax_exclusive" || line.rate === null) return line.amount;
        const combined = BigInt(Math.round((1 + levyRate / 100) * (1 + line.rate / 100) * 1_000_000));
        return Number(roundDivide(BigInt(line.amount) * 1_000_000n, combined, context.rounding));
      });
      const levy = vatCompute(nets.map((amount, index) => ({ amount, rate: lines[index]!.rate === null ? null : levyRate })), exclusive, "levy");
      const levyPerLine = nets.map((amount, index) =>
        lines[index]!.rate === null ? 0 : taxOn(amount, levyRate, "tax_exclusive", context.rounding),
      );
      const vat = vatCompute(
        nets.map((amount, index) => ({ amount: amount + levyPerLine[index]!, rate: lines[index]!.rate })),
        exclusive,
      );
      return { components: [...levy.components, ...vat.components], total: levy.total + vat.total };
    },
  },
  {
    id: "no_tax",
    label: { en: "No consumption tax", ar: "لا توجد ضريبة استهلاك" },
    description: {
      en: "For jurisdictions without a sales or value-added tax on restaurant sales. Every class must be zero or exempt.",
      ar: "للدول التي لا تفرض ضريبة مبيعات أو قيمة مضافة على المطاعم. يجب أن تكون كل الفئات صفرية أو معفاة.",
    },
    params: [],
    requiresFiscalProvider: null,
    compute: () => ({ components: [], total: 0 }),
  },
];

export const STRATEGY_BY_ID = new Map(TAX_STRATEGIES.map((row) => [row.id, row]));

// ---------------------------------------------------------------------------
// Pack versions — FR-LOC-021
// ---------------------------------------------------------------------------

export const TAX_CLASS_CODES = ["standard", "reduced", "zero", "exempt"] as const;
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** ISO 4217 minor-unit exponents for the currencies a pack in the region may use. */
export const ISO_EXPONENT: Record<string, number> = {
  EGP: 2,
  SAR: 2,
  AED: 2,
  QAR: 2,
  OMR: 3,
  BHD: 3,
  KWD: 3,
  JOD: 3,
  USD: 2,
  EUR: 2,
  TRY: 2,
  PKR: 2,
};

export type PackVersionStatus = "draft" | "certified" | "void";

export interface PackTaxClass {
  code: string;
  rate: number | null;
  label: Localised;
}

export interface CountryPackVersion {
  id: Id;
  code: string;
  name: Localised;
  version: string;
  effectiveFrom: IsoDate;
  currency: string;
  currencyExponent: number;
  taxEngine: string;
  taxParams: Record<string, number>;
  pricingMode: PricingMode;
  roundingMode: RoundingMode;
  computationLevel: ComputationLevel;
  taxClasses: PackTaxClass[];
  fiscalProvider: string | null;
  fiscalMode: string | null;
  weekStart: string;
  weekend: string[];
  standardWeeklyHours: number;
  overtimeMultiplier: number;
  dataRetentionYears: number;
  /** FR-LOC-010 — whether this jurisdiction offers Hijri date display. */
  hijriCalendar: boolean;
  status: PackVersionStatus;
  changeNote: string;
  /** SHA-256 of the canonical pack body, set at certification. */
  digest: string | null;
  conformance: ConformanceResult | null;
  certifiedAt: IsoDateTime | null;
  certifiedBy: string | null;
  /** When terminals could first download it — certification, in practice. */
  publishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  createdBy: string | null;
  /** True for rows seeded from the platform's shipped packs. */
  platform: boolean;
}

export type LifecycleState = "draft" | "scheduled" | "active" | "superseded" | "void";

/** Where a version sits today: certified versions are scheduled, active or superseded by date. */
export function lifecycle(version: CountryPackVersion, all: CountryPackVersion[], today: IsoDate): LifecycleState {
  if (version.status === "draft") return "draft";
  if (version.status === "void") return "void";
  if (version.effectiveFrom > today) return "scheduled";
  const current = versionInForce(all, version.code, today);
  return current?.id === version.id ? "active" : "superseded";
}

/**
 * FR-LOC-021 — the certified version in force for a country on a day. Latest
 * `effectiveFrom` on or before it; a later certification of the same date
 * wins, because that is the one terminals would have activated.
 */
export function versionInForce(all: CountryPackVersion[], code: string, day: IsoDate): CountryPackVersion | null {
  return (
    all
      .filter((row) => row.code === code && row.status === "certified" && row.effectiveFrom <= day)
      .sort((a, b) =>
        a.effectiveFrom !== b.effectiveFrom
          ? b.effectiveFrom.localeCompare(a.effectiveFrom)
          : (b.certifiedAt ?? "").localeCompare(a.certifiedAt ?? ""),
      )[0] ?? null
  );
}

/** Differences between two versions, for the history view. */
export function diffVersions(before: CountryPackVersion, after: CountryPackVersion): { field: string; before: string; after: string }[] {
  const fields: (keyof CountryPackVersion)[] = [
    "currency", "currencyExponent", "taxEngine", "taxParams", "pricingMode", "roundingMode", "computationLevel",
    "taxClasses", "fiscalProvider", "fiscalMode", "weekStart", "weekend", "standardWeeklyHours",
    "overtimeMultiplier", "dataRetentionYears", "hijriCalendar",
  ];
  const show = (value: unknown) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === "object" && entry ? `${(entry as PackTaxClass).code}:${(entry as PackTaxClass).rate ?? "exempt"}` : String(entry)))
        .join(", ");
    }
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "—");
  };
  return fields
    .map((field) => ({ field: String(field), before: show(before[field]), after: show(after[field]) }))
    .filter((row) => row.before !== row.after);
}

// ---------------------------------------------------------------------------
// Validation — FR-LOC-030
// ---------------------------------------------------------------------------

export interface PackProblem {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export function validatePack(pack: CountryPackVersion, all: CountryPackVersion[]): PackProblem[] {
  const out: PackProblem[] = [];
  const error = (field: string, message: string) => out.push({ field, severity: "error", message });
  const warn = (field: string, message: string) => out.push({ field, severity: "warning", message });

  if (!/^[A-Z]{2}$/.test(pack.code)) error("code", "The country code must be two capital letters (ISO 3166-1 alpha-2).");
  if (!pack.name.en.trim()) error("name.en", "The English name is required.");
  if (!pack.name.ar.trim()) error("name.ar", "The Arabic name is required.");
  if (!/^\d{4}\.\d+(-[a-z0-9]+)?$/.test(pack.version)) error("version", "Versions look like 2026.2 or 2026.3-rc1.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pack.effectiveFrom)) error("effectiveFrom", "Give the date the version takes effect.");

  const siblings = all.filter((row) => row.code === pack.code && row.id !== pack.id && row.status !== "void");
  if (siblings.some((row) => row.version === pack.version)) error("version", `Version ${pack.version} already exists for ${pack.code}.`);
  const sameDay = siblings.find((row) => row.status === "certified" && row.effectiveFrom === pack.effectiveFrom);
  if (sameDay) warn("effectiveFrom", `Version ${sameDay.version} already takes effect that day; this one would replace it on terminals.`);

  const iso = ISO_EXPONENT[pack.currency];
  if (iso === undefined) error("currency", `${pack.currency || "(blank)"} is not a currency the platform can settle in.`);
  else if (iso !== pack.currencyExponent) {
    error("currencyExponent", `${pack.currency} has ${iso} decimal places under ISO 4217, not ${pack.currencyExponent}.`);
  }

  const strategy = STRATEGY_BY_ID.get(pack.taxEngine);
  if (!strategy) {
    error("taxEngine", `"${pack.taxEngine}" is not a registered tax strategy. A new tax model needs a new strategy implementation.`);
  } else {
    for (const param of strategy.params) {
      const value = pack.taxParams[param.key];
      if (typeof value !== "number" || !Number.isFinite(value)) error(`taxParams.${param.key}`, `${param.label.en} is required by ${strategy.label.en}.`);
      else if (value < param.min || value > param.max) error(`taxParams.${param.key}`, `${param.label.en} must be between ${param.min} and ${param.max}.`);
    }
    if (strategy.requiresFiscalProvider && !strategy.requiresFiscalProvider.includes(pack.fiscalProvider ?? "")) {
      error("fiscalProvider", `${strategy.label.en} needs the fiscal provider ${strategy.requiresFiscalProvider.join(" or ")}.`);
    }
  }

  if (pack.taxClasses.length === 0) error("taxClasses", "At least one tax class is required.");
  const codes = new Set<string>();
  pack.taxClasses.forEach((taxClass, index) => {
    const field = `taxClasses[${index}]`;
    if (!(TAX_CLASS_CODES as readonly string[]).includes(taxClass.code)) error(`${field}.code`, `"${taxClass.code}" is not a tax class the menu can assign.`);
    if (codes.has(taxClass.code)) error(`${field}.code`, `The class "${taxClass.code}" appears twice.`);
    codes.add(taxClass.code);
    if (taxClass.code === "exempt" && taxClass.rate !== null) error(`${field}.rate`, "An exempt class carries no rate — leave it empty.");
    if (taxClass.code !== "exempt" && taxClass.rate === null) error(`${field}.rate`, "Only the exempt class may have no rate.");
    if (taxClass.rate !== null && (taxClass.rate < 0 || taxClass.rate > 100)) error(`${field}.rate`, "A rate is a percentage between 0 and 100.");
    if (taxClass.rate !== null && Math.round(taxClass.rate * 1000) !== taxClass.rate * 1000) error(`${field}.rate`, "Rates carry at most three decimal places.");
    if (taxClass.code === "zero" && taxClass.rate !== 0) error(`${field}.rate`, "The zero-rated class must be 0%.");
    if (!taxClass.label.en.trim() || !taxClass.label.ar.trim()) warn(`${field}.label`, "Give the class a label in both languages; receipts print it.");
    if (pack.taxEngine === "no_tax" && (taxClass.rate ?? 0) > 0) error(`${field}.rate`, "The no-tax strategy allows only zero-rated or exempt classes.");
  });
  if (pack.taxClasses.length > 0 && !codes.has("standard")) error("taxClasses", "A standard class is required; new items default to it.");

  if (!["HALF_UP", "HALF_EVEN", "DOWN"].includes(pack.roundingMode)) error("roundingMode", "Unknown rounding mode.");
  if (!(WEEKDAYS as readonly string[]).includes(pack.weekStart)) error("weekStart", "Choose the first day of the working week.");
  if (pack.weekend.length === 0 || pack.weekend.length > 3) error("weekend", "The weekend is one to three days.");
  if (pack.weekend.some((day) => !(WEEKDAYS as readonly string[]).includes(day))) error("weekend", "The weekend contains an unknown day.");
  if (pack.weekend.includes(pack.weekStart)) warn("weekStart", "The working week starts on a weekend day.");
  if (!(pack.standardWeeklyHours >= 1 && pack.standardWeeklyHours <= 84)) error("standardWeeklyHours", "Standard weekly hours must be between 1 and 84.");
  if (!(pack.overtimeMultiplier >= 1 && pack.overtimeMultiplier <= 3)) error("overtimeMultiplier", "The overtime multiplier must be between 1 and 3.");
  if (!(Number.isInteger(pack.dataRetentionYears) && pack.dataRetentionYears >= 1 && pack.dataRetentionYears <= 30)) {
    error("dataRetentionYears", "Retention is a whole number of years between 1 and 30.");
  }
  if (pack.fiscalMode && !pack.fiscalProvider) error("fiscalMode", "A fiscal mode needs a fiscal provider.");
  if (!pack.changeNote.trim()) warn("changeNote", "Say what changed — the history is read by auditors, not only by you.");
  return out;
}

// ---------------------------------------------------------------------------
// Conformance suite — FR-LOC-030
// ---------------------------------------------------------------------------

export interface ConformanceCase {
  id: string;
  title: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface ConformanceResult {
  ranAt: IsoDateTime;
  passed: boolean;
  cases: ConformanceCase[];
}

interface Golden {
  id: string;
  title: string;
  strategies: string[];
  lines: TaxInputLine[];
  context: TaxContext;
  expected: number[];
}

/** Worked by hand; the strategy must reproduce each figure exactly. */
const GOLDEN: Golden[] = [
  { id: "G1", title: "Exclusive 10.00 at 15%", strategies: ["vat_standard", "vat_zatca_phase2"], lines: [{ amount: 1000, rate: 15 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [150] },
  { id: "G2", title: "Inclusive 11.50 at 15%", strategies: ["vat_standard", "vat_zatca_phase2"], lines: [{ amount: 1150, rate: 15 }], context: { pricingMode: "tax_inclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [150] },
  { id: "G3", title: "Inclusive 10.00 at 14%", strategies: ["vat_standard"], lines: [{ amount: 1000, rate: 14 }], context: { pricingMode: "tax_inclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [123] },
  { id: "G4", title: "Tie 0.50 at 5%, half-up", strategies: ["vat_standard"], lines: [{ amount: 50, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [3] },
  { id: "G5", title: "Tie 0.50 at 5%, half-even", strategies: ["vat_standard"], lines: [{ amount: 50, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_EVEN", level: "line", params: {} }, expected: [2] },
  { id: "G6", title: "3.33 at 5%, round down", strategies: ["vat_standard"], lines: [{ amount: 333, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "DOWN", level: "line", params: {} }, expected: [16] },
  { id: "G7", title: "Three lines per line vs per order", strategies: ["vat_standard"], lines: [{ amount: 333, rate: 5 }, { amount: 333, rate: 5 }, { amount: 334, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [51] },
  { id: "G8", title: "Same lines computed per order", strategies: ["vat_standard"], lines: [{ amount: 333, rate: 5 }, { amount: 333, rate: 5 }, { amount: 334, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "order", params: {} }, expected: [50] },
  { id: "G9", title: "Exempt line carries no tax", strategies: ["vat_standard", "vat_zatca_phase2", "vat_plus_levy"], lines: [{ amount: 1000, rate: null }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: { levyPercent: 7 } }, expected: [0] },
  { id: "G10", title: "10.00 with 7% levy then 5% VAT", strategies: ["vat_plus_levy"], lines: [{ amount: 1000, rate: 5 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: { levyPercent: 7 } }, expected: [70, 54] },
  { id: "G11", title: "No-tax strategy charges nothing", strategies: ["no_tax"], lines: [{ amount: 1000, rate: 0 }], context: { pricingMode: "tax_exclusive", rounding: "HALF_UP", level: "line", params: {} }, expected: [] },
];

function formatMinor(values: number[]): string {
  return values.length === 0 ? "none" : values.join(" + ");
}

export function runConformance(pack: CountryPackVersion, now: IsoDateTime): ConformanceResult {
  const cases: ConformanceCase[] = [];
  const strategy = STRATEGY_BY_ID.get(pack.taxEngine);
  if (!strategy) {
    cases.push({ id: "S0", title: "Strategy is registered", passed: false, expected: "a registered strategy", actual: pack.taxEngine || "(blank)" });
    return { ranAt: now, passed: false, cases };
  }

  // 1. Golden cases — the strategy implementation itself.
  for (const golden of GOLDEN.filter((row) => row.strategies.includes(strategy.id))) {
    const result = strategy.compute(golden.lines, golden.context);
    const expectedTotal = golden.expected.reduce((sum, amount) => sum + amount, 0);
    const components = result.components.map((component) => component.amount);
    // Totals must match; where the case names several components, so must each one.
    const passed =
      result.total === expectedTotal &&
      (golden.expected.length <= 1 || JSON.stringify(components) === JSON.stringify(golden.expected));
    cases.push({ id: golden.id, title: golden.title, passed, expected: formatMinor(golden.expected), actual: formatMinor(golden.expected.length <= 1 ? [result.total] : components) });
  }

  // 2. Invariants against this pack's own rates, rounding and pricing mode.
  const context: TaxContext = { pricingMode: pack.pricingMode, rounding: pack.roundingMode, level: pack.computationLevel, params: pack.taxParams };
  const amounts = [1, 99, 1000, 1999, 123457];
  for (const taxClass of pack.taxClasses) {
    for (const amount of amounts) {
      const result = strategy.compute([{ amount, rate: taxClass.rate }], context);
      const id = `I-${taxClass.code}-${amount}`;
      if (taxClass.rate === null || taxClass.rate === 0) {
        cases.push({ id, title: `${taxClass.code} ${amount} carries no tax`, passed: result.total === 0, expected: "0", actual: String(result.total) });
        continue;
      }
      const nonNegative = result.total >= 0;
      const bounded = pack.pricingMode === "tax_inclusive" ? result.total < amount || amount <= 1 : true;
      cases.push({
        id,
        title: `${taxClass.code} at ${taxClass.rate}% on ${amount} is non-negative${pack.pricingMode === "tax_inclusive" ? " and below the gross" : ""}`,
        passed: nonNegative && bounded,
        expected: pack.pricingMode === "tax_inclusive" ? `0 ≤ tax < ${amount}` : "tax ≥ 0",
        actual: String(result.total),
      });
    }
  }
  // Same inputs, same answer — the property that lets terminals compute offline.
  const sample = pack.taxClasses.map((row, index) => ({ amount: 1234 + index * 111, rate: row.rate }));
  const first = strategy.compute(sample, context).total;
  const second = strategy.compute(sample, context).total;
  cases.push({ id: "D1", title: "Deterministic across runs", passed: first === second, expected: String(first), actual: String(second) });

  return { ranAt: now, passed: cases.every((row) => row.passed), cases };
}

/** Stable JSON of the parts of a pack that change its behaviour — what gets digested. */
export function canonicalBody(pack: CountryPackVersion): string {
  const body = {
    code: pack.code,
    version: pack.version,
    effectiveFrom: pack.effectiveFrom,
    currency: pack.currency,
    currencyExponent: pack.currencyExponent,
    taxEngine: pack.taxEngine,
    taxParams: Object.fromEntries(Object.entries(pack.taxParams).sort(([a], [b]) => a.localeCompare(b))),
    pricingMode: pack.pricingMode,
    roundingMode: pack.roundingMode,
    computationLevel: pack.computationLevel,
    taxClasses: [...pack.taxClasses].sort((a, b) => a.code.localeCompare(b.code)).map((row) => [row.code, row.rate]),
    fiscalProvider: pack.fiscalProvider,
    fiscalMode: pack.fiscalMode,
    weekStart: pack.weekStart,
    weekend: [...pack.weekend].sort(),
    standardWeeklyHours: pack.standardWeeklyHours,
    overtimeMultiplier: pack.overtimeMultiplier,
    dataRetentionYears: pack.dataRetentionYears,
    hijriCalendar: pack.hijriCalendar,
  };
  return JSON.stringify(body);
}

export async function digestOf(pack: CountryPackVersion): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBody(pack));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Distribution to terminals — FR-LOC-024
// ---------------------------------------------------------------------------

export type DistributionState = "active_on_device" | "held_on_device" | "awaiting_sync" | "at_risk" | "missed";

/**
 * Whether a terminal holds a version. Terminals download every certified
 * pack for their country at each sync, so a terminal last seen after the
 * version was published holds it; one not seen since does not yet.
 */
export function distributionState(
  version: CountryPackVersion,
  terminalLastSeenAt: IsoDateTime | null,
  now: Date,
  leadDays: number,
): DistributionState {
  const holds = Boolean(version.publishedAt && terminalLastSeenAt && terminalLastSeenAt >= version.publishedAt);
  const today = now.toISOString().slice(0, 10);
  if (holds) return version.effectiveFrom <= today ? "active_on_device" : "held_on_device";
  if (version.effectiveFrom <= today) return "missed";
  const days = Math.round((Date.parse(`${version.effectiveFrom}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= leadDays ? "at_risk" : "awaiting_sync";
}

// ---------------------------------------------------------------------------

export function blankVersion(input: Partial<CountryPackVersion> = {}): Omit<CountryPackVersion, "id"> {
  const now = new Date().toISOString();
  return {
    code: "",
    name: { en: "", ar: "" },
    version: `${new Date().getFullYear()}.1`,
    effectiveFrom: now.slice(0, 10),
    currency: "",
    currencyExponent: 2,
    taxEngine: "vat_standard",
    taxParams: {},
    pricingMode: "tax_inclusive",
    roundingMode: "HALF_UP",
    computationLevel: "line",
    taxClasses: [{ code: "standard", rate: 0, label: { en: "Standard", ar: "قياسي" } }],
    fiscalProvider: null,
    fiscalMode: null,
    weekStart: "sunday",
    weekend: ["friday", "saturday"],
    standardWeeklyHours: 48,
    overtimeMultiplier: 1.25,
    dataRetentionYears: 5,
    hijriCalendar: false,
    status: "draft",
    changeNote: "",
    digest: null,
    conformance: null,
    certifiedAt: null,
    certifiedBy: null,
    publishedAt: null,
    createdAt: now,
    createdBy: null,
    platform: false,
    ...input,
  };
}
