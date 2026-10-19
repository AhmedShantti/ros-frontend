"use client";

/**
 * Inter-branch transfers — SRS §11.5, §17.4.
 *
 * Dispatch and receipt are two events, not one. Between them the stock belongs
 * to neither location — it is in transit, and it is visible as such. A system
 * that moves the balance instantly hides exactly the window in which stock
 * goes missing.
 *
 * The discrepancy column is the reconciliation: dispatched minus received. A
 * non-zero value puts the transfer into `discrepancy` rather than `received`,
 * because closing it silently would make the loss disappear into two branches'
 * variance reports where nobody owns it.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { Transfer, TransferLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { APPROVAL_STATUS, TRANSFER_STATUS, labelOf } from "@/lib/console/labels";
import {
  CellStack,
  CollectionTable,
  DataTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
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
  Toast,
} from "@/components/console/ui";

const QUANTITY_SCALE = 1_000_000n;
function quantityMicros(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(value.trim());
  if (!match) return -1n;
  return BigInt(match[1]!) * QUANTITY_SCALE + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}
function physicalLotCounts(transfer: Transfer, values: Record<string, string>) {
  return (transfer.batchProvenance ?? []).map(lot => ({ sourceBatchId: lot.sourceBatchId, receivedQuantity: values[lot.sourceBatchId] ?? lot.quantity }));
}
function validLotCounts(transfer: Transfer, values: Record<string, string>, physical: bigint) {
  const lots = transfer.batchProvenance ?? [];
  if (lots.length <= 1) return true;
  const counts = physicalLotCounts(transfer, values);
  return counts.every((c, i) => quantityMicros(c.receivedQuantity) >= 0n && quantityMicros(c.receivedQuantity) <= quantityMicros(lots[i]!.quantity)) && counts.reduce((sum, c) => sum + quantityMicros(c.receivedQuantity), 0n) === physical;
}
function LotCountFields({ transfer, values, onChange }: { transfer: Transfer; values: Record<string, string>; onChange: (values: Record<string, string>) => void }) {
  const { t } = useI18n();
  return <div className="space-y-3"><Callout>{t("inv.lotCountHint")}</Callout>{(transfer.batchProvenance ?? []).map(lot => <Field key={lot.sourceBatchId} label={`${t("inv.lotReceived")} · ${lot.batchNumber ?? lot.sourceBatchId}`} required><Input inputMode="decimal" dir="ltr" value={values[lot.sourceBatchId] ?? lot.quantity} onChange={e => onChange({ ...values, [lot.sourceBatchId]: e.target.value })} /></Field>)}</div>;
}

function quantityFromMicros(value: bigint): string {
  const whole = value / QUANTITY_SCALE;
  const fraction = (value % QUANTITY_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export default function TransfersPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <TransfersScreen />
    </Gate>
  );
}

function TransfersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useTransientMessage();

  // Locations come from the service so the filters offer real ids.
  const locationList = useAsync(() => services.organisation.locations(), []);
  const locations = locationList.data ?? [];

  const collection = useCollection<Transfer>(
    (query) => services.inventory.transfers.list(query),
    { scope, initialSort: "-dispatchedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const inTransit = rows.filter(
      (row) => row.status === "dispatched" || row.status === "in_transit",
    );
    return {
      inTransit: inTransit.length,
      inTransitValue: inTransit.reduce((sum, row) => sum + row.totalValue.amount, 0),
      discrepancies: rows.filter((row) => row.status === "discrepancy" || row.status === "pending_investigation" || row.status === "excess_held").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.totalValue.currency ?? "EGP";

  const columns = useMemo<Column<Transfer>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.requestedBy)}
          />
        ),
      },
      {
        key: "route",
        header: t("inv.from"),
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-fg">{tx(row.fromLocationName)}</span>
            <ArrowRight size={12} className="text-fg-subtle shrink-0 rtl:rotate-180" aria-hidden />
            <span className="text-fg">{tx(row.toLocationName)}</span>
          </span>
        ),
      },
      {
        key: "dispatchedAt",
        header: t("inv.dispatched"),
        sortable: true,
        secondary: true,
        render: (row) =>
          row.dispatchedAt ? (
            formatDateTime(row.dispatchedAt, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "receivedAt",
        header: t("inv.received"),
        secondary: true,
        render: (row) =>
          row.receivedAt ? (
            formatDateTime(row.receivedAt, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "lines",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lines.length, fmt),
      },
      {
        key: "totalValue",
        header: t("common.value"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.totalValue, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(TRANSFER_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("inv.transfersTitle")}
        subtitle={t("inv.transfersSubtitle")}
        spec="FR-INV-030"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDispatching(true)}>
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("inv.inTransit")} value={formatNumber(totals.inTransit, fmt)} />
          <MetricTile
            label={t("inv.inTransitValue")}
            value={formatMoney({ amount: totals.inTransitValue, currency }, fmt, true)}
            hint={t("inv.inTransitHint")}
          />
          <MetricTile
            label={t("inv.discrepancy")}
            value={formatNumber(totals.discrepancies, fmt)}
            spec="FR-INV-034"
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(TRANSFER_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "fromLocationId",
              label: t("inv.from"),
              options: locations.map((location) => ({
                value: location.id,
                label: tx(location.name),
              })),
            },
            {
              key: "toLocationId",
              label: t("inv.to"),
              options: locations.map((location) => ({
                value: location.id,
                label: tx(location.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("inv.transfersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <TransferDrawer
        transfer={selected}
        onClose={() => setSelected(null)}
        onChanged={(note, updated) => {
          setMessage(note);
          if (updated) setSelected(updated);
          collection.reload();
        }}
      />

      <DispatchTransferDrawer
        open={dispatching}
        onClose={() => setDispatching(false)}
        onDispatched={(transfer) => {
          setDispatching(false);
          setMessage(t("inv.transferDispatched"));
          // There is no index to find this transfer again by, so it is
          // opened straight into the detail drawer (see `inv.transfersNoIndex`).
          setSelected(transfer);
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TransferDrawer({
  transfer,
  onClose,
  onChanged,
}: {
  transfer: Transfer | null;
  onClose: () => void;
  onChanged: (message: string, transfer?: Transfer) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canReceive = usePermission("inventory.transfer.receive");
  const canReturnExcess = usePermission("inventory.approve_adjustment");
  const [receiving, setReceiving] = useState(false);

  const columns = useMemo<Column<TransferLine>[]>(
    () => [
      {
        key: "item",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "dispatched",
        header: t("inv.dispatched"),
        numeric: true,
        render: (row) => formatQuantity(row.dispatched, fmt),
      },
      {
        key: "received",
        header: t("inv.received"),
        numeric: true,
        render: (row) =>
          row.received ? (
            formatQuantity(row.received, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "discrepancy",
        header: t("inv.discrepancy"),
        numeric: true,
        render: (row) =>
          row.discrepancy === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <DeltaCell value={row.discrepancy}>
              {row.discrepancy > 0 ? "+" : ""}
              {formatNumber(row.discrepancy, fmt, 2)}
            </DeltaCell>
          ),
      },
      {
        key: "unitCost",
        header: t("inv.unitCost"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.unitCost, fmt),
      },
    ],
    [t, tx, fmt],
  );

  if (!transfer) return null;

  const transferId = transfer.id;
  const status = labelOf(TRANSFER_STATUS, transfer.status);
  const hasDiscrepancy = transfer.lines.some((line) => line.discrepancy !== 0);
  async function refreshTransfer(message: string) {
    const updated = await services.inventory.transfers.get(transferId);
    onChanged(message, updated ?? undefined);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={transfer.reference}
      subtitle={
        <span className="flex items-center gap-1.5">
          {tx(transfer.fromLocationName)}
          <ArrowRight size={11} className="rtl:rotate-180" aria-hidden />
          {tx(transfer.toLocationName)}
        </span>
      }
      footer={
        canReceive && (transfer.status === "dispatched" || transfer.status === "in_transit") ? (
          <Button variant="primary" onClick={() => setReceiving(true)}>
            {t("inv.receiveTransfer")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {hasDiscrepancy ? (
          <Callout tone="bad" title={t("inv.discrepancy")}>
            {t("inv.discrepancyNote")}
          </Callout>
        ) : null}
        {transfer.status === "pending_investigation" ? (
          <Callout tone="warn" title={t("inv.pendingInvestigation")}>
            {t("inv.transferApprovalQueue")}
          </Callout>
        ) : null}
        {transfer.status === "excess_held" ? (
          <Callout tone="warn" title={t("inv.excessHeld")}>
            {t("inv.transferExcessHeldNote")}
          </Callout>
        ) : null}
        {transfer.status === "excess_held" && canReturnExcess ? <ExcessReturnForm transfer={transfer} onSubmitted={() => void refreshTransfer(t("inv.excessReturnRecorded"))} /> : null}
        {(transfer.excessReturns ?? []).map(event => <Callout key={event.id} title={t("inv.excessReturnRecorded")}><p>{event.quantity} · {tx(transfer.fromLocationName)} · {formatDateTime(event.returnedAt, fmt)}</p><p>{event.evidence} · {event.returnedBy}</p></Callout>)}
        {transfer.discrepancyEvidence ? (
          <DescRow label={t("inv.investigationEvidence")}>{transfer.discrepancyEvidence}</DescRow>
        ) : null}
        {transfer.status === "pending_investigation" && !transfer.approvalRequestId ? (
          <ReinvestigateTransferForm transfer={transfer} onSubmitted={() => void refreshTransfer(t("inv.transferSubmittedForApproval"))} />
        ) : null}

        <DescList>
          {transfer.dispatchGroupId ? <DescRow label={t("inv.transferGroup")}>{transfer.dispatchGroupId}</DescRow> : null}
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.by")}>{tx(transfer.requestedBy)}</DescRow>
          <DescRow label={t("inv.dispatched")}>
            {transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.received")}>
            {transfer.receivedAt ? formatDateTime(transfer.receivedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.inTransit")} mono>
            {formatQuantity(transfer.lines[0]?.inTransit ?? { value: "0", unit: "pc" }, fmt)}
          </DescRow>
          <DescRow label={t("inv.physicallyHeld")} mono>
            {formatQuantity(transfer.lines[0]?.physicallyHeld ?? { value: "0", unit: "pc" }, fmt)}
          </DescRow>
          <DescRow label={t("inv.availableAfterReceipt")} mono>
            {formatQuantity(transfer.lines[0]?.available ?? { value: "0", unit: "pc" }, fmt)}
          </DescRow>
          <DescRow label={t("inv.unresolvedQuantity")} mono>
            {formatQuantity(transfer.lines[0]?.unresolved ?? { value: "0", unit: "pc" }, fmt)}
          </DescRow>
          <DescRow label={t("common.value")} mono>
            {formatMoney(transfer.totalValue, fmt)}
          </DescRow>
        </DescList>

        {(transfer.receipts.length > 0 || transfer.approvalHistory.length > 0) ? (
          <section className="space-y-3">
            <h3 className="text-fg text-sm font-semibold">{t("inv.transferHistory")}</h3>
            {transfer.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{receipt.isRecount ? `${t("inv.recount")} · ${formatQuantity(receipt.recounted ?? receipt.received, fmt)}` : `${t("inv.received")} · ${formatQuantity(receipt.received, fmt)}${receipt.isFinal ? ` · ${t("inv.finalTransferReceipt")}` : ` · ${t("inv.partialTransferReceipt")}`}`}</span>
                  <span className="text-fg-subtle">{formatDateTime(receipt.receivedAt, fmt)}</span>
                </div>
                {receipt.evidence ? <p className="text-fg-subtle mt-1">{receipt.evidence}</p> : null}
                {(receipt.lotCounts ?? []).map(count => <p className="text-fg-subtle mt-1" key={count.sourceBatchId}>{transfer.batchProvenance?.find(lot => lot.sourceBatchId === count.sourceBatchId)?.batchNumber ?? count.sourceBatchId}: {count.receivedQuantity}</p>)}
              </div>
            ))}
            {transfer.approvalHistory.map((approval) => {
              const decision = labelOf(APPROVAL_STATUS, approval.status);
              return (
                <div key={approval.approvalRequestId} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <Badge tone={decision.tone} dot>{tx(decision.label)}</Badge>
                    <span className="text-fg-subtle">{formatDateTime(approval.requestedAt, fmt)}</span>
                  </div>
                  {approval.decidedAt ? <p className="text-fg-subtle mt-1">{t("inv.managerDecision")}: {approval.decidedBy ?? "—"} · {formatDateTime(approval.decidedAt, fmt)}</p> : null}
                  {approval.decisionComment ? <p className="text-fg-subtle mt-1">{approval.decisionComment}</p> : null}
                </div>
              );
            })}
          </section>
        ) : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          <DataTable
            columns={columns}
            rows={transfer.lines}
            rowKey={(row) => row.id}
            caption={transfer.reference}
            dense
          />
        </section>

        <ReceiveTransferDrawer
          transfer={transfer}
          open={receiving}
          onClose={() => setReceiving(false)}
          onReceived={() => {
            setReceiving(false);
            void refreshTransfer(t("inv.transferReceived"));
          }}
        />
      </div>
    </Drawer>
  );
}

function ExcessReturnForm({ transfer, onSubmitted }: { transfer: Transfer; onSubmitted: () => void }) {
  const { t, tx } = useI18n();
  const action = useAction();
  const reasons = useAsync(() => services.inventory.reasonCodes(), []);
  const [quantity, setQuantity] = useState(transfer.lines[0]?.physicallyHeld?.value ?? "");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [returnedAt, setReturnedAt] = useState(() => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,23); });
  const valid = quantityMicros(quantity) > 0n && quantityMicros(quantity) <= quantityMicros(transfer.lines[0]?.physicallyHeld?.value ?? "0") && !!reason && !!evidence.trim() && Number.isFinite(new Date(returnedAt).getTime());
  return <section className="space-y-3 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold">{t("inv.returnExcess")}</h3>
    <Callout>{t("inv.excessReturnHint")} · {tx(transfer.fromLocationName)}</Callout>
    <Field label={t("inv.returnQuantity")} required><Input inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
    <Field label={t("inv.returnedAt")} required><Input type="datetime-local" step="0.001" value={returnedAt} onChange={e => setReturnedAt(e.target.value)} /></Field>
    <AsyncPanel state={reasons} isEmpty={rows => rows.length === 0}>{rows => <Field label={t("inv.reason")} required><Select value={reason} onChange={e => setReason(e.target.value)}><option value="">—</option>{rows.map(row => <option key={row.id} value={row.id}>{tx(row.label)}</option>)}</Select></Field>}</AsyncPanel>
    <Field label={t("inv.investigationEvidence")} required><Input maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>
    {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
    <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => action.run(() => services.inventory.returnTransferExcess({ transferId: transfer.id, toLocationId: transfer.toLocationId, returnToLocationId: transfer.fromLocationId, quantity: quantity.trim(), reasonCodeId: reason, evidence: evidence.trim(), returnedAt: new Date(returnedAt).toISOString() }), { onSuccess: onSubmitted })}>{t("inv.recordPhysicalReturn")}</Button>
  </section>;
}

function ReinvestigateTransferForm({ transfer, onSubmitted }: { transfer: Transfer; onSubmitted: () => void }) {
  const { t, tx } = useI18n();
  const action = useAction();
  const reasons = useAsync(() => services.inventory.reasonCodes(), []);
  const [reasonId, setReasonId] = useState(transfer.discrepancyReasonCodeId ?? "");
  const [evidence, setEvidence] = useState(transfer.discrepancyEvidence ?? "");
  const [recountedQuantity, setRecountedQuantity] = useState(transfer.lines[0]?.received?.value ?? "");
  const [lotCounts, setLotCounts] = useState<Record<string, string>>(Object.fromEntries((transfer.lotCounts ?? []).map(c => [c.sourceBatchId, c.receivedQuantity])));
  const counted = quantityMicros(recountedQuantity || transfer.lines[0]?.received?.value || "0");
  const batchShortage = counted < quantityMicros(transfer.lines[0]?.dispatched.value ?? "0") && (transfer.batchProvenance?.length ?? 0) > 1;
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t("inv.pendingInvestigation")}</h3>
      <AsyncPanel state={reasons} isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Field label={t("inv.reason")} required>
            <Select value={reasonId} onChange={(event) => setReasonId(event.target.value)}>
              <option value="">—</option>
              {rows.map((reason) => <option key={reason.id} value={reason.id}>{tx(reason.label)}</option>)}
            </Select>
          </Field>
        )}
      </AsyncPanel>
      <Field label={t("inv.investigationEvidence")} required>
        <Input value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={1000} />
      </Field>
      <Field label={t("inv.recountedQuantity")}>
        <Input inputMode="decimal" dir="ltr" value={recountedQuantity} onChange={(event) => setRecountedQuantity(event.target.value)} />
      </Field>
      {batchShortage ? <LotCountFields transfer={transfer} values={lotCounts} onChange={setLotCounts} /> : null}
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Button variant="primary" loading={action.pending} disabled={!reasonId || !evidence.trim() || (batchShortage && !validLotCounts(transfer, lotCounts, counted))} onClick={() => action.run(() => services.inventory.investigateTransfer({ transferId: transfer.id, toLocationId: transfer.toLocationId, discrepancyReasonCodeId: reasonId, evidence: evidence.trim(), ...(recountedQuantity.trim() ? { recountedQuantity: recountedQuantity.trim() } : {}), ...(batchShortage ? { lotCounts: physicalLotCounts(transfer, lotCounts) } : {}) }), { onSuccess: onSubmitted })}>
        {t("inv.transferSubmitInvestigation")}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-032 — receive a dispatched transfer.
 *
 * The received quantity is entered rather than assumed. A final mismatch
 * requires reason/evidence and remains held pending Governance approval.
 */
