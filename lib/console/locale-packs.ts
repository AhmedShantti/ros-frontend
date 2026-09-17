/**
 * Translation packs and language assignment — FR-LOC-008, FR-LOC-009.
 *
 * ## Packs (FR-LOC-009)
 *
 * The console's own dictionaries are English and Arabic and stay that way.
 * French, Turkish, Urdu, Bengali, Tagalog and Hindi arrive as *translation
 * packs*: a language code, a script direction, an Intl locale for dates and
 * numbers, a font stack for the script, and a table of strings by key.
 *
 * A pack is useful long before it could translate the whole console. A cook
 * in Dubai who reads Urdu needs the kitchen ticket in Urdu — "ADDITION",
 * "ALLERGY", "No onion" — not the settings screen. So coverage is measured
 * per *surface*: the kitchen ticket and the receipt each have a required key
 * set, and a pack is offered for a surface only when it covers every key of
 * it. The console chrome is a surface too; its key set is the full console
 * dictionary, and no pack here covers it, so the chrome stays en/ar — shown
 * as a coverage figure rather than silently falling back mid-screen.
 *
 * ## Assignment (FR-LOC-008)
 *
 * Language is chosen independently per user (the console they read), per
 * terminal (the till or KDS interface) and per printed document type (which
 * may be bilingual, in a stated order). `resolveDocumentLanguages` walks
 * branch → tenant → built-in default for a document.
 */

import type { Id, IsoDateTime } from "./types";

export type PackLanguage = "en" | "ar" | "fr" | "tr" | "ur" | "bn" | "tl" | "hi";

export const PACK_LANGUAGES: PackLanguage[] = ["en", "ar", "fr", "tr", "ur", "bn", "tl", "hi"];
/** Languages that arrive by pack rather than as a console dictionary. */
export const ADDITIONAL_LANGUAGES: PackLanguage[] = ["fr", "tr", "ur", "bn", "tl", "hi"];

export type Surface = "kitchen_ticket" | "receipt" | "console";

export const KITCHEN_KEYS = [
  "k.order", "k.table", "k.dineIn", "k.takeaway", "k.delivery", "k.guests", "k.seat", "k.course",
  "k.server", "k.fired", "k.amendment", "k.void", "k.held", "k.rush", "k.allergy", "k.note", "k.no", "k.extra",
] as const;

export const RECEIPT_KEYS = [
  "r.order", "r.cashier", "r.table", "r.customer", "r.subtotal", "r.discount", "r.service", "r.tax",
  "r.total", "r.paid", "r.change", "r.vatNo", "r.points", "r.duplicate", "r.thanks",
] as const;

export type PackKey = (typeof KITCHEN_KEYS)[number] | (typeof RECEIPT_KEYS)[number];

export interface TranslationPack {
  language: PackLanguage;
  /** The language's own name for itself. */
  endonym: string;
  dir: "ltr" | "rtl";
  /** BCP 47 tag for Intl — digits, separators, month names. */
  intlTag: string;
  /** CSS font stack able to render the script. */
  fontStack: string;
  version: string;
  strings: Partial<Record<PackKey, string>>;
}

const LATIN = "'Inter', 'Noto Sans', system-ui, sans-serif";

