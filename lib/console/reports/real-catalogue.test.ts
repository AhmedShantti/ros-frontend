import { describe, expect, it } from "vitest";
import { REAL_REPORT_CATALOGUE } from "./real-catalogue";
import { hasBuilder } from "./engine";

/*
 * FRONTEND-REAL-UX-BATCH-1A — `/reports` used to fetch a backend "report
 * catalogue" that has never existed. This is now a static, frontend-only
 * catalogue restricted to reports that are demonstrably real against the
 * canonical backend (kitchen-kit-backend-clean-baseline @ ad99ba2):
 *
 *   - Every id must have a working builder in `reports/engine.ts` — except
 *     `z-report`, which hands off to the already-real `/finance/day-close`
 *     screen instead of running through the generic runner.
 *   - `requiredPermission` must be a real backend permission code, never
 *     the SRS-only `report.view.<category>` vocabulary the backend has
 *     only ever defined two of (`report.view.sales`, `report.view.financial`
 *     — `reporting.permissions.ts`).
 *   - No workforce report (`services.workforce.attendance` is
 *     `absentCollection`) and no `prep-time` (its only data source, the KDS
 *     station-queue route, is `@AllowKdsSession()`-only server-side and can
 *     never answer a Console bearer session).
 */

const REAL_PERMISSIONS = new Set([
  "pos.order.create",
  "inventory.view",
  "report.view.financial",
]);

const EXCLUDED_FAKE_IDS = [
  "attendance",
  "overtime",
  "labour-cost",
  "sales-per-labour-hour",
  "prep-time",
  "cash-reconciliation",
  "tax-summary",
  "station-performance",
  "delayed-orders",
];

describe("Reports — real catalogue", () => {
  it("is non-empty and has no duplicate ids", () => {
    expect(REAL_REPORT_CATALOGUE.length).toBeGreaterThan(0);
    const ids = REAL_REPORT_CATALOGUE.map((report) => report.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gates every entry on a real backend permission code, never an SRS-only one", () => {
    for (const report of REAL_REPORT_CATALOGUE) {
      expect(REAL_PERMISSIONS.has(report.requiredPermission)).toBe(true);
    }
  });

  it("has a working engine builder for every entry except the day-close hand-off", () => {
    for (const report of REAL_REPORT_CATALOGUE) {
      if (report.id === "z-report") continue;
      expect(hasBuilder(report.id)).toBe(true);
    }
  });

  it("never lists a report backed by an absent/unsupported data source", () => {
    const ids = new Set(REAL_REPORT_CATALOGUE.map((report) => report.id));
    for (const fakeId of EXCLUDED_FAKE_IDS) {
      expect(ids.has(fakeId)).toBe(false);
    }
  });

  it("carries bilingual name/description for every entry", () => {
    for (const report of REAL_REPORT_CATALOGUE) {
      expect(report.name.en).toBeTruthy();
      expect(report.name.ar).toBeTruthy();
      expect(report.description.en).toBeTruthy();
      expect(report.description.ar).toBeTruthy();
    }
  });
});