function ReceiveTransferDrawer({
  transfer,
  open,
  onClose,
  onReceived,
}: {
  transfer: Transfer;
  open: boolean;
  onClose: () => void;
  onReceived: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();

  const line = transfer.lines[0];
  const [received, setReceived] = useState(line?.dispatched.value ?? "");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [isFinal, setIsFinal] = useState(true);
  const [lotCounts, setLotCounts] = useState<Record<string, string>>({});

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  useEffect(() => {
    if (open && line) {
      const outstanding = quantityMicros(line.dispatched.value) - quantityMicros(line.received?.value ?? "0");
      setReceived(quantityFromMicros(outstanding > 0n ? outstanding : 0n));
      setIsFinal(true);
      setLotCounts({});
      setEvidence("");
      setReasonCodeId("");
    }
  }, [open, line]);

  if (!open || !line) return null;

  const prior = quantityMicros(line.received?.value ?? "0");
  const entered = quantityMicros(received);
  const dispatched = quantityMicros(line.dispatched.value);
  const total = prior + entered;
  const discrepancy = isFinal && (entered < 0n || total !== dispatched);
  const batchShortage = isFinal && total < dispatched && (transfer.batchProvenance?.length ?? 0) > 1;
  const valid = received.trim() !== "" && (isFinal ? entered >= 0n : entered > 0n) && (!batchShortage || validLotCounts(transfer, lotCounts, total));

  async function receive() {
    if (!valid) return;
    await action.run(
      () =>
        services.inventory.receiveTransfer({
          transferReferenceId: transfer.id,
          toLocationId: transfer.toLocationId,
          receivedQuantity: received.trim(),
          isFinal,
          lotCounts: batchShortage ? physicalLotCounts(transfer, lotCounts) : undefined,
          evidence: discrepancy ? evidence.trim() : undefined,
          discrepancyReasonCodeId: discrepancy ? reasonCodeId || undefined : undefined,
        }),
      { onSuccess: onReceived },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("inv.receiveTransfer")}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {transfer.reference}
        </span>
      }
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!valid || (discrepancy && (!reasonCodeId || evidence.trim().length === 0))}
            onClick={receive}
          >
            {t("inv.receiveTransfer")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <DescList>
          <DescRow label={t("inv.from")}>{tx(transfer.fromLocationName)}</DescRow>
          <DescRow label={t("inv.to")}>{tx(transfer.toLocationName)}</DescRow>
          <DescRow label={t("common.name")}>{tx(line.itemName)}</DescRow>
          <DescRow label={t("inv.dispatched")} mono>
            <span dir="ltr">{line.dispatched.value}</span>
          </DescRow>
        </DescList>

        <Field label={t("inv.received")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={received}
            onChange={(event) => setReceived(event.target.value)}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={isFinal} onChange={(event) => setIsFinal(event.target.checked)} />
          {t("inv.finalTransferReceipt")}
        </label>

        {batchShortage ? <LotCountFields transfer={transfer} values={lotCounts} onChange={setLotCounts} /> : null}
        {discrepancy ? (
          <>
            <Callout tone="warn">{t("inv.discrepancyNote")}</Callout>

            <AsyncPanel state={reasons} isEmpty={(rows) => rows.length === 0}>
              {(rows) => (
                <Field label={t("inv.reason")} required>
                  <Select
                    value={reasonCodeId}
                    onChange={(event) => setReasonCodeId(event.target.value)}
                  >
                    <option value="">—</option>
                    {rows.map((reason) => (
                      <option key={reason.id} value={reason.id}>
                        {tx(reason.label)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </AsyncPanel>
            <Field label={t("inv.investigationEvidence")} required>
              <Input value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={1000} />
            </Field>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-030 — dispatch a transfer, writing the `transfer_out` leg.
 *
 * `onDispatched` carries the created transfer back: there is no index
 * endpoint to find it again by, so this is the one and only moment the
 * console has its id without someone writing it down.
 */
function DispatchTransferDrawer({
  open,
  onClose,
  onDispatched,
}: {
  open: boolean;
  onClose: () => void;
  onDispatched: (transfer: Transfer) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [fromLocationId, setFrom] = useState("");
  const [toLocationId, setTo] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [additionalLines, setAdditionalLines] = useState<{ itemId: string; quantity: string }[]>([]);

  const locations = useAsync(() => services.organisation.locations(), []);
  const items = useAsync(() => services.inventory.items.list({ limit: 500 }), []);

  useEffect(() => {
    const rows = locations.data;
    if (!rows || rows.length === 0) return;
    if (!fromLocationId) setFrom(rows[0]!.id);
    if (!toLocationId) setTo(rows[1]?.id ?? rows[0]!.id);
  }, [locations.data, fromLocationId, toLocationId]);

  if (!open) return null;

  const valid =
    fromLocationId !== "" &&
    toLocationId !== "" &&
    fromLocationId !== toLocationId &&
    itemId !== "" &&
    quantity.trim() !== "" &&
    quantityMicros(quantity) > 0n &&
    additionalLines.every(line => line.itemId && quantityMicros(line.quantity) > 0n) &&
    new Set([itemId, ...additionalLines.map(line => line.itemId)]).size === additionalLines.length + 1;

  async function dispatch() {
    if (!valid) return;
    await action.run(
      () =>
        (additionalLines.length ? services.inventory.dispatchTransferLines({
          fromLocationId,
          toLocationId,
          lines: [{ stockItemId: itemId, quantity: quantity.trim() }, ...additionalLines.map(line => ({ stockItemId: line.itemId, quantity: line.quantity.trim() }))],
        }).then(rows => rows[0]!) : services.inventory.transfers.create({
          fromLocationId,
          toLocationId,
          lines: [
            {
              id: "",
              itemId,
              itemName: { en: "", ar: "" },
              dispatched: { value: quantity.trim(), unit: "pc" },
              received: null,
              discrepancy: 0,
              unitCost: { amount: 0, currency: "EGP" },
            },
          ],
        })),
      { onSuccess: onDispatched },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("inv.newTransfer")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={dispatch}>
            {t("inv.dispatch")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <AsyncPanel state={locations} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <div className="space-y-4">
              <Field label={t("inv.from")} required>
                <Select value={fromLocationId} onChange={(event) => setFrom(event.target.value)}>
                  {rows.map((location) => (
                    <option key={location.id} value={location.id}>
                      {tx(location.name)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={t("inv.to")}
                required
                error={
                  fromLocationId && fromLocationId === toLocationId
                    ? t("inv.sameLocation")
                    : undefined
                }
              >
                <Select value={toLocationId} onChange={(event) => setTo(event.target.value)}>
                  {rows.map((location) => (
                    <option key={location.id} value={location.id}>
                      {tx(location.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </AsyncPanel>

        <AsyncPanel state={items} isEmpty={(page) => page.rows.length === 0}>
          {(page) => (
            <Field label={t("inv.item")} required>
              <Select value={itemId} onChange={(event) => setItemId(event.target.value)}>
                <option value="">—</option>
                {page.rows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {tx(item.name)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>

        <Field label={t("inv.quantity")} hint={`${t("inv.baseUnit")}: ${items.data?.rows.find(item => item.id === itemId)?.baseUnit ?? "—"}`} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        {additionalLines.map((line, index) => <section key={index} className="space-y-3 rounded-lg border border-border p-3">
          <Field label={`${t("inv.item")} ${index + 2}`} required><Select value={line.itemId} onChange={event => setAdditionalLines(rows => rows.map((row, i) => i === index ? { ...row, itemId: event.target.value } : row))}><option value="">—</option>{(items.data?.rows ?? []).map(item => <option key={item.id} value={item.id}>{tx(item.name)}</option>)}</Select></Field>
          <Field label={`${t("inv.quantity")} ${index + 2}`} hint={`${t("inv.baseUnit")}: ${items.data?.rows.find(item => item.id === line.itemId)?.baseUnit ?? "—"}`} required><Input inputMode="decimal" dir="ltr" value={line.quantity} onChange={event => setAdditionalLines(rows => rows.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} /></Field>
          <Button variant="ghost" onClick={() => setAdditionalLines(rows => rows.filter((_, i) => i !== index))}>{t("common.remove")}</Button>
        </section>)}
        <Button variant="ghost" disabled={additionalLines.length >= 49} onClick={() => setAdditionalLines(rows => [...rows, { itemId: "", quantity: "" }])}>{t("inv.addTransferLine")}</Button>
      </div>
    </Drawer>
  );
}
