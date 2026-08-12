/**
 * The fifteen steps between an empty tenant and a first sale.
 *
 * Each step is its own schema so the wizard can validate one step without
 * demanding the ones after it, and `onboardingDraftSchema` is the partial
 * union that gets written to storage when the user saves and leaves.
 */

import { z } from "zod";
import {
  V,
  digitsOnly,
  emailField,
  isoDate,
  localisedName,
  majorAmount,
  nonNegativeQuantity,
  optionalPhone,
  optionalString,
  percentField,
  phoneField,
  requiredString,
  timeOfDay,
} from "./common";

export const COUNTRIES = ["EG", "SA", "AE", "JO", "KW", "QA"] as const;
export const CURRENCIES = ["EGP", "SAR", "AED"] as const;
export const ORDER_TYPES = [
  "dine_in",
  "takeaway",
  "delivery",
  "drive_thru",
  "pickup",
  "aggregator",
] as const;
export const TENDER_TYPES = [
  "cash",
  "card",
  "wallet",
  "gift_card",
  "loyalty_points",
  "store_credit",
  "voucher",
  "bank_transfer",
  "on_account",
  "aggregator_settled",
] as const;

// -- 1. Tenant ---------------------------------------------------------------

export const tenantStepSchema = z.object({
  name: localisedName,
  country: z.enum(COUNTRIES),
});

// -- 2. Business information -------------------------------------------------

export const businessStepSchema = z.object({
  legalName: requiredString(160),
  /** VAT/TRN. Length differs per country, so the pack validates the format. */
  taxRegistrationNumber: optionalString(30),
  commercialRegistration: optionalString(30),
  addressLine: requiredString(200),
  city: requiredString(80),
  phone: phoneField,
  email: emailField,
});

// -- 3. Brand ----------------------------------------------------------------

export const brandStepSchema = z.object({
  name: localisedName,
  concept: z.enum(["casual_dining", "quick_service", "cafe", "cloud_kitchen", "fine_dining"]),
  /** Six-digit hex; the POS tile colour and the receipt header both use it. */
  accentColour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, V.duplicate)
    .default("#0f766e"),
});

// -- 4. First branch ---------------------------------------------------------

export const branchStepSchema = z.object({
  name: localisedName,
  addressLine: requiredString(200),
  city: requiredString(80),
  phone: optionalPhone,
  seats: z.coerce.number().int(V.integer).min(0, V.nonNegative).max(2000, V.maxValue(2000)),
  orderTypes: z.array(z.enum(ORDER_TYPES)).min(1, V.atLeastOne),
});

// -- 5. Country and currency -------------------------------------------------

export const localeStepSchema = z.object({
  country: z.enum(COUNTRIES),
  currency: z.enum(CURRENCIES),
  timezone: requiredString(60),
  defaultLocale: z.enum(["ar", "en"]),
  arabicIndicNumerals: z.boolean().default(false),
});

// -- 6. Tax ------------------------------------------------------------------

export const taxStepSchema = z.object({
  /** BR-TAX-001 — whether the menu price already contains the tax. */
  pricingMode: z.enum(["tax_inclusive", "tax_exclusive"]),
  standardRate: percentField,
  reducedRate: percentField.optional(),
  roundingMode: z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]),
  computationLevel: z.enum(["line", "order"]),
});

// -- 7. Business day ---------------------------------------------------------

export const businessDayStepSchema = z.object({
  /**
   * A restaurant closing at 02:00 books those sales against the previous
   * calendar date. Getting this wrong shifts a night's takings into the wrong
   * day and every report built on it — BR-CORE-010.
   */
  closingTime: timeOfDay,
  weekStart: z.enum(["saturday", "sunday", "monday"]),
  autoCloseEnabled: z.boolean().default(true),
});

// -- 8. Menu categories ------------------------------------------------------

export const categoryDraftSchema = z.object({
  id: z.string(),
  name: localisedName,
  sortOrder: z.coerce.number().int(V.integer).min(0, V.nonNegative),
});

export const categoriesStepSchema = z.object({
  categories: z.array(categoryDraftSchema).min(1, V.atLeastOne),
});

