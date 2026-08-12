/**
 * Inventory fixtures — levels, batches, the movement ledger, count
 * sessions, transfers, waste and adjustments. SRS ch.11.
 */

import type {
  Batch,
  CountLine,
  CountSession,
  Money,
  MovementType,
  StockAdjustment,
  StockLevel,
  StockMovement,
  Transfer,
  TransferLine,
  WasteRecord,
  WasteReason,
} from "../types";
import { ACTIVE_TENANT_ID, branches, locationById, stockLocations } from "./org";
import { stockItems } from "./stock-items";
import { chance, createRng, float, gaussian, int, pick, seqId } from "./rng";
import { daysUntil, dateAgo, dateAhead, hoursAgo, minutesAgo } from "./clock";

const rng = createRng(0x11ae);

const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

/** Locations that actually hold stock in the demo. */
export const inventoryLocations = stockLocations;

// ---------------------------------------------------------------------------
// Waste reason taxonomy — SRS FR-INV-057
// ---------------------------------------------------------------------------

export const wasteReasons: WasteReason[] = [
  { code: "expired", name: { en: "Expired", ar: "منتهي الصلاحية" }, category: "storage", isTrueWaste: true },
  { code: "spoiled", name: { en: "Spoiled", ar: "تالف" }, category: "storage", isTrueWaste: true },
  { code: "damaged_delivery", name: { en: "Damaged in delivery", ar: "تلف أثناء التوصيل" }, category: "supplier", isTrueWaste: true },
  { code: "prep_error", name: { en: "Preparation error", ar: "خطأ في التحضير" }, category: "kitchen", isTrueWaste: true },
  { code: "overproduction", name: { en: "Overproduction", ar: "إنتاج زائد" }, category: "kitchen", isTrueWaste: true },
  { code: "incorrect_portion", name: { en: "Incorrect portion", ar: "حصة غير صحيحة" }, category: "kitchen", isTrueWaste: true },
  { code: "burnt", name: { en: "Burnt / overcooked", ar: "محروق أو زائد الطهي" }, category: "kitchen", isTrueWaste: true },
  { code: "customer_return", name: { en: "Customer return", ar: "إرجاع من العميل" }, category: "service", isTrueWaste: true },
  { code: "order_error", name: { en: "Order error", ar: "خطأ في الطلب" }, category: "service", isTrueWaste: true },
  { code: "staff_meal", name: { en: "Staff meal", ar: "وجبة موظفين" }, category: "policy", isTrueWaste: false },
  { code: "sampling", name: { en: "Sampling / tasting", ar: "تذوق أو عينة" }, category: "policy", isTrueWaste: false },
  { code: "equipment_failure", name: { en: "Equipment failure", ar: "عطل في المعدات" }, category: "facility", isTrueWaste: true },
  { code: "unexplained", name: { en: "Theft / unexplained", ar: "سرقة أو غير مبرر" }, category: "control", isTrueWaste: true },
];

export const wasteReasonByCode = new Map(wasteReasons.map((r) => [r.code, r]));

export const adjustmentReasons = [
  { code: "correction", name: { en: "Data-entry correction", ar: "تصحيح إدخال بيانات" } },
  { code: "missing_receipt", name: { en: "Missing goods receipt", ar: "استلام بضائع مفقود" } },
  { code: "unrecorded_transfer", name: { en: "Unrecorded transfer", ar: "تحويل غير مسجل" } },
  { code: "opening_load", name: { en: "Opening stock load", ar: "تحميل رصيد افتتاحي" } },
  { code: "system_reconciliation", name: { en: "System reconciliation", ar: "تسوية النظام" } },
];

const STAFF_NAMES = [
  { en: "Mahmoud Fathy", ar: "محمود فتحي" },
  { en: "Amal Saeed", ar: "أمل سعيد" },
  { en: "Youssef Rashad", ar: "يوسف رشاد" },
  { en: "Sameh Naguib", ar: "سامح نجيب" },
  { en: "Nadia Halim", ar: "نادية حليم" },
  { en: "Karim Adel", ar: "كريم عادل" },
  { en: "Hoda Mansour", ar: "هدى منصور" },
  { en: "Tarek Selim", ar: "طارق سليم" },
];

