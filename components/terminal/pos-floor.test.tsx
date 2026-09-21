import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/*
 * Mock/demo POS (`DATA_MODE !== "http"`) — no Guests picker on ANY order type.
 *
 * The live HTTP POS (`LivePos`) collects no guest count, so the demo POS must
 * not either: the POS UX must not change depending on DATA_MODE. This renders
 * the REAL `PosFloor` against the REAL live store + reducer (only `useI18n` is
 * stubbed) and proves, for Dine-In, Takeaway and Pickup, that no Guests
 * control is offered and the order the reducer creates carries no guest value
 * at all — not a typed one, not a default (1, 2, table capacity, …).
 *
 * Display of a guest count that an OLD order already has (pre-bill,
 * `pos-order.tsx`, Console order detail) is deliberately untouched and is not
 * what is asserted here.
 */

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

import { LiveProvider, useLive } from "@/lib/console/live/store";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { PosFloor } from "./pos-floor";

/** Opens the shift (the reducer refuses sales without one) and exposes the orders it holds. */
function Probe() {
  const { state, dispatch } = useLive();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "SHIFT_OPEN",
            employeeId: activeEmployees[0]!.id,
            openingFloatMinor: 100_000,
          })
        }
      >
        open-shift
      </button>
      <output data-testid="orders">
        {JSON.stringify(
          Object.values(state.orders).map((order) => ({
            orderType: order.orderType,
            tableId: order.tableId,
            guestCount: order.guestCount,
          })),
        )}
      </output>
    </>
  );
}

const ordersInStore = (): { orderType: string; tableId: string | null; guestCount: number | null }[] =>
  JSON.parse(screen.getByTestId("orders").textContent ?? "[]");

async function mountWithShift() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  render(
    <LiveProvider>
      <Probe />
      <PosFloor />
    </LiveProvider>,
  );
  await user.click(screen.getByRole("button", { name: "open-shift" }));
  return user;
}

/** The number chips the removed picker rendered. */
const GUEST_CHIPS = ["1", "2", "3", "4", "5", "6", "8", "10"];

function expectNoGuestsPicker() {
  expect(screen.queryByText("pos.guests")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/pos\.guests/)).not.toBeInTheDocument();
  for (const chip of GUEST_CHIPS) {
    expect(screen.queryByRole("button", { name: chip })).not.toBeInTheDocument();
  }
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("demo POS — no Guests picker, no guest value", () => {
  it("Dine-In: the seat sheet offers a table and NO Guests picker; the order it creates has no guest count", async () => {
    const user = await mountWithShift();

    await user.click(screen.getByRole("button", { name: /Dine In/ }));

    // The sheet is open (table choice + confirm), and nothing asks for guests.
    expect(await screen.findByText("pos.newOrder")).toBeInTheDocument();
    expectNoGuestsPicker();

    await user.click(screen.getByRole("button", { name: "pos.newOrder" }));

    const [created] = ordersInStore();
    expect(ordersInStore()).toHaveLength(1);
    expect(created.orderType).toBe("dine_in");
    expect(created.tableId).toBeTruthy();
    // No typed, hidden or default value — strictly null.
    expect(created.guestCount).toBeNull();
  });

  it.each([
    ["Takeaway", "takeaway"],
    ["Pickup from Branch", "pickup"],
  ])("%s: opens straight away with no Guests picker and no guest count", async (label, orderType) => {
    const user = await mountWithShift();

    expectNoGuestsPicker();
    await user.click(screen.getByRole("button", { name: new RegExp(label) }));

    expectNoGuestsPicker();
    const [created] = ordersInStore();
    expect(ordersInStore()).toHaveLength(1);
    expect(created.orderType).toBe(orderType);
    expect(created.tableId).toBeNull();
    expect(created.guestCount).toBeNull();
  });

  it("the floor itself (tables and order-type row) shows no Guests control either", async () => {
    await mountWithShift();
    expectNoGuestsPicker();
  });
});
