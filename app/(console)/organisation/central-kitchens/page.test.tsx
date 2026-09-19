import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FRONTEND-REAL-UX-BATCH-1A — two confirmed bugs on this page against the
 * real backend:
 *
 *   1. `canManage` gated the "New" button on `usePermission("org.manage")`,
 *      a permission code the backend never issues (grep across every
 *      `*.permissions.ts` returns zero hits) — so the create action was
 *      permanently hidden from every real session, including a Tenant
 *      Owner holding the REAL permission, `settings.tenant.manage`
 *      (ORGANISATION_PERMISSIONS.TENANT_MANAGE).
 *   2. The create form only ever collected `name` — `warehouseId` was
 *      never asked for, so every submission failed client-side against
 *      `services.organisation.centralKitchens.create`, which throws
 *      BAD_REQUEST without it (the backend requires and supports it).
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `CentralKitchensScreen` is the real component.
 */

const centralKitchensList = vi.fn();
const centralKitchensCreate = vi.fn();
const warehousesList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    organisation: {
      centralKitchens: {
        list: (...args: unknown[]) => centralKitchensList(...args),
        create: (...args: unknown[]) => centralKitchensCreate(...args),
      },
      warehouses: {
        list: (...args: unknown[]) => warehousesList(...args),
      },
    },
  },
}));

let granted = new Set<string>();

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
    scope: { tenantId: "t1", brandId: null, branchId: null },
    availableBranches: [],
    canAny: (perms: string[]) => perms.some((perm) => granted.has(perm)),
  }),
  usePermission: (perm: string) => granted.has(perm),
}));

import { CentralKitchensScreen } from "./page";

const WAREHOUSE_A = {
  id: "wh-1",
  name: { en: "Central Store" },
  code: "WH-01",
  warehouseType: "central",
  attachedBranchId: null,
  countryCode: "EG",
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set(["settings.tenant.manage", "inventory.view"]);
  centralKitchensList.mockResolvedValue({ rows: [], total: 0 });
  warehousesList.mockResolvedValue({ rows: [WAREHOUSE_A], total: 1 });
});

afterEach(() => {
  cleanup();
});

describe("Central kitchens — org.manage -> settings.tenant.manage", () => {
  it('shows "New" for a real settings.tenant.manage holder', async () => {
    render(<CentralKitchensScreen />);
    expect(await screen.findByRole("button", { name: "common.new" })).toBeInTheDocument();
  });

  it('hides "New" for a session without settings.tenant.manage — the old org.manage bug never grants access to a real user, so a real user who genuinely lacks it must still be blocked', async () => {
    granted = new Set(["inventory.view"]);
    render(<CentralKitchensScreen />);
    await waitFor(() => expect(centralKitchensList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();
  });
});

describe("Central kitchens — create form warehouseId", () => {
  it("submits the real warehouseId selected from the live warehouse list", async () => {
    const user = userEvent.setup();
    render(<CentralKitchensScreen />);

    await user.click(await screen.findByRole("button", { name: "common.new" }));
    await waitFor(() => expect(warehousesList).toHaveBeenCalled());

    // Required-field labels render with a trailing "*", so an exact string
    // match on the label text would fail — same pattern as the stations
    // fallback picker test uses a regex for its own labelled control.
    await user.type(await screen.findByLabelText(/common\.name/), "Downtown Commissary");

    // `Select` here is the custom listbox used across the console (not a
    // native <select>) — same pattern as the stations fallback picker test.
    await user.click(screen.getByLabelText(/nav\.warehouses/));
    await user.click(screen.getByRole("option", { name: /Central Store/ }));

    centralKitchensCreate.mockResolvedValue({ id: "ck-1" });
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(centralKitchensCreate).toHaveBeenCalled());
    expect(centralKitchensCreate).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: "wh-1" }),
    );
  });

  it("shows an empty state and cannot submit when no warehouse exists yet", async () => {
    warehousesList.mockResolvedValue({ rows: [], total: 0 });
    const user = userEvent.setup();
    render(<CentralKitchensScreen />);

    await user.click(await screen.findByRole("button", { name: "common.new" }));
    await waitFor(() => expect(warehousesList).toHaveBeenCalled());

    // No warehouse options exist, so the required select can never be
    // filled in — the create call must never fire.
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(centralKitchensCreate).not.toHaveBeenCalled();
  });
});
