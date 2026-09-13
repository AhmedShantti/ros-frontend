/**
 * Receipt templates and the receipt they produce — FR-POS-100 … FR-POS-102.
 *
 * A template is chosen per brand and country (FR-POS-101): the most specific
 * one that exists wins, and the tenant default catches the rest. Rendering
 * is pure and character-based, because a thermal printer is a character
 * device: a 58 mm roll holds 32 columns, an 80 mm roll 48, and a name that
 * fits in a browser but not on the paper is a receipt nobody can read.
 *
 * Bilingual layout (FR-POS-102) is a choice between Arabic only, English
 * only, or both in a stated order. "Both" prints each line in each language
 * rather than two receipts glued together, so the totals are never read in
 * one language and the items in another.
 */

import type { CountryCode, Id, IsoDateTime, Localised } from "./types";

export type ReceiptLayout = "ar" | "en" | "ar_en" | "en_ar";

export interface ReceiptTemplate {
  id: Id;
  name: string;
  /** Null: the tenant default. */
  brandId: Id | null;
  /** Null: any country. */
  countryCode: CountryCode | null;
  /** 1-bit logo as a PNG data URL, already dithered for a thermal head. */
  logo: string | null;
  legalName: Localised;
  taxRegistration: string;
  header: Localised[];
  footer: Localised[];
  /** Null: take `pos.receiptLanguages` from the settings cascade. */
  layout: ReceiptLayout | null;
  paperWidth: 58 | 80;
  show: {
    orderNumber: boolean;
    cashier: boolean;
    table: boolean;
    modifiers: boolean;
    taxBreakdown: boolean;
    customer: boolean;
    loyalty: boolean;
  };
  qr: "none" | "summary" | "zatca";
  active: boolean;
  updatedAt: IsoDateTime;
}

export function columnsFor(width: ReceiptTemplate["paperWidth"]): number {
  return width === 58 ? 32 : 48;
}

/**
 * The template that applies — FR-POS-101. Brand + country beats brand beats
 * country beats the default; inactive templates never apply.
 */
