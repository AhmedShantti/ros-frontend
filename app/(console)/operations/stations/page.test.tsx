import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * KDS-BRANCH-FALLBACK-STATION-P0
 *
 * Kitchen routing's tier-5 branch fallback (`kitchen.branch_kds_config
 * .fallback_station_id`) had a read path but no write path anywhere in the
 * backend, so `RoutingResolverService` always saw `fallbackStationId: null`
 * and any fired item with no line/modifier/menu-item/category rule failed
 * closed. The backend now exposes `GET`/`PATCH
 * /org/branches/{branchId}/kds-config`; these tests prove the new
 * `FallbackStationSection` on this page reads the current value, never
 * defaults to the first station, and saves through the new endpoint.
 *
 * `Select` (components/console/ui.tsx) is a custom listbox, not a native
 * `<select>`: the trigger is a `<button>` showing only the currently
 * selected option's text, and the option list only exists once opened —
 * `userEvent.selectOptions` does not apply here (same pattern
 * `app/(auth)/select-branch/page.test.tsx` already established).
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `StationsScreen` is the real component.
 */

const stationsList = vi.fn();
const getBranchKdsConfig = vi.fn();
const setBranchKdsConfig = vi.fn();
const createStation = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    operations: {
      stations: (...args: unknown[]) => stationsList(...args),
      createStation: (...args: unknown[]) => createStation(...args),
      getBranchKdsConfig: (...args: unknown[]) => getBranchKdsConfig(...args),
      setBranchKdsConfig: (...args: unknown[]) => setBranchKdsConfig(...args),
    },
  },
}));

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({
    scope: { tenantId: "t1", brandId: null, branchId: BRANCH_ID },
    branch: { id: BRANCH_ID, name: { en: "Downtown" } },
    availableBranches: [{ id: BRANCH_ID, name: { en: "Downtown" } }],
  }),
}));

import { StationsScreen } from "./page";

const BRANCH_ID = "branch-1";
const STATION_GRILL = { id: "st-grill", branchId: BRANCH_ID, name: { en: "Grill" }, type: "grill", colour: "#fff", capacityPerHour: 0, active: true };
const STATION_EXPO = { id: "st-expo", branchId: BRANCH_ID, name: { en: "Expo" }, type: "pass", colour: "#fff", capacityPerHour: 0, active: true };

/** Opens the fallback-station listbox and picks the option with this text. */
async function chooseFallback(user: ReturnType<typeof userEvent.setup>, optionName: string) {
  const trigger = await screen.findByLabelText("stations.fallbackLabel");
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: optionName }));
}

beforeEach(() => {
  vi.clearAllMocks();
  stationsList.mockResolvedValue({ rows: [STATION_GRILL, STATION_EXPO], total: 2 });
});

afterEach(() => {
  cleanup();
});

describe("Stations — Fallback kitchen station", () => {
  it('shows "No fallback" selected when none is configured — never auto-selects the first station', async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: null });
    render(<StationsScreen />);

    const trigger = await screen.findByLabelText("stations.fallbackLabel");
    await waitFor(() => expect(trigger).toHaveTextContent("stations.fallbackNone"));
    expect(trigger).not.toHaveTextContent("Grill");
  });

  it("loads and displays the currently-configured fallback station", async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: "st-expo" });
    render(<StationsScreen />);

    const trigger = await screen.findByLabelText("stations.fallbackLabel");
    await waitFor(() => expect(trigger).toHaveTextContent("Expo"));
  });

  it("saving a selected station calls setBranchKdsConfig with its id and shows success feedback", async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: null });
    setBranchKdsConfig.mockResolvedValue({ fallbackStationId: "st-grill" });
    const user = userEvent.setup();
    render(<StationsScreen />);

    await waitFor(() => expect(getBranchKdsConfig).toHaveBeenCalled());
    await chooseFallback(user, "Grill");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(setBranchKdsConfig).toHaveBeenCalledWith(BRANCH_ID, "st-grill"),
    );
    await screen.findByText("stations.fallbackSaved");
  });

  it('saving "No fallback" after a station was set calls setBranchKdsConfig with null', async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: "st-grill" });
    setBranchKdsConfig.mockResolvedValue({ fallbackStationId: null });
    const user = userEvent.setup();
    render(<StationsScreen />);

    const trigger = await screen.findByLabelText("stations.fallbackLabel");
    await waitFor(() => expect(trigger).toHaveTextContent("Grill"));
    await chooseFallback(user, "stations.fallbackNone");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(setBranchKdsConfig).toHaveBeenCalledWith(BRANCH_ID, null),
    );
  });

  it("Save stays disabled until the selection actually changes from the loaded value", async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: null });
    render(<StationsScreen />);

    await screen.findByLabelText("stations.fallbackLabel");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled(),
    );
  });

  it("an error saving the fallback is surfaced, not swallowed", async () => {
    getBranchKdsConfig.mockResolvedValue({ fallbackStationId: null });
    setBranchKdsConfig.mockRejectedValue(new Error("Station not found in this branch."));
    const user = userEvent.setup();
    render(<StationsScreen />);

    await waitFor(() => expect(getBranchKdsConfig).toHaveBeenCalled());
    await chooseFallback(user, "Grill");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await screen.findByText("Station not found in this branch.");
  });
});
