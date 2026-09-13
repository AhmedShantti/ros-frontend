import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0-CORRECTION — the deployed backend
 * takes `stationId` as a `?stationId=` query parameter on the KDS
 * ticket-scoped mutation routes (start/bump/bump-all/recall), not as a JSON
 * request body field. This proves the ACTUAL constructed HTTP request (URL +
 * body) for each of the four routes, at the lowest layer that builds one
 * (`lib/api/client.ts`'s `request()`, reached through the generated
 * `lib/api/endpoints.ts` wrappers) — not a re-assertion of a mock's own
 * behaviour.
 *
 * `DATA_MODE`/`API_BASE_URL` are computed once at module evaluation from
 * `process.env`, so the env is stubbed and the modules re-imported fresh
 * per test via `vi.resetModules()` — reading them at the top of this file,
 * before any stub, would capture the wrong (mock) mode.
 */

describe("KDS ticket mutations — stationId query-param transport", () => {
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | undefined;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "http");

    capturedUrl = null;
    capturedInit = undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ ticket: { id: "ticket-1" }, bumpedLineIds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("start: GET/POST URL carries ?stationId=, and the body is empty", async () => {
    const { api } = await import("./endpoints");
    await api.kitchen.startLine("ticket-1", "line-1", { stationId: "station-1" });

    expect(capturedUrl).toBe(
      "https://api.example.test/kds/tickets/ticket-1/lines/line-1/start?stationId=station-1",
    );
    expect(capturedInit?.body).toBeUndefined();
  });

  it("bump: stationId is a query parameter, not a JSON body field", async () => {
    const { api } = await import("./endpoints");
    await api.kitchen.bumpLine("ticket-1", "line-1", { stationId: "station-1" });

    expect(capturedUrl).toBe(
      "https://api.example.test/kds/tickets/ticket-1/lines/line-1/bump?stationId=station-1",
    );
    expect(capturedInit?.body).toBeUndefined();
  });

  it("bump-all: stationId is a query parameter, not a JSON body field", async () => {
    const { api } = await import("./endpoints");
    await api.kitchen.bumpAll("ticket-1", { stationId: "station-1" });

    expect(capturedUrl).toBe(
      "https://api.example.test/kds/tickets/ticket-1/bump-all?stationId=station-1",
    );
    expect(capturedInit?.body).toBeUndefined();
  });

  it("recall: stationId is a query parameter, not a JSON body field", async () => {
    const { api } = await import("./endpoints");
    await api.kitchen.recall("ticket-1", { stationId: "station-1" });

    expect(capturedUrl).toBe(
      "https://api.example.test/kds/tickets/ticket-1/recall?stationId=station-1",
    );
    expect(capturedInit?.body).toBeUndefined();
  });

  it("omitting stationId omits the query parameter entirely (never sends it empty)", async () => {
    const { api } = await import("./endpoints");
    await api.kitchen.startLine("ticket-1", "line-1", {});

    expect(capturedUrl).toBe("https://api.example.test/kds/tickets/ticket-1/lines/line-1/start");
  });
});
