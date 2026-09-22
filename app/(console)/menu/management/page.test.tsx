import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/*
 * MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — `DATA_MODE` (the console's own
 * production/demo switch, `lib/api/config.ts`), not a bespoke env var of
 * this workspace's own, decides which implementation renders. Production
 * (`"http"`) must never reach the demo sandbox and its empty in-memory
 * store; demo mode (`"mock"`) must never reach the live workspace.
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

describe("/menu/management — DATA_MODE routing", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("renders the live canonical workspace when DATA_MODE is http", async () => {
    vi.doMock("@/lib/api/config", () => ({ DATA_MODE: "http" }));
    const { default: MenuManagementPage } = await import("./page");

    render(<MenuManagementPage />);

    expect(screen.getByText("LIVE_MENU_MANAGEMENT")).toBeInTheDocument();
    expect(screen.queryByText("DEMO_MENU_MANAGEMENT")).not.toBeInTheDocument();
  });

  it("renders the demo sandbox only in explicit mock mode, never as a production fallback", async () => {
    vi.doMock("@/lib/api/config", () => ({ DATA_MODE: "mock" }));
    const { default: MenuManagementPage } = await import("./page");

    render(<MenuManagementPage />);

    expect(screen.getByText("DEMO_MENU_MANAGEMENT")).toBeInTheDocument();
    expect(screen.queryByText("LIVE_MENU_MANAGEMENT")).not.toBeInTheDocument();
  });
});
