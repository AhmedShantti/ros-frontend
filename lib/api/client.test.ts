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

import { http, setStaleSnapshotReauthHandler } from "./client";
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
  setStaleSnapshotReauthHandler(null);
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

  it("a successful CONSOLE refresh replays /auth/tenant and the retried request goes through", async () => {
    Session.setActiveSurface("console");
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
    const tenantCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/tenant"));
    expect(tenantCalls).toHaveLength(1);
  });

  /*
   * POS-KDS-SESSION-CONTINUITY-P0 — POS/KDS accepts a backend-refreshed
   * token AS-IS: `/auth/refresh` alone now returns a token already carrying
   * genuine server-derived `typ`/`emp`/`brc`, so the old console-only
   * "/auth/tenant puts the scope back" replay must never run for these
   * surfaces (POS-SESSION-REFRESH-CONTEXT-P0 proved that exact replay is
   * what silently converted a POS/KDS session into a dashboard-shaped one).
   */
  for (const surface of ["pos", "kds"] as const) {
    it(`a successful ${surface.toUpperCase()} refresh does NOT call /auth/tenant and uses the refreshed token as-is`, async () => {
      Session.setActiveSurface(surface);
      Session.setTokens({ accessToken: "old-access", refreshToken: "refresh-1", expiresIn: 900 });
      Session.setTenantId("tenant-1"); // present in storage, per PIN sign-on — must still not trigger a replay

      let requestCount = 0;
      const fetchMock = vi.fn(async (url: string | URL) => {
        const path = String(url);
        if (path.includes("/auth/refresh")) {
          return jsonResponse(200, {
            accessToken: "pos-refreshed-2",
            refreshToken: "refresh-2",
            expiresIn: 900,
          });
        }
        if (path.includes("/auth/tenant")) {
          throw new Error("must not be called for a POS/KDS refresh");
        }
        requestCount += 1;
        if (requestCount === 1) return jsonResponse(401, { message: "Unauthenticated" });
        return jsonResponse(200, { ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(http.get("/foo")).resolves.toEqual({ ok: true });
      expect(Session.getAccessToken()).toBe("pos-refreshed-2");
      expect(Session.getRefreshToken()).toBe("refresh-2");
      expect(Session.isSignedIn()).toBe(true); // stayed in POS/KDS — no PIN triggered
      const tenantCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/tenant"));
      expect(tenantCalls).toHaveLength(0);
    });

    it(`a rejected ${surface.toUpperCase()} refresh clears the session so the PIN screen is required — never a silent dashboard-shaped fallback`, async () => {
      Session.setActiveSurface(surface);
      Session.setTokens({ accessToken: "old-access", refreshToken: "dead-refresh", expiresIn: 900 });
      Session.setTenantId("tenant-1");

      const fetchMock = vi.fn(async (url: string | URL) => {
        if (String(url).includes("/auth/refresh")) {
          return jsonResponse(401, { message: "Invalid refresh token", error: "Unauthorized" });
        }
        if (String(url).includes("/auth/tenant")) {
          throw new Error("must not be called after a rejected POS/KDS refresh");
        }
        return jsonResponse(401, { message: "Unauthenticated" });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(http.get("/foo")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(Session.isSignedIn()).toBe(false);
    });
  }

  /*
   * REMOVE-POS-IDLE-LOGOUT-P0 — the frontend never measured POS idle time
   * itself (only the backend did, via `AuthService.refreshPosOrKds()`); it
   * only ever reacts to whatever `POST /auth/refresh` answers. So there is
   * no frontend idle timer to remove — this test documents, explicitly,
   * that a successful refresh keeps the POS session signed in regardless of
   * how long the till sat untouched beforehand (the backend no longer fails
   * this for POS at all; the frontend already handled "refresh succeeded"
   * correctly before this task and still does, unchanged).
   */
  it("POS-KDS-SESSION-CONTINUITY-P0/REMOVE-POS-IDLE-LOGOUT-P0 — a POS session stays signed in when refresh succeeds after a long period of inactivity", async () => {
    Session.setActiveSurface("pos");
    Session.setTokens({ accessToken: "old-access", refreshToken: "refresh-1", expiresIn: 900 });
    Session.setTenantId("tenant-1");

    let requestCount = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = String(url);
      // The backend accepts this refresh even though real elapsed idle time
      // (simulated here — the frontend cannot and does not know this) is
      // well past the old 15-minute POS default; it just returns 200, same
      // shape as any other successful refresh.
      if (path.includes("/auth/refresh")) {
        return jsonResponse(200, {
          accessToken: "pos-refreshed-after-idle",
          refreshToken: "refresh-2",
          expiresIn: 900,
        });
      }
      requestCount += 1;
      if (requestCount === 1) return jsonResponse(401, { message: "Unauthenticated" });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).resolves.toEqual({ ok: true });
    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("pos-refreshed-after-idle");
  });

  it("KDS UNCHANGED — the hard session lifetime cap still ends the session even though the refresh token is still valid", async () => {
    Session.setActiveSurface("kds");
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

  /*
   * REMOVE-POS-ABSOLUTE-SESSION-CAP-P0
   */
  it("POS — the old 12h hard session lifetime cap no longer ends the session; refresh proceeds to the network and succeeds", async () => {
    Session.setActiveSurface("pos");
    Session.setTokens({ accessToken: "old-access", refreshToken: "still-good-refresh", expiresIn: 900 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + Session.HARD_SESSION_LIFETIME_MS + 1_000);

    let requestCount = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/auth/refresh")) {
        return jsonResponse(200, {
          accessToken: "pos-refreshed-past-12h",
          refreshToken: "refresh-2",
          expiresIn: 900,
        });
      }
      requestCount += 1;
      if (requestCount === 1) return jsonResponse(401, { message: "Unauthenticated" });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/foo")).resolves.toEqual({ ok: true });
    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("pos-refreshed-past-12h");

    // Unlike the old behaviour, this DID reach the network — the cap never
    // short-circuited it. (The access token being long expired by the same
    // mocked clock can trigger more than one refresh attempt — a proactive
    // one plus the request-time retry; the count isn't the point here, that
    // it reaches the network at all, and succeeds, is.)
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("POS — manual Sign Off still clears the session even when the (now-unenforced) 12h mark has long passed", async () => {
    Session.setActiveSurface("pos");
    Session.setTokens({ accessToken: "old-access", refreshToken: "still-good-refresh", expiresIn: 900 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * Session.HARD_SESSION_LIFETIME_MS);

    Session.clearSession();

    expect(Session.isSignedIn()).toBe(false);
    expect(Session.getAccessToken()).toBeNull();
  });

  it("POS — a genuine auth rejection still clears the session even when the (now-unenforced) 12h mark has long passed", async () => {
    Session.setActiveSurface("pos");
    Session.setTokens({ accessToken: "old-access", refreshToken: "dead-refresh", expiresIn: 900 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * Session.HARD_SESSION_LIFETIME_MS);

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
});

/*
 * POS-SESSION-RESILIENCE-P1
 *
 * `STALE_AUTHORIZATION_SNAPSHOT` is a distinct backend code (`error:
 * "StaleAuthorizationSnapshot"`, via `codeFrom()`'s own label-to-code
 * convention) for a 403 that is NEVER a real denial — the caller's already-
 * open session's live authorization picture moved underneath it. These
 * tests exercise `request()`'s handling of it directly, with a fake
 * `setStaleSnapshotReauthHandler` standing in for the real UI
 * (`PosReauthPrompt`, covered separately, at the component level).
 */
function staleSnapshotResponse(): Response {
  return jsonResponse(403, {
    statusCode: 403,
    message: "Authorization snapshot is stale; obtain a new access token.",
    error: "StaleAuthorizationSnapshot",
  });
}

function genericForbiddenResponse(): Response {
  return jsonResponse(403, {
    statusCode: 403,
    message: "Insufficient permission for this scope.",
    error: "Forbidden",
  });
}

describe("STALE_AUTHORIZATION_SNAPSHOT recovery", () => {
  it("a stale-snapshot 403 triggers the registered handler, and a successful outcome retries ONLY that request, exactly once", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "ref", expiresIn: 900 });

    let fooCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/foo")) {
        fooCalls += 1;
        if (fooCalls === 1) return staleSnapshotResponse();
        return jsonResponse(200, { ok: true, attempt: fooCalls });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn(async () => true);
    setStaleSnapshotReauthHandler(handler);

    await expect(http.get("/foo")).resolves.toEqual({ ok: true, attempt: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fooCalls).toBe(2); // the original attempt + exactly one retry
  });

  it("never invokes the handler for a generic FORBIDDEN — a real denial stays a denial, with no recovery of any kind", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "ref", expiresIn: 900 });

    const fetchMock = vi.fn(async () => genericForbiddenResponse());
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn(async () => true);
    setStaleSnapshotReauthHandler(handler);

    await expect(http.get("/foo")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Insufficient permission for this scope.",
    });
    expect(handler).not.toHaveBeenCalled();
    // Never retried either — a real denial gets no automatic retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed re-authentication surfaces the ORIGINAL stale-snapshot error and does not retry — no loop", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "ref", expiresIn: 900 });

    const fetchMock = vi.fn(async () => staleSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn(async () => false); // operator cancelled, or the PIN never worked
    setStaleSnapshotReauthHandler(handler);

    await expect(http.get("/foo")).rejects.toMatchObject({
      code: "STALE_AUTHORIZATION_SNAPSHOT",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    // Exactly the one original attempt — a failed recovery is never retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a burst of concurrent stale-snapshot failures shares ONE recovery attempt, and each request retries only itself", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "ref", expiresIn: 900 });

    const attempts: Record<string, number> = { foo: 0, bar: 0 };
    const fetchMock = vi.fn(async (url: string | URL) => {
      const key = String(url).includes("/foo") ? "foo" : "bar";
      attempts[key] += 1;
      if (attempts[key] === 1) return staleSnapshotResponse();
      return jsonResponse(200, { ok: true, path: key });
    });
    vi.stubGlobal("fetch", fetchMock);

    const handler = vi.fn(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10)),
    );
    setStaleSnapshotReauthHandler(handler);

    const [foo, bar] = await Promise.all([http.get("/foo"), http.get("/bar")]);
    expect(foo).toEqual({ ok: true, path: "foo" });
    expect(bar).toEqual({ ok: true, path: "bar" });
    // One shared recovery, not one per failing request.
    expect(handler).toHaveBeenCalledTimes(1);
    // Each request retried only ITSELF, once — never the other's.
    expect(attempts.foo).toBe(2);
    expect(attempts.bar).toBe(2);
  });

  it("no handler registered (e.g. outside the terminal tree) surfaces the stale-snapshot error as-is, with no retry", async () => {
    Session.setTokens({ accessToken: "old-access", refreshToken: "ref", expiresIn: 900 });

    const fetchMock = vi.fn(async () => staleSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);
    // Deliberately no setStaleSnapshotReauthHandler(...) call.

    await expect(http.get("/foo")).rejects.toMatchObject({
      code: "STALE_AUTHORIZATION_SNAPSHOT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
