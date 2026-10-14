import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CountLine, CountSession } from "@/lib/console/types";
import { ServiceError } from "@/lib/console/services/types";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), recount: vi.fn(), explain: vi.fn(), record: vi.fn(), changed: vi.fn(), perform: true }));
vi.mock("@/lib/console/services", async () => ({
  ServiceError: (await import("@/lib/console/services/types")).ServiceError,
  services: { inventory: {
    counts: { get: (...args: unknown[]) => mocks.get(...args), update: (...args: unknown[]) => mocks.update(...args) },
    categories: async () => [], storageAreas: async () => [],
    recordRecount: (...args: unknown[]) => mocks.recount(...args),
    recordVarianceExplanation: (...args: unknown[]) => mocks.explain(...args),
    recordCount: (...args: unknown[]) => mocks.record(...args),
  } },
}));
vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({ t: (key: string) => key, tx: (value: unknown) => typeof value === "string" ? value : (value as { en: string })?.en,
    locale: "en", dir: "ltr", fmt: { locale: "en", arabicIndicNumerals: false } }),
  usePermission: (permission: string) => permission === "inventory.count.perform" ? mocks.perform : true,
  useSession: () => ({ scope: { tenantId: "tenant" } }),
}));
import { CountDrawer } from "./page";

function line(id: string, extra: Partial<CountLine> = {}): CountLine {
  return { id, itemId: `item-${id}`, itemName: { en: `Item ${id}`, ar: `Item ${id}` }, sku: `SKU-${id}`,
    expected: { value: "100", unit: "kg" }, counted: { value: "100", unit: "kg" },
    varianceQty: 0, varianceValue: { amount: 0, currency: "EGP" }, variancePercent: 0,
    flagged: false, recount: false, recountOfLineId: null, countedBy: "actor", countedAt: "2026-10-14T00:00:00Z",
    varianceExplanation: null, varianceExplainedBy: null, varianceExplainedAt: null, isCurrentHead: true, ...extra };
}
const root = line("root", { isCurrentHead: false });
const head = line("head", { recountOfLineId: root.id, recount: true });
// Deliberately huge displayed variance is NOT a violation unless the server names it.
const other = line("other", { varianceQty: 999999, variancePercent: 999999, varianceValue: { amount: 99999999, currency: "EGP" } });
function session(extra: Partial<CountSession> = {}): CountSession {
  return { id: "session", tenantId: "tenant", locationId: "loc", locationName: { en: "Main store", ar: "Main store" }, reference: "CNT-1",
    scope: { en: "Full location", ar: "Full location" }, scopeId: null, mode: "open", status: "counting", openedAt: "2026-10-14T00:00:00Z",
    submittedAt: null, postedAt: null, countedBy: "actor", countedByName: { en: "Counter", ar: "Counter" }, postedBy: null,
    requiresApproval: false, lineCount: 3, flaggedCount: 0, netVarianceValue: { amount: 0, currency: "EGP" },
    lines: [root, head, other], ...extra };
}
function blocked(ids = [head.id]) {
  return new ServiceError("BAD_REQUEST", "Backend review prerequisite (FR-INV-046).", 400, undefined, {
    message: "Backend review prerequisite (FR-INV-046).",
    violatingLines: ids.map((id) => ({ lineId: id, stockItemId: `item-${id}`, exceededDimensions: ["percent"] })),
  });
}
const row = (id: string) => screen.getByText(`SKU-${id}`).closest("tr")!;
async function open(extra: Partial<CountSession> = {}) {
  const value = session(extra); mocks.get.mockResolvedValue(value);
  render(<CountDrawer session={value} onClose={vi.fn()} onChanged={mocks.changed} />);
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("session"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "inv.postCount" })?.hasAttribute("disabled") ?? false).toBe(false));
  return userEvent.setup();
}
async function review(user: ReturnType<typeof userEvent.setup>, ids?: string[]) {
  mocks.update.mockRejectedValue(blocked(ids));
  await user.click(screen.getByRole("button", { name: "inv.postCount" }));
  await screen.findByText("inv.varianceReviewRequired");
  await waitFor(() => expect(screen.getByRole("button", { name: "inv.postCount" })).toBeEnabled());
}
beforeEach(() => { vi.clearAllMocks(); mocks.perform = true; mocks.recount.mockResolvedValue(undefined); mocks.explain.mockResolvedValue(undefined); mocks.record.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("FR-INV-046 server-authoritative count recovery", () => {
  it("keeps ordinary 400 errors generic", async () => {
    const user = await open(); mocks.update.mockRejectedValue(new ServiceError("BAD_REQUEST", "Count is incomplete", 400));
    await user.click(screen.getByRole("button", { name: "inv.postCount" }));
    expect(await screen.findByText("Count is incomplete")).toBeInTheDocument();
    expect(screen.queryByText("inv.varianceReviewRequired")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "inv.recountAction" })).not.toBeInTheDocument();
  });

  it("marks only server IDs, even a zero displayed variance; never infers a violation from huge values", async () => {
    const user = await open(); await review(user);
    expect(within(row("head")).getByText("inv.varianceReviewLine")).toBeInTheDocument();
    expect(within(row("other")).queryByText("inv.varianceReviewLine")).not.toBeInTheDocument();
    expect(within(row("root")).queryByText("inv.varianceReviewLine")).not.toBeInTheDocument();
    expect(within(row("head")).getByRole("button", { name: "inv.recountAction" })).toBeEnabled();
    expect(within(row("head")).getByRole("button", { name: "inv.addExplanation" })).toBeEnabled();
  });

  it("refetches a blocked Post to show the current head returned by the server when the initial view was stale", async () => {
    const user = await open();
    const freshHead = line("fresh", { recountOfLineId: head.id, recount: true });
    mocks.get.mockResolvedValue(session({ lines: [root, { ...head, isCurrentHead: false }, freshHead, other] }));
    await review(user, [freshHead.id]);
    await screen.findByText("SKU-fresh");
    expect(within(row("fresh")).getByRole("button", { name: "inv.recountAction" })).toBeEnabled();
    await user.click(screen.getByText("SKU-head"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    expect(within(row("head")).queryByRole("button", { name: "inv.recountAction" })).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("historical rows cannot Record, Recount or Explain, even if named in a stale server payload", async () => {
    const user = await open(); await user.click(screen.getByText("SKU-root"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    await review(user, [root.id]);
    expect(within(row("root")).queryByRole("button", { name: "inv.recountAction" })).not.toBeInTheDocument();
    expect(within(row("root")).queryByRole("button", { name: "inv.addExplanation" })).not.toBeInTheDocument();
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.recount).not.toHaveBeenCalled(); expect(mocks.explain).not.toHaveBeenCalled();
  });

  it("current heads retain Record count, explained measurements cannot be overwritten", async () => {
    const user = await open({ lines: [root, line("head", { varianceExplanation: "Recorded reason" }), other] });
    await user.click(screen.getByText("SKU-head"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    await user.click(screen.getByText("SKU-other"));
    expect(await screen.findByLabelText(/^inv\.counted/)).toBeEnabled();
  });

  it("recounts the current ID, refetches, clears only its marker, and makes the new backend head actionable on the next deliberate Post", async () => {
    const user = await open(); await review(user, [head.id, other.id]);
    const successor = line("new", { recountOfLineId: head.id, recount: true });
    mocks.get.mockResolvedValue(session({ lines: [root, { ...head, isCurrentHead: false }, successor, other] }));
    await user.click(within(row("head")).getByRole("button", { name: "inv.recountAction" }));
    expect(screen.getByLabelText(/^inv\.counted/)).toHaveValue("");
    await user.type(screen.getByLabelText(/^inv\.counted/), " 101.125 ");
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.recount).toHaveBeenCalledWith("head", "101.125"));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    await screen.findByText("SKU-new");
    expect(within(row("head")).queryByText("inv.varianceReviewLine")).not.toBeInTheDocument();
    expect(within(row("other")).getByText("inv.varianceReviewLine")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    await user.click(screen.getByText("SKU-head"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    await review(user, [successor.id]);
    await user.click(within(row("new")).getByRole("button", { name: "inv.recountAction" }));
    await user.type(screen.getByLabelText(/^inv\.counted/), "102");
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.recount).toHaveBeenLastCalledWith("new", "102"));
  });

  it("explanation trim/non-empty/max500 validation, refetch and stale-marker clearing", async () => {
    const user = await open(); await review(user);
    mocks.get.mockResolvedValue(session({ lines: [root, { ...head, varianceExplanation: "Shelf shrinkage" }, other] }));
    await user.click(within(row("head")).getByRole("button", { name: "inv.addExplanation" }));
    const input = screen.getByLabelText(/^inv\.varianceExplanation/);
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "x".repeat(501) } });
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "x".repeat(500) } });
    expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "  Shelf shrinkage  " } });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.explain).toHaveBeenCalledWith("head", "Shelf shrinkage"));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    await screen.findByText("Shelf shrinkage");
    expect(screen.queryByText("inv.varianceReviewLine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^inv\.varianceExplanation/)).not.toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledTimes(1); // Never automatically retries Post.
  });

  it.each(["recount", "explanation"])("keeps %s permission/state errors visible without fake success", async (mode) => {
    const user = await open(); await review(user);
    const action = mode === "recount" ? mocks.recount : mocks.explain;
    action.mockRejectedValue(new ServiceError("FORBIDDEN", "Permission denied", 403));
    await user.click(within(row("head")).getByRole("button", { name: mode === "recount" ? "inv.recountAction" : "inv.addExplanation" }));
    fireEvent.change(screen.getByLabelText(mode === "recount" ? /^inv\.counted/ : /^inv\.varianceExplanation/), { target: { value: mode === "recount" ? "101" : "Reason" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText("inv.varianceReviewLine")).toBeInTheDocument();
  });

  it("allows replacement of a persisted explanation on a current head without inferring a violation", async () => {
    const user = await open({ lines: [root, { ...head, varianceExplanation: "Old explanation" }, other] });
    expect(screen.queryByText("inv.varianceReviewLine")).not.toBeInTheDocument();
    await user.click(within(row("head")).getByRole("button", { name: "inv.addExplanation" }));
    const input = screen.getByLabelText(/^inv\.varianceExplanation/);
    expect(input).toHaveValue("Old explanation");
    fireEvent.change(input, { target: { value: "  Replacement  " } });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.explain).toHaveBeenCalledWith("head", "Replacement"));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows pending state and blocks stale editing until the recount refetch returns", async () => {
    const user = await open(); await review(user);
    let finish: () => void = () => {};
    mocks.recount.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    let refreshed: (value: CountSession) => void = () => {};
    mocks.get.mockReturnValue(new Promise<CountSession>((resolve) => { refreshed = resolve; }));
    await user.click(screen.getByRole("button", { name: "inv.recountAction" }));
    fireEvent.change(screen.getByLabelText(/^inv\.counted/), { target: { value: "101" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    expect(screen.getByText("inv.varianceReviewLine")).toBeInTheDocument();
    finish();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "inv.postCount" })).toBeDisabled();
    await user.click(screen.getByText("SKU-head"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    refreshed(session({ lines: [root, { ...head, isCurrentHead: false }, line("new", { recountOfLineId: head.id }), other] }));
    await screen.findByText("SKU-new");
    await waitFor(() => expect(screen.getByRole("button", { name: "inv.postCount" })).toBeEnabled());
  });

  it("uses inventory.count.perform for both actions", async () => {
    mocks.perform = false; const user = await open(); await review(user);
    expect(screen.getByRole("button", { name: "inv.recountAction" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "inv.addExplanation" })).toBeDisabled();
  });

  it.each(["posted", "cancelled", "pending_approval", "draft"] as const)("session %s cannot edit measurements", async (status) => {
    const user = await open({ status }); await user.click(screen.getByText("SKU-head"));
    expect(screen.queryByLabelText(/^inv\.counted/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "inv.recountAction" })).not.toBeInTheDocument();
  });

  it.each(["posted", "pending_approval"] as const)("explanation never decides approval: deliberate post retry uses backend %s outcome", async (status) => {
    const user = await open(); await review(user);
    await user.click(screen.getByRole("button", { name: "inv.addExplanation" }));
    fireEvent.change(screen.getByLabelText(/^inv\.varianceExplanation/), { target: { value: "Reason" } });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    const result = session({ status }); mocks.update.mockResolvedValue(result); mocks.get.mockResolvedValue(result);
    await user.click(screen.getByRole("button", { name: "inv.postCount" }));
    await waitFor(() => expect(mocks.changed).toHaveBeenLastCalledWith(status === "pending_approval" ? "inv.countSubmittedForApproval" : "inv.countPosted"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "inv.postCount" })).not.toBeInTheDocument());
  });
});
