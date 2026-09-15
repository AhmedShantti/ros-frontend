import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * POS-KDS-SESSION-LIFETIME-POLICY-P0
 *
 * Root cause of the reported "logged out mid-shift" symptom: refresh was
 * purely REACTIVE (only attempted when a request happened to notice the
 * token had gone stale) and, on ANY failure of `POST /auth/refresh` — a
 * dropped LAN, a backend restart, a genuinely dead refresh token — it called
 * `clearSession()` unconditionally. A restaurant's Wi-Fi hiccupping at the
 * exact moment the ~15-minute access token needed renewing was therefore
 * indistinguishable, to the frontend, from the shift genuinely being over:
 * both dropped the operator straight back to the PIN screen.
 *
 * These tests exercise `lib/api/client.ts`'s real `request()`/`refreshSession()`
 * against a mocked `fetch` and the real `lib/api/session.ts` (real jsdom
 * localStorage) — only the network boundary is faked.
 */

vi.mock("./config", () => ({
  DATA_MODE: "http",
  API_BASE_URL: "http://test.local",
  API_IS_PROXIED: false,
  REQUEST_TIMEOUT_MS: 5_000,
  apiUrl: (path: string) => `http://test.local${path}`,
}));

import { http } from "./client";
import * as Session from "./session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  Session.setActiveSurface("pos");
});

afterEach(() => {
  // Also collapses whatever `scheduleProactiveRefresh` armed for the test's
  // session, via its own `onSessionChange` listener — see client.ts.
  Session.clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("refreshSession resilience", () => {
  it("a genuine rejection of the refresh token ends the session", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "dead-refresh", expiresIn: 900 });

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/auth/refresh")) {
        return jsonResponse(401, { message: "Invalid refresh token", error: "Unauthorized" });
      }
      return jsonResponse(401, { message: "Unauthenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(Session.isSignedIn()).toBe(false);
  });

  it("a network failure reaching /auth/refresh leaves the session intact — no forced PIN re-entry over a Wi-Fi hiccup", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "still-good-refresh", expiresIn: 900 });

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/auth/refresh")) throw new TypeError("Failed to fetch");
      return jsonResponse(401, { message: "Unauthenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).rejects.toMatchObject({ code: "NETWORK_UNREACHABLE" });

    // The session survives the blip: still signed in, same refresh token,
    // ready for the next attempt — not wiped the way a rejected refresh is.
    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("old-access");
  });

  it("a successful refresh replays the tenant and the retried request goes through", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "refresh-1", expiresIn: 900 });
    Session.setTenantId("tenant-1");

    let requestCount = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = String(url);
      if (path.includes("/auth/refresh")) {
        return jsonResponse(200, { accessToken: "base-2", refreshToken: "refresh-2", expiresIn: 900 });
      }
      if (path.includes("/auth/tenant")) {
        return jsonResponse(200, { accessToken: "scoped-2", refreshToken: "refresh-2", expiresIn: 900 });
      }
      requestCount += 1;
      if (requestCount === 1) return jsonResponse(401, { message: "Unauthenticated" });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).resolves.toEqual({ ok: true });
    expect(Session.getAccessToken()).toBe("scoped-2");
    expect(Session.getRefreshToken()).toBe("refresh-2");
  });

  it("the hard session lifetime cap ends the session even though the refresh token is still valid", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "still-good-refresh", expiresIn: 900 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + Session.HARD_SESSION_LIFETIME_MS + 1_000);

    const fetchMock = vi.fn(async (_url: string | URL) => jsonResponse(401, { message: "Unauthenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(Session.isSignedIn()).toBe(false);

    // Never even reached the network for /auth/refresh — the cap is checked
    // before the call, not learned from a rejection.
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(0);
  });
});
