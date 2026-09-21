import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — `useTableStatus` in DEMO mode
 * (`DATA_MODE !== "http"`, no server). The simulated device floor is mapped
 * onto the SAME three states the backend models; the demo's richer floor
 * states (seated, ordered, food served, bill requested, needs cleaning) are
 * never surfaced, and no service call is made. In HTTP mode none of this
 * code path runs (see `table-status-feed.test.ts`).
 */

const tableStatusMock = vi.fn();

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "mock" }));

vi.mock("./services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    sales: { tableStatus: (...args: unknown[]) => tableStatusMock(...args) },
    operations: { stations: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
  },
}));

import { initialLiveState } from "./live/state";
import { tablesOf } from "./live/reducer";

const state = initialLiveState();
vi.mock("./live/store", () => ({
  useLive: () => ({ state, ready: true }),
}));

import { useTableStatus } from "./feeds";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTableStatus — demo mode", () => {
  it("maps the device floor to available/occupied only, and never calls the backend", () => {
    const { result } = renderHook(() => useTableStatus(null));

    expect(result.current.live).toBe(false);
    expect(tableStatusMock).not.toHaveBeenCalled();
    const rows = result.current.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(tablesOf(state).filter((t) => t.branchId === state.branchId).length);
    for (const row of rows) {
      expect(["available", "occupied"]).toContain(row.occupancy);
      expect(row.conflictingOrders).toEqual([]);
    }
  });
});
