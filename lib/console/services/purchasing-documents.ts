"use client";

/**
 * Purchasing documents for a connected deployment — SRS ch.12.
 *
 * The backend has no supplier, requisition, purchase order, goods receipt or
 * supplier invoice endpoints (`API_COVERAGE.absent` lists `purchasing`).
 * Rather than leave procure-to-pay unusable against a live server, the
 * documents are kept in this browser behind the same `PurchasingService`
 * interface the demo implements — empty to start, never seeded with invented
 * rows — while the stock a receipt or return moves goes to the real ledger
 * (`inventory.postPurchaseMovement`). When the server gains these endpoints,
 * `http.ts` swaps this out and no screen changes.
 */

import type {
  GoodsReceipt,
  PurchaseOrder,
  Requisition,
  Supplier,
  SupplierInvoice,
} from "../types";
import { localCollection, nowIso, type LocalCollection } from "../local-store";
import { tierForTotal } from "../purchasing-rules";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type PurchasingService } from "./types";

const tenant = () => getActiveTenantId();
const EMPTY = { en: "", ar: "" };
const today = () => new Date().toISOString().slice(0, 10);

function reference(prefix: string, taken: string[]): string {
  let max = 0;
  for (const value of taken) {
    const match = value.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

const suppliers: LocalCollection<Supplier> = localCollection<Supplier>(
  {
    name: "prc-doc-suppliers",
    idOf: (row) => row.id,
    search: (row) => [row.legalName, row.tradingName, row.code, row.contactName, row.email],
    filters: { active: (row) => row.active, currency: (row) => row.currency },
    sorters: {
      name: (row) => row.tradingName.en,
      leadTimeDays: (row) => row.leadTimeDays,
      onTime: (row) => row.scorecard.onTimeDeliveryRate,
      outstanding: (row) => row.outstandingBalance.amount,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenant(),
      code: input.code ?? "",
      legalName: input.legalName ?? EMPTY,
      tradingName: input.tradingName ?? EMPTY,
      taxRegistration: input.taxRegistration ?? "",
      contactName: input.contactName ?? "",
      phone: input.phone ?? "",
      email: input.email ?? "",
      paymentTermsDays: input.paymentTermsDays ?? 30,
      currency: input.currency ?? "EGP",
      leadTimeDays: input.leadTimeDays ?? 2,
      minimumOrderValue: input.minimumOrderValue ?? { amount: 0, currency: "EGP" },
      deliveryDays: input.deliveryDays ?? [],
      active: input.active ?? true,
      // No deliveries yet, so nothing to score: zeros, not invented rates.
      scorecard: input.scorecard ?? {
        onTimeDeliveryRate: 0,
        fillRate: 0,
        priceStability: 0,
        qualityRejectionRate: 0,
        invoiceAccuracy: 0,
        averageLeadTimeDays: 0,
      },
      outstandingBalance: input.outstandingBalance ?? { amount: 0, currency: "EGP" },
    }),
  },
  tenant,
);

const requisitions: LocalCollection<Requisition> = localCollection<Requisition>(
  {
    name: "prc-doc-requisitions",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.branchName, row.requestedBy],
    branchOf: (row) => row.branchId,
    filters: { status: (row) => row.status, branchId: (row) => row.branchId },
    sorters: {
      requestedAt: (row) => row.requestedAt,
      estimatedTotal: (row) => row.estimatedTotal.amount,
      neededBy: (row) => row.neededBy,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenant(),
      reference: input.reference ?? reference("REQ", requisitions.peek().map((row) => row.reference)),
      branchId: input.branchId ?? "",
      branchName: input.branchName ?? EMPTY,
      status: input.status ?? "draft",
      requestedBy: input.requestedBy ?? EMPTY,
      requestedAt: nowIso(),
      neededBy: input.neededBy ?? today(),
      lines: input.lines ?? [],
      estimatedTotal: input.estimatedTotal ?? {
        amount: (input.lines ?? []).reduce((sum, line) => sum + line.estimatedCost.amount, 0),
        currency: "EGP",
      },
      notes: input.notes ?? null,
    }),
  },
  tenant,
);

