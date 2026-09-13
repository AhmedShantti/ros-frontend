import { describe, expect, it } from "vitest";
import { consoleEn } from "./en";
import { consoleAr } from "./ar";

/*
 * FRONTEND-REMOVE-DEVICE-UX-P1-FINAL-CORRECTION — the actual defect this
 * guards against was a translation VALUE, not a component: `auth.deviceTitle`
 * said "Register this device" while every test only ever rendered the LIVE
 * branch of `/select-branch`, so a component test never saw the demo branch
 * that still used it. A test that reads the catalog directly, independent of
 * which component happens to reference a key today, catches this even if a
 * future screen starts using an existing `branch.*`/`auth.*` key in a place
 * no component test covers.
 *
 * Scoped to the `branch.*` namespace deliberately — the whole
 * `/select-branch` flow's own copy — and not the full catalog: `onb.*` (the
 * console onboarding wizard's hardware-terminal step) and the
 * `/operations/terminals` admin screens have a genuine, in-scope Terminal
 * concept and would false-positive here.
 */

const BANNED_PHRASES: RegExp[] = [
  /device set up/i,
  /this device is ready/i,
  /register this device/i,
  /pair a device/i,
  /bind this device/i,
  /activate.*device/i,
  /\bterminal\b/i,
];

const BANNED_ARABIC_SUBSTRINGS = [
  "تسجيل هذا الجهاز", // "register this device"
  "إقران جهاز", // "pair a device"
  "الجهاز جاهز", // "the device is ready"
  "ربط هذا الجهاز", // "bind this device"
  "تفعيل الجهاز", // "activate the device"
];

function branchKeys<T extends Record<string, unknown>>(catalog: T): [string, string][] {
  return Object.entries(catalog).filter(
    (entry): entry is [string, string] => entry[0].startsWith("branch.") && typeof entry[1] === "string",
  );
}

describe("branch.* copy — no retired device/terminal wording (English)", () => {
  const entries = branchKeys(consoleEn);

  it("has at least the keys this flow actually renders", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s has no banned device/terminal phrase", (_key, value) => {
    for (const phrase of BANNED_PHRASES) {
      expect(value).not.toMatch(phrase);
    }
  });
});

describe("branch.* copy — no retired device/terminal wording (Arabic)", () => {
  const entries = branchKeys(consoleAr);

  it.each(entries)("%s has no banned device/terminal phrase", (_key, value) => {
    for (const banned of BANNED_ARABIC_SUBSTRINGS) {
      expect(value).not.toContain(banned);
    }
  });
});
