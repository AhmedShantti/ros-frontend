import { describe, expect, it } from "vitest";
import { branchesOf, bucketsOf, totalsOf } from "./compare";
import { resolveComparison } from "./periods";
import type { DailySales } from "./rollup";

const name = { en: "B", ar: "ب" };
const row = (date: string, branchId: string, orders: number, net: number): DailySales => ({
  date,
  branchId,
  branchName: name,
  orders,
  gross: net + 10,
  discounts: 5,
  refunds: 5,
  net,
  tax: 1,
});

describe("totalsOf", () => {
  it("sums only the days inside the span and derives AOV", () => {
    const rows = [
      row("2026-08-01", "a", 2, 200),
      row("2026-08-02", "a", 3, 400),
      row("2026-07-31", "a", 9, 999),
    ];
    const totals = totalsOf(rows, { from: "2026-08-01", to: "2026-08-05" });
    expect(totals.orders).toBe(5);
    expect(totals.net).toBe(600);
    expect(totals.aov).toBe(120);
  });

  it("has a zero AOV when there are no orders", () => {
    expect(totalsOf([], { from: "2026-08-01", to: "2026-08-05" }).aov).toBe(0);
  });
});

describe("bucketsOf", () => {
  it("week: pairs day i with day i of the previous week", () => {
    const periods = resolveComparison("week", "2026-08-03")!; // Sat 1st → Mon 3rd
    const rows = [
      row("2026-08-01", "a", 1, 100),
      row("2026-08-03", "a", 1, 300),
      row("2026-07-25", "a", 1, 50),
      row("2026-07-27", "a", 1, 150),
    ];
    const buckets = bucketsOf(rows, periods);
    expect(buckets.map((b) => b.current)).toEqual([100, 0, 300]);
    expect(buckets.map((b) => b.previous)).toEqual([50, 0, 150]);
  });

  it("year: pairs month m with month m of last year, up to the current month", () => {
    const periods = resolveComparison("year", "2026-03-10")!;
    const rows = [
      row("2026-01-15", "a", 1, 100),
      row("2026-03-02", "a", 1, 40),
      row("2025-01-15", "a", 1, 80),
      row("2025-03-09", "a", 1, 30),
      // After the like-for-like cut-off, so excluded from March last year.
      row("2025-03-20", "a", 1, 999),
    ];
    const buckets = bucketsOf(rows, periods);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ current: 100, previous: 80 });
    expect(buckets[1]).toMatchObject({ current: 0, previous: 0 });
    expect(buckets[2]).toMatchObject({ current: 40, previous: 30 });
  });
});

describe("branchesOf", () => {
  it("ranks branches by current net and carries the previous totals", () => {
    const periods = resolveComparison("week", "2026-08-02")!;
    const rows = [
      row("2026-08-01", "a", 1, 100),
      row("2026-08-01", "b", 1, 500),
      row("2026-07-25", "b", 1, 250),
    ];
    const result = branchesOf(rows, periods);
    expect(result.map((r) => r.branchId)).toEqual(["b", "a"]);
    expect(result[0]!.previous.net).toBe(250);
  });
});
