/**
 * Invoice OCR — the extraction seam for SRS FR-PRC-046.
 *
 * "OCR is presented as an accelerator, never as an authority." The capture
 * screen always ends in a person verifying every field before an invoice is
 * posted; an extractor only pre-fills that form, marking each value it
 * supplied (with its confidence) as unverified.
 *
 * No OCR engine or endpoint exists in this deployment, so nothing is
 * registered and the capture screen says so: the photo sits beside the form
 * and the invoice is keyed by hand. When a server (or a licensed client-side
 * engine) is available, it is plugged in with `registerInvoiceExtractor` and
 * no screen changes. Nothing here pretends to read an image.
 */

export interface Extracted<T> {
  value: T;
  /** 0–1, as reported by the engine. */
  confidence: number;
}

export interface ExtractedLine {
  description: Extracted<string>;
  quantity: Extracted<string>;
  unitPriceMinor: Extracted<number>;
  totalMinor: Extracted<number>;
}

export interface InvoiceExtraction {
  supplierName: Extracted<string> | null;
  invoiceNumber: Extracted<string> | null;
  invoiceDate: Extracted<string> | null;
  lines: ExtractedLine[];
  subtotalMinor: Extracted<number> | null;
  taxMinor: Extracted<number> | null;
  totalMinor: Extracted<number> | null;
}

export interface InvoiceExtractor {
  /** Shown on the capture record, e.g. "server-ocr v2". */
  id: string;
  extract(image: Blob): Promise<InvoiceExtraction>;
}

let registered: InvoiceExtractor | null = null;

export function registerInvoiceExtractor(extractor: InvoiceExtractor | null): void {
  registered = extractor;
}

/** The configured extractor, or null — which is the case today. */
export function invoiceExtractor(): InvoiceExtractor | null {
  return registered;
}

/** Below this, a pre-filled value is flagged for a closer look. */
export const LOW_CONFIDENCE = 0.8;
