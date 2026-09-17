"use client";

/**
 * Inter-location transfers — SRS §11.5, §17.4.
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
 *
 * Three views of the same flow:
 *   - **Transfers** — what has moved or is moving (FR-BRN-015, FR-INV-031).
 *   - **Requests** — what a branch has asked for and what the source decided
 *     (FR-BRN-016).
 *   - **Suggested** — stock about to expire in one place that another place
 *     is short of (FR-BRN-017).
 * Every dispatched transfer has a note with a QR (FR-INV-033), and receiving
 * starts from scanning it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, Plus, ScanLine, Send, X } from "lucide-react";
import type { Id, StockItem, StockLocation, Transfer, TransferLine, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, formatQuantity, unitLabel } from "@/lib/console/format";
import { TRANSFER_STATUS, LOCATION_KIND, labelOf } from "@/lib/console/labels";
import { isPositiveDecimal } from "@/lib/console/stock-units";
import type { TransferSuggestion } from "@/lib/console/inventory-transfers";
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
import { SearchSelect } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
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
  Tabs,
  Toast,
} from "@/components/console/ui";
import { ScanTransferNoteDrawer, TransferNoteModal } from "@/components/console/inventory-transfer-note";
import { TransferRequestsPanel, type RequestPrefill } from "@/components/console/inventory-transfer-requests";
import { TransferSuggestionsPanel } from "@/components/console/inventory-transfer-suggestions";

type View = "transfers" | "requests" | "suggested";

export default function TransfersPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <TransfersScreen />
    </Gate>
  );
}

interface DispatchPrefill {
  fromLocationId: Id;
  toLocationId: Id;
  itemId: Id;
  quantity: string;
}

function TransfersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canDispatch = usePermission("inventory.transfer.create");
  const canReceive = usePermission("inventory.transfer.receive");
  const [view, setView] = useState<View>("transfers");
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchPrefill, setDispatchPrefill] = useState<DispatchPrefill | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestPrefill, setRequestPrefill] = useState<RequestPrefill | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notes, setNotes] = useState<Transfer[] | null>(null);
  const [receiveOnOpen, setReceiveOnOpen] = useState(false);
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
      discrepancies: rows.filter((row) => row.status === "discrepancy").length,
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

  const openRequest = useCallback((prefill: RequestPrefill) => {
    setRequestPrefill(prefill);
    setRequesting(true);
    setView("requests");
  }, []);

  const openDispatchFromSuggestion = useCallback((suggestion: TransferSuggestion) => {
    setDispatchPrefill({
      fromLocationId: suggestion.fromLocationId,
      toLocationId: suggestion.toLocationId,
      itemId: suggestion.itemId,
      quantity: String(suggestion.quantity),
    });
    setDispatching(true);
  }, []);

  return (
    <>
      <PageHeader
        title={t("inv.transfersTitle")}
        subtitle={t("inv.transfersSubtitle")}
        spec="FR-INV-030"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canReceive ? (
              <Button icon={<ScanLine size={14} />} onClick={() => setScanning(true)}>
                {t("invx.note.scanTitle")}
              </Button>
            ) : null}
            <Button
              icon={<Send size={14} />}
              onClick={() => {
                setRequestPrefill(null);
                setRequesting(true);
                setView("requests");
              }}
            >
              {t("invx.req.new")}
            </Button>
            {canDispatch ? (
              <Button
                variant="primary"
                icon={<Plus size={14} />}
                onClick={() => {
                  setDispatchPrefill(null);
                  setDispatching(true);
                }}
              >
                {t("common.new")}
              </Button>
            ) : null}
          </div>
        }
      />

      <PageBody>
        <Tabs<View>
          value={view}
          onChange={setView}
          label={t("inv.transfersTitle")}
          options={[
            { value: "transfers", label: t("invx.trf.tabTransfers") },
            { value: "requests", label: t("invx.trf.tabRequests") },
            { value: "suggested", label: t("invx.trf.tabSuggested") },
          ]}
        />

        {view === "transfers" ? (
          <>
            {DATA_MODE === "http" ? (
              <Callout tone="warn">{t("inv.transfersNoIndex")}</Callout>
            ) : null}

            <TileGrid columns={3}>
              <MetricTile label={t("inv.inTransit")} value={formatNumber(totals.inTransit, fmt)} spec="FR-INV-031" />
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
              onRowClick={(row) => {
                setReceiveOnOpen(false);
                setSelected(row);
              }}
              activeRowKey={selected?.id ?? null}
              dense
            />
          </>
        ) : null}

        {view === "requests" ? (
          <TransferRequestsPanel
            creating={requesting}
            onCreatingChange={(open) => {
              setRequesting(open);
              if (!open) setRequestPrefill(null);
            }}
            prefill={requestPrefill}
            onDispatched={(created) => {
              collection.reload();
              if (created.length > 0) setNotes(created);
            }}
          />
        ) : null}

        {view === "suggested" ? (
          <TransferSuggestionsPanel onRequest={openRequest} onDispatch={openDispatchFromSuggestion} />
        ) : null}
      </PageBody>

      <TransferDrawer
        transfer={selected}
        receiveOnOpen={receiveOnOpen}
        onClose={() => setSelected(null)}
        onNote={(transfer) => setNotes([transfer])}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      {dispatching ? (
        <DispatchTransferDrawer
          prefill={dispatchPrefill}
          onClose={() => setDispatching(false)}
          onDispatched={(created) => {
            setDispatching(false);
            setMessage(t("inv.transferDispatched"));
            collection.reload();
            // There is no index to find these transfers again by, so their
            // notes open at once — the note is what the receiver scans.
            if (created.length > 0) setNotes(created);
          }}
          onSomeSent={(created) => {
            collection.reload();
            setNotes(created);
          }}
        />
      ) : null}

      <ScanTransferNoteDrawer
        open={scanning}
        onClose={() => setScanning(false)}
        onResolved={(transfer) => {
          setScanning(false);
          setView("transfers");
          setReceiveOnOpen(transfer.status === "dispatched" || transfer.status === "in_transit");
          setSelected(transfer);
        }}
      />

      {notes ? <TransferNoteModal transfers={notes} onClose={() => setNotes(null)} /> : null}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TransferDrawer({
  transfer,
  receiveOnOpen,
  onClose,
  onNote,
  onChanged,
}: {
  transfer: Transfer | null;
  receiveOnOpen: boolean;
  onClose: () => void;
  onNote: (transfer: Transfer) => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canReceive = usePermission("inventory.transfer.receive");
  const [receiving, setReceiving] = useState(false);

  // A scanned note lands straight in the receive form.
  useEffect(() => {
    setReceiving(Boolean(transfer && receiveOnOpen && canReceive));
  }, [transfer, receiveOnOpen, canReceive]);

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

  const status = labelOf(TRANSFER_STATUS, transfer.status);
  const hasDiscrepancy = transfer.lines.some((line) => line.discrepancy !== 0);
  const dispatched = transfer.status !== "draft" && transfer.status !== "requested" && transfer.status !== "cancelled";

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
        <div className="flex flex-wrap gap-2">
          {dispatched ? (
            // FR-INV-033 — reprint or show the note at any point after dispatch.
            <Button icon={<FileText size={14} />} onClick={() => onNote(transfer)}>
              {t("invx.note.open")}
            </Button>
          ) : null}
          {canReceive && (transfer.status === "dispatched" || transfer.status === "in_transit") ? (
            <Button variant="primary" onClick={() => setReceiving(true)}>
              {t("inv.receiveTransfer")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {hasDiscrepancy ? (
          <Callout tone="bad" title={t("inv.discrepancy")}>
            {t("inv.discrepancyNote")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.by")}>{tx(transfer.requestedBy) || "—"}</DescRow>
          <DescRow label={t("inv.dispatched")}>
            {transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.received")}>
            {transfer.receivedAt ? formatDateTime(transfer.receivedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("common.value")} mono>
            {formatMoney(transfer.totalValue, fmt)}
          </DescRow>
        </DescList>

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
            onChanged(t("inv.transferReceived"));
          }}
        />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-032 — receive a dispatched transfer.
 *
 * The received quantity is entered rather than assumed. When it differs from
 * what was dispatched the server writes a discrepancy adjustment alongside
 * the `transfer_in` leg, and that adjustment needs a reason code — so the
 * field appears exactly when the numbers disagree.
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

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  useEffect(() => {
    if (open && line) setReceived(line.dispatched.value);
  }, [open, line]);

  if (!open || !line) return null;

  const short = Number(received) !== Number(line.dispatched.value);
  const valid = received.trim() !== "" && Number.isFinite(Number(received));

  async function receive() {
    if (!valid) return;
    await action.run(
      () =>
        services.inventory.receiveTransfer({
          transferReferenceId: transfer.id,
          toLocationId: transfer.toLocationId,
          receivedQuantity: received.trim(),
          discrepancyReasonCodeId: short ? reasonCodeId || undefined : undefined,
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
            disabled={!valid || (short && !reasonCodeId)}
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
        {transfer.lines.length > 1 ? <Callout tone="muted">{t("invx.trf.multiLineReceive")}</Callout> : null}

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

        {short ? (
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
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

interface DispatchLine {
  key: string;
  itemId: Id | null;
  quantity: string;
}

/**
 * FR-INV-030 / FR-BRN-015 — dispatch stock between any two locations in the
 * tenant (branch, warehouse or central kitchen), writing the `transfer_out`
 * leg.
 *
 * The API moves one item per transfer, so a multi-item dispatch is one
 * transfer per line, sent in order; a line that fails is reported and the
 * ones that went are kept. `onDispatched` carries the created transfers back:
 * there is no index endpoint to find them again by, so this is the moment
 * their notes are printed.
 */
