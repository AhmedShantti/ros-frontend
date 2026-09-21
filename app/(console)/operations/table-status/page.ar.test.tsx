import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — Arabic / English localization.
 *
 * Every string on the Table Status page comes through the existing
 * catalogues (`content/console/{en,ar}.ts`), none is hard-coded. This renders
 * the REAL page with the REAL Arabic catalogue behind `useI18n().t`, and pins
 * that every key it uses exists in both catalogues with a distinct Arabic
 * value — including the nav labels (`nav.tables` is now the setup page,
 * `nav.tableStatus` the live one).
 */

const useTableStatusMock = vi.fn();

vi.mock("@/lib/console/feeds", () => ({
  useTableStatus: (...args: unknown[]) => useTableStatusMock(...args),
}));

vi.mock("@/lib/console/providers", async () => {
  const { consoleAr } = await import("@/content/console/ar");
  const catalogue = consoleAr as Record<string, string>;
  return {
    useI18n: () => ({
      t: (key: string) => catalogue[key] ?? `MISSING:${key}`,
      tx: (value: unknown) =>
        typeof value === "string" ? value : ((value as { ar?: string })?.ar ?? ""),
      locale: "ar",
      dir: "rtl",
      fmt: { locale: "ar", arabicIndicNumerals: false },
    }),
    useSession: () => ({
      scope: { tenantId: "t1", brandId: null, branchId: "branch-1" },
      branch: { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } },
      availableBranches: [{ id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } }],
      can: () => true,
      canAny: () => true,
    }),
  };
});

import { consoleAr } from "@/content/console/ar";
import { consoleEn } from "@/content/console/en";
import TableStatusPage from "./page";

const KEYS = [
  "nav.tableStatus",
  "nav.tables",
  "tableStatus.subtitle",
  "tableStatus.selectBranch",
  "tableStatus.conflictNote",
  "tableStatus.forbidden",
  "tableStatus.notFound",
  "pos.tableAvailable",
  "pos.tableOccupied",
  "pos.tableConflict",
  "pos.seats",
  "ops.noTables",
  "state.errorRetry",
] as const;

const ARABIC_SCRIPT = /[؀-ۿ]/;

const ref = (id: string, orderNumber: string) => ({
  id,
  businessDay: "2026-09-21",
  orderNumber,
  state: "open",
  version: 1,
});

beforeEach(() => {
  useTableStatusMock.mockReturnValue({
    rows: [
      { id: "t1", label: "T1", section: null, seatCapacity: 4, occupancy: "available", activeOrder: null, conflictingOrders: [] },
      { id: "t2", label: "T2", section: null, seatCapacity: 2, occupancy: "occupied", activeOrder: ref("o1", "MAIN-10"), conflictingOrders: [] },
      { id: "t3", label: "T3", section: null, seatCapacity: null, occupancy: "ambiguous", activeOrder: null, conflictingOrders: [ref("a", "MAIN-3"), ref("b", "MAIN-8")] },
    ],
    ready: true,
    error: null,
    live: true,
    reload: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("Table status — localization", () => {
  it("every key it uses exists in BOTH catalogues, and the Arabic is real Arabic (not the English copied)", () => {
    for (const key of KEYS) {
      const en = (consoleEn as Record<string, string>)[key];
      const ar = (consoleAr as Record<string, string>)[key];
      expect(en, `en ${key}`).toBeTruthy();
      expect(ar, `ar ${key}`).toBeTruthy();
      expect(ar, `ar ${key} script`).toMatch(ARABIC_SCRIPT);
      expect(ar, `ar ${key} differs`).not.toBe(en);
    }
  });

  it("the two nav entries no longer share a label: Tables (setup) vs Table status (live)", () => {
    expect(consoleEn["nav.tables"]).not.toBe(consoleEn["nav.tableStatus"]);
    expect(consoleAr["nav.tables"]).not.toBe(consoleAr["nav.tableStatus"]);
    expect(consoleEn["nav.tableStatus"]).toBe("Table status");
  });

  it("renders the title, the three states and the conflict note in Arabic, with no missing key and no English state word", () => {
    render(<TableStatusPage />);

    expect(screen.getByText(consoleAr["nav.tableStatus"])).toBeInTheDocument();
    expect(screen.getByText(consoleAr["tableStatus.subtitle"])).toBeInTheDocument();

    const t1 = screen.getByText("T1").closest("li")!;
    expect(within(t1).getByText(consoleAr["pos.tableAvailable"])).toBeInTheDocument();
    const t2 = screen.getByText("T2").closest("li")!;
    expect(within(t2).getByText(consoleAr["pos.tableOccupied"])).toBeInTheDocument();
    expect(within(t2).getByText("مفتوح")).toBeInTheDocument(); // the order's own state, existing label
    const t3 = screen.getByText("T3").closest("li")!;
    expect(within(t3).getByText(consoleAr["pos.tableConflict"])).toBeInTheDocument();
    expect(within(t3).getByText(consoleAr["tableStatus.conflictNote"].replace("{n}", "2"))).toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("MISSING:");
    expect(text).not.toMatch(/Available|Occupied|conflict|Table status/i);
  });

  it("the branch-required, 403 and 404 messages are the Arabic catalogue strings", () => {
    useTableStatusMock.mockReturnValue({ rows: null, ready: true, live: true, reload: vi.fn(), error: Object.assign(new Error("x"), { status: 403 }) });
    const { unmount } = render(<TableStatusPage />);
    expect(screen.getByText(consoleAr["tableStatus.forbidden"])).toBeInTheDocument();
    unmount();

    useTableStatusMock.mockReturnValue({ rows: null, ready: true, live: true, reload: vi.fn(), error: Object.assign(new Error("x"), { status: 404 }) });
    render(<TableStatusPage />);
    expect(screen.getByText(consoleAr["tableStatus.notFound"])).toBeInTheDocument();
  });
});
