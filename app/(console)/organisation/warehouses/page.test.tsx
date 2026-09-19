import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * FRONTEND-REAL-UX-BATCH-1A — `canManage` gated the "New" button on
 * `usePermission("org.manage")`, a permission the backend never issues.
 * The real permission guarding warehouse create/update is
 * `settings.tenant.manage`.
 */

const warehousesList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    organisation: {
      warehouses: { list: (...args: unknown[]) => warehousesList(...args) },
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

import { WarehousesScreen } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set(["settings.tenant.manage"]);
  warehousesList.mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("Warehouses — org.manage -> settings.tenant.manage", () => {
  it('shows "New" for a real settings.tenant.manage holder', async () => {
    render(<WarehousesScreen />);
    expect(await screen.findByRole("button", { name: "common.new" })).toBeInTheDocument();
  });

  it('hides "New" for a session without the real permission', async () => {
    granted = new Set(["inventory.view"]);
    render(<WarehousesScreen />);
    await waitFor(() => expect(warehousesList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();
  });
});
