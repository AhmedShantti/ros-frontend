import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-035/047/058 — the wire contract of the Inventory approval-workflow
 * endpoints, against the real API client with only `fetch` faked (the same
 * convention `endpoints.select-table.test.ts` already establishes for
 * Idempotency-Key coverage).
 *
 * The accepted backend declares an OPTIONAL `Idempotency-Key` header
 * (`@ApiHeader({required:false})`) on `postMovement`/`recordWaste` only —
 * `generate-api-types.mjs` detects that header parameter regardless of its
 * `required` flag and adds `idempotent: true` to the generated call. This
 * is a generated-client regression test: if a future regeneration ever
 * drops that detection, or a hand-edit to `endpoints.ts` removes the flag,
 * these fail.
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

const ADJUSTMENT_BODY = {
  locationId: "loc-1",
  stockItemId: "item-1",
  movementType: "manual_adjustment" as const,
  quantity: "-10",
  referenceType: "console_adjustment",
  referenceId: "ref-1",
  reasonCodeId: "reason-1",
};

const WASTE_BODY = {
  locationId: "loc-1",
  reasonCodeId: "reason-1",
  lines: [{ stockItemId: "item-1", quantity: "5" }],
};

describe("api.inventory.postMovement — Idempotency-Key", () => {
  it("1. sends an Idempotency-Key header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { status: "posted", movementId: "m1" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.postMovement(ADJUSTMENT_BODY);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["idempotency-key"];
    expect(key).toBeTruthy();
  });

  it("a retry of the same logical submission reuses one key for both attempts (401 replay)", async () => {
    // First attempt: 401 (forces the client's refresh-and-replay path).
    // Second: the real response. Both must carry the SAME key — a replay
    // with a different key is, to the server, a different request.
    let call = 0;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (String(url).includes("/auth/refresh")) {
        return jsonResponse(200, { accessToken: "tok2", refreshToken: "ref2", expiresIn: 900 });
      }
      call += 1;
      if (call === 1) return jsonResponse(401, { message: "expired" });
      return jsonResponse(201, { status: "posted", movementId: "m1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Session, "getRefreshToken").mockReturnValue("ref");
    vi.spyOn(Session, "isAccessTokenStale").mockReturnValue(false);

    await api.inventory.postMovement(ADJUSTMENT_BODY);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const movementCalls = calls.filter(([url]) => String(url).includes("/inventory/movements"));
    expect(movementCalls.length).toBe(2);
    const keys = movementCalls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("two separate submissions (two deliberate actions) mint two different keys", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { status: "posted", movementId: "m1" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.postMovement(ADJUSTMENT_BODY);
    await api.inventory.postMovement(ADJUSTMENT_BODY);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const keys = calls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("api.inventory.recordWaste — Idempotency-Key", () => {
  it("2. sends an Idempotency-Key header", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { status: "posted", id: "w1", totalValue: "1250", lines: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.recordWaste(WASTE_BODY);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["idempotency-key"];
    expect(key).toBeTruthy();
  });
});

describe("api.inventory.postCount — no Idempotency-Key dependency", () => {
  it("3. never sends an Idempotency-Key header — CountSession status already prevents duplicate post/request creation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { id: "s1", status: "posted", adjustments: [], movementsDuringCountWindow: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.postCount("session-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = (init.headers as Record<string, string> | undefined) ?? {};
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});

const POLICY_BODY = {
  adjustmentValueThresholdMinor: "50000",
  countVarianceValueThresholdMinor: "100000",
  wasteValueThresholdMinor: "30000",
};

const POLICY_RESPONSE = {
  id: "iapv-1",
  branchId: "branch-1",
  currency: "EGP",
  adjustmentValueThresholdMinor: "50000",
  countVarianceValueThresholdMinor: "100000",
  wasteValueThresholdMinor: "30000",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("api.inventory.createPolicy — Idempotency-Key", () => {
  it("5. sends an Idempotency-Key header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, POLICY_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.createPolicy("branch-1", POLICY_BODY);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["idempotency-key"];
    expect(key).toBeTruthy();
  });

  it("a retry of the same logical Save (401 replay) reuses one key for both attempts", async () => {
    let call = 0;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (String(url).includes("/auth/refresh")) {
        return jsonResponse(200, { accessToken: "tok2", refreshToken: "ref2", expiresIn: 900 });
      }
      call += 1;
      if (call === 1) return jsonResponse(401, { message: "expired" });
      return jsonResponse(201, POLICY_RESPONSE);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Session, "getRefreshToken").mockReturnValue("ref");
    vi.spyOn(Session, "isAccessTokenStale").mockReturnValue(false);

    await api.inventory.createPolicy("branch-1", POLICY_BODY);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const policyCalls = calls.filter(([url]) => String(url).includes("/inventory-approval-policy"));
    expect(policyCalls.length).toBe(2);
    const keys = policyCalls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("two separate deliberate Saves mint two different keys", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, POLICY_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await api.inventory.createPolicy("branch-1", POLICY_BODY);
    await api.inventory.createPolicy("branch-1", POLICY_BODY);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const keys = calls.map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("api.inventory.getPolicy — no policy configured", () => {
  it("6. a null policy round-trips with no reshaping", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { policy: null })));

    const result = await api.inventory.getPolicy("branch-1");

    expect(result).toEqual({ policy: null });
  });
});

describe("dual-outcome submit responses pass through untouched", () => {
  it("4a. postMovement: a pending_approval body round-trips with no reshaping", async () => {
    const body = { status: "pending_approval", approvalRequestId: "req-1" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, body)));

    const result = await api.inventory.postMovement(ADJUSTMENT_BODY);
    expect(result).toEqual(body);
  });

  it("4b. recordWaste: a pending_approval body round-trips with no reshaping", async () => {
    const body = { status: "pending_approval", approvalRequestId: "req-2" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, body)));

    const result = await api.inventory.recordWaste(WASTE_BODY);
    expect(result).toEqual(body);
  });

  it("4c. postCount: a pending_approval body round-trips with no reshaping", async () => {
    const body = { id: "s1", status: "pending_approval", approvalRequestId: "req-3" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, body)));

    const result = await api.inventory.postCount("s1");
    expect(result).toEqual(body);
  });
});