// ---------------------------------------------------------------------------
// Stock levels — SRS FR-INV-010
// ---------------------------------------------------------------------------

export const stockLevels: StockLevel[] = (() => {
  const out: StockLevel[] = [];
  for (const loc of inventoryLocations) {
    // Central kitchen and warehouses carry the full range; branches a subset.
    const carried =
      loc.kind === "branch"
        ? stockItems.filter((_, i) => i % 5 !== 4)
        : stockItems;

    for (const stockItem of carried) {
      const par = int(rng, 40, 900);
      const reorderPoint = Math.round(par * 0.35);
      const reorderQty = Math.round(par * 0.6);

      // Most items sit healthy; a deliberate minority sit low or negative so
      // every state on the stock screen is reachable.
      const roll = rng();
      let onHand: number;
      if (roll < 0.06) onHand = -int(rng, 1, 40);
      else if (roll < 0.16) onHand = int(rng, 1, reorderPoint - 1);
      else if (roll < 0.24) onHand = int(rng, reorderPoint, Math.round(par * 0.55));
      else if (roll < 0.9) onHand = int(rng, Math.round(par * 0.6), par);
      else onHand = int(rng, par + 1, Math.round(par * 1.9));

      const dailyUse = Math.max(1, Math.round(par / int(rng, 5, 22)));
      const value = onHand * stockItem.unitCost.amount;

      const status: StockLevel["status"] =
        onHand < 0
          ? "negative"
          : onHand === 0 || onHand < reorderPoint * 0.4
            ? "critical"
            : onHand < reorderPoint
              ? "low"
              : onHand > par
                ? "overstocked"
                : "ok";

      out.push({
        itemId: stockItem.id,
        itemName: stockItem.name,
        sku: stockItem.sku,
        locationId: loc.id,
        locationName: loc.name,
        onHand: { value: onHand.toFixed(3), unit: stockItem.baseUnit },
        allocated: { value: int(rng, 0, 20).toFixed(3), unit: stockItem.baseUnit },
        onOrder: { value: (chance(rng, 0.3) ? reorderQty : 0).toFixed(3), unit: stockItem.baseUnit },
        reorderPoint,
        reorderQuantity: reorderQty,
        parLevel: par,
        unitCost: stockItem.unitCost,
        value: EGP(value),
        daysOfCover: onHand > 0 ? Math.round((onHand / dailyUse) * 10) / 10 : 0,
        lastCountedAt: chance(rng, 0.8) ? hoursAgo(int(rng, 12, 700)) : null,
        status,
      });
    }
  }
  return out;
})();

export const lowStockLevels = stockLevels.filter(
  (l) => l.status === "low" || l.status === "critical" || l.status === "negative",
);

// ---------------------------------------------------------------------------
// Batches — SRS §11.4
// ---------------------------------------------------------------------------

export const batches: Batch[] = (() => {
  const out: Batch[] = [];
  let n = 0;
  const tracked = stockItems.filter((s) => s.batchTracked || s.expiryTracked);

  for (const loc of inventoryLocations) {
    for (const stockItem of tracked) {
      if (!chance(rng, loc.kind === "branch" ? 0.42 : 0.75)) continue;
      const perItem = int(rng, 1, 2);

      for (let b = 0; b < perItem; b += 1) {
        n += 1;
        const shelf = stockItem.shelfLifeDays ?? 30;
        // Skew a few batches into the past so the expiry worklist is real.
        const offset = chance(rng, 0.12)
          ? -int(rng, 1, 5)
          : int(rng, 0, Math.max(1, shelf));
        const expiry = dateAhead(offset);
        const qty = int(rng, 5, 400);
        const days = daysUntil(expiry);

        out.push({
          id: seqId("bat", n),
          itemId: stockItem.id,
          itemName: stockItem.name,
          locationId: loc.id,
          locationName: loc.name,
          batchNumber: `B${String(240000 + n)}`,
          productionDate: stockItem.batchTracked ? dateAgo(int(rng, 1, 20)) : null,
          expiryDate: expiry,
          quantity: { value: qty.toFixed(3), unit: stockItem.baseUnit },
          unitCost: stockItem.unitCost,
          value: EGP(qty * stockItem.unitCost.amount),
          supplierId: null,
          supplierName: null,
          daysToExpiry: days,
          status:
            days < 0 ? "expired" : days <= 1 ? "critical" : days <= 7 ? "expiring" : "fresh",
        });
      }
    }
  }
  return out;
})();

