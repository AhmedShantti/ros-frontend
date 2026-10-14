import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./config", () => ({ DATA_MODE: "http", API_BASE_URL: "http://test.local", API_IS_PROXIED: false,
  REQUEST_TIMEOUT_MS: 5000, apiUrl: (path: string) => `http://test.local${path}` }));
import { api } from "./endpoints";
import * as Session from "./session";
import { ServiceError } from "../console/services/types";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
beforeEach(() => {
  window.localStorage.clear(); Session.setActiveSurface("pos");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
});
afterEach(() => { Session.clearSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("FR-INV-046 real API client", () => {
  it("sends recount path/body and fresh canonical keys for separate deliberate actions", async () => {
    const fetchMock = vi.fn(async () => response(201, { id: "new-head" })); vi.stubGlobal("fetch", fetchMock);
    await api.inventory.recordRecount("line-1", { countedQuantity: "8.125" });
    await api.inventory.recordRecount("line-1", { countedQuantity: "8.125" });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(Array(2).fill("http://test.local/inventory/count-lines/line-1/recount"));
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ countedQuantity: "8.125" });
    const keys = calls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeTruthy(); expect(keys[1]).toBeTruthy(); expect(keys[0]).not.toBe(keys[1]);
  });

  it.each(["recount", "policy"])("reuses the canonical key for %s auth retry; next deliberate action gets a new key", async (kind) => {
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/auth/refresh")) return response(200, { accessToken: "tok2", refreshToken: "ref2", expiresIn: 900 });
      attempts += 1; return attempts === 1 ? response(401, { message: "expired" }) : response(201, {});
    });
    vi.stubGlobal("fetch", fetchMock); vi.spyOn(Session, "getRefreshToken").mockReturnValue("ref");
    vi.spyOn(Session, "isAccessTokenStale").mockReturnValue(false);
    const save = () => kind === "recount" ? api.inventory.recordRecount("line-1", { countedQuantity: "9" }) :
      api.inventory.createPolicy("branch-1", { adjustmentValueThresholdMinor: null, countVarianceValueThresholdMinor: null,
        wasteValueThresholdMinor: null, countRecountVarianceValueThresholdMinor: null, countRecountVariancePercentBps: 525 });
    await save(); await save();
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => !url.includes("/auth/"));
    const keys = calls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toHaveLength(3); expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]); expect(keys[2]).not.toBe(keys[0]);
  });

  it("console recount auth retry preserves the key through tenant replay", async () => {
    Session.setActiveSurface("console"); Session.setTokens({ accessToken: "console", refreshToken: "ref", expiresIn: 900 });
    Session.setTenantId("tenant-1"); vi.spyOn(Session, "isAccessTokenStale").mockReturnValue(false);
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/auth/refresh")) return response(200, { accessToken: "rotated", refreshToken: "ref2", expiresIn: 900 });
      if (url.includes("/auth/tenant")) return response(200, { accessToken: "scoped", refreshToken: "ref2", expiresIn: 900 });
      attempts += 1; return attempts === 1 ? response(401, { message: "expired" }) : response(201, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    await api.inventory.recordRecount("head", { countedQuantity: "9" });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.some(([url]) => url.includes("/auth/tenant"))).toBe(true);
    const recounts = calls.filter(([url]) => url.includes("/recount"));
    expect(recounts).toHaveLength(2);
    expect((recounts[0][1].headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect((recounts[0][1].headers as Record<string, string>)["idempotency-key"]).toBe((recounts[1][1].headers as Record<string, string>)["idempotency-key"]);
  });

  it("sends the explanation endpoint body exactly", async () => {
    const fetchMock = vi.fn(async () => response(201, {})); vi.stubGlobal("fetch", fetchMock);
    await api.inventory.recordVarianceExplanation("line-1", { explanation: "Delivery shrinkage." });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://test.local/inventory/count-lines/line-1/variance-explanation");
    expect(JSON.parse(init.body as string)).toEqual({ explanation: "Delivery shrinkage." });
  });

  it("preserves the actual blocked-post envelope and ordinary message/status consumers", async () => {
    const payload = { message: "Recount or explanation required (FR-INV-046).", violatingLines: [
      { lineId: "line-1", stockItemId: "item-1", exceededDimensions: ["value", "percent"] },
    ] };
    vi.stubGlobal("fetch", vi.fn(async () => response(400, payload)));
    await expect(api.inventory.postCount("session-1")).rejects.toMatchObject({
      message: payload.message, status: 400, code: "BAD_REQUEST", payload,
    });
    await expect(api.inventory.postCount("session-1")).rejects.toBeInstanceOf(ServiceError);
  });
});
