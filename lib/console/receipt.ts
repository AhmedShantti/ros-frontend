/**
 * Receipt templates and how a receipt prints with them — FR-POS-101 / FR-POS-102.
 *
 * ## What a template is
 *
 * The editable PRESENTATION of a receipt: a logo (an https URL), up to four
 * header lines, up to four footer lines and the language(s) the printed
 * labels use. It is stored by the backend, one per (brand?, country pack?),
 * and the backend — not this file — decides which one a branch prints with
 * (`GET /orders/receipt-template` for the till, `GET /receipt-templates/resolve`
 * for the dashboard preview).
 *
 * Fiscal content (tax registration, invoice numbers, QR — FR-POS-100) is NOT
 * template content and is not modelled here.
 *
 * ## Language (FR-POS-102)
 *
 * A template prints Arabic only, English only, or both in a stated order.
 * That choice belongs to the template, so it is independent of the language
 * the console or the till happens to be displayed in: an Arabic-only receipt
 * printed from an English UI is still Arabic-only. Every label is therefore
 * resolved here from BOTH dictionaries (`catalogues.en` / `catalogues.ar`)
 * rather than from the active locale.
 *
 * The editor's single "layout" control (`ar`, `en`, `ar_en`, `en_ar`) maps
 * onto the backend's two fields — `languageMode` (`ar` | `en` | `bilingual`)
 * and `bothOrder` (`ar_first` | `en_first`). The retired spelling `both` is
 * never produced.
 */

import { catalogues, type ConsoleKey } from "@/locales";
import type { Id, IsoDateTime, Localised } from "./types";

// ---------------------------------------------------------------------------
// Model — mirrors the backend's `ReceiptTemplate`
// ---------------------------------------------------------------------------

export type ReceiptLanguage = "ar" | "en";
export type ReceiptLanguageMode = "ar" | "en" | "bilingual";
export type ReceiptBothOrder = "ar_first" | "en_first";
/** What prints on the back of a double-sided receipt: nothing, or the logo repeated across the page. */
export type ReceiptBackSide = "none" | "logo_pattern";
export const RECEIPT_BACK_SIDES: readonly ReceiptBackSide[] = [
  "none",
  "logo_pattern",
];

/** The look of the paper: a serif restaurant check, or the monospaced till roll. */
export type ReceiptPaperStyle = "classic" | "thermal";
export const RECEIPT_PAPER_STYLES: readonly ReceiptPaperStyle[] = [
  "classic",
  "thermal",
];

/**
 * What a receipt shows and how it looks. Every key has a default, so a
 * template (or a PATCH) may carry any subset. None of these can remove fiscal
 * content (tax registration, tax lines, QR) — that is not template content.
 */
export interface ReceiptOptions {
  paperStyle: ReceiptPaperStyle;
  /** The restaurant (brand) name in the heading. */
  showBrandName: boolean;
  showBranchName: boolean;
  showBranchAddress: boolean;
  showOrderType: boolean;
  showTable: boolean;
  showGuests: boolean;
  /** Who served the order. */
  showCashier: boolean;
  /** Suggested tip percentages under the total; empty prints none. */
  suggestedTips: number[];
  /** "Tip / Total / Signature" write-in lines for a card slip. */
  signatureLine: boolean;
}

export const DEFAULT_RECEIPT_OPTIONS: ReceiptOptions = {
  paperStyle: "classic",
  showBrandName: true,
  showBranchName: true,
  showBranchAddress: true,
  showOrderType: true,
  showTable: true,
  showGuests: true,
  showCashier: true,
  suggestedTips: [],
  signatureLine: false,
};

/** The on/off details, in the order the editor lists them. */
export const RECEIPT_SHOW_OPTIONS = [
  "showBrandName",
  "showBranchName",
  "showBranchAddress",
  "showOrderType",
  "showTable",
  "showGuests",
  "showCashier",
] as const;
export type ReceiptShowOption = (typeof RECEIPT_SHOW_OPTIONS)[number];

export const RECEIPT_MAX_TIPS = 4;
/** Ready-made tip suggestions; the editor also accepts its own. */
export const RECEIPT_TIP_PRESETS: readonly (readonly number[])[] = [
  [10, 15, 20],
  [15, 18, 20],
  [18, 20, 22],
];