export const expiringBatches = batches
  .filter((b) => b.daysToExpiry <= 7)
  .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

// ---------------------------------------------------------------------------
// Movement ledger — SRS §7.4.3
// ---------------------------------------------------------------------------

const MOVEMENT_MIX: { type: MovementType; weight: number; sign: -1 | 1 }[] = [
  { type: "sale_depletion", weight: 46, sign: -1 },
  { type: "purchase_receipt", weight: 14, sign: 1 },
  { type: "waste", weight: 9, sign: -1 },
  { type: "transfer_out", weight: 7, sign: -1 },
  { type: "transfer_in", weight: 7, sign: 1 },
  { type: "count_adjustment", weight: 6, sign: -1 },
  { type: "production_input", weight: 4, sign: -1 },
  { type: "production_output", weight: 4, sign: 1 },
  { type: "manual_adjustment", weight: 2, sign: 1 },
  { type: "expiry_writeoff", weight: 1, sign: -1 },
];

const MOVEMENT_POOL: { type: MovementType; sign: -1 | 1 }[] = MOVEMENT_MIX.flatMap((m) =>
  Array.from({ length: m.weight }, () => ({ type: m.type, sign: m.sign })),
);

const REFERENCE_TYPE: Record<MovementType, string> = {
  sale_depletion: "order",
  sale_reversal: "order",
  purchase_receipt: "goods_receipt",
  purchase_return: "goods_receipt",
  waste: "waste",
  transfer_out: "transfer",
  transfer_in: "transfer",
  count_adjustment: "count",
  manual_adjustment: "adjustment",
  production_input: "production",
  production_output: "production",
  opening_balance: "opening",
  expiry_writeoff: "waste",
};

export const stockMovements: StockMovement[] = (() => {
  const out: StockMovement[] = [];
  const balances = new Map<string, number>();

  for (let i = 1; i <= 520; i += 1) {
    const loc = pick(rng, inventoryLocations);
    const stockItem = pick(rng, stockItems);
    const { type, sign } = pick(rng, MOVEMENT_POOL);
    const magnitude = int(rng, 1, type === "sale_depletion" ? 60 : 260);
    const signed = sign * magnitude;

    const key = `${loc.id}:${stockItem.id}`;
    const running = (balances.get(key) ?? int(rng, 100, 800)) + signed;
    balances.set(key, running);

    const staff = pick(rng, STAFF_NAMES);
    const needsReason = type === "waste" || type === "manual_adjustment" || type === "count_adjustment";

    out.push({
      id: seqId("mov", i),
      tenantId: ACTIVE_TENANT_ID,
      locationId: loc.id,
      locationName: loc.name,
      itemId: stockItem.id,
      itemName: stockItem.name,
      batchId: stockItem.batchTracked && chance(rng, 0.5) ? seqId("bat", int(rng, 1, 200)) : null,
      movementType: type,
      quantity: { value: signed.toFixed(3), unit: stockItem.baseUnit },
      unitCost: stockItem.unitCost,
      totalCost: EGP(Math.abs(signed) * stockItem.unitCost.amount),
      balanceAfter: { value: running.toFixed(3), unit: stockItem.baseUnit },
      referenceType: REFERENCE_TYPE[type],
      referenceId: seqId(REFERENCE_TYPE[type].slice(0, 3), int(rng, 1, 400)),
      counterpartMovementId:
        type === "transfer_out" || type === "transfer_in" ? seqId("mov", int(rng, 1, 520)) : null,
      occurredAt: minutesAgo(int(rng, 5, 60 * 24 * 21)),
      recordedAt: minutesAgo(int(rng, 1, 60 * 24 * 21)),
      performedBy: seqId("emp", int(rng, 1, 40)),
      performedByName: staff,
      reasonCode: needsReason ? pick(rng, wasteReasons).code : null,
      notes: chance(rng, 0.15) ? "Recorded on the mobile app." : null,
    });
  }

  return out.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
})();

// ---------------------------------------------------------------------------
// Count sessions — SRS §11.6
// ---------------------------------------------------------------------------