export const TRANSLATION_PACKS: Record<PackLanguage, TranslationPack> = {
  en: {
    language: "en", endonym: "English", dir: "ltr", intlTag: "en-US", fontStack: LATIN, version: "1.0",
    strings: {
      "k.order": "Order", "k.table": "Table", "k.dineIn": "Dine in", "k.takeaway": "Takeaway", "k.delivery": "Delivery",
      "k.guests": "Guests", "k.seat": "Seat", "k.course": "Course", "k.server": "Server", "k.fired": "Fired",
      "k.amendment": "ADDITION", "k.void": "VOID", "k.held": "ON HOLD", "k.rush": "RUSH", "k.allergy": "ALLERGY",
      "k.note": "Note", "k.no": "No", "k.extra": "Extra",
      "r.order": "Order", "r.cashier": "Cashier", "r.table": "Table", "r.customer": "Customer", "r.subtotal": "Subtotal",
      "r.discount": "Discount", "r.service": "Service charge", "r.tax": "Tax", "r.total": "TOTAL", "r.paid": "Paid",
      "r.change": "Change", "r.vatNo": "VAT no.", "r.points": "Loyalty points", "r.duplicate": "DUPLICATE", "r.thanks": "Thank you",
    },
  },
  ar: {
    language: "ar", endonym: "العربية", dir: "rtl", intlTag: "ar-EG-u-nu-latn",
    fontStack: "'Noto Naskh Arabic', 'IBM Plex Sans Arabic', 'Tahoma', sans-serif", version: "1.0",
    strings: {
      "k.order": "طلب", "k.table": "طاولة", "k.dineIn": "محلي", "k.takeaway": "سفري", "k.delivery": "توصيل",
      "k.guests": "ضيوف", "k.seat": "مقعد", "k.course": "طبق", "k.server": "النادل", "k.fired": "أُرسل",
      "k.amendment": "إضافة", "k.void": "ملغى", "k.held": "معلّق", "k.rush": "مستعجل", "k.allergy": "حساسية",
      "k.note": "ملاحظة", "k.no": "بدون", "k.extra": "إضافي",
      "r.order": "طلب", "r.cashier": "الكاشير", "r.table": "طاولة", "r.customer": "العميل", "r.subtotal": "المجموع الفرعي",
      "r.discount": "خصم", "r.service": "رسوم الخدمة", "r.tax": "الضريبة", "r.total": "الإجمالي", "r.paid": "المدفوع",
      "r.change": "الباقي", "r.vatNo": "الرقم الضريبي", "r.points": "نقاط الولاء", "r.duplicate": "نسخة مكررة", "r.thanks": "شكرًا لزيارتكم",
    },
  },
  fr: {
    language: "fr", endonym: "Français", dir: "ltr", intlTag: "fr-FR", fontStack: LATIN, version: "1.0",
    strings: {
      "k.order": "Commande", "k.table": "Table", "k.dineIn": "Sur place", "k.takeaway": "À emporter", "k.delivery": "Livraison",
      "k.guests": "Couverts", "k.seat": "Place", "k.course": "Service", "k.server": "Serveur", "k.fired": "Envoyé",
      "k.amendment": "AJOUT", "k.void": "ANNULÉ", "k.held": "EN ATTENTE", "k.rush": "URGENT", "k.allergy": "ALLERGIE",
      "k.note": "Remarque", "k.no": "Sans", "k.extra": "Supplément",
      "r.order": "Commande", "r.cashier": "Caissier", "r.table": "Table", "r.customer": "Client", "r.subtotal": "Sous-total",
      "r.discount": "Remise", "r.service": "Frais de service", "r.tax": "Taxe", "r.total": "TOTAL", "r.paid": "Payé",
      "r.change": "Rendu", "r.vatNo": "N° TVA", "r.points": "Points fidélité", "r.duplicate": "DUPLICATA", "r.thanks": "Merci",
    },
  },
  tr: {
    language: "tr", endonym: "Türkçe", dir: "ltr", intlTag: "tr-TR", fontStack: LATIN, version: "1.0",
    strings: {
      "k.order": "Sipariş", "k.table": "Masa", "k.dineIn": "Restoranda", "k.takeaway": "Gel-al", "k.delivery": "Paket servis",
      "k.guests": "Kişi", "k.seat": "Koltuk", "k.course": "Servis", "k.server": "Garson", "k.fired": "Gönderildi",
      "k.amendment": "EK", "k.void": "İPTAL", "k.held": "BEKLEMEDE", "k.rush": "ACİL", "k.allergy": "ALERJİ",
      "k.note": "Not", "k.no": "Olmasın", "k.extra": "Ekstra",
      "r.order": "Sipariş", "r.cashier": "Kasiyer", "r.table": "Masa", "r.customer": "Müşteri", "r.subtotal": "Ara toplam",
      "r.discount": "İndirim", "r.service": "Servis ücreti", "r.tax": "Vergi", "r.total": "TOPLAM", "r.paid": "Ödenen",
      "r.change": "Para üstü", "r.vatNo": "Vergi no.", "r.points": "Sadakat puanı", "r.duplicate": "KOPYA", "r.thanks": "Teşekkürler",
    },
  },
  ur: {
    language: "ur", endonym: "اردو", dir: "rtl", intlTag: "ur-PK",
    fontStack: "'Noto Nastaliq Urdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq', serif", version: "1.0",
    strings: {
      "k.order": "آرڈر", "k.table": "میز", "k.dineIn": "یہیں کھائیں", "k.takeaway": "ساتھ لے جائیں", "k.delivery": "ڈیلیوری",
      "k.guests": "مہمان", "k.seat": "نشست", "k.course": "کورس", "k.server": "ویٹر", "k.fired": "بھیج دیا",
      "k.amendment": "اضافہ", "k.void": "منسوخ", "k.held": "روکا گیا", "k.rush": "فوری", "k.allergy": "الرجی",
      "k.note": "نوٹ", "k.no": "بغیر", "k.extra": "اضافی",
      "r.order": "آرڈر", "r.cashier": "کیشیئر", "r.table": "میز", "r.customer": "گاہک", "r.subtotal": "ذیلی کل",
      "r.discount": "رعایت", "r.service": "سروس چارج", "r.tax": "ٹیکس", "r.total": "کل رقم", "r.paid": "ادا شدہ",
      "r.change": "بقایا", "r.vatNo": "ویٹ نمبر", "r.points": "لائلٹی پوائنٹس", "r.duplicate": "نقل", "r.thanks": "شکریہ",
    },
  },
  bn: {
    language: "bn", endonym: "বাংলা", dir: "ltr", intlTag: "bn-BD",
    fontStack: "'Noto Sans Bengali', 'Hind Siliguri', 'Vrinda', sans-serif", version: "1.0",
    strings: {
      "k.order": "অর্ডার", "k.table": "টেবিল", "k.dineIn": "এখানে খাবেন", "k.takeaway": "নিয়ে যাবেন", "k.delivery": "ডেলিভারি",
      "k.guests": "অতিথি", "k.seat": "আসন", "k.course": "কোর্স", "k.server": "ওয়েটার", "k.fired": "পাঠানো হয়েছে",
      "k.amendment": "সংযোজন", "k.void": "বাতিল", "k.held": "স্থগিত", "k.rush": "জরুরি", "k.allergy": "অ্যালার্জি",
      "k.note": "নোট", "k.no": "ছাড়া", "k.extra": "অতিরিক্ত",
      "r.order": "অর্ডার", "r.cashier": "ক্যাশিয়ার", "r.table": "টেবিল", "r.customer": "গ্রাহক", "r.subtotal": "উপমোট",
      "r.discount": "ছাড়", "r.service": "সার্ভিস চার্জ", "r.tax": "কর", "r.total": "মোট", "r.paid": "পরিশোধিত",
      "r.change": "ফেরত", "r.vatNo": "ভ্যাট নং", "r.points": "লয়্যালটি পয়েন্ট", "r.duplicate": "অনুলিপি", "r.thanks": "ধন্যবাদ",
    },
  },
  tl: {
    language: "tl", endonym: "Tagalog", dir: "ltr", intlTag: "fil-PH", fontStack: LATIN, version: "1.0",
    strings: {
      "k.order": "Order", "k.table": "Mesa", "k.dineIn": "Kain dito", "k.takeaway": "Take-out", "k.delivery": "Delivery",
      "k.guests": "Bisita", "k.seat": "Upuan", "k.course": "Kurso", "k.server": "Weyter", "k.fired": "Ipinadala",
      "k.amendment": "DAGDAG", "k.void": "KANSELADO", "k.held": "NAKABINBIN", "k.rush": "AGARAN", "k.allergy": "ALERHIYA",
      "k.note": "Tala", "k.no": "Walang", "k.extra": "Ekstra",
      "r.order": "Order", "r.cashier": "Kahera", "r.table": "Mesa", "r.customer": "Kustomer", "r.subtotal": "Subtotal",
      "r.discount": "Diskwento", "r.service": "Service charge", "r.tax": "Buwis", "r.total": "KABUUAN", "r.paid": "Ibinayad",
      "r.change": "Sukli", "r.vatNo": "VAT no.", "r.points": "Loyalty points", "r.duplicate": "KOPYA", "r.thanks": "Salamat",
    },
  },
  hi: {
    language: "hi", endonym: "हिन्दी", dir: "ltr", intlTag: "hi-IN",
    fontStack: "'Noto Sans Devanagari', 'Mangal', sans-serif", version: "1.0",
    strings: {
      "k.order": "ऑर्डर", "k.table": "टेबल", "k.dineIn": "यहीं खाएँ", "k.takeaway": "पैक करके", "k.delivery": "डिलीवरी",
      "k.guests": "मेहमान", "k.seat": "सीट", "k.course": "कोर्स", "k.server": "वेटर", "k.fired": "भेजा गया",
      "k.amendment": "जोड़", "k.void": "रद्द", "k.held": "रोका गया", "k.rush": "तुरंत", "k.allergy": "एलर्जी",
      "k.note": "नोट", "k.no": "बिना", "k.extra": "अतिरिक्त",
      "r.order": "ऑर्डर", "r.cashier": "कैशियर", "r.table": "टेबल", "r.customer": "ग्राहक", "r.subtotal": "उप-योग",
      "r.discount": "छूट", "r.service": "सेवा शुल्क", "r.tax": "कर", "r.total": "कुल", "r.paid": "भुगतान किया",
      "r.change": "वापसी", "r.vatNo": "वैट नं.", "r.points": "लॉयल्टी पॉइंट", "r.duplicate": "प्रतिलिपि", "r.thanks": "धन्यवाद",
    },
  },
};

