import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Branch } from "@/lib/console/types";
import { consoleEn } from "@/content/console/en";

/*
 * Create Menu — the reference's centered modal, wired to the real canonical
 * `services.catalogue.menus.create` + `assignMenuToBranch` calls. No mock
 * state; current order-type/branch data only.
 */

const menusCreate = vi.fn();
const assignMenuToBranch = vi.fn();

vi.mock("@/lib/console/services", () => ({
  services: {
    catalogue: {
      menus: { create: (...args: unknown[]) => menusCreate(...args) },
      assignMenuToBranch: (...args: unknown[]) => assignMenuToBranch(...args),
    },
  },
}));

import LiveCreateMenuModal from "./live-create-menu-modal";

afterEach(cleanup);

const tx = (v: { en: string; ar: string }) => v.en;
const t = (key: string) => (consoleEn as Record<string, string>)[key] ?? key;

function mkBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: "branch-1",
    tenantId: "t",
    brandId: "brand-1",
    name: { en: "Downtown", ar: "وسط البلد" },
    code: "DT1",
    countryCode: "EG",
    currency: "EGP",
    timezone: "Africa/Cairo",
    businessDayBoundary: "04:00",
    seats: 10,
    areaSqm: 50,
    openedAt: "2025-01-01",
    active: true,
    isFranchise: false,
    address: "",
    driveThroughEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  menusCreate.mockReset().mockResolvedValue({ id: "menu-1", name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: ["dine_in"], branchIds: [], active: true });
  assignMenuToBranch.mockReset().mockResolvedValue(undefined);
});

describe("LiveCreateMenuModal", () => {
  it("blocks creation until a name is entered", () => {
    render(
      <LiveCreateMenuModal availableBranches={[]} tx={tx} t={t} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /create menu/i })).toBeDisabled();
  });

  it("creates a menu and assigns every selected branch, then reports the created menu", async () => {
    const onCreated = vi.fn();
    render(
      <LiveCreateMenuModal
        availableBranches={[mkBranch()]}
        defaultBranchId="branch-1"
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/main menu/i), "Lunch");
    await userEvent.click(screen.getByRole("button", { name: /create menu/i }));

    await waitFor(() => expect(menusCreate).toHaveBeenCalledTimes(1));
    expect(menusCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: { en: "Lunch", ar: "Lunch" }, orderTypes: ["dine_in"] }),
    );
    expect(assignMenuToBranch).toHaveBeenCalledWith("menu-1", "branch-1");
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("does not assign any branch when none is selected", async () => {
    render(
      <LiveCreateMenuModal availableBranches={[mkBranch()]} tx={tx} t={t} onClose={() => {}} onCreated={() => {}} />,
    );
    await userEvent.type(screen.getByPlaceholderText(/main menu/i), "Lunch");
    await userEvent.click(screen.getByRole("button", { name: /create menu/i }));
    await waitFor(() => expect(menusCreate).toHaveBeenCalledTimes(1));
    expect(assignMenuToBranch).not.toHaveBeenCalled();
  });

  it("calls onClose from the close button", async () => {
    const onClose = vi.fn();
    render(
      <LiveCreateMenuModal availableBranches={[]} tx={tx} t={t} onClose={onClose} onCreated={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
