import { describe, expect, it } from "vitest";
import { daysUntilDate, toBatch } from "./map";

/** A wire row the way `/inventory/expiring` sends it: DATE as midnight UTC. */
function row(expiryDate: string | null) {
  return {
    batchId: "0f3c9a2e-0000-0000-0000-000000000000",
    expiryDate,
    locationId: "loc_1",
    quantityRemaining: "10",
    stockItemId: "item_1",
  };
}

describe("toBatch — days to expiry counts calendar days, not hours", () => {
  // Local 16:00 — the afternoon is when the old rounding flipped the answer.
  const afternoon = new Date(2026, 8, 28, 16, 0, 0);
  const morning = new Date(2026, 8, 28, 8, 0, 0);

  it("a batch expiring today is 0 / critical, not expired, all day", () => {
    for (const now of [morning, afternoon]) {
      const batch = toBatch(row("2026-09-28T00:00:00.000Z"), {}, now);
      expect(batch.daysToExpiry).toBe(0);
      expect(batch.status).toBe("critical");
    }
  });

  it("a batch expiring tomorrow is 1, not 0", () => {
    expect(toBatch(row("2026-09-29T00:00:00.000Z"), {}, afternoon).daysToExpiry).toBe(1);
  });

  it("a batch that expired yesterday is -1 / expired", () => {
    const batch = toBatch(row("2026-09-27T00:00:00.000Z"), {}, morning);
    expect(batch.daysToExpiry).toBe(-1);
    expect(batch.status).toBe("expired");
  });

  it("keeps the displayed date as the calendar date the backend sent", () => {
    expect(toBatch(row("2026-10-05T00:00:00.000Z"), {}, afternoon).expiryDate).toBe("2026-10-05");
  });

  it("accepts a bare YYYY-MM-DD too", () => {
    expect(daysUntilDate("2026-10-05", afternoon)).toBe(7);
  });
});