function DispatchTransferDrawer({
  prefill,
  onClose,
  onDispatched,
  onSomeSent,
}: {
  prefill: DispatchPrefill | null;
  onClose: () => void;
  onDispatched: (transfers: Transfer[]) => void;
  /** Some lines went and some did not; the drawer stays open on the failures. */
  onSomeSent: (transfers: Transfer[]) => void;
}) {
  const { t, tx, locale } = useI18n();
  const confirm = useConfirm();
  const action = useAction();
  const [fromLocationId, setFrom] = useState(prefill?.fromLocationId ?? "");
  const [toLocationId, setTo] = useState(prefill?.toLocationId ?? "");
  const [lines, setLines] = useState<DispatchLine[]>(() => [
    { key: "d0", itemId: prefill?.itemId ?? null, quantity: prefill?.quantity ?? "" },
  ]);
  const [failures, setFailures] = useState<Record<string, string>>({});

  const locations = useAsync(() => services.organisation.locations(), []);
  const items = useAsync(
    () => services.inventory.items.list({ limit: 2000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
    [],
  );

  useEffect(() => {
    const rows = locations.data;
    if (!rows || rows.length === 0) return;
    if (!fromLocationId) setFrom(rows[0]!.id);
    if (!toLocationId) setTo(rows[1]?.id ?? rows[0]!.id);
  }, [locations.data, fromLocationId, toLocationId]);

  const itemById = useMemo(() => new Map((items.data ?? []).map((item) => [item.id, item])), [items.data]);
  const filled = lines.filter((line) => line.itemId);

  const valid =
    fromLocationId !== "" &&
    toLocationId !== "" &&
    fromLocationId !== toLocationId &&
    filled.length > 0 &&
    filled.every((line) => isPositiveDecimal(line.quantity)) &&
    new Set(filled.map((line) => line.itemId)).size === filled.length;

  const byKind = (rows: StockLocation[]) =>
    [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || tx(a.name).localeCompare(tx(b.name)));

  async function dispatch() {
    if (!valid) return;
    if (filled.length > 1) {
      const ok = await confirm({
        title: t("invx.trf.multiTitle"),
        body: t("invx.trf.multiBody").replace("{n}", String(filled.length)),
        confirmLabel: t("inv.dispatch"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await action.run(async () => {
      const created: Transfer[] = [];
      const errors: Record<string, string> = {};
      const nameOf = (id: Id) => (locations.data ?? []).find((row) => row.id === id)?.name;
      for (const line of filled) {
        const item = itemById.get(line.itemId!);
        try {
          const transfer = await services.inventory.transfers.create({
            fromLocationId,
            fromLocationName: nameOf(fromLocationId),
            toLocationId,
            toLocationName: nameOf(toLocationId),
            lines: [
              {
                id: "",
                itemId: line.itemId!,
                itemName: item?.name ?? { en: "", ar: "" },
                dispatched: { value: line.quantity.trim(), unit: (item?.baseUnit ?? "pc") as UnitCode },
                received: null,
                discrepancy: 0,
                unitCost: item?.unitCost ?? { amount: 0, currency: "EGP" },
              },
            ],
          });
          created.push({
            ...transfer,
            fromLocationName: transfer.fromLocationName ?? nameOf(fromLocationId) ?? { en: "", ar: "" },
            toLocationName: transfer.toLocationName ?? nameOf(toLocationId) ?? { en: "", ar: "" },
            reference: transfer.reference || transfer.id,
          });
        } catch (caught) {
          errors[line.key] = caught instanceof Error ? caught.message : String(caught);
        }
      }
      setFailures(errors);
      if (Object.keys(errors).length > 0) {
        // Keep only the lines that did not go, so a retry cannot double-send.
        setLines((current) => current.filter((line) => errors[line.key]));
        if (created.length > 0) onSomeSent(created);
        throw new Error(t("invx.trf.someFailed").replace("{n}", String(Object.keys(errors).length)));
      }
      onDispatched(created);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("inv.newTransfer")}
      subtitle="FR-BRN-015"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void dispatch()}>
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
        {prefill ? <Callout tone="accent">{t("invx.trf.fromSuggestion")}</Callout> : null}

        <AsyncPanel state={locations} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <div className="space-y-4">
              <Field label={t("inv.from")} required hint={t("invx.trf.anyLocation")}>
                <Select value={fromLocationId} onChange={(event) => setFrom(event.target.value)}>
                  {byKind(rows).map((location) => (
                    <option key={location.id} value={location.id}>
                      {tx(location.name)} · {tx(labelOf(LOCATION_KIND, location.kind).label)}
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
                  {byKind(rows).map((location) => (
                    <option key={location.id} value={location.id}>
                      {tx(location.name)} · {tx(labelOf(LOCATION_KIND, location.kind).label)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </AsyncPanel>

        <section className="space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("invx.req.lines")}</h3>
          {lines.map((line) => {
            const item = line.itemId ? itemById.get(line.itemId) : undefined;
            return (
              <div key={line.key} className="space-y-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchSelect
                      value={line.itemId}
                      onChange={(itemId) =>
                        setLines((current) => current.map((row) => (row.key === line.key ? { ...row, itemId } : row)))
                      }
                      options={(items.data ?? []).map((row) => ({ value: row.id, label: tx(row.name), hint: row.sku }))}
                      placeholder={t("inv.item")}
                      aria-label={t("inv.item")}
                    />
                  </div>
                  <div className="w-32">
                    <Input
                      inputMode="decimal"
                      dir="ltr"
                      value={line.quantity}
                      placeholder={item ? unitLabel(item.baseUnit, locale) : t("inv.quantity")}
                      aria-label={t("inv.quantity")}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)),
                        )
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.remove")}
                    icon={<X size={12} />}
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  />
                </div>
                {failures[line.key] ? <p className="text-bad text-xs">{failures[line.key]}</p> : null}
              </div>
            );
          })}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => setLines((current) => [...current, { key: `d${Date.now()}`, itemId: null, quantity: "" }])}
          >
            {t("invx.req.addLine")}
          </Button>
        </section>
      </div>
    </Drawer>
  );
}
