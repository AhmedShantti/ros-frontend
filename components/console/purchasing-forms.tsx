"use client";

/**
 * The write half of procure-to-pay — SRS ch.12.
 *
 * Five documents, in the order money moves: supplier, requisition, purchase
 * order, goods receipt, supplier invoice. They share `DocumentLineEditor`
 * because they are the same shape; what differs is the control each one
 * carries, and those are the parts worth reading:
 *
 *   - The PO shows its **approval band before you submit** (FR-PRC-018), so
 *     the router is visible rather than a surprise.
 *   - The receipt splits **received from rejected** per line (FR-PRC-031)
 *     and captures batch, expiry and temperature where they apply. A receipt
 *     that only records "what arrived" cannot support a spoilage claim.
 *   - The invoice runs the **three-way match** (FR-PRC-041) with the
 *     tolerance for each check shown, because a control whose thresholds are
 *     invisible gets switched off the first time rounding trips it.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Thermometer, X } from "lucide-react";

import type {
  GoodsReceipt,
  Id,
  PurchaseOrder,
  PurchaseUnit,
  Requisition,
  StockItem,
  StockLocation,
  Supplier,
  SupplierInvoice,
  UnitCode,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { SupplierDrawer as SupplierForm } from "./supplier-form";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession, usePermission } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { EMPTY_LOCALISED, LocalisedField, MoneyInput, PercentInput, QuantityInput } from "@/components/console/fields";
import {
  DocumentLineEditor,
  documentTotals,
  newDocumentLine,
  type DocumentLine,
} from "@/components/console/line-editor";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

const CURRENCY = "EGP";

/** Shared: the stock catalogue every line editor picks from. */
function useStockItems(): StockItem[] {
  const state = useAsync(
    () => services.inventory.items.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  return state.data ?? [];
}

function useSuppliers(): Supplier[] {
  const state = useAsync(
    () => services.purchasing.suppliers.list({ limit: 300, filters: { active: "true" } }).then((page) => page.rows.filter(s => s.active)).catch(() => []),
    [],
  );
  return state.data ?? [];
}

function useLocations(): StockLocation[] {
  const state = useAsync(() => services.organisation.locations().catch(() => []), []);
  return state.data ?? [];
}

// ---------------------------------------------------------------------------
// Supplier — FR-PRC-005
// ---------------------------------------------------------------------------

export { SupplierDrawer } from "./supplier-form";

// ---------------------------------------------------------------------------
// Requisition — FR-PRC-015
// ---------------------------------------------------------------------------

export function RequisitionDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const action = useAction();
  const items = useStockItems();
  const branches = useBranches(scope);

  const [branchId, setBranchId] = useState<Id>("");
  const [neededBy, setNeededBy] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocumentLine[]>([]);

  useEffect(() => {
    if (!open) return;
    setBranchId(scope.branchId ?? branches[0]?.id ?? "");
    setLines([newDocumentLine(CURRENCY)]);
    setNotes("");
  }, [open, scope.branchId, branches.length]);

  const usable = lines.filter((line) => line.itemId && Number(line.quantity.value || 0) > 0);
  const problems = useMemo(() => {
    const list: string[] = [];
    if (!branchId) list.push(t("pur.needBranch"));
    if (usable.length === 0) list.push(t("pur.needLines"));
    if (!neededBy) list.push(t("pur.needDate"));
    return list;
  }, [branchId, usable.length, neededBy, t]);

  async function submit(status: "draft" | "submitted") {
    if (problems.length > 0) return;
    const branch = branches.find((entry) => entry.id === branchId);
    await action.run(
      () =>
        services.purchasing.requisitions.create({
          branchId,
          branchName: branch?.name,
          status,
          neededBy,
          notes: notes.trim() || null,
          lines: usable.map((line, index) => ({
            id: `rql_${index + 1}`,
            itemId: line.itemId!,
            itemName: line.itemName,
            quantity: line.quantity,
            estimatedCost: money(
              Math.round(Number(line.quantity.value || 0) * line.unitPrice),
              CURRENCY,
            ),
          })),
        }),
      {
        onSuccess: () =>
          onSaved(status === "submitted" ? t("pur.requisitionSubmitted") : t("pur.requisitionSaved")),
      },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pur.newRequisition")}
      subtitle="FR-PRC-015"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() => void submit("submitted")}
          >
            {t("pur.submitRequisition")}
          </Button>
          <Button
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() => void submit("draft")}
          >
            {t("pur.saveDraft")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("pur.requisitionNote")}</Callout>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.branch")} required>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">—</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pur.neededBy")} required>
            <Input
              type="date"
              dir="ltr"
              value={neededBy}
              onChange={(event) => setNeededBy(event.target.value)}
            />
          </Field>
        </div>

        <DocumentLineEditor
          lines={lines}
          onChange={setLines}
          items={items}
          currency={CURRENCY}
          showTax={false}
          emptyHint={t("pur.requisitionLinesHint")}
        />

        <Field label={t("common.notes")}>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Purchase order — FR-PRC-017, FR-PRC-018
// ---------------------------------------------------------------------------

/** FR-PRC-018 — the same bands the service derives, for the preview. */
function tierOf(totalMinor: number): 0 | 1 | 2 | 3 {
  if (totalMinor < 500_00) return 0;
  if (totalMinor < 5_000_00) return 1;
  if (totalMinor < 25_000_00) return 2;
  return 3;
}

export function PurchaseOrderDrawer({
  order,
  open,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const items = useStockItems();
  const suppliers = useSuppliers();
  const locations = useLocations();

  const [supplierId, setSupplierId] = useState<Id>("");
  const [locationId, setLocationId] = useState<Id>("");
  const [expected, setExpected] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DocumentLine[]>([]);

  useEffect(() => {
    if (!open) return;
    if (order) {
      setSupplierId(order.supplierId);
      setLocationId(order.deliveryLocationId);
      setExpected(order.expectedDelivery);
      setLines(
        order.lines.map((line, index) => ({
          key: `existing_${index}`,
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice.amount,
          taxRate: line.taxRate,
        })),
      );
    } else {
      setSupplierId(suppliers[0]?.id ?? "");
      setLocationId(locations[0]?.id ?? "");
      setLines([newDocumentLine(CURRENCY)]);
    }
  }, [open, order?.id, suppliers.length, locations.length]);

  const usable = lines.filter((line) => line.itemId && Number(line.quantity.value || 0) > 0);
  const totals = documentTotals(usable);
  const tier = tierOf(totals.total);
  const supplier = suppliers.find((entry) => entry.id === supplierId);

  const belowMinimum =
    supplier && supplier.minimumOrderValue.amount > 0 && totals.subtotal < supplier.minimumOrderValue.amount;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!supplierId) list.push(t("pur.needSupplier"));
    if (!locationId) list.push(t("pur.needLocation"));
    if (usable.length === 0) list.push(t("pur.needLines"));
    return list;
  }, [supplierId, locationId, usable.length, t]);

  async function save(status: "draft" | "pending_approval") {
    if (problems.length > 0) return;
    const location = locations.find((entry) => entry.id === locationId);

    const payload: Partial<PurchaseOrder> = {
      supplierId,
      supplierName: supplier?.tradingName,
      deliveryLocationId: locationId,
      deliveryLocationName: location?.name,
      expectedDelivery: expected,
      status,
      approvalTier: tier,
      subtotal: money(totals.subtotal, CURRENCY),
      taxTotal: money(totals.taxTotal, CURRENCY),
      total: money(totals.total, CURRENCY),
      lines: usable.map((line, index) => ({
        id: `pol_${index + 1}`,
        itemId: line.itemId!,
        itemName: line.itemName,
        quantity: line.quantity,
        receivedQuantity: { value: "0", unit: line.quantity.unit },
        unitPrice: money(line.unitPrice, CURRENCY),
        taxRate: line.taxRate,
        lineTotal: money(
          Math.round(Number(line.quantity.value || 0) * line.unitPrice),
          CURRENCY,
        ),
      })),
    };

    await action.run(
      () =>
        order
          ? services.purchasing.orders.update(order.id, payload)
          : services.purchasing.orders.create(payload),
      {
        onSuccess: () =>
          onSaved(
            status === "pending_approval" ? t("pur.orderSubmitted") : t("pur.orderSaved"),
          ),
      },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={order ? t("pur.editOrder") : t("pur.newOrder")}
      subtitle="FR-PRC-017"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() => void save(tier === 0 ? "draft" : "pending_approval")}
          >
            {tier === 0 ? t("pur.createOrder") : t("pur.sendForApproval")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">—</option>
              {suppliers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {tx(entry.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pur.deliverTo")} required>
            <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">—</option>
              {locations.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {tx(entry.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("pur.expectedDelivery")} hint={supplier ? t("pur.leadTimeIs").replace("{n}", String(supplier.leadTimeDays)) : undefined}>
          <Input
            type="date"
            dir="ltr"
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </Field>

        <DocumentLineEditor
          lines={lines}
          onChange={setLines}
          items={items}
          currency={CURRENCY}
          emptyHint={t("pur.orderLinesHint")}
        />

        {belowMinimum && supplier ? (
          <Callout tone="warn" title={t("pur.belowMinimum")}>
            {t("pur.belowMinimumBody").replace(
              "{amount}",
              formatMoney(supplier.minimumOrderValue, fmt),
            )}
          </Callout>
        ) : null}

        {/*
          FR-PRC-018 — the band is shown before submitting, not after. A
          requester who can see where their order routes stops trying to
          route it, which is the behaviour the control is for.
        */}
        <Callout tone={tier === 0 ? "good" : "accent"} title={t("pur.approvalRouting")}>
          {tier === 0
            ? t("pur.tier0")
            : t(`pur.tier${tier}` as never).replace(
                "{amount}",
                formatMoney(money(totals.total, CURRENCY), fmt),
              )}
        </Callout>

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Goods receipt — FR-PRC-030 … FR-PRC-036
// ---------------------------------------------------------------------------

interface ReceiptLineDraft {
  key: string;
  itemId: Id;
  itemName: { en: string; ar: string };
  purchaseOrderLineId: Id | null;
  purchaseUnitId: Id;
  purchaseUnitLabel: string;
  purchaseUnits: PurchaseUnit[];
  ordered: { value: string; unit: string };
  received: string;
  rejected: string;
  rejectionReason: string;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  unitPrice: number;
  agreedPrice: number;
  batchTracked: boolean;
}

/** FR-PRC-008 — price drift beyond this is flagged at the door. */
const PRICE_VARIANCE_TOLERANCE = 2;

function decimalMicros(value: string): bigint | null {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}

function microsDecimal(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function ReceivingDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const items = useStockItems();
  const supplierState = useAsync(
    () => services.purchasing.suppliers.list({ limit: 10000, filters: { active: "true" } }).then(page => page.rows.filter(s => s.active)), [open],
  );
  const suppliers = supplierState.data ?? [];
  const canManageSuppliers = usePermission("supplier.manage");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const locations = useLocations();

  const orders = useAsync(
    () =>
      services.purchasing.orders
        .list({ limit: 100 })
        .then((page) => page.rows.filter((row) => row.status === "approved"))
        .catch(() => [] as PurchaseOrder[]),
    [open],
  );

  const [orderId, setOrderId] = useState<Id | "">("");
  const [supplierId, setSupplierId] = useState<Id>("");
  const [locationId, setLocationId] = useState<Id>("");
  const [temperature, setTemperature] = useState("");
  const [lines, setLines] = useState<ReceiptLineDraft[]>([]);

  const itemsById = useMemo(() => {
    const map = new Map<Id, StockItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const order = (orders.data ?? []).find((entry) => entry.id === orderId) ?? null;

  useEffect(() => {
    if (!open) return;
    setOrderId("");
    setSupplierId("");
    setLocationId("");
    setTemperature("");
    setLines([]);
  }, [open]);
  useEffect(() => { if (open && !supplierId && suppliers.length) setSupplierId(suppliers[0]!.id); }, [open, supplierId, suppliers]);
  useEffect(() => { if (open && !locationId && locations.length) setLocationId(locations[0]!.id); }, [open, locationId, locations]);

  /** Picking a PO pre-fills the sheet with what was ordered. */
  useEffect(() => {
    if (!order) return;
    setSupplierId(order.supplierId);
    setLocationId(order.deliveryLocationId);
    setLines(
      order.lines.map((line, index) => {
        const item = itemsById.get(line.itemId);
        return {
          key: `po_${index}`,
          itemId: line.itemId,
          itemName: line.itemName,
          purchaseOrderLineId: line.id,
          purchaseUnitId: line.purchaseUnitId ?? "",
          purchaseUnitLabel: line.purchaseUnitLabel ?? line.quantity.unit,
          purchaseUnits: [],
          ordered: { ...line.quantity, value: microsDecimal((decimalMicros(line.quantity.value) ?? 0n) - (decimalMicros(line.receivedQuantity.value) ?? 0n)) },
          received: microsDecimal((decimalMicros(line.quantity.value) ?? 0n) - (decimalMicros(line.receivedQuantity.value) ?? 0n)),
          rejected: "0",
          rejectionReason: "",
          batchNumber: "",
          productionDate: "",
          expiryDate: "",
          unitPrice: line.unitPrice.amount,
          agreedPrice: line.unitPrice.amount,
          batchTracked: item?.batchTracked ?? false,
        };
      }),
    );
  }, [order?.id, itemsById]);

  /** FR-PRC-035 — chilled and frozen goods need a reading at the door. */
  const needsTemperature = lines.some((line) => {
    const item = itemsById.get(line.itemId);
    return item?.storage === "chilled" || item?.storage === "frozen";
  });
  const temperatureValue = temperature === "" ? null : Number(temperature);
  const temperatureOk =
    temperatureValue === null ? true : temperatureValue >= -25 && temperatureValue <= 8;

  function patchLine(key: string, part: Partial<ReceiptLineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...part } : line)),
    );
  }

  async function addAdHocLine(itemId: Id) {
    const item = itemsById.get(itemId);
    if (!item) return;
    const purchaseUnits = await services.inventory.listPurchaseUnits(itemId);
    const baseUnit = purchaseUnits.find((unit) => unit.id === item.baseUnitId);
    setLines((current) => [
      ...current,
      {
        key: `adhoc_${current.length}`,
        itemId,
        itemName: item.name,
        purchaseOrderLineId: null,
        purchaseUnitId: baseUnit?.id ?? item.baseUnitId ?? "",
        purchaseUnitLabel: baseUnit?.name ?? item.baseUnit,
        purchaseUnits,
        ordered: { value: "0", unit: item.baseUnit },
        received: "",
        rejected: "0",
        rejectionReason: "",
        batchNumber: "",
        productionDate: "",
        expiryDate: "",
        unitPrice: item.unitCost?.amount ?? 0,
        agreedPrice: item.unitCost?.amount ?? 0,
        batchTracked: item.batchTracked ?? false,
      },
    ]);
  }

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!supplierId) list.push(t("pur.needSupplier"));
    if (!locationId) list.push(t("pur.needLocation"));
    if (lines.length === 0) list.push(t("pur.needReceiptLines"));
    if (needsTemperature && temperature === "") list.push(t("pur.needTemperature"));
    for (const line of lines) {
      if (!line.purchaseUnitId) {
        list.push(t("inv.purchaseUnit"));
        break;
      }
      const receivedMicros = decimalMicros(line.received);
      if (receivedMicros === null || receivedMicros <= 0n) {
        list.push(t("pur.invalidReceiptQuantity"));
        break;
      }
      const rejectedMicros = decimalMicros(line.rejected || "0");
      if (rejectedMicros === null || receivedMicros === null || rejectedMicros > receivedMicros) {
        list.push(t("pur.invalidRejectedQuantity"));
        break;
      }
      const remainingMicros = decimalMicros(line.ordered.value);
      if (line.purchaseOrderLineId && remainingMicros !== null && receivedMicros > remainingMicros) {
        list.push(t("pur.overReceipt"));
        break;
      }
      if (rejectedMicros > 0n && !line.rejectionReason.trim()) {
        list.push(t("pur.needRejectionReason"));
        break;
      }
    }
    for (const line of lines) {
      const receivedMicros = decimalMicros(line.received) ?? 0n;
      const rejectedMicros = decimalMicros(line.rejected || "0") ?? 0n;
      if (line.batchTracked && receivedMicros > rejectedMicros && !line.batchNumber.trim()) {
        list.push(t("pur.needBatch"));
        break;
      }
      const item = itemsById.get(line.itemId);
      if (item?.expiryTracked && receivedMicros > rejectedMicros && !line.expiryDate && !(line.productionDate && item.shelfLifeDays !== null)) {
        list.push(t("pur.needExpiry"));
        break;
      }
    }
    return list;
  }, [supplierId, locationId, lines, needsTemperature, temperature, t]);

  const total = lines.reduce(
    (sum, line) => sum + Math.round(Number(line.received || 0) * line.unitPrice),
    0,
  );

  async function post() {
    if (problems.length > 0) return;
    await action.run(
      () =>
        services.purchasing.receipts.create({
          ...(order ? { purchaseOrderId: order.id } : {}),
          supplierId,
          locationId,
          ...(temperatureValue === null ? {} : { temperatureC: String(temperatureValue) }),
          temperatureOk,
          lines: lines.map((line) => ({
            ...(line.purchaseOrderLineId ? { purchaseOrderLineId: line.purchaseOrderLineId } : {}),
            stockItemId: line.itemId,
            purchaseUnitId: line.purchaseUnitId,
            receivedQuantity: line.received,
            rejectedQuantity: line.rejected || "0",
            unitPrice: String(line.unitPrice),
            ...(line.batchNumber.trim() ? { batchNumber: line.batchNumber.trim() } : {}),
            ...(line.productionDate ? { productionDate: line.productionDate } : {}),
            ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
            ...(line.rejectionReason.trim() ? { rejectionReason: line.rejectionReason.trim() } : {}),
          })),
        }),
      { onSuccess: () => onSaved(t("pur.receiptPosted")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pur.newReceipt")}
      subtitle="FR-PRC-030"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={post}
          >
            {t("pur.postReceipt")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("pur.againstOrder")} hint={t("pur.againstOrderHint")}>
          <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">{t("pur.directReceipt")}</option>
            {(orders.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.reference} · {tx(entry.supplierName)}
              </option>
            ))}
          </Select>
        </Field>

        {!orderId ? (
          <Callout tone="warn">{t("pur.directReceiptNote")}</Callout>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select
              value={supplierId}
              disabled={Boolean(order)}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">—</option>
              {suppliers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {tx(entry.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          {canManageSuppliers ? <Button onClick={() => setAddingSupplier(true)} disabled={Boolean(orderId)}>{t("pur.addSupplier")}</Button> : null}
          {supplierState.error ? <Callout tone="bad">{supplierState.error.message}</Callout> : null}
          <SupplierForm supplier={null} open={addingSupplier} onClose={() => setAddingSupplier(false)}
            onSaved={(_message, created) => { setAddingSupplier(false); supplierState.reload(); if (created?.active && !orderId) setSupplierId(created.id); }} />
          <Field label={t("common.location")} required>
            <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">—</option>
              {locations.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {tx(entry.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {needsTemperature ? (
          <Field
            label={t("pur.temperature")}
            hint={t("pur.temperatureHint")}
            required
            error={
              temperatureValue !== null && !temperatureOk ? t("pur.temperatureOutOfRange") : undefined
            }
          >
            <div className="relative">
              <Input
                dir="ltr"
                inputMode="decimal"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
                aria-invalid={temperatureValue !== null && !temperatureOk}
                className="pe-10 text-end font-mono tabular-nums"
              />
              <Thermometer
                size={14}
                aria-hidden
                className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 end-3"
              />
            </div>
          </Field>
        ) : null}

        {temperatureValue !== null && !temperatureOk ? (
          <Callout tone="bad" icon={<AlertTriangle size={14} />} title={t("pur.temperatureRejectTitle")}>
            {t("pur.temperatureRejectBody")}
          </Callout>
        ) : null}

        {/* -- Lines ------------------------------------------------------ */}
        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("pur.receiptLines")}</h3>

          {lines.length === 0 ? (
            <Callout tone="muted">{t("pur.pickOrderOrItem")}</Callout>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => {
                const received = Number(line.received || 0);
                const ordered = Number(line.ordered.value || 0);
                const enteredMicros = decimalMicros(line.received);
                const remainingMicros = decimalMicros(line.ordered.value);
                const overReceipt = remainingMicros !== null && remainingMicros > 0n && enteredMicros !== null && enteredMicros > remainingMicros;
                const variance =
                  line.agreedPrice > 0
                    ? ((line.unitPrice - line.agreedPrice) / line.agreedPrice) * 100
                    : 0;
                const priceFlagged = Math.abs(variance) > PRICE_VARIANCE_TOLERANCE;

                return (
                  <li key={line.key} className="border-line rounded-lg border p-3">
                    <p className="text-fg mb-2 text-sm font-medium">{tx(line.itemName)}</p>

                    {line.purchaseOrderLineId ? (
                      <Field label={t("inv.purchaseUnit")}>
                        <Input readOnly value={line.purchaseUnitLabel} />
                      </Field>
                    ) : (
                      <Field label={t("inv.purchaseUnit")} required>
                        <Select value={line.purchaseUnitId} onChange={(event) => {
                          const unit = line.purchaseUnits.find((candidate) => candidate.id === event.target.value);
                          patchLine(line.key, { purchaseUnitId: event.target.value, purchaseUnitLabel: unit?.name ?? "" });
                        }}>
                          <option value="">—</option>
                          {line.purchaseUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                        </Select>
                      </Field>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field
                        label={t("pur.received")}
                        hint={
                          ordered > 0
                            ? `${t("pur.ordered")} ${line.ordered.value} ${line.purchaseUnitLabel || line.ordered.unit}`
                            : undefined
                        }
                        error={overReceipt ? t("pur.overReceipt") : undefined}
                      >
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          value={line.received}
                          onChange={(event) => patchLine(line.key, { received: event.target.value })}
                          className="text-end font-mono tabular-nums"
                        />
                      </Field>

                      <Field label={t("pur.rejected")}>
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          value={line.rejected}
                          onChange={(event) => patchLine(line.key, { rejected: event.target.value })}
                          className="text-end font-mono tabular-nums"
                        />
                      </Field>

                      <Field
                        label={t("doc.unitPrice")}
                        error={priceFlagged ? t("pur.priceVariance").replace("{n}", variance.toFixed(1)) : undefined}
                      >
                        <MoneyInput
                          value={line.unitPrice}
                          currency={CURRENCY}
                          onChange={(minor) => patchLine(line.key, { unitPrice: minor ?? 0 })}
                          aria-label={t("doc.unitPrice")}
                        />
                      </Field>
                    </div>

                    {Number(line.rejected || 0) > 0 ? (
                      <div className="mt-3">
                        <Field label={t("pur.rejectionReason")} required>
                          <Input
                            value={line.rejectionReason}
                            onChange={(event) =>
                              patchLine(line.key, { rejectionReason: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}

                    {line.batchTracked ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <Field label={t("inv.batchNumber")} required>
                          <Input
                            dir="ltr"
                            value={line.batchNumber}
                            onChange={(event) =>
                              patchLine(line.key, { batchNumber: event.target.value })
                            }
                            className="font-mono"
                          />
                        </Field>
                        <Field label={t("inv.productionDate")}>
                          <Input type="date" dir="ltr" value={line.productionDate} onChange={(event) => patchLine(line.key, { productionDate: event.target.value })} />
                        </Field>
                        <Field label={t("inv.expiryDate")} hint={t("pur.expiryHint")}>
                          <Input
                            type="date"
                            dir="ltr"
                            value={line.expiryDate}
                            onChange={(event) =>
                              patchLine(line.key, { expiryDate: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3">
            <Field label={t("pur.addUnorderedItem")} hint={t("pur.addUnorderedHint")}>
              <Select
                value=""
                onChange={(event) => {
                  if (event.target.value) addAdHocLine(event.target.value);
                }}
              >
                <option value="">—</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {tx(item.name)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <DescList>
          <DescRow label={t("doc.total")} mono>
            {formatMoney(money(total, CURRENCY), fmt)}
          </DescRow>
        </DescList>

        {problems.length > 0 ? (
          <ul className="text-bad space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Supplier invoice — FR-PRC-040, FR-PRC-041
// ---------------------------------------------------------------------------

interface MatchCheck {
  label: string;
  expected: string;
  stated: string;
  tolerance: string;
  ok: boolean;
}

export function InvoiceDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const suppliers = useSuppliers();

  const receipts = useAsync(
    () =>
      services.purchasing.receipts
        .list({ limit: 100 })
        .then((page) => page.rows)
        .catch(() => [] as GoodsReceipt[]),
    [open],
  );

  const [receiptId, setReceiptId] = useState<Id | "">("");
  const [supplierId, setSupplierId] = useState<Id>("");
  const [number, setNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [subtotalMinor, setSubtotalMinor] = useState<number | null>(null);
  const [taxMinor, setTaxMinor] = useState<number | null>(null);

  const receipt = (receipts.data ?? []).find((entry) => entry.id === receiptId) ?? null;

  useEffect(() => {
    if (!open) return;
    setReceiptId("");
    setSupplierId(suppliers[0]?.id ?? "");
    setNumber("");
    setSubtotalMinor(null);
    setTaxMinor(null);
  }, [open, suppliers.length]);

  useEffect(() => {
    if (!receipt) return;
    setSupplierId(receipt.supplierId);
    setSubtotalMinor(receipt.total.amount);
  }, [receipt?.id]);

  const statedTotal = (subtotalMinor ?? 0) + (taxMinor ?? 0);

  /**
   * FR-PRC-041 — the three-way match, with each tolerance stated.
   *
   * The tolerances are shown because a control whose thresholds are invisible
   * is one that gets disabled the first time rounding trips it. Quantity is
   * exact, unit price may drift 2%, totals must land within a minor unit.
   */
  const checks = useMemo<MatchCheck[]>(() => {
    if (!receipt) return [];
    const receiptTotal = receipt.total.amount;
    const priceDrift =
      receiptTotal > 0 ? Math.abs(((subtotalMinor ?? 0) - receiptTotal) / receiptTotal) * 100 : 0;

    return [
      {
        label: t("pur.checkQuantity"),
        expected: formatMoney(receipt.total, fmt),
        stated: formatMoney(money(subtotalMinor ?? 0, CURRENCY), fmt),
        tolerance: t("pur.toleranceExact"),
        ok: (subtotalMinor ?? 0) === receiptTotal,
      },
      {
        label: t("pur.checkPrice"),
        expected: `±2%`,
        stated: `${priceDrift.toFixed(1)}%`,
        tolerance: "2%",
        ok: priceDrift <= 2,
      },
      {
        label: t("pur.checkTotal"),
        expected: formatMoney(money((subtotalMinor ?? 0) + (taxMinor ?? 0), CURRENCY), fmt),
        stated: formatMoney(money(statedTotal, CURRENCY), fmt),
        tolerance: t("pur.toleranceMinorUnit"),
        ok: Math.abs(statedTotal - ((subtotalMinor ?? 0) + (taxMinor ?? 0))) <= 1,
      },
    ];
  }, [receipt, subtotalMinor, taxMinor, statedTotal, t, fmt]);

  const matched = checks.length > 0 && checks.every((check) => check.ok);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!supplierId) list.push(t("pur.needSupplier"));
    if (!number.trim()) list.push(t("pur.needInvoiceNumber"));
    if (subtotalMinor === null) list.push(t("pur.needSubtotal"));
    return list;
  }, [supplierId, number, subtotalMinor, t]);

  async function record() {
    if (problems.length > 0) return;
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    const terms = supplier?.paymentTermsDays ?? 30;
    const due = new Date(Date.parse(invoiceDate) + terms * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await action.run(
      () =>
        services.purchasing.invoices.create({
          supplierInvoiceNumber: number.trim(),
          supplierId,
          supplierName: supplier?.tradingName,
          goodsReceiptId: receipt?.id ?? null,
          goodsReceiptRef: receipt?.reference ?? null,
          purchaseOrderRef: receipt?.purchaseOrderRef ?? null,
          status: receipt ? (matched ? "matched" : "disputed") : "recorded",
          matchResult: receipt ? (matched ? "matched" : "disputed") : "unmatched",
          invoiceDate,
          dueDate: due,
          subtotal: money(subtotalMinor ?? 0, CURRENCY),
          taxTotal: money(taxMinor ?? 0, CURRENCY),
          total: money(statedTotal, CURRENCY),
        }),
      {
        onSuccess: () =>
          onSaved(
            receipt && !matched ? t("pur.invoiceDisputed") : t("pur.invoiceRecorded"),
          ),
      },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pur.newInvoice")}
      subtitle="FR-PRC-040"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={record}
          >
            {receipt && !matched ? t("pur.recordAsDisputed") : t("pur.recordInvoice")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("pur.againstReceipt")} hint={t("pur.againstReceiptHint")}>
          <Select value={receiptId} onChange={(event) => setReceiptId(event.target.value)}>
            <option value="">{t("pur.noReceipt")}</option>
            {(receipts.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.reference} · {tx(entry.supplierName)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select
              value={supplierId}
              disabled={Boolean(receipt)}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">—</option>
              {suppliers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {tx(entry.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pur.invoiceNumber")} required>
            <Input
              dir="ltr"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className="font-mono"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pur.invoiceDate")}>
            <Input
              type="date"
              dir="ltr"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </Field>
          <Field label={t("doc.subtotal")} required>
            <MoneyInput
              value={subtotalMinor}
              currency={CURRENCY}
              onChange={setSubtotalMinor}
              aria-label={t("doc.subtotal")}
            />
          </Field>
          <Field label={t("doc.tax")}>
            <MoneyInput
              value={taxMinor}
              currency={CURRENCY}
              onChange={setTaxMinor}
              aria-label={t("doc.tax")}
            />
          </Field>
        </div>

        {receipt ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("pur.threeWayMatch")}</h3>
            <p className="text-fg-subtle mb-2 text-xs leading-relaxed">{t("pur.matchNote")}</p>

            <ul className="border-line divide-line divide-y rounded-lg border">
              {checks.map((check) => (
                <li key={check.label} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span
                    className={cx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      check.ok ? "bg-good/15 text-good" : "bg-bad/15 text-bad",
                    )}
                    aria-hidden
                  >
                    {check.ok ? <Check size={11} /> : <X size={11} />}
                  </span>
                  <span className="text-fg min-w-0 flex-1">{check.label}</span>
                  <span className="text-fg-subtle shrink-0 font-mono tabular-nums">
                    {check.stated}
                  </span>
                  <Badge tone={check.ok ? "good" : "bad"}>{check.tolerance}</Badge>
                </li>
              ))}
            </ul>

            <Callout tone={matched ? "good" : "warn"} className="mt-3">
              {matched ? t("pur.matchPasses") : t("pur.matchFails")}
            </Callout>
          </section>
        ) : (
          <Callout tone="muted">{t("pur.noReceiptNote")}</Callout>
        )}

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}
