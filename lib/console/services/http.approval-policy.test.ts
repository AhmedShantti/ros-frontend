import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-035/047/058 — the HTTP boundary for `GET`/`POST
 * /branches/{branchId}/inventory-approval-policy`. Mocked only at the
 * transport boundary (`@/lib/api/endpoints`), same pattern as
 * `http.purchase-units.test.ts` — the real `http.ts` module runs, so this
 * proves the actual service-layer call and mapping, not a service-layer
 * mock. If `httpServices.inventory.getApprovalPolicy`/`createApprovalPolicy`
 * ever fell back to mock data instead of calling through, the `api.inventory`
 * spies below would never be invoked and every assertion here would fail.
 */

const getPolicy = vi.fn();
const createPolicy = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      getPolicy: (...args: unknown[]) => getPolicy(...args),
      createPolicy: (...args: unknown[]) => createPolicy(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

const POLICY_ROW = {
  id: "iapv-1",
  branchId: "branch-1",
  currency: "EGP",
  adjustmentValueThresholdMinor: "50000",
  countVarianceValueThresholdMinor: "100000",
  wasteValueThresholdMinor: "30000",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  getPolicy.mockResolvedValue({ policy: null });
  createPolicy.mockResolvedValue(POLICY_ROW);
  ({ httpServices } = await import("./http"));
});

describe("Inventory approval policy — FR-INV-035/047/058 HTTP boundary", () => {
  it("getApprovalPolicy calls the real GET route with the branch id", async () => {
    await httpServices.inventory.getApprovalPolicy("branch-1");

    expect(getPolicy).toHaveBeenCalledTimes(1);
    expect(getPolicy).toHaveBeenCalledWith("branch-1");
  });

  it("getApprovalPolicy returns null when the branch has no policy — never substitutes a default", async () => {
    getPolicy.mockResolvedValue({ policy: null });

    const result = await httpServices.inventory.getApprovalPolicy("branch-1");

    expect(result).toBeNull();
  });

  it("getApprovalPolicy maps an existing policy's minor-unit strings through unmodified", async () => {
    getPolicy.mockResolvedValue({ policy: POLICY_ROW });

    const result = await httpServices.inventory.getApprovalPolicy("branch-1");

    expect(result).toEqual({
      id: "iapv-1",
      branchId: "branch-1",
      currency: "EGP",
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(typeof result?.adjustmentValueThresholdMinor).toBe("string");
  });

  it("getApprovalPolicy preserves a null threshold (\"always require approval\") rather than coercing it", async () => {
    getPolicy.mockResolvedValue({
      policy: { ...POLICY_ROW, wasteValueThresholdMinor: null },
    });

    const result = await httpServices.inventory.getApprovalPolicy("branch-1");

    expect(result?.wasteValueThresholdMinor).toBeNull();
  });

  it("createApprovalPolicy calls the real POST route with exactly the three threshold fields — no currency, no effectiveFrom", async () => {
    await httpServices.inventory.createApprovalPolicy("branch-1", {
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });

    expect(createPolicy).toHaveBeenCalledWith("branch-1", {
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });
    const [, body] = createPolicy.mock.calls[0]!;
    expect(body).not.toHaveProperty("currency");
    expect(body).not.toHaveProperty("effectiveFrom");
  });

  it("createApprovalPolicy sends thresholds as strings, never numbers", async () => {
    await httpServices.inventory.createApprovalPolicy("branch-1", {
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });

    const [, body] = createPolicy.mock.calls[0]!;
    expect(typeof body.adjustmentValueThresholdMinor).toBe("string");
    expect(typeof body.countVarianceValueThresholdMinor).toBe("string");
    expect(typeof body.wasteValueThresholdMinor).toBe("string");
  });

  it("createApprovalPolicy passes an explicit null through for a threshold left blank, never '0' or omitted", async () => {
    await httpServices.inventory.createApprovalPolicy("branch-1", {
      adjustmentValueThresholdMinor: null,
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });

    const [, body] = createPolicy.mock.calls[0]!;
    expect(body.adjustmentValueThresholdMinor).toBeNull();
  });

  it("createApprovalPolicy returns the server-derived currency from the response, not an invented one", async () => {
    createPolicy.mockResolvedValue({ ...POLICY_ROW, currency: "SAR" });

    const result = await httpServices.inventory.createApprovalPolicy("branch-1", {
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });

    expect(result.currency).toBe("SAR");
  });

  it("never calls any other inventory endpoint as a fallback", async () => {
    await httpServices.inventory.getApprovalPolicy("branch-1");
    await httpServices.inventory.createApprovalPolicy("branch-1", {
      adjustmentValueThresholdMinor: "50000",
      countVarianceValueThresholdMinor: "100000",
      wasteValueThresholdMinor: "30000",
    });

    expect(getPolicy).toHaveBeenCalledTimes(1);
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });
});
