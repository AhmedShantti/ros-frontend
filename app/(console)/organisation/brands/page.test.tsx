import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * FRONTEND-REAL-UX-BATCH-1A — `canManage` gated the "New" button on
 * `usePermission("org.manage")`, a permission the backend never issues
 * (zero hits across every `*.permissions.ts`). The real permission guarding
 * brand create/update is `settings.tenant.manage`
 * (ORGANISATION_PERMISSIONS.TENANT_MANAGE). This proves a real
 * settings.tenant.manage holder now sees the create action.
 */

const brandsList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    organisation: {
      brands: { list: (...args: unknown[]) => brandsList(...args) },
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
    canAny: (perms: string[]) => perms.some((perm) => granted.has(perm)),
  }),
  usePermission: (perm: string) => granted.has(perm),
}));

import { BrandsScreen } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set(["settings.tenant.manage"]);
  brandsList.mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("Brands — org.manage -> settings.tenant.manage", () => {
  it('shows "New" for a real settings.tenant.manage holder', async () => {
    render(<BrandsScreen />);
    expect(await screen.findByRole("button", { name: "common.new" })).toBeInTheDocument();
  });

  it('hides "New" for a session without the real permission', async () => {
    granted = new Set(["report.view.sales"]);
    render(<BrandsScreen />);
    await waitFor(() => expect(brandsList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();
  });
});
