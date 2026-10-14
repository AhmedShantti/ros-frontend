import { describe, expect, it } from "vitest";
import { percentToBps, bpsToPercent, countVarianceViolations } from "./count-variance-review";
import { ServiceError } from "./services/types";
import { describeError } from "./actions";

describe("exact human percentage conversion", () => {
  it.each([["", null], ["  ", null], ["10", 1000], ["5.25", 525], ["0.01", 1], ["125", 12500], ["5.25000", 525], [".01", 1]])("%s -> %s", (text, expected) => expect(percentToBps(text)).toBe(expected));
  it.each(["5.251", "0.001", "-1", "abc", "1e2", "9007199254740991"])('rejects %s', (text) => expect(percentToBps(text)).toBeUndefined());
  it("formats basis points without rounding", () => {
    expect(bpsToPercent(1)).toBe("0.01"); expect(bpsToPercent(525)).toBe("5.25");
    expect(bpsToPercent(null)).toBe("");
  });
});

describe("FR-INV-046 payload validation", () => {
  const line = { lineId: "line-1", stockItemId: "item-1", exceededDimensions: ["value"] };
  it("retains validated violations without changing legacy error behavior", () => {
    const payload = { message: "Review required", violatingLines: [line] };
    const error = new ServiceError("BAD_REQUEST", payload.message, 400, "POST count", payload);
    expect(countVarianceViolations(error)).toEqual([line]);
    expect(error.payload).toBe(payload); expect(error.status).toBe(400);
    expect(error.code).toBe("BAD_REQUEST"); expect(error.detail).toBe("POST count");
    expect(describeError(error)).toBe("Review required");
  });
  it.each([undefined, {}, { violatingLines: [] }, { violatingLines: [{ ...line, exceededDimensions: ["internal"] }] }, { violatingLines: [{ ...line, lineId: null }] }])("keeps ordinary or malformed 400 payload generic", (payload) => {
    expect(countVarianceViolations(new ServiceError("BAD_REQUEST", "Ordinary error", 400, undefined, payload))).toEqual([]);
  });
  it("does not interpret violations on other HTTP statuses", () => {
    expect(countVarianceViolations(new ServiceError("FORBIDDEN", "Denied", 403, undefined, { violatingLines: [line] }))).toEqual([]);
  });
});
