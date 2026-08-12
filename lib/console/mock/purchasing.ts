/**
 * Purchasing fixtures — suppliers, requisitions, purchase orders, goods
 * receipts and supplier invoices with three-way match results. SRS ch.12.
 */

import type {
  GoodsReceipt,
  GoodsReceiptLine,
  Money,
  PurchaseOrder,
  PurchaseOrderLine,
  Requisition,
  RequisitionLine,
  Supplier,
  SupplierInvoice,
} from "../types";
import { ACTIVE_TENANT_ID, branches, stockLocations } from "./org";
import { stockItems } from "./stock-items";
import { chance, createRng, float, int, pick, seqId } from "./rng";
import { dateAgo, dateAhead, hoursAgo } from "./clock";

const rng = createRng(0x9c17);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

// ---------------------------------------------------------------------------
// Suppliers — SRS §12.3
// ---------------------------------------------------------------------------

interface SupplierSeed {
  code: string;
  en: string;
  ar: string;
  tradeEn: string;
  tradeAr: string;
  contact: string;
  lead: number;
  terms: number;
  days: string[];
}

const SUPPLIER_SEEDS: SupplierSeed[] = [
  { code: "SUP-001", en: "Nile Valley Poultry Co.", ar: "شركة وادي النيل للدواجن", tradeEn: "Nile Poultry", tradeAr: "دواجن النيل", contact: "Hassan Gamal", lead: 1, terms: 30, days: ["Sun", "Tue", "Thu"] },
  { code: "SUP-002", en: "Delta Meat Trading", ar: "دلتا لتجارة اللحوم", tradeEn: "Delta Meat", tradeAr: "دلتا للحوم", contact: "Mostafa Ibrahim", lead: 2, terms: 45, days: ["Mon", "Thu"] },
  { code: "SUP-003", en: "Green Farms Produce", ar: "مزارع الخضرة للمنتجات الطازجة", tradeEn: "Green Farms", tradeAr: "مزارع الخضرة", contact: "Salma Ezzat", lead: 1, terms: 14, days: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"] },
  { code: "SUP-004", en: "Alexandria Dairy House", ar: "بيت الإسكندرية للألبان", tradeEn: "Alex Dairy", tradeAr: "ألبان الإسكندرية", contact: "Ramy Shaker", lead: 2, terms: 30, days: ["Sun", "Wed"] },
  { code: "SUP-005", en: "Cairo Dry Goods Import", ar: "القاهرة لاستيراد المواد الجافة", tradeEn: "Cairo Dry", tradeAr: "القاهرة الجافة", contact: "Nourhan Fouad", lead: 4, terms: 60, days: ["Tue"] },
  { code: "SUP-006", en: "Levant Bakery Supplies", ar: "الشام لمستلزمات المخابز", tradeEn: "Levant Bakery", tradeAr: "مخابز الشام", contact: "Bassem Nour", lead: 3, terms: 30, days: ["Mon", "Thu"] },
  { code: "SUP-007", en: "Roastery Partners Egypt", ar: "شركاء التحميص مصر", tradeEn: "Roastery Partners", tradeAr: "شركاء التحميص", contact: "Dina Wahba", lead: 5, terms: 30, days: ["Wed"] },
  { code: "SUP-008", en: "Red Sea Seafood", ar: "البحر الأحمر للمأكولات البحرية", tradeEn: "Red Sea", tradeAr: "البحر الأحمر", contact: "Ayman Lotfy", lead: 2, terms: 21, days: ["Sun", "Wed"] },
  { code: "SUP-009", en: "PackRight Egypt", ar: "باك رايت مصر", tradeEn: "PackRight", tradeAr: "باك رايت", contact: "Mariam Sobhy", lead: 7, terms: 45, days: ["Mon"] },
  { code: "SUP-010", en: "Oasis Beverage Distribution", ar: "الواحة لتوزيع المشروبات", tradeEn: "Oasis Beverage", tradeAr: "مشروبات الواحة", contact: "Khaled Amer", lead: 3, terms: 30, days: ["Sat", "Tue"] },
];

export const suppliers: Supplier[] = SUPPLIER_SEEDS.map((s, i) => ({
  id: seqId("sup", i + 1),
  tenantId: ACTIVE_TENANT_ID,
  code: s.code,
  legalName: { en: s.en, ar: s.ar },
  tradingName: { en: s.tradeEn, ar: s.tradeAr },
  taxRegistration: String(100_000_000 + i * 7_301_119).slice(0, 9),
  contactName: s.contact,
  phone: `+2010${String(10_000_000 + i * 913_337).slice(0, 8)}`,
  email: `orders@${s.tradeEn.toLowerCase().replace(/\s+/g, "")}.example`,
  paymentTermsDays: s.terms,
  currency: "EGP",
  leadTimeDays: s.lead,
  minimumOrderValue: EGP(int(rng, 100, 600) * 100),
  deliveryDays: s.days,
  active: i !== SUPPLIER_SEEDS.length - 1 ? true : chance(rng, 0.6),
  scorecard: {
    onTimeDeliveryRate: float(rng, 71, 99, 1),
    fillRate: float(rng, 82, 100, 1),
    priceStability: float(rng, 0.4, 9.5, 1),
    qualityRejectionRate: float(rng, 0, 6.5, 1),
    invoiceAccuracy: float(rng, 76, 100, 1),
    averageLeadTimeDays: float(rng, s.lead - 0.4, s.lead + 1.8, 1),
  },
  outstandingBalance: EGP(int(rng, 0, 480_000) * 100),
}));

export const supplierById = new Map(suppliers.map((s) => [s.id, s]));

/** Items this supplier plausibly sells — keeps order lines coherent. */
function itemsForSupplier(index: number) {
  const buckets = [
    ["PRO-001", "PRO-002"],
    ["PRO-003", "PRO-004", "PRO-005"],
    ["PRD-001", "PRD-002", "PRD-003", "PRD-004", "PRD-005", "PRD-006", "PRD-007", "PRD-008", "PRD-009", "PRD-010", "PRD-011", "PRD-012", "BEV-007", "BEV-008"],
    ["DRY-001", "DRY-002", "DRY-003", "DRY-004", "DRY-005", "DRY-006", "DRY-007", "PRO-008"],
    ["DRG-001", "DRG-002", "DRG-003", "DRG-004", "DRG-005", "DRG-006", "DRG-007", "DRG-008", "DRG-009", "DRG-010", "DRG-011", "DRG-012", "DRG-013", "DRG-014", "DRG-015", "DRG-016", "DRY-008"],
    ["BAK-001", "BAK-002", "BAK-003", "BAK-004"],
    ["BEV-001", "BEV-002", "BEV-003", "BEV-004"],
    ["PRO-006", "PRO-007"],
    ["PKG-001", "PKG-002", "PKG-003", "PKG-004", "PKG-005", "PKG-006"],
    ["BEV-005", "BEV-006"],
  ];
  const skus = buckets[index % buckets.length]!;
  return stockItems.filter((s) => skus.includes(s.sku));
}

// ---------------------------------------------------------------------------
// Requisitions — SRS FR-PRC-015
// ---------------------------------------------------------------------------

export const requisitions: Requisition[] = (() => {
  const out: Requisition[] = [];
  const statuses: Requisition["status"][] = [
    "submitted", "submitted", "approved", "consolidated", "draft", "rejected", "cancelled",
  ];

  for (let i = 1; i <= 26; i += 1) {
    const branch = pick(rng, branches);
    const status = statuses[(i - 1) % statuses.length]!;
    const pool = itemsForSupplier(i);
    const lineCount = int(rng, 2, 7);

    const lines: RequisitionLine[] = Array.from({ length: lineCount }, (_, li) => {
      const stockItem = pool[(li * 3 + i) % pool.length]!;
      const qty = int(rng, 5, 120);
      return {
        id: `rql_${i}_${li}`,
        itemId: stockItem.id,
        itemName: stockItem.name,
        quantity: { value: qty.toFixed(3), unit: stockItem.purchaseUnit },
        estimatedCost: EGP(qty * stockItem.unitCost.amount * stockItem.purchaseConversion),
      };
    });

    out.push({
      id: seqId("req", i),
      tenantId: ACTIVE_TENANT_ID,
      reference: `REQ-${String(7200 + i)}`,
      branchId: branch.id,
      branchName: branch.name,
      status,
      requestedBy: pick(rng, [
        { en: "Amal Saeed", ar: "أمل سعيد" },
        { en: "Karim Adel", ar: "كريم عادل" },
        { en: "Tarek Selim", ar: "طارق سليم" },
      ]),
      requestedAt: hoursAgo(int(rng, 3, 24 * 18)),
      neededBy: dateAhead(int(rng, 1, 9)),
      lines,
      estimatedTotal: EGP(lines.reduce((s, l) => s + l.estimatedCost.amount, 0)),
      notes: chance(rng, 0.3) ? "Covering the weekend service." : null,
    });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Purchase orders — SRS §12.4
// ---------------------------------------------------------------------------

/** FR-PRC-018 — value bands decide who must approve. */
export const PO_APPROVAL_BANDS = [
  { tier: 0 as const, upTo: 500_000, approver: { en: "Auto-approved", ar: "اعتماد تلقائي" } },
  { tier: 1 as const, upTo: 2_500_000, approver: { en: "Branch Manager", ar: "مدير الفرع" } },
  { tier: 2 as const, upTo: 10_000_000, approver: { en: "Operations Director", ar: "مدير العمليات" } },
  { tier: 3 as const, upTo: Number.POSITIVE_INFINITY, approver: { en: "Tenant Owner", ar: "مالك المستأجر" } },
];

function tierFor(total: number): 0 | 1 | 2 | 3 {
  return (PO_APPROVAL_BANDS.find((b) => total <= b.upTo) ?? PO_APPROVAL_BANDS[3]!).tier;
}

export const purchaseOrders: PurchaseOrder[] = (() => {
  const out: PurchaseOrder[] = [];
  const statuses: PurchaseOrder["status"][] = [
    "received", "received", "sent", "approved", "pending_approval", "pending_approval",
    "partially_received", "draft", "cancelled",
  ];

  for (let i = 1; i <= 38; i += 1) {
    const supplierIndex = (i - 1) % suppliers.length;
    const supplier = suppliers[supplierIndex]!;
    const location = pick(rng, stockLocations);
    const status = statuses[(i - 1) % statuses.length]!;
    const pool = itemsForSupplier(supplierIndex);
    const lineCount = int(rng, 3, 9);

    const lines: PurchaseOrderLine[] = Array.from({ length: lineCount }, (_, li) => {
      const stockItem = pool[(li * 2 + i) % pool.length]!;
      const qty = int(rng, 4, 90);
      const unitPrice = stockItem.unitCost.amount * stockItem.purchaseConversion;
      const received =
        status === "received" ? qty : status === "partially_received" ? Math.floor(qty * 0.6) : 0;
      return {
        id: `pol_${i}_${li}`,
        itemId: stockItem.id,
        itemName: stockItem.name,
        quantity: { value: qty.toFixed(3), unit: stockItem.purchaseUnit },
        receivedQuantity: { value: received.toFixed(3), unit: stockItem.purchaseUnit },
        unitPrice: EGP(unitPrice),
        taxRate: 14,
        lineTotal: EGP(qty * unitPrice),
      };
    });

    const subtotal = lines.reduce((s, l) => s + l.lineTotal.amount, 0);
    const tax = Math.round(subtotal * 0.14);
    const total = subtotal + tax;
    const tier = tierFor(total);
    const approved = ["approved", "sent", "received", "partially_received"].includes(status);

    out.push({
      id: seqId("pur", i),
      tenantId: ACTIVE_TENANT_ID,
      reference: `PO-${String(9100 + i)}`,
      supplierId: supplier.id,
      supplierName: supplier.tradingName,
      deliveryLocationId: location.id,
      deliveryLocationName: location.name,
      status,
      approvalTier: tier,
      createdBy: pick(rng, [
        { en: "Nourhan Fouad", ar: "نورهان فؤاد" },
        { en: "Karim Adel", ar: "كريم عادل" },
      ]),
      createdAt: hoursAgo(int(rng, 6, 24 * 25)),
      expectedDelivery: dateAhead(int(rng, -6, 10)),
      approvedBy: approved
        ? pick(rng, [
            { en: "Youssef Rashad", ar: "يوسف رشاد" },
            { en: "Amal Saeed", ar: "أمل سعيد" },
          ])
        : null,
      approvedAt: approved ? hoursAgo(int(rng, 2, 24 * 20)) : null,
      lines,
      subtotal: EGP(subtotal),
      taxTotal: EGP(tax),
      total: EGP(total),
    });
  }
  return out;
})();

export const purchaseOrderById = new Map(purchaseOrders.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Goods receipts — SRS §12.5
// ---------------------------------------------------------------------------

const REJECTION_REASONS = [
  "Damaged packaging",
  "Temperature out of range",
  "Short shelf life on arrival",
  "Wrong specification",
];

export const goodsReceipts: GoodsReceipt[] = (() => {
  const out: GoodsReceipt[] = [];
  const sourcePos = purchaseOrders.filter((p) =>
    ["received", "partially_received"].includes(p.status),
  );

  sourcePos.forEach((po, i) => {
    const chilled = chance(rng, 0.55);
    const temp = chilled ? float(rng, 1.2, 9.4, 1) : null;
    const tempOk = temp === null ? true : temp <= 5;

    const lines: GoodsReceiptLine[] = po.lines.map((line, li) => {
      const ordered = Number(line.quantity.value);
      const rejected = chance(rng, 0.12) ? int(rng, 1, Math.max(1, Math.floor(ordered * 0.1))) : 0;
      const short = chance(rng, 0.18) ? int(rng, 1, Math.max(1, Math.floor(ordered * 0.15))) : 0;
      const received = Math.max(0, ordered - rejected - short);
      const drift = chance(rng, 0.22) ? float(rng, -3.5, 8.5, 1) : 0;

      return {
        id: `grl_${i}_${li}`,
        itemId: line.itemId,
        itemName: line.itemName,
        ordered: line.quantity,
        received: { value: received.toFixed(3), unit: line.quantity.unit },
        rejected: { value: rejected.toFixed(3), unit: line.quantity.unit },
        rejectionReason: rejected > 0 ? pick(rng, REJECTION_REASONS) : null,
        batchNumber: chance(rng, 0.6) ? `B${String(250000 + i * 13 + li)}` : null,
        expiryDate: chance(rng, 0.6) ? dateAhead(int(rng, 3, 120)) : null,
        unitPrice: EGP(line.unitPrice.amount * (1 + drift / 100)),
        priceVariancePercent: drift,
      };
    });

    const total = lines.reduce(
      (s, l) => s + Number(l.received.value) * l.unitPrice.amount,
      0,
    );

    out.push({
      id: seqId("grn", i + 1),
      tenantId: ACTIVE_TENANT_ID,
      reference: `GRN-${String(5300 + i + 1)}`,
      purchaseOrderId: po.id,
      purchaseOrderRef: po.reference,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      locationId: po.deliveryLocationId,
      locationName: po.deliveryLocationName,
      status: tempOk ? "posted" : "disputed",
      receivedAt: hoursAgo(int(rng, 2, 24 * 18)),
      receivedBy: pick(rng, [
        { en: "Tarek Selim", ar: "طارق سليم" },
        { en: "Hoda Mansour", ar: "هدى منصور" },
      ]),
      temperatureC: temp,
      temperatureOk: tempOk,
      lines,
      total: EGP(total),
    });
  });

  // Two direct receipts with no PO — FR-PRC-030, flagged as unauthorised.
  for (let i = 0; i < 2; i += 1) {
    const supplier = suppliers[i + 2]!;
    const pool = itemsForSupplier(i + 2);
    const lines: GoodsReceiptLine[] = pool.slice(0, 3).map((stockItem, li) => {
      const qty = int(rng, 3, 25);
      return {
        id: `grl_direct_${i}_${li}`,
        itemId: stockItem.id,
        itemName: stockItem.name,
        ordered: { value: "0.000", unit: stockItem.purchaseUnit },
        received: { value: qty.toFixed(3), unit: stockItem.purchaseUnit },
        rejected: { value: "0.000", unit: stockItem.purchaseUnit },
        rejectionReason: null,
        batchNumber: null,
        expiryDate: null,
        unitPrice: EGP(stockItem.unitCost.amount * stockItem.purchaseConversion),
        priceVariancePercent: 0,
      };
    });
    out.push({
      id: seqId("grn", out.length + 1),
      tenantId: ACTIVE_TENANT_ID,
      reference: `GRN-${String(5400 + i)}`,
      purchaseOrderId: null,
      purchaseOrderRef: null,
      supplierId: supplier.id,
      supplierName: supplier.tradingName,
      locationId: branches[i]!.id,
      locationName: branches[i]!.name,
      status: "posted",
      receivedAt: hoursAgo(int(rng, 4, 60)),
      receivedBy: { en: "Amal Saeed", ar: "أمل سعيد" },
      temperatureC: null,
      temperatureOk: true,
      lines,
      total: EGP(lines.reduce((s, l) => s + Number(l.received.value) * l.unitPrice.amount, 0)),
    });
  }

  return out;
})();

// ---------------------------------------------------------------------------
// Supplier invoices and the three-way match — SRS §12.6
// ---------------------------------------------------------------------------

export const supplierInvoices: SupplierInvoice[] = (() => {
  const out: SupplierInvoice[] = [];

  goodsReceipts.forEach((grn, i) => {
    if (!chance(rng, 0.82)) return;

    const worstDrift = grn.lines.reduce(
      (max, l) => (Math.abs(l.priceVariancePercent) > Math.abs(max) ? l.priceVariancePercent : max),
      0,
    );
    // FR-PRC-041 — unit price tolerance defaults to 2%.
    const match: SupplierInvoice["matchResult"] =
      Math.abs(worstDrift) <= 0.001
        ? "matched"
        : Math.abs(worstDrift) <= 2
          ? "within_tolerance"
          : "disputed";

    const status: SupplierInvoice["status"] =
      match === "disputed"
        ? "disputed"
        : pick(rng, ["matched", "approved_for_payment", "paid", "recorded"] as const);

    const subtotal = grn.total.amount;
    const tax = Math.round(subtotal * 0.14);
    const invoiceDate = dateAgo(int(rng, 1, 25));
    const supplier = supplierById.get(grn.supplierId)!;
    const dueOffset = int(rng, -12, 40);

    out.push({
      id: seqId("inv", i + 1),
      tenantId: ACTIVE_TENANT_ID,
      reference: `SI-${String(6600 + i + 1)}`,
      supplierInvoiceNumber: `${supplier.code}/${String(4400 + i * 3)}`,
      supplierId: grn.supplierId,
      supplierName: grn.supplierName,
      goodsReceiptId: grn.id,
      goodsReceiptRef: grn.reference,
      purchaseOrderRef: grn.purchaseOrderRef,
      status,
      matchResult: match,
      matchNotes:
        match === "disputed"
          ? {
              en: `Unit price ${worstDrift.toFixed(1)}% above the agreed purchase-order price, exceeding the 2% tolerance.`,
              ar: `سعر الوحدة أعلى بنسبة ${worstDrift.toFixed(1)}٪ من سعر أمر الشراء المتفق عليه، بما يتجاوز حد ٢٪.`,
            }
          : null,
      invoiceDate,
      dueDate: dateAhead(dueOffset),
      subtotal: EGP(subtotal),
      taxTotal: EGP(tax),
      total: EGP(subtotal + tax),
      ageingBucket:
        dueOffset >= 0 ? "current" : dueOffset >= -30 ? "30" : dueOffset >= -60 ? "60" : "90+",
    });
  });

  return out;
})();

// Point each stock item at a plausible default supplier.
stockItems.forEach((stockItem, i) => {
  stockItem.defaultSupplierId = suppliers[i % suppliers.length]!.id;
});