/** A pack string, falling back to English — never to a raw key on paper. */
export function packString(language: string, key: PackKey): string {
  const pack = TRANSLATION_PACKS[language as PackLanguage];
  return pack?.strings[key]?.trim() || TRANSLATION_PACKS.en.strings[key] || key;
}

export function packFor(language: string): TranslationPack {
  return TRANSLATION_PACKS[language as PackLanguage] ?? TRANSLATION_PACKS.en;
}

export interface Coverage {
  surface: Surface;
  covered: number;
  required: number;
  percent: number;
  missing: string[];
  complete: boolean;
}

/**
 * FR-LOC-009 — how much of a surface a pack covers. `consoleKeys` is the
 * console dictionary's key list; packs carry none of it, so chrome coverage
 * is reported, and the console refuses to switch into an incomplete pack.
 */
export function coverage(language: PackLanguage, surface: Surface, consoleKeys: string[] = []): Coverage {
  if (surface === "console") {
    const native = language === "en" || language === "ar";
    const required = consoleKeys.length;
    const covered = native ? required : 0;
    return { surface, covered, required, percent: required ? (covered / required) * 100 : 0, missing: native ? [] : consoleKeys.slice(0, 5), complete: native };
  }
  const keys: readonly PackKey[] = surface === "kitchen_ticket" ? KITCHEN_KEYS : RECEIPT_KEYS;
  const strings = TRANSLATION_PACKS[language].strings;
  const missing = keys.filter((key) => !strings[key]?.trim());
  const covered = keys.length - missing.length;
  return { surface, covered, required: keys.length, percent: (covered / keys.length) * 100, missing, complete: missing.length === 0 };
}