const COUNT_SCOPES = [
  { en: "Walk-in chiller", ar: "الثلاجة الكبيرة" },
  { en: "Dry store", ar: "المخزن الجاف" },
  { en: "Freezer", ar: "المجمد" },
  { en: "Full location", ar: "الموقع بالكامل" },
  { en: "Proteins category", ar: "فئة البروتينات" },
  { en: "Bar and beverages", ar: "البار والمشروبات" },
];

export const countSessions: CountSession[] = (() => {
  const out: CountSession[] = [];
  const statuses: CountSession["status"][] = [
    "posted", "posted", "posted", "posted", "submitted", "submitted", "counting", "draft", "cancelled",
  ];

  for (let i = 1; i <= 18; i += 1) {
    const loc = pick(rng, inventoryLocations);
    const status = statuses[(i - 1) % statuses.length]!;
    const mode: CountSession["mode"] = chance(rng, 0.78) ? "blind" : "open";
    const lineCount = int(rng, 12, 30);
    const staff = pick(rng, STAFF_NAMES);

    const lines: CountLine[] = Array.from({ length: lineCount }, (_, li) => {
      const stockItem = stockItems[(i * 7 + li * 3) % stockItems.length]!;
      const expected = int(rng, 20, 600);
      const drift = Math.round(gaussian(rng, 0, expected * 0.05));
      const counted = status === "draft" || status === "counting" ? null : expected + drift;
      const varianceQty = counted === null ? 0 : counted - expected;
      const variancePercent = expected === 0 ? 0 : (varianceQty / expected) * 100;

      return {
        id: `cnl_${i}_${li}`,
        itemId: stockItem.id,
        itemName: stockItem.name,
        sku: stockItem.sku,
        expected: { value: expected.toFixed(3), unit: stockItem.baseUnit },
        counted: counted === null ? null : { value: counted.toFixed(3), unit: stockItem.baseUnit },
        varianceQty,
        varianceValue: EGP(varianceQty * stockItem.unitCost.amount),
        variancePercent: Math.round(variancePercent * 10) / 10,
        flagged: Math.abs(variancePercent) > 6,
        recount: Math.abs(variancePercent) > 12 && chance(rng, 0.4),
      };
    });

    const net = lines.reduce((sum, l) => sum + l.varianceValue.amount, 0);
    const openedAt = hoursAgo(int(rng, 2, 24 * 30));

    out.push({
      id: seqId("cnt", i),
      tenantId: ACTIVE_TENANT_ID,
      locationId: loc.id,
      locationName: loc.name,
      reference: `CNT-${String(2600 + i)}`,
      scope: pick(rng, COUNT_SCOPES),
      mode,
      status,
      openedAt,
      submittedAt: status === "draft" || status === "counting" ? null : hoursAgo(int(rng, 1, 40)),
      postedAt: status === "posted" ? hoursAgo(int(rng, 1, 30)) : null,
      countedBy: seqId("emp", int(rng, 1, 40)),
      countedByName: staff,
      postedBy: status === "posted" ? seqId("emp", int(rng, 1, 12)) : null,
      lineCount,
      flaggedCount: lines.filter((l) => l.flagged).length,
      netVarianceValue: EGP(net),
      lines,
    });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Transfers — SRS FR-INV-031
// ---------------------------------------------------------------------------

export const transfers: Transfer[] = (() => {
  const out: Transfer[] = [];
  const statuses: Transfer["status"][] = [
    "received", "received", "received", "in_transit", "dispatched", "requested", "discrepancy", "draft", "cancelled",
  ];

  for (let i = 1; i <= 22; i += 1) {
    const from = pick(rng, inventoryLocations);
    let to = pick(rng, inventoryLocations);
    while (to.id === from.id) to = pick(rng, inventoryLocations);

    const status = statuses[(i - 1) % statuses.length]!;
    const lineCount = int(rng, 2, 8);

    const lines: TransferLine[] = Array.from({ length: lineCount }, (_, li) => {
      const stockItem = stockItems[(i * 5 + li * 11) % stockItems.length]!;
      const dispatched = int(rng, 5, 200);
      const shortfall = status === "discrepancy" && li === 0 ? int(rng, 1, 8) : 0;
      const received =
        status === "received" || status === "discrepancy" ? dispatched - shortfall : null;
      return {
        id: `trl_${i}_${li}`,
        itemId: stockItem.id,
        itemName: stockItem.name,
        dispatched: { value: dispatched.toFixed(3), unit: stockItem.baseUnit },
        received: received === null ? null : { value: received.toFixed(3), unit: stockItem.baseUnit },
        discrepancy: -shortfall,
        unitCost: stockItem.unitCost,
      };
    });

    const total = lines.reduce(
      (sum, l) => sum + Number(l.dispatched.value) * l.unitCost.amount,
      0,
    );

    out.push({
      id: seqId("trf", i),
      tenantId: ACTIVE_TENANT_ID,
      reference: `TRF-${String(4100 + i)}`,
      fromLocationId: from.id,
      fromLocationName: from.name,
      toLocationId: to.id,
      toLocationName: to.name,
      status,
      dispatchedAt: status === "draft" || status === "requested" ? null : hoursAgo(int(rng, 2, 300)),
      receivedAt: status === "received" || status === "discrepancy" ? hoursAgo(int(rng, 1, 200)) : null,
      requestedBy: pick(rng, STAFF_NAMES),
      lines,
      totalValue: EGP(total),
    });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Waste records — SRS §11.7
// ---------------------------------------------------------------------------

export const wasteRecords: WasteRecord[] = (() => {
  const out: WasteRecord[] = [];
  for (let i = 1; i <= 140; i += 1) {
    const loc = pick(rng, inventoryLocations);
    const stockItem = pick(rng, stockItems);
    const reason = pick(rng, wasteReasons);
    const qty = float(rng, 0.5, 40, 2);
    const value = qty * stockItem.unitCost.amount;
    const staff = pick(rng, STAFF_NAMES);
    const needsApproval = value > 40_000;

    out.push({
      id: seqId("wst", i),
      tenantId: ACTIVE_TENANT_ID,
      locationId: loc.id,
      locationName: loc.name,
      itemId: stockItem.id,
      itemName: stockItem.name,
      quantity: { value: qty.toFixed(3), unit: stockItem.baseUnit },
      reasonCode: reason.code,
      reasonName: reason.name,
      category: reason.category,
      isTrueWaste: reason.isTrueWaste,
      value: EGP(value),
      recordedAt: minutesAgo(int(rng, 10, 60 * 24 * 30)),
      recordedBy: seqId("emp", int(rng, 1, 40)),
      recordedByName: staff,
      stationId: chance(rng, 0.5) ? seqId("stn", int(rng, 1, 50)) : null,
      approval: needsApproval
        ? pick(rng, ["pending", "approved", "approved", "rejected"] as const)
        : "not_required",
      notes: chance(rng, 0.2) ? "Photograph attached at the point of record." : null,
    });
  }
  return out.sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
})();

// ---------------------------------------------------------------------------
// Manual adjustments — SRS FR-INV-035
// ---------------------------------------------------------------------------

export const stockAdjustments: StockAdjustment[] = (() => {
  const out: StockAdjustment[] = [];
  for (let i = 1; i <= 34; i += 1) {
    const loc = pick(rng, inventoryLocations);
    const stockItem = pick(rng, stockItems);
    const reason = pick(rng, adjustmentReasons);
    const qty = (chance(rng, 0.5) ? 1 : -1) * float(rng, 1, 90, 2);
    const value = Math.abs(qty) * stockItem.unitCost.amount;

    out.push({
      id: seqId("adj", i),
      tenantId: ACTIVE_TENANT_ID,
      locationId: loc.id,
      locationName: loc.name,
      itemId: stockItem.id,
      itemName: stockItem.name,
      quantity: { value: qty.toFixed(3), unit: stockItem.baseUnit },
      reasonCode: reason.code,
      reasonName: reason.name,
      value: EGP(value),
      createdAt: minutesAgo(int(rng, 30, 60 * 24 * 25)),
      createdBy: pick(rng, STAFF_NAMES),
      approval: value > 25_000
        ? pick(rng, ["pending", "approved", "approved"] as const)
        : "not_required",
      notes: chance(rng, 0.35) ? "Reconciled against the supplier delivery note." : null,
    });
  }
  return out.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
})();

void branches;
void locationById;
void dateAgo;