export function resolveTemplate(
  templates: ReceiptTemplate[],
  brandId: Id | null,
  countryCode: CountryCode | null,
): ReceiptTemplate | null {
  const live = templates.filter((row) => row.active);
  const score = (row: ReceiptTemplate) => {
    if (row.brandId && row.brandId !== brandId) return -1;
    if (row.countryCode && row.countryCode !== countryCode) return -1;
    return (row.brandId ? 2 : 0) + (row.countryCode ? 1 : 0);
  };
  return (
    live
      .map((row) => ({ row, points: score(row) }))
      .filter((entry) => entry.points >= 0)
      .sort((a, b) => b.points - a.points)[0]?.row ?? null
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface ReceiptInput {
  orderNumber: string;
  issuedAt: IsoDateTime;
  cashier: string;
  table: string | null;
  customer: string | null;
  loyaltyPoints: number | null;
  lines: { quantity: number; name: Localised; modifiers: Localised[]; total: string }[];
  subtotal: string;
  taxes: { label: Localised; amount: string }[];
  total: string;
  currency: string;
}

export type ReceiptLine =
  | { kind: "text"; text: string; align: "start" | "center" | "end"; dir: "rtl" | "ltr"; bold?: boolean }
  | { kind: "rule" }
  | { kind: "logo" }
  | { kind: "qr"; payload: string };

const LABELS: Record<string, Localised> = {
  order: { en: "Order", ar: "طلب" },
  cashier: { en: "Cashier", ar: "الكاشير" },
  table: { en: "Table", ar: "طاولة" },
  customer: { en: "Customer", ar: "العميل" },
  subtotal: { en: "Subtotal", ar: "المجموع الفرعي" },
  total: { en: "TOTAL", ar: "الإجمالي" },
  vatNo: { en: "VAT no.", ar: "الرقم الضريبي" },
  points: { en: "Loyalty points", ar: "نقاط الولاء" },
  tax: { en: "Tax", ar: "الضريبة" },
};

function languages(layout: ReceiptLayout): ("ar" | "en")[] {
  switch (layout) {
    case "ar":
      return ["ar"];
    case "en":
      return ["en"];
    case "ar_en":
      return ["ar", "en"];
    default:
      return ["en", "ar"];
  }
}

function pick(value: Localised, language: "ar" | "en"): string {
  return value[language]?.trim() || value[language === "ar" ? "en" : "ar"] || "";
}

/** Left text, right amount, padded to the paper — reversed for Arabic by `dir`. */
function pair(label: string, amount: string, columns: number): string {
  const room = Math.max(1, columns - amount.length - 1);
  const cut = label.length > room ? `${label.slice(0, room - 1)}…` : label;
  return `${cut.padEnd(room, " ")} ${amount}`;
}

function wrap(text: string, columns: number): string[] {
  if (text.length <= columns) return [text];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line ? `${line} ${word}` : word).length > columns) {
      if (line) out.push(line);
      line = word.length > columns ? word.slice(0, columns) : word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function renderReceipt(
  template: ReceiptTemplate,
  input: ReceiptInput,
  layout: ReceiptLayout,
  zatcaPayload: string | null,
): ReceiptLine[] {
  const columns = columnsFor(template.paperWidth);
  const langs = languages(layout);
  const out: ReceiptLine[] = [];
  const text = (value: string, language: "ar" | "en", align: "start" | "center" | "end" = "start", bold = false) =>
    wrap(value, columns).forEach((chunk) =>
      out.push({ kind: "text", text: chunk, align, dir: language === "ar" ? "rtl" : "ltr", bold }),
    );
  const each = (fn: (language: "ar" | "en") => void) => langs.forEach(fn);

  if (template.logo) out.push({ kind: "logo" });
  each((language) => text(pick(template.legalName, language), language, "center", true));
  if (template.taxRegistration) {
    each((language) => text(`${pick(LABELS.vatNo!, language)} ${template.taxRegistration}`, language, "center"));
  }
  for (const line of template.header) each((language) => text(pick(line, language), language, "center"));
  out.push({ kind: "rule" });

  if (template.show.orderNumber) {
    each((language) => text(pair(`${pick(LABELS.order!, language)} ${input.orderNumber}`, input.issuedAt.slice(0, 16).replace("T", " "), columns), language));
  }
  if (template.show.cashier) each((language) => text(`${pick(LABELS.cashier!, language)}: ${input.cashier}`, language));
  if (template.show.table && input.table) each((language) => text(`${pick(LABELS.table!, language)}: ${input.table}`, language));
  if (template.show.customer && input.customer) each((language) => text(`${pick(LABELS.customer!, language)}: ${input.customer}`, language));
  out.push({ kind: "rule" });

  for (const line of input.lines) {
    each((language) => text(pair(`${line.quantity} ${pick(line.name, language)}`, line.total, columns), language));
    if (template.show.modifiers) {
      for (const modifier of line.modifiers) {
        // Modifiers print once, in the first language: repeating "+ extra
        // cheese" in both languages doubles a long order for no reader.
        text(`   + ${pick(modifier, langs[0]!)}`, langs[0]!);
      }
    }
  }
  out.push({ kind: "rule" });

  each((language) => text(pair(pick(LABELS.subtotal!, language), input.subtotal, columns), language));
  if (template.show.taxBreakdown) {
    for (const tax of input.taxes) each((language) => text(pair(pick(tax.label, language), tax.amount, columns), language));
  }
  each((language) => text(pair(pick(LABELS.total!, language), `${input.total} ${input.currency}`, columns), language, "start", true));

  if (template.show.loyalty && input.loyaltyPoints !== null) {
    each((language) => text(pair(pick(LABELS.points!, language), String(input.loyaltyPoints), columns), language));
  }

  if (template.footer.length > 0) out.push({ kind: "rule" });
  for (const line of template.footer) each((language) => text(pick(line, language), language, "center"));

  if (template.qr === "zatca" && zatcaPayload) out.push({ kind: "qr", payload: zatcaPayload });
  if (template.qr === "summary") {
    out.push({
      kind: "qr",
      payload: [
        pick(template.legalName, "en"),
        `${input.orderNumber} ${input.issuedAt}`,
        ...input.lines.map((line) => `${line.quantity} x ${pick(line.name, "en")} ${line.total}`),
        `TOTAL ${input.total} ${input.currency}`,
      ].join("\n"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ZATCA (Saudi Arabia) simplified-invoice QR — phase 1 TLV
// ---------------------------------------------------------------------------

/**
 * Tag-length-value, UTF-8, then Base64: seller name (1), VAT registration
 * number (2), timestamp (3), invoice total with VAT (4), VAT total (5). This
 * is the payload a Saudi receipt's QR must carry; any ZATCA-compliant reader
 * decodes it offline.
 */
export function zatcaTlv(fields: {
  seller: string;
  vatNumber: string;
  timestamp: IsoDateTime;
  total: string;
  vat: string;
}): string {
  const encoder = new TextEncoder();
  const parts: number[] = [];
  [fields.seller, fields.vatNumber, fields.timestamp, fields.total, fields.vat].forEach((value, index) => {
    const bytes = encoder.encode(value);
    if (bytes.length > 255) throw new Error("A ZATCA TLV field cannot exceed 255 bytes.");
    parts.push(index + 1, bytes.length, ...bytes);
  });
  let binary = "";
  for (const byte of parts) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode a ZATCA TLV — used to show the cashier what the code says. */
export function readZatcaTlv(base64: string): string[] {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const out: string[] = [];
  let index = 0;
  while (index + 2 <= bytes.length) {
    const length = bytes[index + 1]!;
    out.push(new TextDecoder().decode(bytes.slice(index + 2, index + 2 + length)));
    index += 2 + length;
  }
  return out;
}

/** Saudi VAT registration numbers are 15 digits, starting and ending with 3. */
export function validSaudiVat(value: string): boolean {
  return /^3\d{13}3$/.test(value.trim());
}
