/**
 * Shared Zod building blocks.
 *
 * Validation messages are dictionary **keys**, not sentences. A schema is a
 * plain module with no access to the active locale, and a form that shows
 * "Required" to an Arabic user has failed at the first hurdle — so the schema
 * emits `validation.required` and the form renders it through `t()`.
 *
 * Parameters ride on the key after a colon: `validation.minLength:3`. The
 * renderer in `schemas/messages.ts` splits it and substitutes.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Message keys
// ---------------------------------------------------------------------------

export const V = {
  required: "validation.required",
  email: "validation.email",
  phone: "validation.phone",
  min: (n: number) => `validation.minLength:${n}`,
  max: (n: number) => `validation.maxLength:${n}`,
  minValue: (n: number) => `validation.minValue:${n}`,
  maxValue: (n: number) => `validation.maxValue:${n}`,
  positive: "validation.positive",
  nonNegative: "validation.nonNegative",
  integer: "validation.integer",
  digits: (n: number) => `validation.digits:${n}`,
  passwordWeak: "validation.passwordWeak",
  passwordMismatch: "validation.passwordMismatch",
  url: "validation.url",
  date: "validation.date",
  dateOrder: "validation.dateOrder",
  atLeastOne: "validation.atLeastOne",
  duplicate: "validation.duplicate",
  arabicRequired: "validation.arabicRequired",
  englishRequired: "validation.englishRequired",
  currencyMismatch: "validation.currencyMismatch",
  percentRange: "validation.percentRange",
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const requiredString = (max = 200) =>
  z.string().trim().min(1, V.required).max(max, V.max(max));

export const optionalString = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, V.max(max))
    .optional()
    .or(z.literal("").transform(() => undefined));

export const emailField = z
  .string()
  .trim()
  .min(1, V.required)
  .email(V.email)
  .transform((v) => v.toLowerCase());

/**
 * E.164-ish. Deliberately permissive about separators, because the three
 * country packs write the same number four different ways and rejecting a
 * space is not validation, it is rudeness.
 */
export const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{7,20}$/, V.phone);

export const optionalPhone = phoneField
  .optional()
  .or(z.literal("").transform(() => undefined));

/** A localised name. Both sides are required — FR-LOC-006. */
export const localisedName = z.object({
  en: z.string().trim().min(1, V.englishRequired).max(120, V.max(120)),
  ar: z.string().trim().min(1, V.arabicRequired).max(120, V.max(120)),
});

/** A localised description, where either side may be left blank. */
export const localisedText = z.object({
  en: z.string().trim().max(600, V.max(600)).default(""),
  ar: z.string().trim().max(600, V.max(600)).default(""),
});

/**
 * Money entered by a person: major units as a string, so the input never
 * fights the user over a leading zero or a trailing decimal point. Converted
 * to minor units by `toMinorUnits` at submit time — a float never reaches
 * the store.
 */
export const majorAmount = (opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .trim()
    .min(1, V.required)
    .regex(/^\d{1,12}(\.\d{1,3})?$/, V.positive)
    .refine((v) => opts.min === undefined || Number(v) >= opts.min, V.minValue(opts.min ?? 0))
    .refine((v) => opts.max === undefined || Number(v) <= opts.max, V.maxValue(opts.max ?? 0));

export function toMinorUnits(major: string, exponent = 2): number {
  return Math.round(Number(major) * 10 ** exponent);
}

export const percentField = z.coerce
  .number()
  .min(0, V.percentRange)
  .max(100, V.percentRange);

export const positiveQuantity = z.coerce.number().positive(V.positive);

export const nonNegativeQuantity = z.coerce.number().min(0, V.nonNegative);

/** `YYYY-MM-DD`, the shape every date field in the system uses. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, V.date);

export const optionalIsoDate = isoDate
  .optional()
  .or(z.literal("").transform(() => undefined));

/** `HH:MM` in 24-hour form — opening hours, business-day close. */
export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, V.date);

export const digitsOnly = (length: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${length}}$`), V.digits(length));

/**
 * A date range where the end must not precede the start. The error is
 * attached to `to`, because that is the field the user should change.
 */
export const dateRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: V.dateOrder, path: ["to"] });

export const nonEmptyArray = <T extends z.ZodTypeAny>(inner: T) =>
  z.array(inner).min(1, V.atLeastOne);
