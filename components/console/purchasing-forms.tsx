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
  GoodsReceiptLine,
  Id,
  PurchaseOrder,
  Quantity,
  Requisition,
  StockItem,
  StockLocation,
  Supplier,
  SupplierInvoice,
  UnitCode,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatQuantity, money } from "@/lib/console/format";
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
    () => services.purchasing.suppliers.list({ limit: 300 }).then((page) => page.rows).catch(() => []),
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

const DELIVERY_DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

export function SupplierDrawer({
  supplier,
  open,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();

  const [draft, setDraft] = useState(() => seedSupplier(supplier));
  useEffect(() => setDraft(seedSupplier(supplier)), [supplier?.id, open]);

  function patch(part: Partial<ReturnType<typeof seedSupplier>>) {
    setDraft((current) => ({ ...current, ...part }));
  }

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!draft.tradingName.en.trim() && !draft.tradingName.ar.trim()) list.push(t("pur.needName"));
    if (!draft.code.trim()) list.push(t("pur.needCode"));
    if (draft.leadTimeDays < 0) list.push(t("pur.badLeadTime"));
    return list;
  }, [draft, t]);

  async function save() {
    if (problems.length > 0) return;
    const payload: Partial<Supplier> = {
      code: draft.code.trim(),
      legalName: draft.legalName,
      tradingName: draft.tradingName,
      taxRegistration: draft.taxRegistration.trim(),
      contactName: draft.contactName.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      paymentTermsDays: draft.paymentTermsDays,
      currency: draft.currency as Supplier["currency"],
      leadTimeDays: draft.leadTimeDays,
      minimumOrderValue: money(draft.minimumOrderMinor, CURRENCY),
      deliveryDays: draft.deliveryDays,
      active: draft.active,
    };

    await action.run(
      () =>
        supplier
          ? services.purchasing.suppliers.update(supplier.id, payload)
          : services.purchasing.suppliers.create(payload),
      { onSuccess: () => onSaved(supplier ? t("pur.supplierSaved") : t("pur.supplierCreated")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={supplier ? t("pur.editSupplier") : t("pur.newSupplier")}
      subtitle="FR-PRC-005"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={save}
          >
            {supplier ? t("common.save") : t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <LocalisedField
          label={t("pur.tradingName")}
          hint={t("pur.tradingNameHint")}
          required
          value={draft.tradingName}
          onChange={(tradingName) => patch({ tradingName })}
        />
        <LocalisedField
          label={t("pur.legalName")}
          value={draft.legalName}
          onChange={(legalName) => patch({ legalName })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.code")} required>
            <Input
              dir="ltr"
              value={draft.code}
              onChange={(event) => patch({ code: event.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label={t("pur.taxRegistration")}>
            <Input
              dir="ltr"
              value={draft.taxRegistration}
              onChange={(event) => patch({ taxRegistration: event.target.value })}
              className="font-mono"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pur.contactName")}>
            <Input
              value={draft.contactName}
              onChange={(event) => patch({ contactName: event.target.value })}
            />
          </Field>
          <Field label={t("onb.phone")}>
            <Input
              dir="ltr"
              inputMode="tel"
              value={draft.phone}
              onChange={(event) => patch({ phone: event.target.value })}
            />
          </Field>
          <Field label={t("onb.email")}>
            <Input
              dir="ltr"
              inputMode="email"
              value={draft.email}
              onChange={(event) => patch({ email: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pur.paymentTerms")} hint={t("pur.paymentTermsHint")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={String(draft.paymentTermsDays)}
              onChange={(event) => patch({ paymentTermsDays: Number(event.target.value) || 0 })}
              className="text-end font-mono tabular-nums"
            />
          </Field>
          <Field label={t("pur.leadTime")} hint={t("pur.leadTimeHint")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={String(draft.leadTimeDays)}
              onChange={(event) => patch({ leadTimeDays: Number(event.target.value) || 0 })}
              className="text-end font-mono tabular-nums"
            />
          </Field>
          <Field label={t("pur.minimumOrder")}>
            <MoneyInput
              value={draft.minimumOrderMinor}
              currency={CURRENCY}
              onChange={(minor) => patch({ minimumOrderMinor: minor ?? 0 })}
              aria-label={t("pur.minimumOrder")}
            />
          </Field>
        </div>

        <Field label={t("pur.deliveryDays")} hint={t("pur.deliveryDaysHint")}>
          <div className="flex flex-wrap gap-1.5">
            {DELIVERY_DAYS.map((day) => {
              const on = draft.deliveryDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    patch({
                      deliveryDays: on
                        ? draft.deliveryDays.filter((entry) => entry !== day)
                        : [...draft.deliveryDays, day],
                    })
                  }
                  className={cx(
                    "rounded-lg border px-2.5 py-1.5 text-xs",
                    on
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {t(`pur.day.${day}` as never)}
                </button>
              );
            })}
          </div>
        </Field>

        <Toggle
          checked={draft.active}
          onChange={(active) => patch({ active })}
          label={t("pur.activeSupplier")}
          hint={t("pur.activeSupplierHint")}
        />

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

function seedSupplier(supplier: Supplier | null) {
  return {
    code: supplier?.code ?? "",
    legalName: supplier?.legalName ?? { ...EMPTY_LOCALISED },
    tradingName: supplier?.tradingName ?? { ...EMPTY_LOCALISED },
    taxRegistration: supplier?.taxRegistration ?? "",
    contactName: supplier?.contactName ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    paymentTermsDays: supplier?.paymentTermsDays ?? 30,
    currency: supplier?.currency ?? CURRENCY,
    leadTimeDays: supplier?.leadTimeDays ?? 2,
    minimumOrderMinor: supplier?.minimumOrderValue.amount ?? 0,
    deliveryDays: supplier?.deliveryDays ?? [],
    active: supplier?.active ?? true,
  };
}

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
  ordered: Quantity;
  received: string;
  rejected: string;
  rejectionReason: string;
  batchNumber: string;
  expiryDate: string;
  unitPrice: number;
  agreedPrice: number;
  batchTracked: boolean;
}

/** FR-PRC-033 — how far over the ordered quantity may be received untouched. */
const OVER_RECEIPT_TOLERANCE = 0.02;
/** FR-PRC-008 — price drift beyond this is flagged at the door. */
const PRICE_VARIANCE_TOLERANCE = 2;

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
  const suppliers = useSuppliers();
  const locations = useLocations();

  const orders = useAsync(
    () =>
      services.purchasing.orders
        .list({ limit: 100 })
        .then((page) =>
          page.rows.filter((row) =>
            ["approved", "sent", "partially_received"].includes(row.status),
          ),
        )
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
    setSupplierId(suppliers[0]?.id ?? "");
    setLocationId(locations[0]?.id ?? "");
    setTemperature("");
    setLines([]);
  }, [open, suppliers.length, locations.length]);

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
          ordered: line.quantity,
          received: line.quantity.value,
          rejected: "0",
          rejectionReason: "",
          batchNumber: "",
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

  function addAdHocLine(itemId: Id) {
    const item = itemsById.get(itemId);
    if (!item) return;
    setLines((current) => [
      ...current,
      {
        key: `adhoc_${current.length}`,
        itemId,
        itemName: item.name,
        ordered: { value: "0", unit: item.baseUnit },
        received: "",
        rejected: "0",
        rejectionReason: "",
        batchNumber: "",
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
      if (Number(line.rejected || 0) > 0 && !line.rejectionReason.trim()) {
        list.push(t("pur.needRejectionReason"));
        break;
      }
    }
    for (const line of lines) {
      if (line.batchTracked && Number(line.received || 0) > 0 && !line.batchNumber.trim()) {
        list.push(t("pur.needBatch"));
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
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    const location = locations.find((entry) => entry.id === locationId);

    const receiptLines: GoodsReceiptLine[] = lines.map((line, index) => ({
      id: `grl_${index + 1}`,
      itemId: line.itemId,
      itemName: line.itemName,
      ordered: line.ordered,
      received: { value: line.received || "0", unit: line.ordered.unit },
      rejected: { value: line.rejected || "0", unit: line.ordered.unit },
      rejectionReason: line.rejectionReason.trim() || null,
      batchNumber: line.batchNumber.trim() || null,
      expiryDate: line.expiryDate || null,
      unitPrice: money(line.unitPrice, CURRENCY),
      priceVariancePercent:
        line.agreedPrice > 0
          ? ((line.unitPrice - line.agreedPrice) / line.agreedPrice) * 100
          : 0,
    }));

    await action.run(
      () =>
        services.purchasing.receipts.create({
          purchaseOrderId: order?.id ?? null,
          purchaseOrderRef: order?.reference ?? null,
          supplierId,
          supplierName: supplier?.tradingName,
          locationId,
          locationName: location?.name,
          status: "posted",
          temperatureC: temperatureValue,
          temperatureOk,
          lines: receiptLines,
          total: money(total, CURRENCY),
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
                const overReceipt =
                  ordered > 0 && received > ordered * (1 + OVER_RECEIPT_TOLERANCE);
                const variance =
                  line.agreedPrice > 0
                    ? ((line.unitPrice - line.agreedPrice) / line.agreedPrice) * 100
                    : 0;
                const priceFlagged = Math.abs(variance) > PRICE_VARIANCE_TOLERANCE;

                return (
                  <li key={line.key} className="border-line rounded-lg border p-3">
                    <p className="text-fg mb-2 text-sm font-medium">{tx(line.itemName)}</p>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field
                        label={t("pur.received")}
                        hint={
                          ordered > 0
                            ? `${t("pur.ordered")} ${formatQuantity(line.ordered, fmt)}`
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
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
