import { describe, expect, it } from "vitest";
import { formatMoney, tx } from "@/lib/console/format";
import { itemSnapshotName, toOrder, toOrderLine, toReceipt, toTicketLine, type OrderContext } from "./map";
import type * as S from "@/lib/api/schema";

/*
 * DEMO-POS-ORDER-CRITICAL-P0 — live symptom: an EGP 300 item displayed a
 * subtotal of EGP 150,000.00 after being added to the bill. Root cause:
 * `toOrder`/`toOrderLine` ran every Sales/Orders money field (all already
 * minor-unit integer strings straight off a Prisma BigInt column, e.g.
 * `"30000"` for EGP 300.00) through `money()` — the parser built for a
 * MAJOR-unit decimal string a human typed (`"12.5" -> 1250`) — instead of
 * `minorMoney()`, which does a straight integer parse. `money("30000")`
 * reads "30000" as if it were "300.00" and produces 3,000,000 (a further
 * 100x), which `formatMoney` then divides by 100 for display: exactly a
 * 100x-too-large figure for every non-zero amount, invisible at zero (tax).
 */

const fmt = { locale: "en" as const, arabicIndicNumerals: false };

// `Intl.NumberFormat` inserts a U+00A0 non-breaking space between the
// currency code and the amount; normalize it so assertions compare on the
// visible text, not an invisible codepoint.
function normalizeSpace(s: string): string {
  return s.replace(/ /g, " ");
}

const CONTEXT: OrderContext = { tenantId: "tenant-1" };

function egp(minorUnits: string) {
  return minorUnits;
}

const wireLine: S.OrdersController_findOneResponse["lines"][number] = {
  id: "line-1",
  sequence: 1,
  menuItemId: "item-1",
  variantId: "variant-1",
  itemNameSnapshot: { item: { en: "test maqloba" } },
  quantity: "1",
  unitPrice: egp("30000"), // EGP 300.00
  modifierTotal: egp("0"),
  lineDiscount: egp("0"),
  lineSubtotal: egp("30000"),
  taxClassId: "tax-1",
  taxAmount: egp("0"),
  lineTotal: egp("30000"),
  unitCostSnapshot: null,
  recipeVersionId: null,
  priceListId: null,
  priceEntryId: null,
  priceRule: null,
  course: 1,
  seatNumber: null,
  state: "pending",
  firedAt: null,
  readyAt: null,
  isComp: false,
  notes: null,
  createdAt: "2026-09-14T00:00:00.000Z",
};

function wireOrder(
  lines: S.OrdersController_findOneResponse["lines"],
): S.OrdersController_findOneResponse {
  const subtotal = lines.reduce((sum, l) => sum + Number(l.lineSubtotal), 0);
  const tax = lines.reduce((sum, l) => sum + Number(l.taxAmount), 0);
  return {
    id: "order-1",
    branchId: "branch-1",
    terminalId: null,
    orderNumber: "B1-0001",
    businessDay: "2026-09-14",
    orderType: "takeaway",
    channel: "pos",
    state: "open",
    tableId: null,
    guestCount: null,
    openedBy: "employee-1",
    servedBy: null,
    closedBy: null,
    currency: "EGP",
    subtotal: String(subtotal),
    discountTotal: "0",
    serviceChargeTotal: "0",
    taxTotal: String(tax),
    roundingAdjustment: "0",
    grandTotal: String(subtotal + tax),
    paidTotal: "0",
    tipTotal: "0",
    openedAt: "2026-09-14T00:00:00.000Z",
    firstFiredAt: null,
    completedAt: null,
    originDeviceTime: "2026-09-14T00:00:00.000Z",
    countryPackVersion: "EG-1",
    notes: null,
    version: 1,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    lines,
  };
}

describe("toOrderLine — money stays in the units the backend declares (minor units)", () => {
  it("EGP 300 unit price stays EGP 300 (not EGP 30,000 or EGP 3,000)", () => {
    const line = toOrderLine(wireLine, "EGP");
    expect(line.unitPrice.amount).toBe(30_000);
    expect(normalizeSpace(formatMoney(line.unitPrice, fmt))).toBe("EGP 300.00");
  });

  it("whole chicken (EGP 600) stays EGP 600", () => {
    const line = toOrderLine({ ...wireLine, unitPrice: egp("60000"), lineSubtotal: egp("60000"), lineTotal: egp("60000") }, "EGP");
    expect(line.unitPrice.amount).toBe(60_000);
    expect(normalizeSpace(formatMoney(line.unitPrice, fmt))).toBe("EGP 600.00");
  });

  it("zero stays zero (tax with no configured rate)", () => {
    const line = toOrderLine(wireLine, "EGP");
    expect(line.taxAmount.amount).toBe(0);
    expect(normalizeSpace(formatMoney(line.taxAmount, fmt))).toBe("EGP 0.00");
  });
});

