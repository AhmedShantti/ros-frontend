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
  window.localStorage.clear();
  Session.setActiveSurface("console");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
});

afterEach(() => {
  Session.clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Inventory transfer API contract", () => {
  it("lists and reads durable transfer custody history", async () => {
    const row = { id: "transfer-1", status: "in_transit", physicallyReceived: "4.000000", inTransit: "6.000000", receipts: [] };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, row)));

    await expect(api.inventory.readTransfer("transfer-1")).resolves.toEqual(row);
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("/inventory/transfers/transfer-1");
  });

  it("sends dispatch with an idempotency key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { id: "transfer-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.inventory.dispatch({ stockItemId: "item-1", fromLocationId: "from-1", toLocationId: "to-1", quantity: "10.125000" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({ quantity: "10.125000" });
  });

  it("sends partial/final receipt fields and idempotency key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { status: "in_transit" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.inventory.receive({ transferReferenceId: "transfer-1", toLocationId: "to-1", receivedQuantity: "4.250000", isFinal: false });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({ receivedQuantity: "4.250000", isFinal: false });
  });

  it("submits discrepancy investigation reason and evidence", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { status: "pending_investigation" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.inventory.investigateTransfer("transfer-1", { toLocationId: "to-1", discrepancyReasonCodeId: "reason-1", evidence: "recounted", recountedQuantity: "9.5" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/inventory/transfers/transfer-1/investigate");
    expect(JSON.parse(String(init.body))).toEqual({ toLocationId: "to-1", discrepancyReasonCodeId: "reason-1", evidence: "recounted", recountedQuantity: "9.5" });
  });
  it("posts physical excess returns with precise quantities and an idempotency key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { status: "excess_held" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.inventory.returnTransferExcess("transfer-1", { toLocationId: "to-1", returnToLocationId: "from-1", quantity: "0.000001", reasonCodeId: "reason-1", evidence: "Returned", returnedAt: "2026-10-19T08:00:00Z" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/inventory/transfers/transfer-1/excess-returns");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({ quantity: "0.000001", returnToLocationId: "from-1" });
  });
  it("serializes every item line in grouped dispatch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, []));
    vi.stubGlobal("fetch", fetchMock);
    const lines = [{ stockItemId: "one", quantity: "1.125" }, { stockItemId: "two", quantity: "2.000001" }];
    await api.inventory.dispatchTransferLines({ fromLocationId: "from-1", toLocationId: "to-1", lines });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).lines).toEqual(lines);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
  });

});
