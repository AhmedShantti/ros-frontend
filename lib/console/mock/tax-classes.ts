/**
 * Mock analogue of the backend's per-tenant `fiscal.tax_classes` registry
 * (DEMO-TAX-CLASS-BACKEND-P0) — `GET /catalogue/branches/{branchId}/tax-classes`.
 *
 * The real registry is materialised per-tenant the moment a country pack is
 * assigned, with a real database `id`; branch-scoping just reads whichever
 * pack is currently effective for that branch's jurisdiction. The mock does
 * the same thing deterministically off `Branch.countryCode` — see
 * `./branch-tax-classes.ts`, which resolves that against `mock/platform`'s
 * `countryPacks`. This file stays free of that dependency on purpose: the
 * seed builder (`./catalogue.ts`) needs a stable id for `MenuItem.taxClassId`
 * before any menu item exists, and `mock/platform.ts` transitively depends
 * on `menuItems` (via `mock/sales.ts`) — importing it here would close a
 * circular-import loop back through `./catalogue.ts`.
 */

import type { Id, TaxClassCode } from "../types";

/** The demo tenant's home jurisdiction — matches `mock/platform.ts`'s Egypt pack, which every branch seed but a handful of others defaults to. */
const DEFAULT_PACK_CODE = "EG";

export function taxClassId(packCode: string, code: string): Id {
  return `txc_${packCode.toLowerCase()}_${code}`;
}

/**
 * Resolves a semantic `TaxClassCode` to the registry id the seed builder
 * (`./catalogue.ts`) writes into `MenuItem.taxClassId` — every seeded item
 * predates DEMO-TAX-CLASS-BACKEND-P0 and was written as a bare code
 * ("standard", "zero", ...), the exact shape this whole fix roots out.
 */
export function taxClassIdForCode(code: TaxClassCode): Id {
  return taxClassId(DEFAULT_PACK_CODE, code);
}

/** The value `withDemoZeroTaxClass` (`./catalogue.ts`) writes to `MenuItem.taxClassId` — a real registry id, never the bare code `"zero"`. */
export const DEMO_ZERO_TAX_CLASS_ID: Id = taxClassIdForCode("zero");
