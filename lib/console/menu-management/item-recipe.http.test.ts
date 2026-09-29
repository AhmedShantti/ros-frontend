import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The item recipe unit catalogue against the REAL `GET /inventory/uoms`
 * contract (`api.inventory.listUoms()`), as opposed to `item-recipe.test.ts`,
 * which exercises demo mode plus the generic `catalogueFrom` unit rules.
 *
 * `GET /inventory/uoms` returns a flat `{id, code, name, dimension}[]` — no
 * conversions. A coworker commit (`029130ae`) called a nonexistent
 * `api.inventory.listUnits()` expecting `{units, conversions}`, written
 * before this endpoint reached production; these tests prove the real
 * method is used instead, and that with no conversions available, live mode
 * correctly narrows an ingredient's offered unit to its own base unit only
 * — never an invented or unverified conversion.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`) and
 * `@/lib/api/config`, same pattern as `./live-adapter.test.ts`.
 */

const listUoms = vi.fn();
const listUnits = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      listUoms: (...args: unknown[]) => listUoms(...args),
      listUnits: (...args: unknown[]) => listUnits(...args),
    },
  },
}));

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "http" }));

vi.mock("@/lib/console/services/map", () => ({
  registerUnits: vi.fn(),
}));

const GRAM = { id: "uom-g", code: "g", name: "Gram", dimension: "mass" };
const KILOGRAM = { id: "uom-kg", code: "kg", name: "Kilogram", dimension: "mass" };
const PIECE = { id: "uom-pc", code: "pc", name: "Piece", dimension: "count" };

let itemRecipe: typeof import("./item-recipe");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listUoms.mockResolvedValue([GRAM, KILOGRAM, PIECE]);
  itemRecipe = await import("./item-recipe");
});

describe("item recipe — live unit catalogue (GET /inventory/uoms)", () => {
  it("calls the real listUoms(), never the nonexistent listUnits()", async () => {
    await itemRecipe.loadUnitCatalogue();
    expect(listUoms).toHaveBeenCalledTimes(1);
    expect(listUnits).not.toHaveBeenCalled();
  });

  it("builds a catalogue with no conversions — none are available from this endpoint", async () => {
    const catalogue = await itemRecipe.loadUnitCatalogue();
    expect(catalogue.conversions).toEqual([]);
  });

  it("resolves a stock item's own base unit to its real, readable code/name from the catalogue", async () => {
    const catalogue = await itemRecipe.loadUnitCatalogue();
    const flour = { baseUnit: "kg", baseUnitId: KILOGRAM.id } as Parameters<
      typeof itemRecipe.unitsFor
    >[1];
    const resolved = catalogue.byId.get(itemRecipe.baseUnitIdOf(flour));
    expect(resolved).toMatchObject({ id: KILOGRAM.id, code: "kg" });
  });

  it("offers ONLY the stock item's own base unit — never an unverified derived unit", async () => {
    const catalogue = await itemRecipe.loadUnitCatalogue();
    const flour = { baseUnit: "kg", baseUnitId: KILOGRAM.id } as Parameters<
      typeof itemRecipe.unitsFor
    >[1];
    const options = itemRecipe.unitsFor(catalogue, flour);
    expect(options.map((u) => u.id)).toEqual([KILOGRAM.id]);
  });

  it("still finds the piece unit a menu-item recipe yields in, from the flat catalogue", async () => {
    const catalogue = await itemRecipe.loadUnitCatalogue();
    expect(catalogue.pieceUnitId).toBe(PIECE.id);
  });

  it("throws UnitsUnavailableError when the endpoint 404s, rather than falling back to anything invented", async () => {
    listUoms.mockRejectedValue({ status: 404 });
    await expect(itemRecipe.loadUnitCatalogue()).rejects.toBeInstanceOf(
      itemRecipe.UnitsUnavailableError,
    );
  });
});
