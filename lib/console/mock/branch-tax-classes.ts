/**
 * Mock implementation of `GET /catalogue/branches/{branchId}/tax-classes`
 * (DEMO-TAX-CLASS-BACKEND-P0) — see `./tax-classes.ts` for why the id
 * builder lives in its own dependency-free module. This one resolves the
 * pack currently effective for a branch's jurisdiction, mirroring
 * `CountryPackService.resolveForBranch`.
 */

import type { BranchTaxClass, CountryPack, Id } from "../types";
import { branchById } from "./org";
import { countryPacks } from "./platform";
import { taxClassId } from "./tax-classes";

function toBranchTaxClasses(pack: CountryPack): BranchTaxClass[] {
  return pack.taxClasses.map((tc) => ({
    id: taxClassId(pack.code, tc.code),
    code: tc.code,
    names: tc.label,
  }));
}

/**
 * The pack effective for this branch's jurisdiction — mirrors
 * `CountryPackService.resolveForBranch`: the branch's own `countryCode`,
 * its active pack if one exists. `null` collapses "unknown branch" and "no
 * activated pack" into one failure shape, same as the real endpoint's 404
 * and 422 are indistinguishable to a caller with no legitimate reason to
 * tell them apart.
 */
export function sellableTaxClassesForBranch(branchId: Id): BranchTaxClass[] | null {
  const branch = branchById.get(branchId);
  if (!branch) return null;
  const pack =
    countryPacks.find((p) => p.code === branch.countryCode && p.status === "active") ??
    countryPacks.find((p) => p.code === branch.countryCode);
  return pack ? toBranchTaxClasses(pack) : [];
}
