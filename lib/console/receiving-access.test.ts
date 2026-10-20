import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("Receiving authorization presentation", () => {
  it("uses only the server's existing OR permissions in live mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "http");
    const { receivingPermissions } = await import("./receiving-access");
    expect(receivingPermissions()).toEqual(["purchase.order.create", "inventory.adjust"]);
    const { NAV_SECTIONS } = await import("./nav");
    const nav = NAV_SECTIONS.flatMap(s => s.items).find(i => i.href === "/purchasing/receiving")!;
    expect(nav.permissions).toEqual(receivingPermissions());
    for (const grant of ["purchase.order.create", "inventory.adjust"]) {
      expect(nav.permissions.some(p => p === grant)).toBe(true);
    }
    expect(nav.permissions.some(p => p === "purchase.view")).toBe(false);
    expect(nav.permissions.some(p => p === "inventory.view")).toBe(false);
  });
  it("preserves existing demo role behavior", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    const { receivingPermissions } = await import("./receiving-access");
    expect(receivingPermissions()).toEqual(["purchase.view"]);
  });
});