/** A template's options with every default filled in. */
export function optionsOf(content: {
  options?: Partial<ReceiptOptions> | undefined;
}): ReceiptOptions {
  const own = content.options ?? {};
  return {
    ...DEFAULT_RECEIPT_OPTIONS,
    ...own,
    suggestedTips: [
      ...(own.suggestedTips ?? DEFAULT_RECEIPT_OPTIONS.suggestedTips),
    ],
  };
}

/** The editor's one language control; see `layoutOf` / `languageFieldsOf`. */
export type ReceiptLayout = "ar" | "en" | "ar_en" | "en_ar";
export const RECEIPT_LAYOUTS: readonly ReceiptLayout[] = [
  "ar_en",
  "en_ar",
  "ar",
  "en",
];

/** The limits the backend enforces (a longer value is a 400, never truncated). */
export const RECEIPT_MAX_LINES = 4;
export const RECEIPT_MAX_LINE_LENGTH = 120;
export const RECEIPT_MAX_LOGO_URL_LENGTH = 500;

/** Which axes of (brand, country pack) a stored template is narrowed by — also its resolution tier. */
export type ReceiptTemplateScope =
  "brand_country_pack" | "brand" | "country_pack" | "tenant_default";
export type ReceiptTemplateSource = ReceiptTemplateScope | "built_in_default";

/** The presentation fields of a template — what an edit changes and what the till prints from. */
export interface ReceiptTemplateContent {
  languageMode: ReceiptLanguageMode;
  /** Only meaningful when `languageMode` is `bilingual`. */
  bothOrder: ReceiptBothOrder;
  /** Absolute https URL, or null for no logo. */
  logoUrl: string | null;
  /**
   * The back of a double-sided receipt. `logo_pattern` repeats the logo over
   * the whole page and needs a logo; the backend refuses it otherwise.
   * Optional so a template without the field reads as `none`.
   */
  backSide?: ReceiptBackSide;
  /** Optional so a template without it reads as the defaults; see `optionsOf`. */
  options?: ReceiptOptions;
  headerLines: Localised[];
  footerLines: Localised[];
}

