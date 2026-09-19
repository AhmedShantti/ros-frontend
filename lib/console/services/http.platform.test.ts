import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FRONTEND-REAL-UX-BATCH-1A — `platform.reports()` used to be
 * `unsupportedPlatform.reports`, which threw NOT_IMPLEMENTED
 * ("The report catalogue") on every call, so `/reports` and `/reports/[id]`
 * were dead on any live backend. It now resolves to the static
 * `REAL_REPORT_CATALOGUE` — no network call, no NOT_IMPLEMENTED.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`), same
 * pattern as `http.test.ts` — the real `http.ts` module runs.
 */

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listBranches: vi.fn().mockResolvedValue([]),
      getAccessibleScope: vi.fn().mockResolvedValue({ tenantId: "t1", brands: [], branches: [] }),
    },
  },
}));

let httpServices: typeof import("./http")["httpServices"];

beforeEach(async () => {
  vi.resetModules();
  ({ httpServices } = await import("./http"));
});

describe("http.ts — platform.reports", () => {
  it("resolves to the real, static report catalogue instead of throwing NOT_IMPLEMENTED", async () => {
    const { REAL_REPORT_CATALOGUE } = await import("../reports/real-catalogue");
    await expect(httpServices.platform.reports()).resolves.toEqual(REAL_REPORT_CATALOGUE);
  });

  it("still reports countryPacks/integrations as unsupported — no backend resource for either", async () => {
    await expect(httpServices.platform.countryPacks.list()).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
    });
  });
});
