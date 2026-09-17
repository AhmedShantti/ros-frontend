"use client";

/**
 * Requisition review and consolidation — SRS §12.4, FR-PRC-016, FR-PRC-019.
 *
 *   - **Decide** (019): approve or reject a submitted requisition, refused for
 *     the person who raised it. The same rule as orders, enforced in the
 *     service.
 *   - **Consolidate** (016): several branches' approved requisitions become one
 *     order per supplier. Each item's supplier defaults to its preferred one
 *     (FR-PRC-007 ranking, then the item's default supplier), and every line
 *     keeps who asked for how much, so cost lands on the branch that consumed
 *     it rather than on head office.
 */

import { useEffect, useMemo, useState } from "react";

import type { Id, PurchaseOrder, Requisition, StockItem, StockLocation, Supplier, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ApprovalChannel } from "@/lib/console/services/purchasing-local";
import {
  allocateCost,
  isSelfApproval,
  resolvePrice,
  tierForTotal,
  type BranchAllocation,
  type ConsolidatedLine,
} from "@/lib/console/purchasing-rules";
import { decimalAdd } from "@/lib/console/stock-units";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatQuantity, money } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import { useConfirm } from "@/components/console/confirm";
import { MoneyInput } from "@/components/console/fields";
import { PRC_CURRENCY, useActor, usePolicy } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, Input, Modal, Select, Textarea } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// FR-PRC-019 — decide a requisition
// ---------------------------------------------------------------------------