/** Languages offered for a surface: only packs that cover it completely. */
export function languagesFor(surface: Exclude<Surface, "console">): PackLanguage[] {
  return PACK_LANGUAGES.filter((language) => coverage(language, surface).complete);
}

// ---------------------------------------------------------------------------
// Assignment — FR-LOC-008
// ---------------------------------------------------------------------------

export type DocumentType = "receipt" | "kitchen_ticket" | "pre_bill" | "shift_report";

export const DOCUMENT_TYPES: DocumentType[] = ["receipt", "kitchen_ticket", "pre_bill", "shift_report"];

/** Which pack surface a document type draws its strings from. */
export function surfaceOf(documentType: DocumentType): Exclude<Surface, "console"> {
  return documentType === "kitchen_ticket" ? "kitchen_ticket" : "receipt";
}

/** Built-in defaults when neither the branch nor the tenant chose. */
export const DOCUMENT_DEFAULTS: Record<DocumentType, PackLanguage[]> = {
  receipt: ["ar", "en"],
  kitchen_ticket: ["ar"],
  pre_bill: ["ar", "en"],
  shift_report: ["en"],
};

export interface UserLanguage {
  /** The user id. */
  id: Id;
  userName: string;
  language: "en" | "ar";
  calendar: "gregory" | "hijri" | "both";
  updatedAt: IsoDateTime;
}

