import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  DATA_MODE: "http",
  API_BASE_URL: "http://test.local",
  API_IS_PROXIED: false,
  REQUEST_TIMEOUT_MS: 5_000,
  apiUrl: (path: string) => `http://test.local${path}`,
}));

import { api } from "./endpoints";
import * as Session from "./session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules(); // Each transport fixture must bypass the service module's reference-data cache.
  window.localStorage.clear();
  Session.setActiveSurface("console");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
});

afterEach(() => {
  Session.clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Inventory unit API response contract", () => {
  it("uses the unambiguous unit-array route and maps units through the real console service", async () => {
    const rows = [{ id: "unit-1", code: "g", name: "gram", dimension: "mass" }];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(200, rows));
    vi.stubGlobal("fetch", fetchMock);
    Session.setTenantId("tenant-visibility-test");
    const { httpServices } = await import("../console/services/http");
    await expect(httpServices.inventory.unitsOfMeasure()).resolves.toEqual(rows);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://test.local/inventory/uoms/units");
  });
  it("propagates authorization errors without mock or legacy fallback", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(403, { message: "Forbidden" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.inventory.listUoms()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://test.local/inventory/uoms/units");
  });
  it("reproduces the original catalogue-object mismatch instead of hiding it with a fallback", async () => {
    const catalogue = { units: [{ id: "g", code: "g", name: "gram", dimension: "mass" }], conversions: [] };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(200, catalogue));
    vi.stubGlobal("fetch", fetchMock);
    Session.setTenantId("tenant-malformed-uoms");
    const { httpServices } = await import("../console/services/http");
    await expect(httpServices.inventory.unitsOfMeasure()).rejects.toThrow(/map/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves an empty unit array without inventing units", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL) => jsonResponse(200, [])));
    Session.setTenantId("tenant-empty-uoms");
    const { httpServices } = await import("../console/services/http");
    await expect(httpServices.inventory.unitsOfMeasure()).resolves.toEqual([]);
  });

});
