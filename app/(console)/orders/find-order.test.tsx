import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Orders > Find an order — a malformed Order Reference is "no match", never
 * a raw server error with a Retry button (issue #13 of the 27 Sep 2026
 * frontend test report).
 */

const { findOrderByReference, searchOrdersByNumber } = vi.hoisted(() => ({
  findOrderByReference: vi.fn(),
  searchOrdersByNumber: vi.fn(),
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
  useSession: () => ({
    scope: { tenantId: "t1", brandId: null, branchId: null },
    can: () => true,
    canAny: () => true,
  }),
}));

vi.mock("@/lib/console/feeds", () => ({
  ORDER_HISTORY_FEED_LIMIT: 100,
  useOrderFeed: () => ({ rows: [], ready: true, error: null, live: true, reload: () => {} }),
}));

vi.mock("@/lib/console/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/console/hooks")>()),
  useBranches: () => [],
}));

vi.mock("@/lib/console/services", () => ({
  services: {
    sales: {
      findOrderByReference: (...args: unknown[]) => findOrderByReference(...args),
      searchOrdersByNumber: (...args: unknown[]) => searchOrdersByNumber(...args),
      listOrderHistoryPage: () => Promise.resolve({ orders: [], nextCursor: null }),
    },
  },
}));

import OrdersPage from "./page";
import { ServiceError } from "@/lib/console/services/types";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

async function search(text: string) {
  const user = userEvent.setup();
  render(<OrdersPage />);
  await user.type(screen.getByPlaceholderText("orders.referencePlaceholder"), `${text}{Enter}`);
}

describe("Orders — Find an order by reference", () => {
  it("a reference that is not a UUID shows 'no match' and sends no request", async () => {
    await search("01J00000000000000000000000");

    expect(await screen.findByText("orders.noMatch")).toBeInTheDocument();
    expect(findOrderByReference).not.toHaveBeenCalled();
  });

  it("a 400 from the server is shown as 'no match', not as an error with Retry", async () => {
    findOrderByReference.mockRejectedValue(new ServiceError("BAD_REQUEST", "id must match …", 400));

    await search("0190a1b2-0000-7000-8000-000000000000");

    expect(await screen.findByText("orders.noMatch")).toBeInTheDocument();
    expect(screen.queryByText(/id must match/)).not.toBeInTheDocument();
  });

  it("a well-formed reference is looked up (trimmed)", async () => {
    findOrderByReference.mockResolvedValue(null);

    await search("  0190a1b2-0000-7000-8000-000000000000  ");

    expect(findOrderByReference).toHaveBeenCalledWith("0190a1b2-0000-7000-8000-000000000000");
    expect(await screen.findByText("orders.noMatch")).toBeInTheDocument();
  });

  it("a real failure (server down) still shows the error panel", async () => {
    findOrderByReference.mockRejectedValue(new ServiceError("NETWORK_UNREACHABLE", "down", 0));

    await search("0190a1b2-0000-7000-8000-000000000000");

    expect(screen.queryByText("orders.noMatch")).not.toBeInTheDocument();
    expect(await screen.findByText(/down/)).toBeInTheDocument();
  });
});