export interface TerminalLanguage {
  /** The terminal id. */
  id: Id;
  branchId: Id;
  terminalName: string;
  /** The till or KDS interface language. */
  language: "en" | "ar";
  updatedAt: IsoDateTime;
}

export interface DocumentLanguage {
  /** `${branchId ?? "tenant"}:${documentType}` */
  id: string;
  branchId: Id | null;
  documentType: DocumentType;
  /** One language, or two in print order for a bilingual document. */
  languages: PackLanguage[];
  updatedAt: IsoDateTime;
}

export function documentLanguageId(branchId: Id | null, documentType: DocumentType): string {
  return `${branchId ?? "tenant"}:${documentType}`;
}

export interface ResolvedDocumentLanguage {
  languages: PackLanguage[];
  from: "branch" | "tenant" | "default";
}

export function resolveDocumentLanguages(rows: DocumentLanguage[], branchId: Id | null, documentType: DocumentType): ResolvedDocumentLanguage {
  const usable = (row: DocumentLanguage | undefined) =>
    row && row.languages.length > 0 && row.languages.every((language) => coverage(language, surfaceOf(documentType)).complete);
  const branchRow = branchId ? rows.find((row) => row.id === documentLanguageId(branchId, documentType)) : undefined;
  if (usable(branchRow)) return { languages: branchRow!.languages, from: "branch" };
  const tenantRow = rows.find((row) => row.id === documentLanguageId(null, documentType));
  if (usable(tenantRow)) return { languages: tenantRow!.languages, from: "tenant" };
  return { languages: DOCUMENT_DEFAULTS[documentType], from: "default" };
}

// ---------------------------------------------------------------------------
// Arabic thermal typography and the printer matrix — FR-LOC-011, FR-LOC-012
// ---------------------------------------------------------------------------

export interface ArabicFont {
  id: string;
  label: string;
  stack: string;
  /** Smallest size, in printer dots, at which it was found legible on 203 dpi thermal heads. */
  minDots: number;
  note: string;
}

/**
 * Candidates for thermal and KDS Arabic. Naskh faces keep the dots under
 * letters apart at small sizes; Kufi faces read better at distance but
 * crowd at 24 dots. The printer's built-in code page is listed because it
 * is what "native" rendering uses.
 */
