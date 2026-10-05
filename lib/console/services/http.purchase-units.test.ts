import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-003 — the 4 real purchase-unit routes replacing the fake
 * base-unit-times-one stand-in. Proves the exact outgoing request for
 * GET/POST/PATCH/DELETE `/inventory/items/{itemId}/purchase-units[/{id}]`,
 * and that `conversionFactorToBase` (a Decimal(20,6) string) transmits
 * byte-exact, never corrupted by `Number()`/float math.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`), same
 * pattern as `http.inventory-valuation.test.ts` — the real `http.ts`
 * module runs, so this proves the actual outgoing request, not a
 * service-layer mock.
 */

const listPurchaseUnits = vi.fn();
const createPurchaseUnit = vi.fn();
const updatePurchaseUnit = vi.fn();
const deletePurchaseUnit = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      listPurchaseUnits: (...args: unknown[]) => listPurchaseUnits(...args),
      createPurchaseUnit: (...args: unknown[]) => createPurchaseUnit(...args),
      updatePurchaseUnit: (...args: unknown[]) => updatePurchaseUnit(...args),
      deletePurchaseUnit: (...args: unknown[]) => deletePurchaseUnit(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

const ROW = {
  id: "pu-1",
  stockItemId: "item-1",
  name: "Case 12",
  conversionFactorToBase: "12.500000",
  supplierId: null,
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listPurchaseUnits.mockResolvedValue([ROW]);
  createPurchaseUnit.mockResolvedValue(ROW);
  updatePurchaseUnit.mockResolvedValue(ROW);
  deletePurchaseUnit.mockResolvedValue(undefined);
  ({ httpServices } = await import("./http"));
});

describe("Purchase units — FR-INV-003 HTTP boundary", () => {
  it("listPurchaseUnits calls the real GET route with the item id", async () => {
    await httpServices.inventory.listPurchaseUnits("item-1");

    expect(listPurchaseUnits).toHaveBeenCalledTimes(1);
    expect(listPurchaseUnits).toHaveBeenCalledWith("item-1");
  });

  it("listPurchaseUnits maps every field through unmodified", async () => {
    const rows = await httpServices.inventory.listPurchaseUnits("item-1");

    expect(rows).toEqual([ROW]);
  });

  it("createPurchaseUnit calls the real POST route with name and the exact conversionFactorToBase string", async () => {
    await httpServices.inventory.createPurchaseUnit("item-1", {
      name: "Case 24",
      conversionFactorToBase: "24.000000",
    });

    expect(createPurchaseUnit).toHaveBeenCalledWith("item-1", {
      name: "Case 24",
      conversionFactorToBase: "24.000000",
    });
  });

  it("createPurchaseUnit never sends a supplierId — no real supplier catalogue exists on this frontend yet", async () => {
    await httpServices.inventory.createPurchaseUnit("item-1", {
      name: "Case 24",
      conversionFactorToBase: "24.000000",
    });

    const [, body] = createPurchaseUnit.mock.calls[0]!;
    expect(body).not.toHaveProperty("supplierId");
  });

  it("updatePurchaseUnit calls the real PATCH route with the selected purchaseUnitId", async () => {
    await httpServices.inventory.updatePurchaseUnit("item-1", "pu-1", {
      name: "Case 12 (relabeled)",
    });

    expect(updatePurchaseUnit).toHaveBeenCalledWith("item-1", "pu-1", {
      name: "Case 12 (relabeled)",
      conversionFactorToBase: undefined,
    });
  });

  it("deletePurchaseUnit calls the real DELETE route with itemId and purchaseUnitId", async () => {
    await httpServices.inventory.deletePurchaseUnit("item-1", "pu-1");

    expect(deletePurchaseUnit).toHaveBeenCalledWith("item-1", "pu-1");
  });

  it("propagates a 409 delete conflict without pretending success", async () => {
    const { ServiceError } = await import("./types");
    deletePurchaseUnit.mockRejectedValue(
      new ServiceError("CONFLICT", "This purchase unit is already in use.", 409),
    );

    await expect(
      httpServices.inventory.deletePurchaseUnit("item-1", "pu-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("never calls services.inventory.items.list or any unrelated endpoint as a fallback", async () => {
    await httpServices.inventory.listPurchaseUnits("item-1");
    await httpServices.inventory.createPurchaseUnit("item-1", {
      name: "Case 24",
      conversionFactorToBase: "24.000000",
    });

    expect(listPurchaseUnits).toHaveBeenCalledTimes(1);
    expect(createPurchaseUnit).toHaveBeenCalledTimes(1);
  });

  it("preserves a Decimal(20,6) conversion factor exactly — never through Number(), which would corrupt trailing precision", async () => {
    // Number("12.5000001") -> 12.5000001, but Number("0.1234567").toString()
    // round-trips fine for small cases; the real risk is a value with 6
    // genuine decimal places plus a large integer part, where float
    // rounding silently changes the transmitted digits. This fixture is
    // chosen so a reintroduced Number()/parseFloat() cast would be caught
    // by a changed string, not just a changed numeric value.
    const exact = "123456789012345.123456";
    await httpServices.inventory.createPurchaseUnit("item-1", {
      name: "Odd case",
      conversionFactorToBase: exact,
    });

    const [, body] = createPurchaseUnit.mock.calls[0]!;
    expect(body.conversionFactorToBase).toBe(exact);
    expect(typeof body.conversionFactorToBase).toBe("string");
  });

  it("round-trips a Decimal(20,6) response value as the exact string, never re-parsed", async () => {
    const exact = "123456789012345.123456";
    listPurchaseUnits.mockResolvedValue([{ ...ROW, conversionFactorToBase: exact }]);

    const rows = await httpServices.inventory.listPurchaseUnits("item-1");

    expect(rows[0]!.conversionFactorToBase).toBe(exact);
  });
});