const orders: LocalCollection<PurchaseOrder> = localCollection<PurchaseOrder>(
  {
    name: "prc-doc-orders",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.supplierName, row.deliveryLocationName],
    filters: {
      status: (row) => row.status,
      supplierId: (row) => row.supplierId,
      approvalTier: (row) => row.approvalTier,
    },
    sorters: {
      createdAt: (row) => row.createdAt,
      total: (row) => row.total.amount,
      expectedDelivery: (row) => row.expectedDelivery,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenant(),
      reference: input.reference ?? reference("PO", orders.peek().map((row) => row.reference)),
      supplierId: input.supplierId ?? "",
      supplierName: input.supplierName ?? EMPTY,
      deliveryLocationId: input.deliveryLocationId ?? "",
      deliveryLocationName: input.deliveryLocationName ?? EMPTY,
      status: input.status ?? "draft",
      // FR-PRC-018 — derived from the value, never chosen.
      approvalTier: tierForTotal(input.total?.amount ?? 0),
      createdBy: input.createdBy ?? EMPTY,
      createdAt: nowIso(),
      expectedDelivery: input.expectedDelivery ?? today(),
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      lines: input.lines ?? [],
      subtotal: input.subtotal ?? { amount: 0, currency: "EGP" },
      taxTotal: input.taxTotal ?? { amount: 0, currency: "EGP" },
      total: input.total ?? { amount: 0, currency: "EGP" },
    }),
  },
  tenant,
);

const receipts: LocalCollection<GoodsReceipt> = localCollection<GoodsReceipt>(
  {
    name: "prc-doc-receipts",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.supplierName, row.locationName, row.purchaseOrderRef],
    filters: {
      status: (row) => row.status,
      supplierId: (row) => row.supplierId,
      temperatureOk: (row) => row.temperatureOk,
    },
    sorters: { receivedAt: (row) => row.receivedAt, total: (row) => row.total.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenant(),
      reference: input.reference ?? reference("GRN", receipts.peek().map((row) => row.reference)),
      purchaseOrderId: input.purchaseOrderId ?? null,
      purchaseOrderRef: input.purchaseOrderRef ?? null,
      supplierId: input.supplierId ?? "",
      supplierName: input.supplierName ?? EMPTY,
      locationId: input.locationId ?? "",
      locationName: input.locationName ?? EMPTY,
      status: input.status ?? "posted",
      receivedAt: input.receivedAt ?? nowIso(),
      receivedBy: input.receivedBy ?? EMPTY,
      temperatureC: input.temperatureC ?? null,
      temperatureOk: input.temperatureOk ?? true,
      lines: input.lines ?? [],
      total: input.total ?? { amount: 0, currency: "EGP" },
    }),
  },
  tenant,
);

const invoices: LocalCollection<SupplierInvoice> = localCollection<SupplierInvoice>(
  {
    name: "prc-doc-invoices",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.supplierInvoiceNumber, row.supplierName, row.purchaseOrderRef],
    filters: {
      status: (row) => row.status,
      matchResult: (row) => row.matchResult,
      supplierId: (row) => row.supplierId,
      ageingBucket: (row) => row.ageingBucket,
    },
    sorters: { invoiceDate: (row) => row.invoiceDate, dueDate: (row) => row.dueDate, total: (row) => row.total.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenant(),
      reference: input.reference ?? reference("SI", invoices.peek().map((row) => row.reference)),
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? "",
      supplierId: input.supplierId ?? "",
      supplierName: input.supplierName ?? EMPTY,
      goodsReceiptId: input.goodsReceiptId ?? null,
      goodsReceiptRef: input.goodsReceiptRef ?? null,
      purchaseOrderRef: input.purchaseOrderRef ?? null,
      status: input.status ?? "recorded",
      matchResult: input.matchResult ?? "unmatched",
      matchNotes: input.matchNotes ?? null,
      invoiceDate: input.invoiceDate ?? today(),
      dueDate: input.dueDate ?? today(),
      subtotal: input.subtotal ?? { amount: 0, currency: "EGP" },
      taxTotal: input.taxTotal ?? { amount: 0, currency: "EGP" },
      total: input.total ?? { amount: 0, currency: "EGP" },
      ageingBucket: input.ageingBucket ?? "current",
    }),
  },
  tenant,
);

export const localPurchasing: PurchasingService = {
  suppliers,
  requisitions,
  orders,
  receipts,
  invoices,

  async approveOrder(id) {
    const order = await orders.get(id);
    if (!order) throw new ServiceError("NOT_FOUND", "That purchase order no longer exists.", 404);
    if (order.status !== "pending_approval" && order.status !== "draft") {
      throw new ServiceError("INVALID_STATE", "Only a draft or pending order can be approved.", 422);
    }
    return orders.update(id, { status: "approved", approvedAt: nowIso() });
  },
};
