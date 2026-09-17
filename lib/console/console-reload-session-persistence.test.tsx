import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * CONSOLE-RELOAD-SESSION-PERSISTENCE-P0
 *
 * Empirical reproduction: mounts the REAL `ConsoleProvider` + `ConsoleShell`
 * against real `lib/api/session.ts` (jsdom localStorage) and a mocked
 * `fetch`, simulating a fresh page load (a fresh mount, no prior render) with
 * various pre-seeded CONSOLE_KEYS states — exactly what a browser reload
 * looks like from this code's point of view. `next/navigation` (routing) and
 * `./live-session` (org/tenant context — a separate, already-reviewed
 * concern, not what this bug is about) are the only things mocked; the
 * session bootstrap, hydration-guard, and refresh logic under test are all
 * real.
 *
 * `DATA_MODE`/`API_BASE_URL` are computed once at module evaluation from
 * `process.env` (see `lib/api/kds-station-query.test.ts` for the same
 * pattern), so the env is stubbed and every module under test is re-imported
 * fresh, per test, via `vi.resetModules()`.
 */

const replaceMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => "/dashboard",
}));

vi.mock("./live-session", () => ({
  useLiveOrgContext: () => ({
    ready: true,
    loading: false,
    tenant: null,
    brands: [],
    branches: [],
    permissions: new Set<string>(),
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

/** A `/auth/refresh` (+ console's own `/auth/tenant` replay) fetch double. */
function installFetchMock(opts: {
  /** Omit for a refresh that never gets called (valid-access-token case). */
  refreshStatus?: number;
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/auth/refresh") && method === "POST") {
      if (opts.refreshStatus && opts.refreshStatus >= 400) {
        return jsonResponse({ message: "Invalid refresh token" }, opts.refreshStatus);
      }
      return jsonResponse({
        tokenType: "Bearer",
        accessToken: "console-tok-2",
        refreshToken: "console-refresh-2",
        expiresIn: 3600,
      });
    }
    if (url.endsWith("/auth/tenant") && method === "POST") {
      return jsonResponse({
        tokenType: "Bearer",
        accessToken: "console-tok-2",
        expiresIn: 3600,
        tenant: {
          id: "t1",
          slug: "t1",
          legalName: "T1",
          status: "active",
          defaultCurrency: "EGP",
          defaultLocale: "en",
        },
        membership: { membershipId: "m1", status: "active" },
      });
    }
    if (url.endsWith("/auth/logout") && method === "POST") {
      return jsonResponse(undefined);
    }
    throw new Error(`Unexpected fetch in this test: ${method} ${url}`);
  }) as unknown as typeof fetch;
}

/**
 * Seeds the CONSOLE credential slot exactly as a real sign-in would have
 * left it, BEFORE the module under test is imported (so `SessionProvider`'s
 * mount effect reads it on its very first render — a reload).
 */
function seedConsoleSession(opts: { expiresInMs: number; refreshToken?: string | null }) {
  window.localStorage.setItem("ros.api.accessToken", "console-tok-1");
  if (opts.refreshToken !== null) {
    window.localStorage.setItem("ros.api.refreshToken", opts.refreshToken ?? "console-refresh-1");
  }
  window.localStorage.setItem("ros.api.expiresAt", String(Date.now() + opts.expiresInMs));
  window.localStorage.setItem("ros.api.tenantId", "t1");
  window.localStorage.setItem("ros.api.sessionStartedAt", String(Date.now()));
  window.localStorage.setItem("ros.console.auth", "true");
  window.localStorage.setItem("ros.console.role", "owner");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "http");

  // jsdom has no matchMedia; PreferencesProvider's theme-detection effect
  // needs a stub, unrelated to the session bug under test.
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
  vi.useRealTimers();
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

describe("Console reload — a valid session must survive a fresh mount", () => {
  it("access token still valid: reload does not redirect to /login", async () => {
    seedConsoleSession({ expiresInMs: 60 * 60 * 1000 }); // 1h out — nowhere near stale
    installFetchMock({});

    await mountConsole();

    // The dashboard renders immediately (authenticated is optimistically
    // true before hydration, and hydration confirms it from KEY_AUTH).
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();

    // Give any stray async work a tick, then confirm no redirect ever fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(replaceMock).not.toHaveBeenCalledWith("/login");
  });

  it("access token stale, refresh token valid: silently refreshes and stays authenticated", async () => {
    seedConsoleSession({ expiresInMs: -1000 }); // already stale
    installFetchMock({});

    await mountConsole();

    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.localStorage.getItem("ros.api.accessToken")).toBe("console-tok-2");
    });

    expect(replaceMock).not.toHaveBeenCalledWith("/login");
    expect(window.localStorage.getItem("ros.console.auth")).toBe("true");
  });

  it("refresh token rejected: console is signed out and redirected to /login", async () => {
    seedConsoleSession({ expiresInMs: -1000 }); // already stale
    installFetchMock({ refreshStatus: 401 });

    await mountConsole();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });

    expect(window.localStorage.getItem("ros.api.accessToken")).toBeNull();
    expect(window.localStorage.getItem("ros.console.auth")).toBe("false");
  });

  it("no session at all: redirects to /login (sanity check — not a regression, the ordinary sign-out case)", async () => {
    installFetchMock({});

    await mountConsole();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });
  });

  it("FIXED — a real, present, valid access token survives even if the redundant ros.console.auth flag disagrees with it", async () => {
    seedConsoleSession({ expiresInMs: 60 * 60 * 1000 });
    // The exact way this flag and the real credential used to be able to
    // disagree — it is never written atomically with the token, it is a
    // SEPARATE piece of state read independently on every mount. Before the
    // fix, the bootstrap trusted this cache blindly and discarded a
    // perfectly valid session; now it derives `authenticated` from the real
    // credential (`isSignedIn()`) in http mode, so this flag being stale no
    // longer matters.
    window.localStorage.setItem("ros.console.auth", "false");
    installFetchMock({});

    await mountConsole();

    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(replaceMock).not.toHaveBeenCalledWith("/login");
  });
});
