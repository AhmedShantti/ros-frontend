import { describe, expect, it } from "vitest";
import {
  addYears,
  coverageOf,
  delta,
  resolveComparison,
  spanDays,
  startOfWeek,
} from "./periods";

describe("startOfWeek", () => {
  it("starts the week on Saturday by default", () => {
    // 2026-08-05 is a Wednesday → the week began Saturday 2026-08-01.
    expect(startOfWeek("2026-08-05")).toBe("2026-08-01");
    expect(startOfWeek("2026-08-01")).toBe("2026-08-01");
    expect(startOfWeek("2026-08-07")).toBe("2026-08-01");
  });

  it("honours another week start", () => {
    // Monday start: Wednesday 2026-08-05 → Monday 2026-08-03.
    expect(startOfWeek("2026-08-05", 1)).toBe("2026-08-03");
  });
});

describe("resolveComparison", () => {
  it("week compares the same days of the previous week", () => {
    const periods = resolveComparison("week", "2026-08-05")!;
    expect(periods.current).toEqual({ from: "2026-08-01", to: "2026-08-05" });
    expect(periods.previous).toEqual({ from: "2026-07-25", to: "2026-07-29" });
    expect(spanDays(periods.previous)).toBe(spanDays(periods.current));
  });

  it("year compares 1 January to today against the same span last year", () => {
    const periods = resolveComparison("year", "2026-08-05")!;
    expect(periods.current).toEqual({ from: "2026-01-01", to: "2026-08-05" });
    expect(periods.previous).toEqual({ from: "2025-01-01", to: "2025-08-05" });
    expect(spanDays(periods.previous)).toBe(spanDays(periods.current));
  });

  it("year handles 29 February", () => {
    expect(addYears("2028-02-29", -1)).toBe("2027-02-28");
    const periods = resolveComparison("year", "2028-02-29")!;
    expect(periods.previous.to).toBe("2027-02-28");
  });

  it("off resolves to nothing", () => {
    expect(resolveComparison("off", "2026-08-05")).toBeNull();
  });
});

describe("delta", () => {
  it("computes change and percent", () => {
    expect(delta(120, 100)).toEqual({ change: 20, percent: 20, direction: "up" });
    expect(delta(80, 100)).toEqual({ change: -20, percent: -20, direction: "down" });
    expect(delta(100, 100).direction).toBe("flat");
  });

  it("has no percent when the previous figure is zero", () => {
    expect(delta(50, 0)).toEqual({ change: 50, percent: null, direction: "up" });
  });
});

describe("coverageOf", () => {
  const previous = { from: "2025-01-01", to: "2025-08-05" };
  it("is full when the data starts before the previous period", () => {
    expect(coverageOf("2024-06-01", previous)).toBe("full");
  });
  it("is partial when the data starts inside it", () => {
    expect(coverageOf("2025-03-01", previous)).toBe("partial");
  });
  it("is none when the data starts after it, or is empty", () => {
    expect(coverageOf("2026-07-01", previous)).toBe("none");
    expect(coverageOf(null, previous)).toBe("none");
  });
});
