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
 *
 * Each form reads the tenant's procurement policy (FR-PRC-001): a skipped
 * step changes what the form does, and simple mode (FR-PRC-002) turns a
 * receipt without an order into order and receipt together.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { OrderSourcingChecks, type SourcingVerdict } from "@/components/console/purchasing-sourcing";
import { FileCapture, ScanField, useActor, usePolicy } from "@/components/console/purchasing-shared";
import type { StoredFile } from "@/lib/console/services/purchasing-local";
import { decimalAdd } from "@/lib/console/stock-units";
import { DEFAULT_POLICY, evaluateMatch } from "@/lib/console/purchasing-rules";
import { defaultExpiryDate } from "@/lib/console/inventory-batches";
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
  const actor = useActor();
  const { policy } = usePolicy();
  // FR-PRC-001 — a tenant that skips requisitions raises orders directly.
  const skipped = policy ? !policy.steps.requisition : false;

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
    if (skipped) list.push(t("prc.req.skipped"));
    return list;
  }, [branchId, usable.length, neededBy, skipped, t]);

  async function submit(status: "draft" | "submitted") {
    if (problems.length > 0) return;
    const branch = branches.find((entry) => entry.id === branchId);
    await action.run(
      async () => {
        const created = await services.purchasing.requisitions.create({
          branchId,
          branchName: branch?.name,
          requestedBy: { en: actor.name, ar: actor.name },
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
        });
        // FR-PRC-019 — who asked, so they cannot also approve it.
        await services.procurement.recordRequisition(created, actor);
        return created;
      },
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
        {skipped ? (
          <Callout tone="warn" title={t("prc.req.skippedTitle")}>
            {t("prc.req.skipped")}
          </Callout>
        ) : null}
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
  const actor = useActor();
  const { policy } = usePolicy();
  const [verdict, setVerdict] = useState<SourcingVerdict>({ blocked: false, offListCategories: [] });
  const onVerdict = useCallback((next: SourcingVerdict) => setVerdict(next), []);

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
  // FR-PRC-001 — with order approval skipped by policy, every order is approved as raised.
  const approvalSkipped = policy ? !policy.steps.poApproval : false;
  const autoApproved = tier === 0 || approvalSkipped;

  const belowMinimum =
    supplier && supplier.minimumOrderValue.amount > 0 && totals.subtotal < supplier.minimumOrderValue.amount;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!supplierId) list.push(t("pur.needSupplier"));
    if (!locationId) list.push(t("pur.needLocation"));
    if (usable.length === 0) list.push(t("pur.needLines"));
    if (verdict.blocked) list.push(t("prc.check.blockedByPolicy"));
    return list;
  }, [supplierId, locationId, usable.length, verdict.blocked, t]);

  async function save(status: "approved" | "pending_approval") {
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
      createdBy: order?.createdBy ?? { en: actor.name, ar: actor.name },
      ...(status === "approved" ? { approvedAt: new Date().toISOString() } : {}),
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
      async () => {
        let saved = order
          ? await services.purchasing.orders.update(order.id, payload)
          : await services.purchasing.orders.create(payload);
        if (status === "approved" && saved.status !== "approved") {
          saved = await services.purchasing.orders.update(saved.id, { status: "approved", approvedAt: new Date().toISOString() });
        }
        // FR-PRC-019 / FR-PRC-010 — the requester, and any off-list category, on the record.
        await services.procurement.recordSubmission(saved, actor, { offListCategories: verdict.offListCategories });
        return saved;
      },
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
            onClick={() => void save(autoApproved ? "approved" : "pending_approval")}
          >
            {autoApproved ? t("pur.createOrder") : t("pur.sendForApproval")}
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

        {/* FR-PRC-007 / FR-PRC-010 / FR-PRC-011 — comparative pricing and supplier checks. */}
        {supplierId ? (
          <OrderSourcingChecks
            supplierId={supplierId}
            lines={lines}
            items={items}
            suppliers={suppliers}
            policy={policy}
            onVerdict={onVerdict}
            onUsePrice={(key, unitPriceMinor) =>
              setLines((current) => current.map((line) => (line.key === key ? { ...line, unitPrice: unitPriceMinor } : line)))
            }
          />
        ) : null}

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
        <Callout tone={autoApproved ? "good" : "accent"} title={t("pur.approvalRouting")}>
          {approvalSkipped
            ? t("prc.po.approvalSkipped")
            : tier === 0
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
  /** FR-INV-021 — true once someone typed a date over the shelf-life default. */
  expiryOverridden: boolean;
  unitPrice: number;
  agreedPrice: number;
  batchTracked: boolean;
  expiryTracked: boolean;
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
  const actor = useActor();
  const { policy } = usePolicy();
  // FR-PRC-002 — simple mode: a receipt without an order records the order too.
  const simpleMode = policy?.simpleMode ?? false;
  const receiptSkipped = policy ? !policy.steps.goodsReceipt : false;
  // FR-PRC-034 — what was scanned at the door, and the supplier's delivery note.
  const [scans, setScans] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState<StoredFile | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  // FR-INV-021 — shelf life counts from receipt or production, per item profile.
  const profiles = useAsync(() => services.stockProfiles.all().catch(() => []), [open]);
  const basisByItem = useMemo(
    () => new Map((profiles.data ?? []).map((profile) => [profile.itemId, profile.shelfLifeBasis])),
    [profiles.data],
  );

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
    setScans([]);
    setScanError(null);
    setDeliveryNote(null);
    setHighlight(null);
    setReceivedOn(new Date().toISOString().slice(0, 10));
  }, [open, suppliers.length, locations.length]);

  /** FR-INV-021 — the expiry a line defaults to from the item's shelf life. */
  function expiryDefault(itemId: Id, on: string): string {
    const item = itemsById.get(itemId);
    if (!item) return "";
    return (
      defaultExpiryDate({
        shelfLifeDays: item.shelfLifeDays,
        basis: basisByItem.get(itemId) ?? "receipt",
        receivedOn: on,
      }) ?? ""
    );
  }

  // FR-INV-021 — a new received date re-defaults every line not overridden by hand.
  useEffect(() => {
    setLines((current) =>
      current.map((line) => (line.expiryOverridden ? line : { ...line, expiryDate: expiryDefault(line.itemId, receivedOn) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedOn, basisByItem]);

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
          expiryDate: expiryDefault(line.itemId, receivedOn),
          expiryOverridden: false,
          unitPrice: line.unitPrice.amount,
          agreedPrice: line.unitPrice.amount,
          batchTracked: item?.batchTracked ?? false,
          expiryTracked: item?.expiryTracked ?? false,
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

  /**
   * FR-PRC-034 — a scan is tried as a barcode (item profiles), then as a SKU.
   * A hit on the sheet counts one more received; a hit off it adds the line.
   */
  async function handleScan(code: string) {
    setScanError(null);
    setScanning(true);
    try {
      const byBarcode = await services.stockProfiles.findByBarcode(code).catch(() => null);
      const item =
        (byBarcode ? itemsById.get(byBarcode.itemId) : undefined) ??
        items.find((row) => row.sku.toLowerCase() === code.toLowerCase());
      if (!item) {
        setScanError(t("prc.grn.scanNoMatch").replace("{code}", code));
        return;
      }
      setScans((current) => [...current, code]);
      const existing = lines.find((line) => line.itemId === item.id);
      if (existing) {
        patchLine(existing.key, { received: decimalAdd(existing.received || "0", "1") });
        setHighlight(existing.key);
      } else {
        addAdHocLine(item.id, "1");
      }
    } finally {
      setScanning(false);
    }
  }

  function addAdHocLine(itemId: Id, received = "") {
    const item = itemsById.get(itemId);
    if (!item) return;
    const key = `adhoc_${Date.now().toString(36)}_${lines.length}`;
    setHighlight(key);
    setLines((current) => [
      ...current,
      {
        key,
        itemId,
        itemName: item.name,
        ordered: { value: "0", unit: item.baseUnit },
        received,
        rejected: "0",
        rejectionReason: "",
        batchNumber: "",
        expiryDate: expiryDefault(itemId, receivedOn),
        expiryOverridden: false,
        unitPrice: item.unitCost?.amount ?? 0,
        agreedPrice: item.unitCost?.amount ?? 0,
        batchTracked: item.batchTracked ?? false,
        expiryTracked: item.expiryTracked ?? false,
      },
    ]);
  }

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!supplierId) list.push(t("pur.needSupplier"));
    if (!locationId) list.push(t("pur.needLocation"));
    if (lines.length === 0) list.push(t("pur.needReceiptLines"));
    if (receiptSkipped) list.push(t("prc.grn.skipped"));
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
  }, [supplierId, locationId, lines, needsTemperature, temperature, receiptSkipped, t]);

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
      async () => {
        let linkedOrder: PurchaseOrder | null = order;
        // FR-PRC-002 — simple mode: the order is recorded from what arrived,
        // already received, in the same action as the receipt.
        if (!order && simpleMode) {
          const orderLines = receiptLines.map((line, index) => ({
            id: `pol_${index + 1}`,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: line.received,
            receivedQuantity: line.received,
            unitPrice: line.unitPrice,
            taxRate: 0,
            lineTotal: money(Math.round(Number(line.received.value || 0) * line.unitPrice.amount), CURRENCY),
          }));
          linkedOrder = await services.purchasing.orders.create({
            supplierId,
            supplierName: supplier?.tradingName,
            deliveryLocationId: locationId,
            deliveryLocationName: location?.name,
            expectedDelivery: new Date().toISOString().slice(0, 10),
            status: "received",
            createdBy: { en: actor.name, ar: actor.name },
            lines: orderLines,
            subtotal: money(total, CURRENCY),
            taxTotal: money(0, CURRENCY),
            total: money(total, CURRENCY),
          });
          await services.procurement.recordSubmission(linkedOrder, actor, { source: "simple_mode" });
        }
        const receipt = await services.purchasing.receipts.create({
          purchaseOrderId: linkedOrder?.id ?? null,
          purchaseOrderRef: linkedOrder?.reference ?? null,
          supplierId,
          supplierName: supplier?.tradingName,
          locationId,
          locationName: location?.name,
          receivedBy: { en: actor.name, ar: actor.name },
          receivedAt:
            receivedOn === new Date().toISOString().slice(0, 10)
              ? new Date().toISOString()
              : `${receivedOn}T12:00:00.000Z`,
          status: "posted",
          temperatureC: temperatureValue,
          temperatureOk,
          lines: receiptLines,
          total: money(total, CURRENCY),
        });
        // FR-PRC-032 — the stock movements (and batch records) for what was accepted.
        const posting = await services.procurement.postReceipt(
          receipt,
          { items, deliveryNote, scans, actor },
          { ledger: services.inventory },
        );
        return { linkedOrder, posting };
      },
      {
        onSuccess: ({ linkedOrder, posting }) => {
          const failed = posting.legs.filter((leg) => leg.error).length;
          onSaved(
            failed > 0
              ? t("prc.grn.postedWithFailures").replace("{n}", String(failed))
              : !order && linkedOrder
                ? t("prc.grn.simplePosted").replace("{ref}", linkedOrder.reference)
                : t("pur.receiptPosted"),
          );
        },
      },
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

        {receiptSkipped ? (
          <Callout tone="warn" title={t("prc.grn.skippedTitle")}>
            {t("prc.grn.skipped")}
          </Callout>
        ) : null}

        {!orderId ? (
          simpleMode ? (
            <Callout tone="accent" title={t("prc.policy.simpleActive")}>
              {t("prc.grn.simpleNote")}
            </Callout>
          ) : (
            <Callout tone="warn">{t("pur.directReceiptNote")}</Callout>
          )
        ) : null}

        <Field label={t("prc.grn.receivedOn")} hint={t("prc.grn.receivedOnHint")}>
          <Input type="date" dir="ltr" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
        </Field>

        {/* FR-PRC-034 — scan at the door: wedge scanner or phone camera. */}
        <Field label={t("prc.grn.scan")} hint={t("prc.grn.scanHint")} error={scanError}>
          <ScanField onScan={(code) => void handleScan(code)} placeholder={t("prc.grn.scanPlaceholder")} busy={scanning} />
        </Field>

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
                  <li key={line.key} className={cx("rounded-lg border p-3", highlight === line.key ? "border-accent" : "border-line")}>
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

                    {line.batchTracked || line.expiryTracked ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {line.batchTracked ? (
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
                        ) : null}
                        {/* FR-INV-021 — defaulted from shelf life, overridable. */}
                        <Field
                          label={t("inv.expiryDate")}
                          hint={
                            !line.expiryOverridden && line.expiryDate
                              ? t("prc.grn.expiryDefaulted")
                              : t("pur.expiryHint")
                          }
                        >
                          <div className="flex gap-2">
                            <Input
                              type="date"
                              dir="ltr"
                              value={line.expiryDate}
                              onChange={(event) =>
                                patchLine(line.key, { expiryDate: event.target.value, expiryOverridden: true })
                              }
                            />
                            {line.expiryOverridden && expiryDefault(line.itemId, receivedOn) ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  patchLine(line.key, { expiryDate: expiryDefault(line.itemId, receivedOn), expiryOverridden: false })
                                }
                              >
                                {t("prc.grn.expiryReset")}
                              </Button>
                            ) : null}
                          </div>
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

        {/* FR-PRC-034 — the supplier's delivery note, photographed. */}
        <Field label={t("prc.grn.deliveryNote")} hint={t("prc.grn.deliveryNoteHint")}>
          <FileCapture value={deliveryNote} onChange={setDeliveryNote} label={t("prc.grn.captureNote")} />
        </Field>

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
    setPrintedTotalMinor(null);
  }, [open, suppliers.length]);

  useEffect(() => {
    if (!receipt) return;
    setSupplierId(receipt.supplierId);
    setSubtotalMinor(receipt.total.amount);
  }, [receipt?.id]);

  // The total as printed on the invoice; blank means "same as computed".
  const [printedTotalMinor, setPrintedTotalMinor] = useState<number | null>(null);
  const statedTotal = printedTotalMinor ?? (subtotalMinor ?? 0) + (taxMinor ?? 0);
  const actor = useActor();
  const { policy } = usePolicy();
  const tolerances = policy?.tolerances ?? DEFAULT_POLICY.tolerances;
  const matchSkipped = policy ? !policy.steps.threeWayMatch : false;
  const paymentApprovalSkipped = policy ? !policy.steps.paymentApproval : false;

  /**
   * FR-PRC-041 / FR-PRC-042 — the three-way match against the tenant's
   * tolerances (procurement policy), each one stated beside its check.
   *
   * The tolerances are shown because a control whose thresholds are invisible
   * is one that gets disabled the first time rounding trips it. The order-side
   * value is the received quantity at the agreed price, recovered from each
   * receipt line's recorded price variance.
   */
  const checkResults = useMemo(() => {
    if (!receipt) return [];
    const agreedValue = receipt.lines.reduce((sum, line) => {
      const agreed = line.unitPrice.amount / (1 + (line.priceVariancePercent || 0) / 100);
      return sum + Math.round(Number(line.received.value || 0) * agreed);
    }, 0);
    return evaluateMatch({
      receiptValueMinor: receipt.total.amount,
      orderValueMinor: receipt.purchaseOrderId ? agreedValue : null,
      invoiceSubtotalMinor: subtotalMinor ?? 0,
      invoiceTaxMinor: taxMinor ?? 0,
      invoiceTotalMinor: statedTotal,
      tolerances,
    });
  }, [receipt, subtotalMinor, taxMinor, statedTotal, tolerances]);

  const checks = useMemo<MatchCheck[]>(
    () =>
      checkResults.map((result) => ({
        label: t(result.check === "quantity" ? "pur.checkQuantity" : result.check === "price" ? "pur.checkPrice" : "pur.checkTotal"),
        expected: formatMoney(money(result.expected, CURRENCY), fmt),
        stated:
          result.check === "total"
            ? formatMoney(money(result.stated, CURRENCY), fmt)
            : `${result.drift.toFixed(1)}%`,
        tolerance:
          result.check === "total"
            ? t("prc.tol.minorUnits").replace("{n}", String(result.tolerance))
            : `±${result.tolerance}%`,
        ok: result.ok,
      })),
    [checkResults, t, fmt],
  );

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

    // FR-PRC-042 — within tolerance is eligible for payment approval; outside
    // it the invoice enters dispute. FR-PRC-001 — skipped steps move it along.
    const inTolerance = receipt ? matched : false;
    const status: SupplierInvoice["status"] = matchSkipped
      ? paymentApprovalSkipped
        ? "approved_for_payment"
        : "recorded"
      : receipt
        ? inTolerance
          ? paymentApprovalSkipped
            ? "approved_for_payment"
            : "matched"
          : "disputed"
        : "recorded";

    await action.run(
      async () => {
        const created = await services.purchasing.invoices.create({
          supplierInvoiceNumber: number.trim(),
          supplierId,
          supplierName: supplier?.tradingName,
          goodsReceiptId: receipt?.id ?? null,
          goodsReceiptRef: receipt?.reference ?? null,
          purchaseOrderRef: receipt?.purchaseOrderRef ?? null,
          status,
          matchResult: receipt && !matchSkipped ? (matched ? "matched" : "disputed") : "unmatched",
          invoiceDate,
          dueDate: due,
          subtotal: money(subtotalMinor ?? 0, CURRENCY),
          taxTotal: money(taxMinor ?? 0, CURRENCY),
          total: money(statedTotal, CURRENCY),
        });
        await services.procurement.recordInvoiceReview(
          created,
          {
            checks: checkResults.map((row) => ({ check: row.check, drift: row.drift, tolerance: row.tolerance, ok: row.ok })),
            captureId: null,
          },
          actor,
        );
        return created;
      },
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

        <Field label={t("prc.inv.printedTotal")} hint={t("prc.inv.printedTotalHint")}>
          <MoneyInput value={printedTotalMinor} currency={CURRENCY} onChange={setPrintedTotalMinor} aria-label={t("prc.inv.printedTotal")} />
        </Field>

        {matchSkipped ? <Callout tone="warn">{t("prc.inv.matchSkipped")}</Callout> : null}

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