// -- 9. Menu items -----------------------------------------------------------

export const itemDraftSchema = z.object({
  id: z.string(),
  name: localisedName,
  categoryId: z.string().min(1, V.required),
  price: majorAmount({ min: 0 }),
  taxClass: z.enum(["standard", "reduced", "zero", "exempt"]).default("standard"),
  prepMinutes: z.coerce.number().int(V.integer).min(0, V.nonNegative).max(240, V.maxValue(240)),
});

export const itemsStepSchema = z.object({
  items: z.array(itemDraftSchema).min(1, V.atLeastOne),
});

// -- 10. Payment methods -----------------------------------------------------

export const paymentsStepSchema = z.object({
  enabled: z.array(z.enum(TENDER_TYPES)).min(1, V.atLeastOne),
  // BR-CASH-004 — the smallest coin still in circulation. Egypt rounds to 25
  // piastres, so a cash total of 12.30 is tendered as 12.25.
  cashRoundingMinorUnits: nonNegativeQuantity,
});

// -- 11. First employee ------------------------------------------------------

export const employeeStepSchema = z.object({
  name: localisedName,
  position: requiredString(60),
  email: emailField,
  phone: optionalPhone,
  pin: digitsOnly(4),
  startDate: isoDate,
  roleKey: z.string().min(1, V.required),
});

// -- 12. Terminal ------------------------------------------------------------

export const terminalStepSchema = z.object({
  name: requiredString(60),
  deviceType: z.enum(["pos", "kds", "kiosk", "handheld"]),
  printerAttached: z.boolean().default(true),
  cashDrawerAttached: z.boolean().default(true),
});

// -- 14. Open shift ----------------------------------------------------------

export const shiftStepSchema = z.object({
  openingFloat: majorAmount({ min: 0 }),
});

// ---------------------------------------------------------------------------
// The whole wizard
// ---------------------------------------------------------------------------

export const ONBOARDING_STEPS = [
  "tenant",
  "business",
  "brand",
  "branch",
  "locale",
  "tax",
  "businessDay",
  "categories",
  "items",
  "payments",
  "employee",
  "terminal",
  "preview",
  "shift",
  "sample",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** Steps a restaurant may legitimately skip and still take an order. */
export const OPTIONAL_STEPS: OnboardingStepId[] = ["business", "employee"];

export const onboardingDraftSchema = z.object({
  tenant: tenantStepSchema.partial().optional(),
  business: businessStepSchema.partial().optional(),
  brand: brandStepSchema.partial().optional(),
  branch: branchStepSchema.partial().optional(),
  locale: localeStepSchema.partial().optional(),
  tax: taxStepSchema.partial().optional(),
  businessDay: businessDayStepSchema.partial().optional(),
  categories: categoriesStepSchema.partial().optional(),
  items: itemsStepSchema.partial().optional(),
  payments: paymentsStepSchema.partial().optional(),
  employee: employeeStepSchema.partial().optional(),
  terminal: terminalStepSchema.partial().optional(),
  shift: shiftStepSchema.partial().optional(),
});

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

export type TenantStep = z.infer<typeof tenantStepSchema>;
export type BusinessStep = z.infer<typeof businessStepSchema>;
export type BrandStep = z.infer<typeof brandStepSchema>;
export type BranchStep = z.infer<typeof branchStepSchema>;
export type LocaleStep = z.infer<typeof localeStepSchema>;
export type TaxStep = z.infer<typeof taxStepSchema>;
export type BusinessDayStep = z.infer<typeof businessDayStepSchema>;
export type CategoriesStep = z.infer<typeof categoriesStepSchema>;
export type ItemsStep = z.infer<typeof itemsStepSchema>;
export type PaymentsStep = z.infer<typeof paymentsStepSchema>;
export type EmployeeStep = z.infer<typeof employeeStepSchema>;
export type TerminalStep = z.infer<typeof terminalStepSchema>;
export type ShiftStep = z.infer<typeof shiftStepSchema>;
export type CategoryDraft = z.infer<typeof categoryDraftSchema>;
export type ItemDraft = z.infer<typeof itemDraftSchema>;
