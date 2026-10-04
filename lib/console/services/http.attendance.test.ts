import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Attendance over the real mapping layer: corrections post one call per
 * changed field (the API corrects a single field at a time), and the
 * register follows `nextCursor` across pages. Only `@/lib/api/endpoints` is
 * mocked, so `http.ts`'s own logic is what is under test.
 */

const correct = vi.fn();
const listAttendance = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    workforceAttendance: {
      correct: (...args: unknown[]) => correct(...args),
      list: (...args: unknown[]) => listAttendance(...args),
    },
    workforceEmployees: { list: async () => [] },
    organisation: {},
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

function row(id: string) {
  return {
    id,
    tenantId: "t1",
    branchId: "b1",
    employeeId: "e1",
    clockInAt: "2026-01-02T08:00:00.000Z",
    clockOutAt: null,
    corrected: false,
    flags: ["missing_clock_out", "auto_closed"],
    hours: null,
    method: "pos_pin",
    scheduledShiftId: null,
    status: "open",
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  httpServices = (await import("./http")).httpServices;
});

describe("workforce.correctAttendance()", () => {
  it("sends only the changed field, with the reason", async () => {
    await httpServices.workforce.correctAttendance("a1", {
      clockOut: "2026-01-02T17:00:00.000Z",
      reason: "Forgot to clock out",
    });
    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledWith("a1", {
      field: "clock_out_at",
      correctedValue: "2026-01-02T17:00:00.000Z",
      reason: "Forgot to clock out",
    });
  });

  it("makes one call per changed field", async () => {
    await httpServices.workforce.correctAttendance("a1", {
      clockIn: "2026-01-02T07:30:00.000Z",
      clockOut: "2026-01-02T17:00:00.000Z",
      reason: "Terminal was offline",
    });
    expect(correct.mock.calls.map((call) => (call[1] as { field: string }).field)).toEqual([
      "clock_in_at",
      "clock_out_at",
    ]);
  });
});

describe("workforce.attendance.list()", () => {
  it("follows nextCursor and drops the unbuildable auto_closed flag", async () => {
    listAttendance
      .mockResolvedValueOnce({ items: [row("r1")], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [row("r2")], nextCursor: null });
    const page = await httpServices.workforce.attendance.list({});
    expect(page.rows.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect(listAttendance).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));
    expect(page.rows[0]!.flags).toEqual(["missing_clock_out"]);
  });
});
