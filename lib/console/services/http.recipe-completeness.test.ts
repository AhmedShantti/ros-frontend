import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `production.requiringCompletion` — the real backend's completeness report
 * only ever sends `absentCount`/`incompleteCount` today (no `unpriced`/
 * `unconvertible` reason exists yet in `RecipeCompletenessReason`). A
 * coworker commit added UI for two more counts, `unpricedCount` and
 * `unconvertibleCount`, that the real endpoint simply never sends. This
 * proves `http.ts` never invents a value for either — a response missing
 * them resolves to exactly 0, so the UI's `count > 0` tiles never render
 * against the real, current, live backend.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`), same
 * pattern as `http.platform.test.ts`.
 */

const recipesRequiringCompletion = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    production: {
      recipesRequiringCompletion: (...args: unknown[]) => recipesRequiringCompletion(...args),
    },
  },
}));

let httpServices: typeof import("./http")["httpServices"];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ httpServices } = await import("./http"));
});

describe("http.ts — production.requiringCompletion (real backend, no unpriced/unconvertible yet)", () => {
  it("defaults unpricedCount/unconvertibleCount to 0 when the real response omits them entirely", async () => {
    recipesRequiringCompletion.mockResolvedValue({
      branchId: "b1",
      sellableVariantCount: 10,
      absentCount: 2,
      incompleteCount: 1,
      entries: [],
      // No unpricedCount / unconvertibleCount — the real backend never sends these.
    });

    const report = await httpServices.production.requiringCompletion("b1");

    expect(report.absentCount).toBe(2);
    expect(report.incompleteCount).toBe(1);
    expect(report.unpricedCount).toBe(0);
    expect(report.unconvertibleCount).toBe(0);
  });

  it("never fabricates a nonzero count when the field is simply absent from the wire response", async () => {
    recipesRequiringCompletion.mockResolvedValue({
      branchId: null,
      sellableVariantCount: 0,
      absentCount: 0,
      incompleteCount: 0,
      entries: [],
    });

    const report = await httpServices.production.requiringCompletion();
    expect(report).toMatchObject({ unpricedCount: 0, unconvertibleCount: 0 });
  });
});
