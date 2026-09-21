import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * DINE-IN-TABLE-SELECTOR-RESUME-P0 — the wire contract of
 * `api.sales.selectDineInTable`, against the real API client with only
 * `fetch` faked: it is `POST /orders/tables/{tableId}/select`, it always
 * carries an `Idempotency-Key` (the backend refuses one without), and each
 * call mints its OWN key — selecting two different tables never reuses one,
 * and no key is hard-coded.
 */

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

const BODY = { channel: "pos" as const, originDeviceTime: "2026-09-19T10:00:00.000Z" };

beforeEach(() => {
  window.localStorage.clear();
  Session.setActiveSurface("pos");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
});

afterEach(() => {
  Session.clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api.sales.selectDineInTable", () => {
  it("POSTs /orders/tables/{tableId}/select with an Idempotency-Key, per-call and per-table", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { outcome: "resumed" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.sales.selectDineInTable("table-4", BODY);
    await api.sales.selectDineInTable("table-5", BODY);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [[urlA, initA], [urlB, initB]] = fetchMock.mock.calls as unknown as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(urlA).toBe("http://test.local/orders/tables/table-4/select");
    expect(urlB).toBe("http://test.local/orders/tables/table-5/select");
    expect(initA.method).toBe("POST");

    const keyA = (initA.headers as Record<string, string>)["idempotency-key"];
    const keyB = (initB.headers as Record<string, string>)["idempotency-key"];
    expect(keyA).toBeTruthy();
    expect(keyB).toBeTruthy();
    expect(keyA).not.toBe(keyB);
    expect(JSON.parse(String(initA.body))).toEqual(BODY);
  });

  it("selecting the SAME table twice still mints a fresh key per logical call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { outcome: "resumed" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.sales.selectDineInTable("table-4", BODY);
    await api.sales.selectDineInTable("table-4", BODY);

    const keys = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.headers as Record<string, string>)["idempotency-key"],
    );
    expect(new Set(keys).size).toBe(2);
  });
});
