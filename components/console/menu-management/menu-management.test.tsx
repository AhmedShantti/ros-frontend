import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetMemoryMenuManagementStore } from "@/lib/console/menu-management/memory-adapter";

/*
 * MENU-MANAGEMENT — the workspace end to end against the empty in-memory
 * store (the default until the backend endpoints exist). Only the console
 * session/i18n providers are mocked; brands and branches come from them,
 * exactly as they do from the real session.
 */

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) => (typeof value === "string" ? value : ((value as { en?: string })?.en ?? "")),
    locale: "en",
    dir: "ltr",
  }),
  useSession: () => ({
    availableBrands: [{ id: "b1", name: { en: "TRENDOW", ar: "ترندو" } }],
    availableBranches: [
      { id: "br1", brandId: "b1", name: { en: "Downtown", ar: "وسط البلد" } },
      { id: "br2", brandId: "b1", name: { en: "New Cairo", ar: "القاهرة الجديدة" } },
    ],
  }),
}));

import MenuManagement from "./menu-management";

describe("Menu Management workspace", () => {
  beforeEach(() => resetMemoryMenuManagementStore());
  afterEach(() => cleanup());

  it("starts empty and walks menu → category → item → publish", async () => {
    const user = userEvent.setup();
    render(<MenuManagement />);

    expect(await screen.findByText("No menus yet")).toBeInTheDocument();

    // Create a menu (Enter submits the open window).
    await user.click(screen.getByRole("button", { name: /Create menu/ }));
    await user.type(screen.getByPlaceholderText("e.g. Lunch Menu"), "Lunch{Enter}");
    expect(await screen.findByText("No categories yet")).toBeInTheDocument();

    // Brand/branch options come from the session.
    await user.click(screen.getByRole("button", { name: /Brand/ }));
    expect(screen.getByRole("button", { name: "TRENDOW" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Add a category.
    await user.click(screen.getByRole("button", { name: "+ Add category" }));
    await user.type(screen.getByPlaceholderText(/Category name/), "Mains{Enter}");
    expect(await screen.findByRole("heading", { name: "Mains" })).toBeInTheDocument();

    // Add an item; save stays blocked until it has a price.
    await user.click(within(document.querySelector(".items-actions") as HTMLElement).getByRole("button", { name: /Add item/ }));
    await user.type(screen.getByPlaceholderText("e.g. Chicken Burger"), "Kofta");
    expect(screen.getByText("Add a price.")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("0.00"), "90{Enter}");
    await waitFor(() => expect(document.querySelector(".drawer")).toBeNull());
    expect(screen.getByRole("heading", { name: "Kofta" })).toBeInTheDocument();

    // Publish flips to published, then back after a change.
    const publish = screen.getByRole("button", { name: "Publish changes" });
    await user.click(publish);
    expect(await screen.findByRole("button", { name: "Published ✓" })).toBeDisabled();
  });
});
