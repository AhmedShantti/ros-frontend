import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/*
 * TABLES-SIDEBAR-PRODUCTION-PERMISSION-CORRECTION-P0
 *
 * The prior task's own Tables tests mocked `useSession` directly, returning
 * a hand-rolled `can()` — which proves the ROLE-HEURISTIC fallback path
 * works, but never exercises what a real production console session
 * actually does: once `GET /auth/permissions` (`useLiveOrgContext`'s
 * `permissions`, `lib/console/providers.tsx`'s `granted` memo) returns a
 * real, non-empty, catalogue-overlapping set, `useSession().can(...)` stops
 * consulting the role heuristic ENTIRELY and only trusts that real set —
 * which is the ordinary case for any signed-in production user, not an
 * edge case. This is what actually hid the Tables nav item on production:
 * the OLD gate (`ops.live.view`) is a string the real backend never issues,
 * so on a live session it is unconditionally false regardless of role.
 *
 * This test mounts the REAL `ConsoleProvider` + `ConsoleShell` (real
 * `lib/api/session.ts` against jsdom localStorage, real `providers.tsx`
 * `granted`/`can`/`canAny` logic, real `lib/console/nav.ts`) and supplies a
 * simulated `GET /auth/permissions` result via `./live-session`'s
 * `useLiveOrgContext` — the one seam `CONSOLE-RELOAD-SESSION-PERSISTENCE-P0`
 * already established as the right mock boundary for exactly this reason.
 * `next/navigation` is mocked (routing is not what this proves); nothing
 * about `useSession`/`can`/nav filtering is mocked.
 */

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

let simulatedGrantedCodes: string[] = [];

vi.mock("./live-session", () => ({
  useLiveOrgContext: () => ({
    ready: true,
    loading: false,
    tenant: null,
    brands: [],
    branches: [],
    permissions: new Set(simulatedGrantedCodes),
    error: null,
    reload: () => {},
  }),
}));

const ORIGINAL_FETCH = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/auth/logout") && method === "POST") return jsonResponse(undefined);
    throw new Error(`Unexpected fetch in this test: ${method} ${url}`);
  }) as unknown as typeof fetch;
}

/** A valid, non-stale console session — no refresh round-trip needed. */
function seedConsoleSession(roleKey: string) {
  window.localStorage.setItem("ros.api.accessToken", "console-tok-1");
  window.localStorage.setItem("ros.api.refreshToken", "console-refresh-1");
  window.localStorage.setItem("ros.api.expiresAt", String(Date.now() + 60 * 60 * 1000));
  window.localStorage.setItem("ros.api.tenantId", "t1");
  window.localStorage.setItem("ros.api.sessionStartedAt", String(Date.now()));
  window.localStorage.setItem("ros.console.auth", "true");
  window.localStorage.setItem("ros.console.role", roleKey);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.resetModules();
  simulatedGrantedCodes = [];
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "http");

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
});

async function mountConsole() {
  const { ConsoleProvider } = await import("./providers");
  const { ConsoleShell } = await import("../../components/console/shell");
  render(
    <ConsoleProvider>
      <ConsoleShell>
        <div data-testid="dashboard-content">Dashboard</div>
      </ConsoleShell>
    </ConsoleProvider>,
  );
}

function tablesLinkVisible(): boolean {
  return document.querySelector('a[href="/operations/tables"]') !== null;
}

describe("Sidebar — Operations > Tables visibility from REAL live-granted permissions", () => {
  it("Owner-shaped live permission set (includes settings.branch.read/manage): Tables IS visible", async () => {
    simulatedGrantedCodes = [
      "pos.order.create",
      "settings.branch.read",
      "settings.branch.manage",
      "settings.tenant.manage",
    ];
    seedConsoleSession("owner");
    installFetchMock();

    await mountConsole();

    await screen.findByTestId("dashboard-content");
    expect(tablesLinkVisible()).toBe(true);
  });

  it("Branch-Manager-shaped live permission set (settings.branch.read + .manage, no tenant-wide grant): Tables IS visible", async () => {
    simulatedGrantedCodes = [
      "pos.order.create",
      "pos.order.view",
      "settings.branch.read",
      "settings.branch.manage",
      "cash.session.close_other",
    ];
    seedConsoleSession("branch_manager");
    installFetchMock();

    await mountConsole();

    await screen.findByTestId("dashboard-content");
    expect(tablesLinkVisible()).toBe(true);
  });

  it("Cashier-shaped live permission set (no settings.branch.read/manage): Tables is NOT visible", async () => {
    simulatedGrantedCodes = [
      "pos.order.create",
      "pos.order.void_line_prefire",
      "cash.session.open",
      "cash.session.close",
      "menu.item.read",
    ];
    seedConsoleSession("cashier");
    installFetchMock();

    await mountConsole();

    await screen.findByTestId("dashboard-content");
    expect(tablesLinkVisible()).toBe(false);
  });

  it("the OLD gate would have failed this exact scenario — regression guard: a real granted set with NO 'ops.live.view' string anywhere still shows Tables for a branch-read holder", async () => {
    // Deliberately proves the backend's real vocabulary (no "ops.live.view"
    // in it at all, matching production) is sufficient on its own.
    simulatedGrantedCodes = ["settings.branch.read", "pos.order.create"];
    seedConsoleSession("branch_manager");
    installFetchMock();

    await mountConsole();

    await screen.findByTestId("dashboard-content");
    expect(simulatedGrantedCodes).not.toContain("ops.live.view");
    expect(tablesLinkVisible()).toBe(true);
  });
});