export function RequisitionDecision({
  requisition,
  channel,
  onDone,
}: {
  requisition: Requisition;
  channel: ApprovalChannel;
  onDone: (updated: Requisition, message: string) => void;
}) {
  const { t } = useI18n();
  const { session, can } = useSession();
  const actor = useActor();
  const action = useAction();
  const review = useAsync(() => services.procurement.requisitionReviews.get(requisition.id), [requisition.id]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  if (requisition.status !== "submitted") return null;

  const requester = review.data?.requesterId
    ? { id: review.data.requesterId, name: null }
    : { id: null, name: requisition.requestedBy };
  const block = isSelfApproval(requester, session?.user ?? null)
    ? t("prc.reqDecide.selfApproval")
    : !can("approval.act") && !can("purchase.order.create")
      ? t("prc.reqDecide.noPermission")
      : null;

  async function decide(decision: "approved" | "rejected") {
    await action.run(
      () => services.procurement.decideRequisition(requisition, decision, { actor, note, channel }, { requisitions: services.purchasing.requisitions }),
      {
        onSuccess: (updated) => {
          setRejecting(false);
          setNote("");
          onDone(updated, decision === "approved" ? t("prc.reqDecide.approved") : t("prc.reqDecide.rejected"));
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {block ? <Callout tone="warn">{block}</Callout> : null}
      {action.error && !rejecting ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={Boolean(block) || review.loading} loading={action.pending && !rejecting} onClick={() => void decide("approved")}>
          {t("prc.reqDecide.approve")}
        </Button>
        <Button variant="danger" disabled={Boolean(block) || review.loading} onClick={() => setRejecting(true)}>
          {t("prc.decide.reject")}
        </Button>
      </div>
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={t("prc.decide.rejectTitle").replace("{ref}", requisition.reference)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={action.pending} disabled={note.trim().length < 8} onClick={() => void decide("rejected")}>
              {t("prc.decide.reject")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <Field label={t("prc.reason")} hint={t("prc.reasonHint")} required>
            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} data-autofocus />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-016 — consolidate into supplier orders
// ---------------------------------------------------------------------------

interface ConsolidationRow extends ConsolidatedLine {
  supplierId: Id;
  unitPriceMinor: number;
}

/** Merge requisition lines by item and unit, keeping each branch's share. */
export function consolidate(requisitions: Requisition[]): ConsolidatedLine[] {
  const byKey = new Map<string, ConsolidatedLine>();
  for (const requisition of requisitions) {
    for (const line of requisition.lines) {
      const key = `${line.itemId}|${line.quantity.unit}`;
      const current =
        byKey.get(key) ??
        ({ itemId: line.itemId, itemName: line.itemName, unit: line.quantity.unit, quantity: "0", allocations: [] } as ConsolidatedLine);
      current.quantity = decimalAdd(current.quantity, line.quantity.value || "0");
      current.allocations.push({
        itemId: line.itemId,
        branchId: requisition.branchId,
        branchName: requisition.branchName,
        requisitionId: requisition.id,
        requisitionRef: requisition.reference,
        quantity: line.quantity.value,
        unit: line.quantity.unit,
        costMinor: 0,
      });
      byKey.set(key, current);
    }
  }
  return [...byKey.values()];
}

export function ConsolidateDrawer({
  requisitions,
  onClose,
  onDone,
}: {
  requisitions: Requisition[];
  onClose: () => void;
  onDone: (orders: PurchaseOrder[], message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const { policy } = usePolicy();
  const data = useAsync(
    () =>
      Promise.all([
        services.purchasing.suppliers.list({ limit: 500 }).then((page) => page.rows),
        services.inventory.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
        services.organisation.locations().catch(() => [] as StockLocation[]),
        services.procurement.priceEntries.all(),
        services.procurement.sourcing.all(),
      ]),
    [],
  );
  const [rows, setRows] = useState<ConsolidationRow[]>([]);
  const [locationId, setLocationId] = useState<Id>("");
  const [expected, setExpected] = useState(todayIso());

  const suppliers: Supplier[] = data.data?.[0] ?? [];
  const locations: StockLocation[] = data.data?.[2] ?? [];

  useEffect(() => {
    if (!data.data) return;
    const [, items, locs, entries, rankings] = data.data;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const ranking = new Map(rankings.map((row) => [row.itemId, row.supplierIds]));
    setLocationId(locs[0]?.id ?? "");
    setRows(
      consolidate(requisitions).map((line) => {
        const item = itemsById.get(line.itemId);
        const supplierId = ranking.get(line.itemId)?.[0] ?? item?.defaultSupplierId ?? "";
        const price = supplierId ? resolvePrice(entries, supplierId, line.itemId, line.unit, line.quantity, todayIso()) : null;
        const estimated = requisitions
          .flatMap((row) => row.lines)
          .filter((entry) => entry.itemId === line.itemId)
          .reduce((sum, entry) => sum + entry.estimatedCost.amount, 0);
        const fallback = Number(line.quantity) > 0 ? Math.round(estimated / Number(line.quantity)) : 0;
        return { ...line, supplierId, unitPriceMinor: price?.unitPriceMinor ?? fallback };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);

  const bySupplier = useMemo(() => {
    const map = new Map<Id, ConsolidationRow[]>();
    for (const row of rows) {
      if (!row.supplierId) continue;
      map.set(row.supplierId, [...(map.get(row.supplierId) ?? []), row]);
    }
    return map;
  }, [rows]);

  const unassigned = rows.filter((row) => !row.supplierId).length;
  const branches = new Set(requisitions.map((row) => row.branchId)).size;

  function setRow(key: string, part: Partial<ConsolidationRow>) {
    setRows((current) => current.map((row) => (`${row.itemId}|${row.unit}` === key ? { ...row, ...part } : row)));
  }

  async function create() {
    const ok = await confirm({
      title: t("prc.cons.confirmTitle"),
      body: t("prc.cons.confirmBody")
        .replace("{orders}", String(bySupplier.size))
        .replace("{requisitions}", String(requisitions.length)),
      confirmLabel: t("prc.cons.create"),
      tone: "neutral",
    });
    if (!ok) return;
    const location = locations.find((row) => row.id === locationId);
    await action.run(
      async () => {
        const created: PurchaseOrder[] = [];
        for (const [supplierId, lines] of bySupplier) {
          const supplier = suppliers.find((row) => row.id === supplierId);
          const orderLines = lines.map((line, index) => ({
            id: `pol_${index + 1}`,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: { value: line.quantity, unit: line.unit as UnitCode },
            receivedQuantity: { value: "0", unit: line.unit as UnitCode },
            unitPrice: money(line.unitPriceMinor, PRC_CURRENCY),
            taxRate: 0,
            lineTotal: money(Math.round(Number(line.quantity) * line.unitPriceMinor), PRC_CURRENCY),
          }));
          const total = orderLines.reduce((sum, line) => sum + line.lineTotal.amount, 0);
          const tier = tierForTotal(total);
          const autoApproved = tier === 0 || (policy ? !policy.steps.poApproval : false);
          // Each branch's share of each line's cost, summing exactly to the line.
          const allocations: BranchAllocation[] = lines.flatMap((line) => {
            const lineTotal = Math.round(Number(line.quantity) * line.unitPriceMinor);
            const shares = allocateCost(lineTotal, line.allocations.map((row) => row.quantity));
            return line.allocations.map((row, index) => ({ ...row, costMinor: shares[index] ?? 0 }));
          });
          let order = await services.purchasing.orders.create({
            supplierId,
            supplierName: supplier?.tradingName,
            deliveryLocationId: locationId,
            deliveryLocationName: location?.name,
            expectedDelivery: expected,
            status: autoApproved ? "approved" : "pending_approval",
            approvalTier: tier,
            createdBy: { en: actor.name, ar: actor.name },
            lines: orderLines,
            subtotal: money(total, PRC_CURRENCY),
            taxTotal: money(0, PRC_CURRENCY),
            total: money(total, PRC_CURRENCY),
          });
          if (autoApproved && order.status !== "approved") {
            order = await services.purchasing.orders.update(order.id, { status: "approved", approvedAt: new Date().toISOString() });
          }
          const requisitionIds = [...new Set(allocations.map((row) => row.requisitionId))];
          await services.procurement.recordSubmission(order, actor, { source: "consolidated", allocations, requisitionIds });
          created.push(order);
        }
        for (const requisition of requisitions) {
          await services.purchasing.requisitions.update(requisition.id, { status: "consolidated" });
        }
        return created;
      },
      { onSuccess: (created) => onDone(created, t("prc.cons.done").replace("{n}", String(created.length))) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("prc.cons.title")}
      subtitle="FR-PRC-016"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={rows.length === 0 || unassigned > 0 || !locationId || rows.some((row) => row.unitPriceMinor <= 0)} onClick={create}>
            {t("prc.cons.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {data.error ? <Callout tone="bad">{data.error.message}</Callout> : null}
        <Callout tone="muted">
          {t("prc.cons.note").replace("{requisitions}", String(requisitions.length)).replace("{branches}", String(branches))}
        </Callout>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.deliverTo")} hint={t("prc.cons.deliverHint")} required>
            <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">—</option>
              {locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pur.expectedDelivery")}>
            <Input type="date" dir="ltr" value={expected} onChange={(event) => setExpected(event.target.value)} />
          </Field>
        </div>

        <ul className="space-y-2">
          {rows.map((row) => {
            const key = `${row.itemId}|${row.unit}`;
            return (
              <li key={key} className="border-line rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-fg min-w-0 flex-1 text-sm font-medium">{tx(row.itemName)}</p>
                  <span className="font-mono text-sm tabular-nums">{formatQuantity({ value: row.quantity, unit: row.unit }, fmt)}</span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label={t("pur.supplier")} required>
                    <Select value={row.supplierId} onChange={(event) => setRow(key, { supplierId: event.target.value })}>
                      <option value="">—</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {tx(supplier.tradingName)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("doc.unitPrice")}>
                    <MoneyInput
                      value={row.unitPriceMinor}
                      currency={PRC_CURRENCY}
                      onChange={(minor) => setRow(key, { unitPriceMinor: minor ?? 0 })}
                      aria-label={`${t("doc.unitPrice")} ${tx(row.itemName)}`}
                    />
                  </Field>
                </div>
                <ul className="text-fg-muted mt-2 space-y-0.5 text-xs">
                  {row.allocations.map((allocation, index) => (
                    <li key={`${allocation.requisitionId}-${index}`} className="flex justify-between gap-2">
                      <span>
                        {tx(allocation.branchName)} · <span className="font-mono">{allocation.requisitionRef}</span>
                      </span>
                      <span className="font-mono tabular-nums">{formatQuantity({ value: allocation.quantity, unit: allocation.unit }, fmt)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>

        {unassigned > 0 ? <Callout tone="warn">{t("prc.cons.unassigned").replace("{n}", String(unassigned))}</Callout> : null}

        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("prc.cons.preview")}</h3>
          <DescList>
            {[...bySupplier.entries()].map(([supplierId, lines]) => {
              const supplier = suppliers.find((row) => row.id === supplierId);
              const total = lines.reduce((sum, line) => sum + Math.round(Number(line.quantity) * line.unitPriceMinor), 0);
              return (
                <DescRow key={supplierId} label={supplier ? tx(supplier.tradingName) : supplierId} mono>
                  {formatMoney(money(total, PRC_CURRENCY), fmt)} <Badge tone="muted">{lines.length}</Badge>
                </DescRow>
              );
            })}
          </DescList>
        </section>
      </div>
    </Drawer>
  );
}