describe("toOrder — one added line renders as one line with the correct totals", () => {
  it("acceptance: one unit of a half-chicken-priced item (EGP 300) — display, subtotal, tax, total", () => {
    const order = toOrder(wireOrder([wireLine]), CONTEXT);

    expect(order.lines).toHaveLength(1);
    expect(normalizeSpace(formatMoney(order.lines[0].unitPrice, fmt))).toBe("EGP 300.00");
    expect(normalizeSpace(formatMoney(order.subtotal, fmt))).toBe("EGP 300.00");
    expect(normalizeSpace(formatMoney(order.taxTotal, fmt))).toBe("EGP 0.00");
    expect(normalizeSpace(formatMoney(order.grandTotal, fmt))).toBe("EGP 300.00");
  });

  it("whole chicken at qty 1 totals EGP 600, not EGP 60,000", () => {
    const wholeChickenLine = {
      ...wireLine,
      id: "line-2",
      unitPrice: egp("60000"),
      lineSubtotal: egp("60000"),
      lineTotal: egp("60000"),
    };
    const order = toOrder(wireOrder([wholeChickenLine]), CONTEXT);

    expect(normalizeSpace(formatMoney(order.subtotal, fmt))).toBe("EGP 600.00");
    expect(normalizeSpace(formatMoney(order.grandTotal, fmt))).toBe("EGP 600.00");
  });

  it("does not silently drop a real line: an order with lines present never falls back to empty", () => {
    const order = toOrder(wireOrder([wireLine]), CONTEXT);
    expect(order.lines.length).toBeGreaterThan(0);
  });
});

/**
 * `pos-live.tsx`'s Send-to-kitchen/Pay buttons derive `disabled` directly
 * from `order.lines` — `pending.length === 0` (Send) and
 * `order.lines.length === 0` (Pay) — never a separate boolean the UI tracks
 * on its own. These were never wrong; they were starved of real data by the
 * bugs above. This proves that once `toOrder` is fed a genuinely populated
 * wire response, both enable correctly, and an empty order still disables
 * both — the root-cause fix (not a button-boolean patch) closes part C too.
 */
describe("Send/Pay enablement derives correctly once `order.lines` is real", () => {
  it("a valid pending line enables Send to kitchen", () => {
    const order = toOrder(wireOrder([wireLine]), CONTEXT);
    const pending = order.lines.filter((line) => line.state === "pending");
    expect(pending.length).toBeGreaterThan(0); // Send's `disabled` condition
  });

  it("any line at all enables Pay", () => {
    const order = toOrder(wireOrder([wireLine]), CONTEXT);
    expect(order.lines.length === 0).toBe(false); // Pay's `disabled` condition
  });

  it("a genuinely empty order still disables both Send and Pay", () => {
    const order = toOrder(wireOrder([]), CONTEXT);
    const pending = order.lines.filter((line) => line.state === "pending");
    expect(pending.length === 0).toBe(true);
    expect(order.lines.length === 0).toBe(true);
  });
});

/*
 * ITEM-NAME-RENDERING-P0 — the backend's BR-POS-004 sale-time snapshot is
 * `{ item: Localised, variant: Localised }`, never a flat `{en, ar}` — every
 * frontend consumer expected the flat shape and silently rendered blank.
 * `itemSnapshotName()` unwraps the real shape; these tests exercise it
 * directly and through the three mappers (order line / receipt / KDS ticket)
 * that feed POS, the receipt drawer, and the KDS ticket card.
 */
describe("itemSnapshotName — unwraps BR-POS-004's { item, variant } snapshot", () => {
  it("renders the item name in EN", () => {
    const name = itemSnapshotName({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } });
    expect(tx(name, "en")).toBe("Grilled Chicken");
  });

  it("renders the item name in AR", () => {
    const name = itemSnapshotName({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } });
    expect(tx(name, "ar")).toBe("فراخ مشوية");
  });

  it("combines the variant name with the item name when a variant is present", () => {
    const name = itemSnapshotName({
      item: { en: "Chicken", ar: "فراخ" },
      variant: { en: "Large", ar: "كبير" },
    });
    expect(tx(name, "en")).toBe("Chicken — Large");
    expect(tx(name, "ar")).toBe("فراخ — كبير");
  });

  it("falls back to the item name alone when no variant is present", () => {
    const name = itemSnapshotName({ item: { en: "Water", ar: "مياه" } });
    expect(tx(name, "en")).toBe("Water");
  });

  it("falls back to the item name alone when variant carries no usable text", () => {
    const name = itemSnapshotName({ item: { en: "Water", ar: "مياه" }, variant: {} });
    expect(tx(name, "en")).toBe("Water");
  });

  it("preserves EN/AR cross-fallback: a name with only EN still resolves in AR", () => {
    const name = itemSnapshotName({ item: { en: "Fries" } });
    expect(tx(name, "ar")).toBe("Fries");
  });

  it("still handles a flat legacy { en, ar } value (demo/mock data path)", () => {
    const name = itemSnapshotName({ en: "Burger", ar: "برجر" });
    expect(tx(name, "en")).toBe("Burger");
    expect(tx(name, "ar")).toBe("برجر");
  });
});

