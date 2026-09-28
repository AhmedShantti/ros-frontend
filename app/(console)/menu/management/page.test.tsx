import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/*
 * MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — `LiveMenuManagement` is the
 * Menu Management product, always. `DATA_MODE` (the console's own
 * production/demo switch, `lib/api/config.ts`) only chooses which `services`
 * implementation the live workspace talks to; it must never choose a
 * different UI. This is a regression guard for exactly that: a plain local
 * `npm run dev` with no backend configured (DATA_MODE=mock) previously fell
 * back to a separate demo sandbox, so what got visually approved locally did
 * not match what production (DATA_MODE=http) actually rendered.
 */

vi.mock("@/components/console/states", () => ({
  Gate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/console/menu-management/menu-management", () => ({
  default: () => <div>DEMO_MENU_MANAGEMENT</div>,
}));

vi.mock("@/components/console/menu-management/live-menu-management", () => ({
  default: () => <div>LIVE_MENU_MANAGEMENT</div>,
}));

describe("/menu/management — always the canonical live workspace", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("renders the live workspace when DATA_MODE is http", async () => {
    vi.doMock("@/lib/api/config", () => ({ DATA_MODE: "http" }));
    const { default: MenuManagementPage } = await import("./page");

    render(<MenuManagementPage />);

    expect(screen.getByText("LIVE_MENU_MANAGEMENT")).toBeInTheDocument();
    expect(screen.queryByText("DEMO_MENU_MANAGEMENT")).not.toBeInTheDocument();
  });

  it("still renders the live workspace when DATA_MODE is mock — a local dev session with no backend configured must review the real product, backed by the in-memory canonical service layer, never the separate demo sandbox", async () => {
    vi.doMock("@/lib/api/config", () => ({ DATA_MODE: "mock" }));
    const { default: MenuManagementPage } = await import("./page");

    render(<MenuManagementPage />);

    expect(screen.getByText("LIVE_MENU_MANAGEMENT")).toBeInTheDocument();
    expect(screen.queryByText("DEMO_MENU_MANAGEMENT")).not.toBeInTheDocument();
  });
});
