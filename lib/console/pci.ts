/**
 * What a card payment may leave behind — FR-POS-066.
 *
 * The System SHALL NOT store, log or transmit a card number, the CVV or
 * magnetic-stripe data. The last four digits, the scheme, the authorisation
 * code and the terminal's reference are all a payment may keep.
 *
 * The integrated terminal already keeps the card away from the till, so the
 * danger here is not the happy path. It is the three ways a card number
 * reaches a POS anyway:
 *
 *   1. A cashier keys a manual payment and types the whole number into the
 *      "last four" field, because that is the number printed on the card.
 *   2. A card is swiped through the keyboard-wedge reader that also reads
 *      barcodes and staff cards, and its track data lands in whatever field
 *      has focus — the menu search, a note, a refund reason.
 *   3. Someone writes the number into free text: "guest paid with 4111…".
 *
 * Every one of those goes through this module before it is stored, and the
 * store is what the offline queue replays to the server, so nothing that
 * leaves here unredacted can reach the network later either.
 *
 * Pure and dependency-free on purpose: the reducer, the payment sheet and the
 * scanner hook all call the same functions.
 */

/** Track 1 (`%B…^…?`) and track 2 (`;…=…?`) as a card reader emits them. */
const TRACK_1 = /%B\d{12,19}\^[^?]*\?/g;
const TRACK_2 = /;\d{12,19}=[^?]*\?/g;

/**
 * A run of 13–19 digits, allowing the spaces and dashes people type between
 * groups. Checked with Luhn before anything is redacted, so an order number
 * or a phone number that merely happens to be long is left alone.
 */
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** The Luhn check every payment card number satisfies. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True when the text carries track data or anything that validates as a PAN. */
export function containsCardData(text: string | null | undefined): boolean {
  if (!text) return false;
  if (new RegExp(TRACK_1.source).test(text) || new RegExp(TRACK_2.source).test(text)) return true;
  for (const match of text.matchAll(DIGIT_RUN)) {
    if (luhnValid(match[0].replace(/[ -]/g, ""))) return true;
  }
  return false;
}

/**
 * Free text with every card number replaced by its masked form.
 *
 * The last four survive because they are allowed and because they are what
 * makes the note still mean something ("paid with the card ending 1111").
 */
export function redactCardData(text: string): string {
  return text
    .replace(TRACK_1, "[card data removed]")
    .replace(TRACK_2, "[card data removed]")
    .replace(DIGIT_RUN, (run) => {
      const digits = run.replace(/[ -]/g, "");
      return luhnValid(digits) ? `•••• ${digits.slice(-4)}` : run;
    });
}

/**
 * A field's text with a card swipe taken back out of it.
 *
 * When a reader types a swipe into whatever field had focus, the field
 * should read as it did before the swipe — not keep a "[card data removed]"
 * the cashier never typed. Track data is removed outright, including a read
 * cut off before its end sentinel; any card number typed by hand is masked.
 */
export function stripSwipe(text: string): string {
  return redactCardData(
    text
      .replace(TRACK_1, "")
      .replace(TRACK_2, "")
      .replace(/%B\d{12,19}\^[^?]*$/, "")
      .replace(/;\d{12,19}=[^?]*$/, ""),
  );
}

/** `redactCardData` for the nullable fields the domain uses. */
export function redactOptional(text: string | null | undefined): string | null {
  if (text == null) return null;
  return redactCardData(text);
}

const SCHEMES = ["Visa", "Mastercard", "Amex", "Meeza", "Mada", "UnionPay", "Other"] as const;
export type CardScheme = (typeof SCHEMES)[number];
export const CARD_SCHEMES: readonly CardScheme[] = SCHEMES;

/**
 * The four fields a card payment may keep, and nothing else.
 *
 * `last4` accepts whatever was typed or returned and keeps only its final
 * four digits — so a full number pasted into the field is truncated here,
 * before any record is made, rather than trusted to have been four digits.
 * An authorisation code or reference that turns out to contain a card number
 * is dropped entirely: there is no safe partial form of a field that was
 * never meant to hold one.
 */
export interface RetainedCardData {
  cardLast4: string | null;
  cardScheme: string | null;
  authorisationCode: string | null;
  terminalReference: string | null;
}

export function retainCardData(input: {
  last4?: string | null;
  scheme?: string | null;
  authorisationCode?: string | null;
  terminalReference?: string | null;
}): RetainedCardData {
  const digits = (input.last4 ?? "").replace(/\D/g, "");
  const scheme = input.scheme?.trim() ?? "";
  const clean = (value: string | null | undefined, max: number) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed || containsCardData(trimmed)) return null;
    return trimmed.slice(0, max);
  };
  return {
    cardLast4: digits.length >= 4 ? digits.slice(-4) : null,
    cardScheme: scheme ? (SCHEMES.find((s) => s.toLowerCase() === scheme.toLowerCase()) ?? "Other") : null,
    authorisationCode: clean(input.authorisationCode, 12),
    terminalReference: clean(input.terminalReference, 32),
  };
}

/** The scheme a card number belongs to, from its leading digits only. */
export function schemeFromBin(digits: string): CardScheme | null {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^5078/.test(digits)) return "Meeza";
  if (/^62/.test(digits)) return "UnionPay";
  return null;
}

/**
 * Whether a burst from the keyboard-wedge reader was a payment card swipe.
 *
 * The same reader serves barcodes and staff ID cards. A payment card is
 * recognised and thrown away without its digits ever reaching state, a
 * field or a log line — the caller only learns that it happened.
 *
 * Recognised by the track sentinels a reader emits, never by a Luhn check
 * on bare digits: roughly one EAN-13 barcode in ten happens to satisfy Luhn,
 * and a scanner that discarded those would silently lose real products. A
 * truncated read (the reader stopped before the end sentinel) still counts.
 */
export function isPaymentCardSwipe(raw: string): boolean {
  const text = raw.trim();
  if (new RegExp(TRACK_1.source).test(text) || new RegExp(TRACK_2.source).test(text)) return true;
  return /^%B\d{12,19}\^/.test(text) || /^;\d{12,19}=/.test(text);
}