export const ARABIC_FONTS: ArabicFont[] = [
  { id: "noto_naskh", label: "Noto Naskh Arabic", stack: "'Noto Naskh Arabic', 'Tahoma', serif", minDots: 22, note: "Open counters; dots stay separate at small sizes." },
  { id: "plex_arabic", label: "IBM Plex Sans Arabic", stack: "'IBM Plex Sans Arabic', 'Tahoma', sans-serif", minDots: 24, note: "Even stroke survives thermal bleed." },
  { id: "noto_kufi", label: "Noto Kufi Arabic", stack: "'Noto Kufi Arabic', 'Tahoma', sans-serif", minDots: 28, note: "Best on KDS at distance; crowds on 58 mm." },
  { id: "tahoma", label: "Tahoma (system)", stack: "'Tahoma', 'Arial', sans-serif", minDots: 24, note: "Present on most tills without a download." },
  { id: "printer_cp864", label: "Printer built-in (code page 864)", stack: "monospace", minDots: 24, note: "Native rendering; shaping depends on the printer firmware." },
];

export type RenderMode = "native" | "image";

export interface PrinterModel {
  id: Id;
  vendor: string;
  model: string;
  dpi: number;
  paperWidths: (58 | 80)[];
  /** Vendor claim — what the matrix is there to test, not to trust. */
  claimsArabic: boolean;
  createdAt: IsoDateTime;
}

export interface PrintTestRecord {
  id: Id;
  printerModelId: Id;
  paperWidth: 58 | 80;
  renderMode: RenderMode;
  fontId: string;
  sizeDots: number;
  result: "pass" | "fail";
  /** What went wrong, or what was checked. */
  notes: string;
  firmware: string;
  testedBy: string | null;
  testedAt: IsoDateTime;
}

export interface PrintProfile {
  arabicFontId: string;
  /** Printed text size in dots (203 dpi: 24 dots ≈ 3 mm). */
  receiptSizeDots: number;
  /** KDS Arabic size in CSS px, chosen for 2 m viewing. */
  kdsFontId: string;
  kdsSizePx: number;
  updatedAt: IsoDateTime;
}

export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  arabicFontId: "noto_naskh",
  receiptSizeDots: 24,
  kdsFontId: "noto_kufi",
  kdsSizePx: 48,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

/**
 * FR-LOC-011 — the smallest KDS font size, in CSS px, that keeps Arabic
 * x-height above a visual angle at a viewing distance. Arabic x-height is
 * about half the font size, and its dots are what fail first, so the angle
 * is applied to the x-height rather than to capitals. 10 arcmin is the floor
 * for short labels; 16 arcmin is comfortable for item names read mid-rush.
 * Pixel pitch defaults to a 21.5-inch 1080p panel (0.248 mm).
 */
export function kdsMinimumPx(distanceMetres = 2, arcMinutes = 10, pixelPitchMm = 0.248): number {
  const xHeightMm = distanceMetres * 1000 * Math.tan(((arcMinutes / 60) * Math.PI) / 180);
  return Math.ceil(xHeightMm / 0.5 / pixelPitchMm);
}

export type MatrixCell = { state: "pass" | "fail" | "untested"; record: PrintTestRecord | null };

/** Latest result per model × paper × mode. */
export function matrixCell(records: PrintTestRecord[], modelId: Id, paperWidth: 58 | 80, mode: RenderMode): MatrixCell {
  const latest = records
    .filter((row) => row.printerModelId === modelId && row.paperWidth === paperWidth && row.renderMode === mode)
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0];
  return latest ? { state: latest.result, record: latest } : { state: "untested", record: null };
}

/**
 * FR-LOC-012 — how a model should print Arabic: native only if native passed
 * its latest test; otherwise the image fallback if that passed; otherwise
 * image anyway, flagged untested, because image rendering does not depend on
 * the printer's Arabic support at all.
 */
export function recommendedMode(records: PrintTestRecord[], modelId: Id, paperWidth: 58 | 80): { mode: RenderMode; verified: boolean } {
  if (matrixCell(records, modelId, paperWidth, "native").state === "pass") return { mode: "native", verified: true };
  if (matrixCell(records, modelId, paperWidth, "image").state === "pass") return { mode: "image", verified: true };
  return { mode: "image", verified: false };
}
