import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromDatetimeLocal, toDatetimeLocal } from "./page";

/*
 * FR-INV-015 — the stock-valuation "As of" field is a native
 * `<input type="datetime-local">`, which is TIMEZONE-NAIVE: its value
 * carries no offset, so a browser renders/parses it in the VIEWER's own
 * clock, not UTC. `toDatetimeLocal`/`fromDatetimeLocal` are the only two
 * places that boundary is crossed.
 *
 * This was previously verified only by hand (manual `node` runs with `TZ`
 * set), never by an automated test — this file closes that gap. `TZ` is
 * set directly on `process.env` per test and restored afterward: Node/V8
 * re-reads it immediately for `Date`'s local-time methods, so this is
 * reliable without any browser-specific timezone mocking.
 */

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = "Africa/Cairo"; // UTC+2 (no DST) — a real, non-UTC tenant timezone.
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("toDatetimeLocal — UTC instant -> viewer's own local wall-clock string", () => {
  it("renders a UTC instant in the local (Cairo) wall clock, not UTC", () => {
    expect(toDatetimeLocal("2026-10-04T07:30:00.000Z")).toBe("2026-10-04T10:30");
  });

  it("renders correctly under UTC too (offset 0 degenerates to the same value)", () => {
    process.env.TZ = "UTC";
    expect(toDatetimeLocal("2026-10-04T10:30:00.000Z")).toBe("2026-10-04T10:30");
  });
});

describe("fromDatetimeLocal — local wall-clock string -> correct UTC ISO instant", () => {
  it("a Cairo wall-clock time of 10:30 is NOT the same instant as UTC 10:30", () => {
    const iso = fromDatetimeLocal("2026-10-04T10:30");
    expect(iso).toBe("2026-10-04T07:30:00.000Z");
    expect(iso).not.toBe("2026-10-04T10:30:00.000Z");
  });

  it("degenerates correctly when the viewer's own clock IS UTC", () => {
    process.env.TZ = "UTC";
    expect(fromDatetimeLocal("2026-10-04T10:30")).toBe("2026-10-04T10:30:00.000Z");
  });

  it("round-trips exactly: display -> unchanged re-submit -> the same UTC instant", () => {
    const original = "2026-10-04T07:30:00.000Z";
    const displayed = toDatetimeLocal(original);
    expect(fromDatetimeLocal(displayed)).toBe(original);
  });

  it("empty input is safely ignored (null), never an exception or an Invalid Date", () => {
    expect(fromDatetimeLocal("")).toBeNull();
  });

  it("a non-empty but unparseable value is also safely ignored (null), never a thrown RangeError", () => {
    expect(() => fromDatetimeLocal("not-a-date")).not.toThrow();
    expect(fromDatetimeLocal("not-a-date")).toBeNull();
  });
});
