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
import { TRANSFER_STATUS, labelOf } from "@/lib/console/labels";
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
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <DispatchTransferDrawer
        open={dispatching}
        onClose={() => setDispatching(false)}
        onDispatched={() => {
          setDispatching(false);
          setMessage(t("inv.transferDispatched"));
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
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canReceive = usePermission("inventory.transfer.receive");
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

  const status = labelOf(TRANSFER_STATUS, transfer.status);
  const hasDiscrepancy = transfer.lines.some((line) => line.discrepancy !== 0);

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

        <DescList>
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

/** FR-INV-030 — dispatch a transfer, writing the `transfer_out` leg. */
function DispatchTransferDrawer({
  open,
  onClose,
  onDispatched,
}: {
  open: boolean;
  onClose: () => void;
  onDispatched: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [fromLocationId, setFrom] = useState("");
  const [toLocationId, setTo] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");

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
    Number.isFinite(Number(quantity));

  async function dispatch() {
    if (!valid) return;
    await action.run(
      () =>
        services.inventory.transfers.create({
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
        }),
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

        <Field label={t("inv.quantity")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
