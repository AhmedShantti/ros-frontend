import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

/*
 * FRONTEND-REMOVE-DEVICE-UX-P1 — `/register-device` named a device-setup
 * concept POS/KDS no longer has. Anyone with the old URL bookmarked must
 * land on the real branch-selection screen, not a 404 — and the redirect
 * itself must be pure routing configuration, never a page that renders UI
 * or runs business logic.
 */
describe("next.config redirects", () => {
  it("redirects the legacy /register-device URL to /select-branch, permanently", async () => {
    const redirects = await nextConfig.redirects!();

    expect(redirects).toContainEqual({
      source: "/register-device",
      destination: "/select-branch",
      permanent: true,
    });
  });
});