describe("toOrderLine — POS line renders the real item name, not blank", () => {
  it("EN", () => {
    const line = toOrderLine(wireLine, "EGP");
    expect(tx(line.itemNameSnapshot, "en")).toBe("test maqloba");
  });

  it("AR (falls back to EN when no Arabic snapshot was captured)", () => {
    const line = toOrderLine(wireLine, "EGP");
    expect(tx(line.itemNameSnapshot, "ar")).toBe("test maqloba");
  });

  it("includes the variant name when the snapshot carries one", () => {
    const line = toOrderLine(
      {
        ...wireLine,
        itemNameSnapshot: {
          item: { en: "Chicken", ar: "فراخ" },
          variant: { en: "Half", ar: "نص" },
        },
      },
      "EGP",
    );
    expect(tx(line.itemNameSnapshot, "en")).toBe("Chicken — Half");
    expect(tx(line.itemNameSnapshot, "ar")).toBe("فراخ — نص");
  });
});

describe("toReceipt — receipt line renders the real item name, not blank", () => {
  function wireReceiptLine(
    itemNameSnapshot: unknown,
  ): S.OrdersController_receiptResponse["lines"][number] {
    return {
      sequence: 1,
      menuItemId: "item-1",
      variantId: "variant-1",
      itemNameSnapshot: itemNameSnapshot as Record<string, unknown>,
      quantity: "1",
      unitPrice: "30000",
      modifiers: [],
      modifierTotal: "0",
      lineDiscount: "0",
      lineSubtotal: "30000",
      taxClassId: "tax-1",
      taxAmount: "0",
      lineTotal: "30000",
    };
  }

  function wireReceipt(
    lines: S.OrdersController_receiptResponse["lines"],
  ): S.OrdersController_receiptResponse {
    return {
      documentType: "INTERNAL_NON_FISCAL_RECEIPT",
      fiscal: false,
      disclosureKey: "receipt.nonFiscal",
      order: {
        id: "order-1",
        orderNumber: "B1-0001",
        businessDay: "2026-09-14",
        branchId: "branch-1",
        terminalId: null,
        orderType: "takeaway",
        channel: "pos",
        state: "completed",
        completedAt: "2026-09-14T00:00:00.000Z",
        currency: "EGP",
        countryPackVersion: "EG-1",
        tableId: null,
        guestCount: null,
        tableLabel: null,
      },
      lines,
      totals: {
        subtotal: "30000",
        discountTotal: "0",
        serviceChargeTotal: "0",
        taxTotal: "0",
        grandTotal: "30000",
        paidTotal: "30000",
        tipTotal: "0",
        cashRoundingAdjustment: "0",
      },
      taxPresentation: "NOT_APPLICABLE",
      payments: [],
    };
  }

  it("shows the item name (EN)", () => {
    const receipt = toReceipt(
      wireReceipt([wireReceiptLine({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } })]),
    );
    expect(tx(receipt.lines[0].name, "en")).toBe("Grilled Chicken");
  });

  it("shows the item name (AR)", () => {
    const receipt = toReceipt(
      wireReceipt([wireReceiptLine({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } })]),
    );
    expect(tx(receipt.lines[0].name, "ar")).toBe("فراخ مشوية");
  });

  it("includes the variant name when present", () => {
    const receipt = toReceipt(
      wireReceipt([
        wireReceiptLine({ item: { en: "Chicken", ar: "فراخ" }, variant: { en: "Large", ar: "كبير" } }),
      ]),
    );
    expect(tx(receipt.lines[0].name, "en")).toBe("Chicken — Large");
  });
});

describe("toTicketLine — KDS ticket card renders the real item name, not blank", () => {
  function wireTicketLine(
    itemNameSnapshot: unknown,
  ): S.KitchenController_getStationQueueResponse["tickets"][number]["lines"][number] {
    return {
      id: "ticket-line-1",
      orderLineId: "line-1",
      itemNameSnapshot: itemNameSnapshot as Record<string, unknown>,
      quantity: "1",
      course: 1,
      sequence: 1,
      preparationNotes: null,
      status: "queued",
      firstViewedAt: null,
      startedAt: null,
      readyAt: null,
      bumpedAt: null,
      recalledAt: null,
      cancelledAt: null,
      modifiers: [],
    };
  }

  it("shows the item name (EN)", () => {
    const line = toTicketLine(
      wireTicketLine({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } }),
    );
    expect(tx(line.name, "en")).toBe("Grilled Chicken");
  });

  it("shows the item name (AR)", () => {
    const line = toTicketLine(
      wireTicketLine({ item: { en: "Grilled Chicken", ar: "فراخ مشوية" } }),
    );
    expect(tx(line.name, "ar")).toBe("فراخ مشوية");
  });

  it("includes the variant name when present", () => {
    const line = toTicketLine(
      wireTicketLine({ item: { en: "Chicken", ar: "فراخ" }, variant: { en: "Half", ar: "نص" } }),
    );
    expect(tx(line.name, "en")).toBe("Chicken — Half");
    expect(tx(line.name, "ar")).toBe("فراخ — نص");
  });
});
