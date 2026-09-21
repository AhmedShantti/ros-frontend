import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/*
 * DINE-IN-TABLE-SELECTOR-RESUME-P0 — Arabic / English localization.
 *
 * Every string on the table surface must come through the existing
 * localization catalogues (`content/console/{en,ar}.ts`), never be hard-coded
 * in the component. This renders the REAL `DineInTableSelector` with the REAL
 * Arabic catalogue behind `useI18n().t`, and separately pins that every key
 * the surface uses exists in both catalogues with a distinct Arabic value.
 */

const { tables, selectTable } = vi.hoisted(() => ({ tables: vi.fn(), selectTable: vi.fn() }));

vi.mock("@/lib/console/services", () => ({
  services: {
    sales: {
      tables: (...args: unknown[]) => tables(...args),
      selectTable: (...args: unknown[]) => selectTable(...args),
    },
  },
  ServiceError: class ServiceError extends Error {},
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
  };
});

import { consoleAr } from "@/content/console/ar";
import { consoleEn } from "@/content/console/en";
import { DineInTableSelector } from "./pos-tables";

const KEYS = [
  "pos.selectTable",
  "pos.tablesAuthError",
  "pos.tablesLoadError",
  "pos.tableAvailable",
  "pos.tableOccupied",
  "pos.tableResumeOrder",
  "pos.tableConflict",
  "pos.tableConflictHint",
  "pos.tableAmbiguous",
  "pos.tableSelectForbidden",
  "pos.tableNotFound",
  "pos.tableNetworkError",
  "pos.orderResumed",
  "pos.seats",
  "common.refresh",
] as const;

const ARABIC_SCRIPT = /[؀-ۿ]/;

const ref = { id: "order-1", businessDay: "2026-09-19", orderNumber: "MAIN-10", state: "open", version: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  tables.mockResolvedValue([
    { id: "t1", label: "1", section: null, seatCapacity: 4, occupancy: "available", activeOrder: null, conflictingOrders: [] },
    { id: "t4", label: "4", section: null, seatCapacity: 2, occupancy: "occupied", activeOrder: ref, conflictingOrders: [] },
    { id: "t9", label: "9", section: null, seatCapacity: null, occupancy: "ambiguous", activeOrder: null, conflictingOrders: [ref, { ...ref, id: "o2" }] },
  ]);
});

afterEach(() => {
  cleanup();
});

describe("Dine-In table surface — localization", () => {
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

  it("no orphaned POS guest-count copy remains: the order-opening hint is gone, the shared label is kept", () => {
    expect(consoleEn).not.toHaveProperty(["pos.guestsNewOrderOnly"]);
    expect(consoleAr).not.toHaveProperty(["pos.guestsNewOrderOnly"]);
    // `pos.guests` is NOT orphaned: the pre-bill (and the demo POS) still label a
    // guest count with it, and `orders.guests` labels the Console order detail.
    for (const key of ["pos.guests", "orders.guests"] as const) {
      expect(consoleEn[key], `en ${key}`).toBeTruthy();
      expect(consoleAr[key], `ar ${key}`).toBeTruthy();
    }
  });

  it("the English ambiguous-table message is the one the product specified", () => {
    expect(consoleEn["pos.tableAmbiguous"]).toBe(
      "This table has multiple active orders and cannot be opened until the conflict is resolved.",
    );
  });

  it("renders Select table / Available / Occupied / Resume order / Table conflict in Arabic through the catalogue", async () => {
    render(<DineInTableSelector onSelected={() => {}} />);

    expect(await screen.findByText(consoleAr["pos.selectTable"])).toBeInTheDocument();
    expect(screen.getByText(consoleAr["common.refresh"])).toBeInTheDocument();

    const available = screen.getByRole("button", { name: new RegExp(`^1,`) });
    expect(within(available).getByText(consoleAr["pos.tableAvailable"])).toBeInTheDocument();

    const occupied = screen.getByRole("button", { name: /^4,/ });
    expect(within(occupied).getByText(consoleAr["pos.tableOccupied"])).toBeInTheDocument();
    expect(occupied).toHaveTextContent(consoleAr["pos.tableResumeOrder"]);

    const conflict = screen.getByRole("button", { name: /^9,/ });
    expect(within(conflict).getByText(consoleAr["pos.tableConflict"])).toBeInTheDocument();
    expect(within(conflict).getByText(consoleAr["pos.tableConflictHint"])).toBeInTheDocument();

    // Nothing fell through to a missing key or a hard-coded English word.
    expect(document.body.textContent).not.toContain("MISSING:");
    expect(document.body.textContent).not.toMatch(/Available|Occupied|Resume|conflict/i);
  });

  it("the tap-on-conflict explanation is the Arabic catalogue string", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<DineInTableSelector onSelected={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /^9,/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(consoleAr["pos.tableAmbiguous"]);
    expect(selectTable).not.toHaveBeenCalled();
  });
});
