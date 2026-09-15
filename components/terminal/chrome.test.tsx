import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * POS-SESSION-RESILIENCE-P1 (Part D) — `BoundIdentity` must show the
 * operating branch's name from the SAME safe, local, already-known context
 * POS/KDS already uses (`getActiveBranchId()`), never by calling the
 * org-admin `GET /org/branches/{id}` read (`settings.branch.read` — a
 * permission the Cashier role is deliberately never granted; see the
 * companion diagnosis). `services.organisation.branches.get` is mocked here
 * purely as a tripwire: this suite fails loudly if it is ever called again.
 */

const { branchesGet } = vi.hoisted(() => ({ branchesGet: vi.fn() }));

vi.mock("@/lib/console/services", () => ({
  services: {
    organisation: {
      branches: {
        get: (...args: unknown[]) => branchesGet(...args),
      },
    },
  },
}));

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
}));

import * as Session from "@/lib/api/session";
import { BoundIdentity } from "./chrome";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  Session.setActiveSurface("pos");
});

afterEach(() => {
  cleanup();
});

describe("BoundIdentity — POS/KDS branch label", () => {
  it("renders the branch name cached locally at /select-branch time, with no network call", async () => {
    Session.setActiveBranchId("branch-1", { en: "Downtown", ar: "وسط البلد" });

    render(<BoundIdentity />);

    expect(await screen.findByText("Downtown")).toBeInTheDocument();
    expect(branchesGet).not.toHaveBeenCalled();
  });

  it("renders nothing (a safe fallback) when no name is cached — never falls back to the privileged org-admin read", async () => {
    Session.setActiveBranchId("branch-1"); // no name supplied

    const { container } = render(<BoundIdentity />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(branchesGet).not.toHaveBeenCalled();
  });

  it("renders nothing when no branch is selected at all, with no network call", async () => {
    const { container } = render(<BoundIdentity />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(branchesGet).not.toHaveBeenCalled();
  });

  it("picks up a newly selected branch's cached name reactively (announce-driven), still with no network call", async () => {
    render(<BoundIdentity />);
    expect(screen.queryByText("Uptown")).not.toBeInTheDocument();

    Session.setActiveBranchId("branch-2", { en: "Uptown", ar: "أعلى المدينة" });

    expect(await screen.findByText("Uptown")).toBeInTheDocument();
    expect(branchesGet).not.toHaveBeenCalled();
  });
});