/** A stored template. Its scope is fixed at creation. */
export interface ReceiptTemplate extends ReceiptTemplateContent {
  id: Id;
  /** Null: every brand. */
  brandId: Id | null;
  /** Null: every country pack. */
  countryPackCode: string | null;
  scope: ReceiptTemplateScope;
  /** Optimistic-concurrency token: echo it on update. */
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The template a branch prints with, and where it came from. */
export interface ResolvedReceiptTemplate {
  template: ReceiptTemplateContent;
  source: ReceiptTemplateSource;
  /** Null for the built-in default. */
  templateId: Id | null;
  version: number | null;
  isDefault: boolean;
  /** Present on the dashboard preview only: the inputs the resolution used. */
  resolvedFor?: { branchId: Id; brandId: Id; countryPackCode: string };
}

/** What the editor needs to offer a country pack as a scope. */
export interface ReceiptScopeOptions {
  /** The tenant's own pack — the editor's default. */
  tenantCountryPackCode: string;
  /** Every pack loaded on this deployment; a template may name any of them. */
  loadedCountryPackCodes: string[];
}

export interface NewReceiptTemplate extends Partial<
  Omit<ReceiptTemplateContent, "options">
> {
  brandId?: Id | null;
  countryPackCode?: string | null;
  /** Only the options chosen; the rest take their defaults. */
  options?: Partial<ReceiptOptions>;
}

/** A PATCH: the version last read, plus only the fields that changed. */
export interface ReceiptTemplateUpdate extends Partial<
  Omit<ReceiptTemplateContent, "options">
> {
  version: number;
  /** Only the options that changed; the rest stay as stored. */
  options?: Partial<ReceiptOptions>;
}

// ---------------------------------------------------------------------------
// Layout <-> languageMode + bothOrder
// ---------------------------------------------------------------------------

export function layoutOf(
  content: Pick<ReceiptTemplateContent, "languageMode" | "bothOrder">,
): ReceiptLayout {
  if (content.languageMode === "ar") return "ar";
  if (content.languageMode === "en") return "en";
  return content.bothOrder === "en_first" ? "en_ar" : "ar_en";
}

/**
 * The backend fields a layout stands for. `bothOrder` is only part of a
 * bilingual layout; choosing `ar` or `en` leaves whatever order is stored.
 */
export function languageFieldsOf(layout: ReceiptLayout): {
  languageMode: ReceiptLanguageMode;
  bothOrder?: ReceiptBothOrder;
} {
  switch (layout) {
    case "ar":
      return { languageMode: "ar" };
    case "en":
      return { languageMode: "en" };
    case "ar_en":
      return { languageMode: "bilingual", bothOrder: "ar_first" };
    case "en_ar":
      return { languageMode: "bilingual", bothOrder: "en_first" };
  }
}

/** The languages a template prints, in print order. */
export function printLanguages(
  content: Pick<ReceiptTemplateContent, "languageMode" | "bothOrder">,
): ReceiptLanguage[] {
  if (content.languageMode === "ar") return ["ar"];
  if (content.languageMode === "en") return ["en"];
  return content.bothOrder === "en_first" ? ["en", "ar"] : ["ar", "en"];
}

/** A receipt reads in the direction of the language it starts with. */
export function documentDirection(
  languages: readonly ReceiptLanguage[],
): "rtl" | "ltr" {
  return languages[0] === "ar" ? "rtl" : "ltr";
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

const sameLines = (a: readonly Localised[], b: readonly Localised[]): boolean =>
  a.length === b.length &&
  a.every(
    (line, index) => line.en === b[index]!.en && line.ar === b[index]!.ar,
  );

const sameTips = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((tip, index) => tip === b[index]);

function sameOptions(a: ReceiptOptions, b: ReceiptOptions): boolean {
  return (
    a.paperStyle === b.paperStyle &&
    RECEIPT_SHOW_OPTIONS.every((key) => a[key] === b[key]) &&
    a.signatureLine === b.signatureLine &&
    sameTips(a.suggestedTips, b.suggestedTips)
  );
}

export function sameContent(
  a: ReceiptTemplateContent,
  b: ReceiptTemplateContent,
): boolean {
  return (
    a.languageMode === b.languageMode &&
    a.bothOrder === b.bothOrder &&
    (a.logoUrl ?? null) === (b.logoUrl ?? null) &&
    (a.backSide ?? "none") === (b.backSide ?? "none") &&
    sameOptions(optionsOf(a), optionsOf(b)) &&
    sameLines(a.headerLines, b.headerLines) &&
    sameLines(a.footerLines, b.footerLines)
  );
}

/** Only the option keys whose value differs — options merge key by key on the server. */
function changedOptions(
  before: ReceiptOptions,
  after: ReceiptOptions,
): Partial<ReceiptOptions> {
  const out: Partial<ReceiptOptions> = {};
  if (before.paperStyle !== after.paperStyle) out.paperStyle = after.paperStyle;
  for (const key of [...RECEIPT_SHOW_OPTIONS, "signatureLine"] as const) {
    if (before[key] !== after[key]) out[key] = after[key];
  }
  if (!sameTips(before.suggestedTips, after.suggestedTips))
    out.suggestedTips = [...after.suggestedTips];
  return out;
}

/**
 * Only the fields that differ — what a PATCH sends. A field that did not
 * change is not sent, so an edit to the footer cannot overwrite a header
 * someone else changed in the meantime without the version check noticing.
 */
export function contentChanges(
  before: ReceiptTemplateContent,
  after: ReceiptTemplateContent,
): Partial<Omit<ReceiptTemplateContent, "options">> & {
  options?: Partial<ReceiptOptions>;
} {
  const out: Partial<Omit<ReceiptTemplateContent, "options">> & {
    options?: Partial<ReceiptOptions>;
  } = {};
  if (before.languageMode !== after.languageMode)
    out.languageMode = after.languageMode;
  if (before.bothOrder !== after.bothOrder) out.bothOrder = after.bothOrder;
  if ((before.logoUrl ?? null) !== (after.logoUrl ?? null))
    out.logoUrl = after.logoUrl ?? null;
  if ((before.backSide ?? "none") !== (after.backSide ?? "none"))
    out.backSide = after.backSide ?? "none";
  const options = changedOptions(optionsOf(before), optionsOf(after));
  if (Object.keys(options).length > 0) out.options = options;
  if (!sameLines(before.headerLines, after.headerLines))
    out.headerLines = after.headerLines;
  if (!sameLines(before.footerLines, after.footerLines))
    out.footerLines = after.footerLines;
  return out;
}

export type ReceiptContentIssue =
  | { code: "tooManyLines"; field: "headerLines" | "footerLines" }
  | {
      code: "lineTooLong";
      field: "headerLines" | "footerLines";
      index: number;
      language: ReceiptLanguage;
    }
  | { code: "lineEmpty"; field: "headerLines" | "footerLines"; index: number }
  | { code: "logoNotHttps" }
  | { code: "backSideNeedsLogo" }
  | { code: "badTips" };

/**
 * The problems visible before anything is sent. The backend validates again
 * and its message is shown verbatim when it disagrees (control characters,
 * for instance) — this only spares a round trip for the common mistakes.
 */
export function receiptContentIssues(
  content: ReceiptTemplateContent,
): ReceiptContentIssue[] {
  const issues: ReceiptContentIssue[] = [];
  for (const field of ["headerLines", "footerLines"] as const) {
    const lines = content[field];
    if (lines.length > RECEIPT_MAX_LINES)
      issues.push({ code: "tooManyLines", field });
    lines.forEach((line, index) => {
      const en = line.en.trim();
      const ar = line.ar.trim();
      if (en.length === 0 && ar.length === 0)
        issues.push({ code: "lineEmpty", field, index });
      if (en.length > RECEIPT_MAX_LINE_LENGTH)
        issues.push({ code: "lineTooLong", field, index, language: "en" });
      if (ar.length > RECEIPT_MAX_LINE_LENGTH)
        issues.push({ code: "lineTooLong", field, index, language: "ar" });
    });
  }
  const logo = content.logoUrl?.trim() ?? "";
  if (logo.length > 0 && !isHttpsUrl(logo))
    issues.push({ code: "logoNotHttps" });
  if (content.backSide === "logo_pattern" && logo.length === 0)
    issues.push({ code: "backSideNeedsLogo" });
  const tips = content.options?.suggestedTips ?? [];
  if (
    tips.length > RECEIPT_MAX_TIPS ||
    tips.some((tip) => !Number.isInteger(tip) || tip < 1 || tip > 100) ||
    new Set(tips).size !== tips.length
  )
    issues.push({ code: "badTips" });
  return issues;
}

/** The same test the backend applies: an absolute https URL, no spaces, no credentials. */
export function isHttpsUrl(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > RECEIPT_MAX_LOGO_URL_LENGTH ||
    /\s/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Printing — text in the template's language(s)
// ---------------------------------------------------------------------------

export interface PrintedText {
  language: ReceiptLanguage;
  dir: "rtl" | "ltr";
  text: string;
}

const otherLanguage = (language: ReceiptLanguage): ReceiptLanguage =>
  language === "ar" ? "en" : "ar";

/**
 * `value` in each printed language, in print order.
 *
 * One language: that side, falling back to the other rather than printing
 * nothing. Two languages: each side that has text — a line authored in one
 * language prints once, not twice.
 */
export function printedTexts(
  value: Localised,
  languages: readonly ReceiptLanguage[],
): PrintedText[] {
  const own = (language: ReceiptLanguage) => (value[language] ?? "").trim();
  const make = (language: ReceiptLanguage, text: string): PrintedText => ({
    language,
    dir: language === "ar" ? "rtl" : "ltr",
    text,
  });
  if (languages.length <= 1) {
    const language = languages[0] ?? "en";
    const text = own(language) || own(otherLanguage(language));
    return text ? [make(language, text)] : [];
  }
  return languages
    .map((language) => make(language, own(language)))
    .filter((entry) => entry.text.length > 0);
}

/** A console dictionary entry in BOTH languages — never the active locale's alone. */
export function localisedLabel(key: ConsoleKey): Localised {
  const en = catalogues.en[key] ?? key;
  return { en, ar: catalogues.ar[key] ?? en };
}

/** Join parts (plain text or a Localised pair) language by language. */
export function joinLocalised(...parts: (string | Localised)[]): Localised {
  const side = (language: ReceiptLanguage) =>
    parts
      .map((part) =>
        typeof part === "string"
          ? part
          : (part[language] ?? part[otherLanguage(language)] ?? ""),
      )
      .join("");
  return { en: side("en"), ar: side("ar") };
}

// ---------------------------------------------------------------------------
// The document a receipt prints — language-neutral
// ---------------------------------------------------------------------------

/** Which line of the sale a meta row is, so a template can hide the ones it may. */
export type ReceiptMetaKey =
  | "orderNumber"
  | "reference"
  | "date"
  | "time"
  | "orderType"
  | "table"
  | "guests"
  | "cashier";

export interface ReceiptMetaRow {
  label: Localised;
  value: string | Localised;
  key?: ReceiptMetaKey;
}

export interface ReceiptItem {
  quantity: number;
  name: Localised;
  /** Already formatted. */
  total: string;
  /** Already formatted; printed as "@ price" under a line of more than one. */
  unitPrice?: string;
  modifiers: { sign: "+" | "−"; name: Localised; amount?: string }[];
}

export interface ReceiptTotalRow {
  label: Localised;
  value: string;
  /** The grand total. */
  emphasis?: boolean;
  /** A breakdown line under the row above it. */
  sub?: boolean;
  negative?: boolean;
}

/**
 * What a receipt says about the sale, before any language is applied. The
 * caller formats money and dates (that is display formatting, not
 * language); this document carries every label as a pair so the renderer can
 * print it in the template's language(s).
 */
export interface ReceiptDocument {
  /**
   * The business heading. `brand` is the restaurant, `name` the branch,
   * `address` the branch's. The template decides which of them print.
   */
  heading: {
    brand?: Localised | null;
    name: Localised | null;
    address: string | null;
  };
  meta: ReceiptMetaRow[];
  items: ReceiptItem[];
  totals: ReceiptTotalRow[];
  payments: ReceiptMetaRow[];
  /** A closing notice below the footer (the non-fiscal notice on the drawer). */
  notice: Localised | null;
  /**
   * The amount to print for a suggested tip of `percent` — of the subtotal,
   * already formatted. Absent when the sale has no amount to suggest against.
   */
  tipAmount?: (percent: number) => string;
}

/**
 * A neutral sample for the editor's preview. It is labelled a preview on
 * screen and carries no business data — the point is the layout, the
 * language order and how the header and footer wrap.
 */
export function previewReceiptDocument(): ReceiptDocument {
  const label = localisedLabel;
  const subtotal = 5700;
  return {
    heading: {
      brand: { en: "Your restaurant", ar: "اسم مطعمك" },
      name: { en: "Downtown branch", ar: "فرع وسط المدينة" },
      address: "12 Sample Street",
    },
    meta: [
      {
        key: "orderNumber",
        label: label("orders.number"),
        value: "PREVIEW-1043",
      },
      { key: "date", label: label("common.date"), value: "2026-01-01" },
      { key: "table", label: label("nav.tables"), value: "12" },
      { key: "time", label: label("common.time"), value: "12:00" },
      { key: "guests", label: label("pos.guests"), value: "3" },
      {
        key: "orderType",
        label: label("pos.orderType"),
        value: { en: "Dine-in", ar: "في المطعم" },
      },
      {
        key: "cashier",
        label: label("shift.cashier"),
        value: { en: "Sample cashier", ar: "كاشير تجريبي" },
      },
    ],
    items: [
      {
        quantity: 2,
        name: { en: "Sample item", ar: "صنف تجريبي" },
        total: "40.00",
        unitPrice: "20.00",
        modifiers: [
          { sign: "+", name: { en: "Sample extra", ar: "إضافة تجريبية" } },
        ],
      },
      {
        quantity: 1,
        name: { en: "Another sample item", ar: "صنف تجريبي آخر" },
        total: "5.00",
        modifiers: [],
      },
      {
        quantity: 1,
        name: { en: "Third sample item", ar: "صنف تجريبي ثالث" },
        total: "12.00",
        modifiers: [],
      },
    ],
    totals: [
      { label: label("pos.subtotal"), value: "57.00" },
      { label: label("pos.tax"), value: "7.98" },
      { label: label("pos.total"), value: "64.98", emphasis: true },
    ],
    payments: [
      {
        label: joinLocalised(label("orders.card"), " •••• 4412"),
        value: "64.98",
      },
    ],
    notice: null,
    tipAmount: (percent) => ((subtotal * percent) / 10000).toFixed(2),
  };
}

/** Preview paper widths, in characters — a preview-only choice, never saved. */
export type PaperWidth = 58 | 80;
export function columnsFor(width: PaperWidth): number {
  return width === 58 ? 32 : 48;
}
