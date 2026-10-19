import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const monitoring = vi.fn();
const categories = vi.fn();
const save = vi.fn();
const permission = vi.fn();
vi.mock("@/lib/console/services", () => ({
  ServiceError: class extends Error {},
  services: {
    inventory: {
      monitoring: () => monitoring(),
      expiryCategories: () => categories(),
      setCategoryExpiryHorizons: (...args: unknown[]) => save(...args),
    },
  },
}));
vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  useSession: () => ({ scope: { tenantId: "t1", branchId: null } }),
  usePermission: () => permission(),
}));
import {
  InventoryMonitoringPanel,
  CategoryExpiryHorizons,
} from "./inventory-monitoring";
beforeEach(() => {
  monitoring.mockResolvedValue({
    schedulerEnabled: false,
    delivery: "unavailable",
    findings: [],
    jobs: [],
  });
  categories.mockResolvedValue([
    { id: "cat", name: "Dairy", expiryAlertHorizons: [7, 3, 1] },
  ]);
  save.mockResolvedValue(undefined);
  permission.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Operational Inventory monitoring", () => {
  it("shows unverified and disabled scheduling without claiming delivery", async () => {
    render(<InventoryMonitoringPanel />);
    expect(
      await screen.findByText("inv.monitoringDisabled"),
    ).toBeInTheDocument();
    expect(screen.getByText("inv.monitoringUnverified")).toBeInTheDocument();
    expect(screen.getByText("inv.monitoringDelivery")).toBeInTheDocument();
  });
  it("shows active, resolved and failed/retrying job distinctions", async () => {
    monitoring.mockResolvedValue({
      schedulerEnabled: true,
      delivery: "unavailable",
      findings: [
        {
          id: "1",
          code: "inventory.low_stock",
          status: "active",
          lastObservedAt: "2026-10-19",
        },
        { id: "2", code: "inventory.expiry", status: "resolved" },
      ],
      jobs: [
        {
          jobType: "inventory.stock_monitoring",
          occurrenceKey: "today",
          state: "pending",
          attempt: 1,
          outcomeCode: "handler_error",
        },
      ],
    });
    render(<InventoryMonitoringPanel />);
    expect(await screen.findByText("inv.monitoringLow")).toBeInTheDocument();
    expect(
      screen.getByText(/inv.monitoringActive: 1.*inv.monitoringResolved: 1/),
    ).toBeInTheDocument();
    expect(screen.getByText("inv.monitoringFailure")).toBeInTheDocument();
  });
  it("keeps failed readback unavailable instead of claiming no findings", async () => {
    monitoring.mockRejectedValue(Error("offline"));
    render(<InventoryMonitoringPanel />);
    await waitFor(() => expect(monitoring).toHaveBeenCalled());
    expect(screen.getByText("inv.monitoringUnavailable")).toBeInTheDocument();
    expect(screen.queryByText(/inv.monitoringActive:/)).not.toBeInTheDocument();
  });
  it("edits horizons with default readback and rejects duplicates, malformed and negative input", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CategoryExpiryHorizons onSaved={onSaved} />);
    await user.click(
      await screen.findByRole("button", { name: /inv.expiryCategory/ }),
    );
    await user.click(await screen.findByRole("option", { name: "Dairy" }));
    const input = screen.getByLabelText("inv.expiryHorizons");
    expect(input).toHaveValue("7,3,1");
    for (const invalid of ["1,1", "-1", "bad", "1,", "1.5"]) {
      await user.clear(input);
      await user.type(input, invalid);
      expect(
        screen.getByRole("button", { name: "inv.expirySave" }),
      ).toBeDisabled();
    }
    await user.clear(input);
    await user.type(input, "14,5,0");
    await user.click(screen.getByRole("button", { name: "inv.expirySave" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("cat", [14, 5, 0]));
    expect(onSaved).toHaveBeenCalled();
  });
  it("hides category configuration from unauthorized users", () => {
    permission.mockReturnValue(false);
    render(<CategoryExpiryHorizons onSaved={() => {}} />);
    expect(screen.queryByText("inv.expiryCategory")).not.toBeInTheDocument();
    expect(categories).not.toHaveBeenCalled();
  });
});
