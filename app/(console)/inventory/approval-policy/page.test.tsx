import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-035/047/058 — the branch's manual-adjustment/count-variance/waste
 * approval thresholds, set from `/inventory/approval-policy`.
 *
 * Mocked only at `@/lib/console/services` and `@/lib/console/providers` —
 * the same boundary `app/(console)/approvals/page.test.tsx` already
 * establishes. `InventoryApprovalPolicyScreen` is the real component, so a
 * fall-through to mock data would show up here as the `getApprovalPolicy`/
 * `createApprovalPolicy` spies never being called.
 */

const getApprovalPolicy = vi.fn();
const createApprovalPolicy = vi.fn();

vi.mock("@/lib/console/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/services")>();
  return {
    ServiceError: actual.ServiceError,
    services: {
      inventory: {
        getApprovalPolicy: (...args: unknown[]) => getApprovalPolicy(...args),
        createApprovalPolicy: (...args: unknown[]) => createApprovalPolicy(...args),
      },
    },
  };
});

const BRANCH_A = { id: "branch-a", name: { en: "Downtown" }, currency: "EGP" as const };

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({
    canAny: () => true,
    branch: BRANCH_A,
    availableBranches: [BRANCH_A],
  }),
}));

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "http" }));

import InventoryApprovalPolicyPage from "./page";

const EXISTING_POLICY = {
  id: "iapv-1",
  branchId: "branch-a",
  currency: "EGP",
  adjustmentValueThresholdMinor: "50000",
  countVarianceValueThresholdMinor: "100000",
  wasteValueThresholdMinor: "30000",
  effectiveFrom: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  getApprovalPolicy.mockResolvedValue(null);
  createApprovalPolicy.mockResolvedValue(EXISTING_POLICY);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Inventory approval policy — real GET, no mock fallback", () => {
  it("reads the real GET policy endpoint for the resolved branch", async () => {
    render(<InventoryApprovalPolicyPage />);
    await waitFor(() => expect(getApprovalPolicy).toHaveBeenCalledWith("branch-a"));
  });

  it("shows the 'no policy configured' state with blank fields when none exists", async () => {
    getApprovalPolicy.mockResolvedValue(null);
    render(<InventoryApprovalPolicyPage />);

    expect(await screen.findByText("inv.noApprovalPolicy")).toBeInTheDocument();
    expect(screen.getByLabelText(/^inv\.adjustmentThreshold/)).toHaveValue("");
    expect(screen.getByLabelText(/^inv\.countVarianceThreshold/)).toHaveValue("");
    expect(screen.getByLabelText(/^inv\.wasteThreshold/)).toHaveValue("");
  });

  it("pre-fills the three thresholds in major units when a policy exists", async () => {
    getApprovalPolicy.mockResolvedValue(EXISTING_POLICY);
    render(<InventoryApprovalPolicyPage />);

    expect(await screen.findByLabelText(/^inv\.adjustmentThreshold/)).toHaveValue("500.00");
    expect(screen.getByLabelText(/^inv\.countVarianceThreshold/)).toHaveValue("1000.00");
    expect(screen.getByLabelText(/^inv\.wasteThreshold/)).toHaveValue("300.00");
    expect(screen.queryByText("inv.noApprovalPolicy")).not.toBeInTheDocument();
  });

  it("shows the server-derived currency next to each field, never invented or client-chosen", async () => {
    getApprovalPolicy.mockResolvedValue(EXISTING_POLICY);
    render(<InventoryApprovalPolicyPage />);

    expect((await screen.findAllByText("EGP")).length).toBeGreaterThan(0);
  });
});

describe("Inventory approval policy — Save (real POST, minor-unit strings)", () => {
  it("converts the typed human EGP values to integer minor-unit strings", async () => {
    getApprovalPolicy.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<InventoryApprovalPolicyPage />);

    await user.type(await screen.findByLabelText(/^inv\.adjustmentThreshold/), "500");
    await user.type(screen.getByLabelText(/^inv\.countVarianceThreshold/), "1000");
    await user.type(screen.getByLabelText(/^inv\.wasteThreshold/), "300");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(createApprovalPolicy).toHaveBeenCalledWith("branch-a", {
        adjustmentValueThresholdMinor: "50000",
        countVarianceValueThresholdMinor: "100000",
        wasteValueThresholdMinor: "30000",
      }),
    );
    const [, body] = createApprovalPolicy.mock.calls[0]!;
    expect(typeof body.adjustmentValueThresholdMinor).toBe("string");
  });

  it("sends an explicit null for a threshold left blank, never 0 or omitted — frontend never decides approval, so it never silently defaults to 'no approval needed'", async () => {
    getApprovalPolicy.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<InventoryApprovalPolicyPage />);

    await user.type(await screen.findByLabelText(/^inv\.countVarianceThreshold/), "1000");
    await user.type(screen.getByLabelText(/^inv\.wasteThreshold/), "300");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(createApprovalPolicy).toHaveBeenCalled());
    const [, body] = createApprovalPolicy.mock.calls[0]!;
    expect(body.adjustmentValueThresholdMinor).toBeNull();
    expect("adjustmentValueThresholdMinor" in body).toBe(true);
  });

  it("reloads the real GET after a successful Save, so the screen reflects the newly created version", async () => {
    getApprovalPolicy.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<InventoryApprovalPolicyPage />);

    await user.type(await screen.findByLabelText(/^inv\.adjustmentThreshold/), "500");
    await user.type(screen.getByLabelText(/^inv\.countVarianceThreshold/), "1000");
    await user.type(screen.getByLabelText(/^inv\.wasteThreshold/), "300");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(getApprovalPolicy).toHaveBeenCalledTimes(2));
  });

  it("two separate Saves call createApprovalPolicy twice — never deduped into one request", async () => {
    getApprovalPolicy.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<InventoryApprovalPolicyPage />);

    await user.type(await screen.findByLabelText(/^inv\.adjustmentThreshold/), "500");
    await user.type(screen.getByLabelText(/^inv\.countVarianceThreshold/), "1000");
    await user.type(screen.getByLabelText(/^inv\.wasteThreshold/), "300");
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(createApprovalPolicy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(createApprovalPolicy).toHaveBeenCalledTimes(2));
  });
});
