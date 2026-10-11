import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-035/058 — acceptance-review hardening: `InventoryEntryDrawer` used
 * to predict the backend's approval decision with a client-side
 * `APPROVAL_THRESHOLD_MINOR = 50_000` constant, and discarded the real
 * `services.inventory.{adjustments,waste}.create()` result entirely — so a
 * submission that actually went to `pending_approval` (zero stock moved)
 * was reported to the user exactly like a successful post. These tests
 * drive the REAL component (mocked only at `@/lib/console/services`, the
 * same boundary `app/(console)/inventory/levels/page.test.tsx` already
 * uses) through both outcomes and assert the message, never a client-side
 * amount-based guess.
 *
 * `initial` pre-fills every controlled field (item/location/quantity/
 * reason/notes) exactly as the real drawer supports when opened from a
 * batch row or a POS void — used here only so the submit button is enabled
 * without driving the SearchSelect/Select comboboxes through the DOM,
 * which is not what these tests are about.
 */

const itemsList = vi.fn();
const locations = vi.fn();
const reasonCodes = vi.fn();
const wasteCreate = vi.fn();
const adjustmentsCreate = vi.fn();

vi.mock("@/lib/console/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/services")>();
  return {
    ServiceError: actual.ServiceError,
    services: {
      inventory: {
        items: { list: (...args: unknown[]) => itemsList(...args) },
        reasonCodes: (...args: unknown[]) => reasonCodes(...args),
        waste: { create: (...args: unknown[]) => wasteCreate(...args) },
        adjustments: { create: (...args: unknown[]) => adjustmentsCreate(...args) },
      },
      organisation: { locations: (...args: unknown[]) => locations(...args) },
    },
  };
});

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({ scope: { tenantId: "t1", brandId: null, branchId: null } }),
}));

import { InventoryEntryDrawer } from "./inventory-entry";

const ITEM = {
  id: "item-1",
  sku: "SKU-1",
  name: { en: "Flour" },
  category: { en: "Dry goods" },
  baseUnit: "kg",
  unitCost: { amount: 1000, currency: "EGP" },
};
const LOCATION = { id: "loc-1", name: { en: "Main Store" } };
const REASON = { id: "rsn-1", code: "shrink", label: { en: "Shrinkage" }, category: "adjustment" };

const INITIAL = {
  itemId: "item-1",
  locationId: "loc-1",
  quantity: { value: "10", unit: "kg" as const },
  reasonCode: "shrink",
  notes: "A long enough justification for the record.",
};

beforeEach(() => {
  itemsList.mockResolvedValue({ rows: [ITEM], total: 1, cursor: null });
  locations.mockResolvedValue([LOCATION]);
  reasonCodes.mockResolvedValue([REASON]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function submit() {
  // `t: (key) => key` under the mocked i18n above, so the button's
  // rendered text is the literal translation key, not English prose.
  const button = await screen.findByRole("button", {
    name: /entry\.postAdjustment|entry\.postWaste/,
  });
  await waitFor(() => expect(button).not.toBeDisabled());
  await userEvent.click(button);
}

describe("InventoryEntryDrawer — manual adjustment, honest outcome (FR-INV-035)", () => {
  it("5. posted: shows the existing successful-post message", async () => {
    adjustmentsCreate.mockResolvedValue({ id: "mv-1", approval: "not_required" });
    const onSaved = vi.fn();

    render(
      <InventoryEntryDrawer kind="adjustment" open onClose={vi.fn()} onSaved={onSaved} initial={INITIAL} />,
    );
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("entry.adjustmentPosted"));
  });

  it("6/7. pending_approval: shows 'submitted for approval', never the posted message — no stock-adjusted claim", async () => {
    adjustmentsCreate.mockResolvedValue({ id: "req-1", approval: "pending" });
    const onSaved = vi.fn();

    render(
      <InventoryEntryDrawer kind="adjustment" open onClose={vi.fn()} onSaved={onSaved} initial={INITIAL} />,
    );
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("entry.submittedForApproval"));
    expect(onSaved).not.toHaveBeenCalledWith("entry.adjustmentPosted");
  });

  it("8. a 403 from the backend surfaces as an error, not a false success", async () => {
    const { ServiceError } = await import("@/lib/console/services/types");
    adjustmentsCreate.mockRejectedValue(new ServiceError("FORBIDDEN", "Not permitted.", 403));
    const onSaved = vi.fn();

    render(
      <InventoryEntryDrawer kind="adjustment" open onClose={vi.fn()} onSaved={onSaved} initial={INITIAL} />,
    );
    await submit();

    await waitFor(() => expect(screen.getByText("Not permitted.")).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("28. the button label and variant never depend on the submitted amount (no client threshold)", async () => {
    adjustmentsCreate.mockResolvedValue({ id: "mv-1", approval: "not_required" });
    const lowValue = { ...INITIAL, quantity: { value: "1", unit: "kg" as const } };
    const highValue = { ...INITIAL, quantity: { value: "999999", unit: "kg" as const } };

    const { unmount } = render(
      <InventoryEntryDrawer kind="adjustment" open onClose={vi.fn()} onSaved={vi.fn()} initial={lowValue} />,
    );
    const lowLabel = (await screen.findByRole("button", { name: /entry\.postAdjustment/ })).textContent;
    unmount();

    render(
      <InventoryEntryDrawer kind="adjustment" open onClose={vi.fn()} onSaved={vi.fn()} initial={highValue} />,
    );
    const highLabel = (await screen.findByRole("button", { name: /entry\.postAdjustment/ })).textContent;

    expect(lowLabel).toBe(highLabel);
    // The removed `entry.approvalTitle` threshold callout never renders.
    expect(screen.queryByText("entry.approvalTitle")).toBeNull();
  });
});

describe("InventoryEntryDrawer — manual waste, honest outcome (FR-INV-058)", () => {
  it("13. posted: shows the existing successful-record message", async () => {
    wasteCreate.mockResolvedValue({ id: "w-1", approval: "not_required" });
    const onSaved = vi.fn();

    render(<InventoryEntryDrawer kind="waste" open onClose={vi.fn()} onSaved={onSaved} initial={INITIAL} />);
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("entry.wasteRecorded"));
  });

  it("14/16. pending_approval: shows 'submitted for approval', never claims the waste was posted", async () => {
    wasteCreate.mockResolvedValue({ id: "req-2", approval: "pending" });
    const onSaved = vi.fn();

    render(<InventoryEntryDrawer kind="waste" open onClose={vi.fn()} onSaved={onSaved} initial={INITIAL} />);
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("entry.submittedForApproval"));
    expect(onSaved).not.toHaveBeenCalledWith("entry.wasteRecorded");
  });
});
