"use client";

/**
 * Batch traceability — SRS FR-INV-027.
 *
 * Forward: a batch → every order that consumed it, including through
 * production (a batch of chicken in a batch of marinade in a shawarma).
 * Backward: an order → every batch it consumed, back through production to
 * the supplier's receipt.
 *
 * The backend has no trace endpoint, so the whole movement ledger is read
 * once (one request per item) and both walks run over it in the browser —
 * `traceForward` / `traceBackward`. The result is exportable, because in an
 * incident the list goes to a regulator, not to a screen.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";

import type { Batch, Id, Order } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useLedger } from "@/lib/console/inventory-ledger";
import { traceBackward, traceForward, type TraceEvent } from "@/lib/console/inventory-trace";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatNumber } from "@/lib/console/format";
import { MOVEMENT_TYPE, labelOf } from "@/lib/console/labels";
import { SearchSelect } from "@/components/console/fields";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { LedgerGate } from "@/components/console/inventory-ledger-panel";
import { Badge, Button, Callout, Field, Input, Tabs, Toast } from "@/components/console/ui";

type Direction = "forward" | "backward";

export default function TracePage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <TraceScreen />
    </Gate>
  );
}

function TraceScreen() {
  const { t } = useI18n();
  const [direction, setDirection] = useState<Direction>("forward");
  const ledger = useLedger();
  // Batches for numbers, expiry and supplier. Live, batches come from the
  // expiring endpoint, so a long horizon is asked for.
  const batches = useAsync(
    () => services.inventory.batches.list({ limit: 5000, filters: { days: "3650" } }).then((page) => page.rows).catch(() => [] as Batch[]),
    [],
  );

  return (
    <>
      <PageHeader title={t("invx.trace.title")} subtitle={t("invx.trace.subtitle")} spec="FR-INV-027" />
      <PageBody>
        <Tabs<Direction>
          value={direction}
          onChange={setDirection}
          label={t("invx.trace.title")}
          options={[
            { value: "forward", label: t("invx.trace.forward") },
            { value: "backward", label: t("invx.trace.backward") },
          ]}
        />
        <Callout tone="muted">{t("invx.trace.how")}</Callout>
        <LedgerGate state={ledger}>
          {(load) =>
            direction === "forward" ? (
              <ForwardTrace movements={load.movements} batches={batches.data ?? []} />
            ) : (
              <BackwardTrace movements={load.movements} batches={batches.data ?? []} />
            )
          }
        </LedgerGate>
      </PageBody>
    </>
  );
}

function useEventColumns(batches: Batch[]): Column<TraceEvent>[] {
  const { t, tx, fmt } = useI18n();
  const numberOf = useMemo(() => new Map(batches.map((batch) => [batch.id, batch.batchNumber])), [batches]);
  return [
    { key: "at", header: t("common.time"), render: (row) => formatDateTime(row.occurredAt, fmt) },
    {
      key: "type",
      header: t("invx.trace.event"),
      render: (row) => (
        <CellStack
          primary={tx(labelOf(MOVEMENT_TYPE, row.movementType).label)}
          secondary={row.depth > 0 ? t("invx.trace.viaProduction").replace("{n}", String(row.depth)) : undefined}
        />
      ),
    },
    {
      key: "item",
      header: t("inv.item"),
      render: (row) => (
        <CellStack
          primary={tx(row.itemName)}
          secondary={row.batchId ? <span className="font-mono">{numberOf.get(row.batchId) ?? row.batchId}</span> : undefined}
        />
      ),
    },
    { key: "location", header: t("common.location"), secondary: true, render: (row) => tx(row.locationName) },
    {
      key: "qty",
      header: t("common.quantity"),
      numeric: true,
      render: (row) => (
        <span dir="ltr" className="font-mono">
          {formatNumber(row.quantity, fmt, 3)} {row.unit}
        </span>
      ),
    },
    {
      key: "reference",
      header: t("common.reference"),
      render: (row) => (
        <CellStack primary={<span className="font-mono text-xs">{row.referenceId}</span>} secondary={row.referenceType} />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------

function ForwardTrace({ movements, batches }: { movements: import("@/lib/console/types").StockMovement[]; batches: Batch[] }) {
  const { t, tx, fmt } = useI18n();
  const [batchId, setBatchId] = useState<Id | null>(null);
  const [message, setMessage] = useTransientMessage();
  const columns = useEventColumns(batches);

  // Every batch the ledger knows, named where the batch register names it.
  const options = useMemo(() => {
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    const ids = new Set<Id>([...batches.map((batch) => batch.id), ...movements.map((row) => row.batchId).filter((id): id is Id => Boolean(id))]);
    const itemOf = new Map(movements.filter((row) => row.batchId).map((row) => [row.batchId!, row.itemName]));
    return [...ids].map((id) => {
      const batch = byId.get(id);
      return {
        value: id,
        label: batch ? `${batch.batchNumber} · ${tx(batch.itemName)}` : `${id} · ${tx(itemOf.get(id))}`,
        hint: batch ? `${tx(batch.locationName)} · ${formatDate(batch.expiryDate, fmt)}` : t("invx.trace.notInRegister"),
      };
    });
  }, [batches, movements, tx, fmt, t]);

  const trace = useMemo(() => (batchId ? traceForward(movements, batchId) : null), [movements, batchId]);
  const batch = batches.find((row) => row.id === batchId) ?? null;

  const orderIds = trace?.orders.map((order) => order.referenceId) ?? [];
  const orders = useAsync(
    async () => {
      // Best effort: resolve up to 50 order numbers; an order the server will
      // not return keeps its id.
      const found = new Map<Id, Order>();
      await Promise.all(
        orderIds.slice(0, 50).map(async (id) => {
          const order = await services.sales.orders.get(id).catch(() => null);
          if (order) found.set(id, order);
        }),
      );
      return found;
    },
    [orderIds.join("|")],
  );

  return (
    <div className="space-y-4">
      <Field label={t("invx.trace.chooseBatch")} hint={t("invx.trace.chooseBatchHint")}>
        <SearchSelect value={batchId} onChange={setBatchId} options={options} placeholder={t("invx.trace.batchPlaceholder")} aria-label={t("invx.trace.chooseBatch")} />
      </Field>

      {trace ? (
        <>
          <TileGrid columns={4}>
            <MetricTile label={t("invx.trace.orders")} value={formatNumber(trace.orders.length, fmt)} spec="FR-INV-027" />
            <MetricTile label={t("invx.trace.events")} value={formatNumber(trace.consumption.length, fmt)} />
            <MetricTile label={t("invx.trace.derived")} value={formatNumber(trace.derivedBatches.length, fmt)} hint={t("invx.trace.derivedHint")} />
            <MetricTile
              label={t("invx.trace.origin")}
              value={batch?.supplierName ? tx(batch.supplierName) : trace.origins[0] ? tx(labelOf(MOVEMENT_TYPE, trace.origins[0].movementType).label) : "—"}
              hint={batch ? `${t("inv.expiryDate")}: ${formatDate(batch.expiryDate, fmt)}` : undefined}
            />
          </TileGrid>

          <Section
            title={t("invx.trace.ordersTitle")}
            hint={t("invx.trace.ordersHint")}
            action={
              <ExportButton
                filename={`trace-forward-${batch?.batchNumber ?? batchId}`}
                title={`${t("invx.trace.forward")} — ${batch?.batchNumber ?? batchId}`}
                rows={trace.orders}
                onExported={setMessage}
                columns={[
                  { key: "order", header: t("invx.trace.order"), value: (row) => orders.data?.get(row.referenceId)?.orderNumber ?? row.referenceId },
                  { key: "id", header: "ID", value: (row) => row.referenceId },
                  { key: "first", header: t("invx.trace.firstAt"), value: (row) => row.firstAt },
                  { key: "qty", header: t("common.quantity"), value: (row) => row.quantity.toFixed(3) },
                  { key: "depth", header: t("invx.trace.depth"), value: (row) => row.depth },
                ]}
              />
            }
            padded={false}
          >
            <DataTable
              columns={[
                {
                  key: "order",
                  header: t("invx.trace.order"),
                  render: (row) => {
                    const order = orders.data?.get(row.referenceId);
                    return (
                      <CellStack
                        primary={<span className="font-mono">{order?.orderNumber ?? row.referenceId}</span>}
                        secondary={order ? tx(order.branchName) : undefined}
                      />
                    );
                  },
                },
                { key: "first", header: t("invx.trace.firstAt"), render: (row) => formatDateTime(row.firstAt, fmt) },
                {
                  key: "qty",
                  header: t("common.quantity"),
                  numeric: true,
                  render: (row) => <span className="font-mono">{formatNumber(row.quantity, fmt, 3)}</span>,
                },
                {
                  key: "depth",
                  header: t("invx.trace.depth"),
                  render: (row) =>
                    row.depth === 0 ? <Badge tone="muted">{t("invx.trace.direct")}</Badge> : <Badge tone="accent">{t("invx.trace.viaProduction").replace("{n}", String(row.depth))}</Badge>,
                },
              ]}
              rows={trace.orders}
              rowKey={(row) => row.referenceId}
              caption={t("invx.trace.ordersTitle")}
              emptyTitle={t("invx.trace.noOrders")}
              dense
            />
          </Section>

          <Section title={t("invx.trace.allEvents")} hint={t("invx.trace.allEventsHint")} padded={false}>
            <DataTable
              columns={columns}
              rows={[...trace.origins, ...trace.consumption]}
              rowKey={(row) => row.movementId}
              caption={t("invx.trace.allEvents")}
              emptyTitle={t("invx.trace.noEvents")}
              dense
            />
          </Section>
        </>
      ) : (
        <Callout tone="muted" icon={<ArrowRight size={14} />}>
          {t("invx.trace.forwardIdle")}
        </Callout>
      )}
      <Toast message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BackwardTrace({ movements, batches }: { movements: import("@/lib/console/types").StockMovement[]; batches: Batch[] }) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [text, setText] = useState("");
  const [referenceIds, setReferenceIds] = useState<Id[] | null>(null);
  const [message, setMessage] = useTransientMessage();
  const columns = useEventColumns(batches);
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  async function find() {
    const needle = text.trim();
    if (!needle) return;
    await action.run(async () => {
      // An id the ledger references answers directly; otherwise the order
      // number is looked up through the orders service.
      if (movements.some((row) => row.referenceId === needle)) return [needle];
      const page = await services.sales.orders.list({ search: needle, limit: 20 });
      const ids = page.rows.filter((order) => order.orderNumber === needle || order.id === needle).map((order) => order.id);
      if (ids.length === 0) throw new Error(t("invx.trace.orderNotFound").replace("{code}", needle));
      return ids;
    }, { onSuccess: setReferenceIds });
  }

  const trace = useMemo(() => (referenceIds ? traceBackward(movements, referenceIds) : null), [movements, referenceIds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label={t("invx.trace.chooseOrder")} hint={t("invx.trace.chooseOrderHint")}>
            <Input
              dir="ltr"
              className="font-mono"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void find();
                }
              }}
            />
          </Field>
        </div>
        <Button variant="primary" icon={<Search size={14} />} loading={action.pending} disabled={!text.trim()} onClick={() => void find()}>
          {t("invx.trace.trace")}
        </Button>
      </div>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {trace ? (
        <>
          <TileGrid columns={3}>
            <MetricTile label={t("invx.trace.batchesConsumed")} value={formatNumber(trace.batches.length, fmt)} spec="FR-INV-027" />
            <MetricTile label={t("invx.trace.events")} value={formatNumber(trace.direct.length, fmt)} />
            <MetricTile label={t("invx.trace.unbatched")} value={formatNumber(trace.unbatched.length, fmt)} hint={t("invx.trace.unbatchedHint")} />
          </TileGrid>

          {trace.direct.length === 0 ? <Callout tone="warn">{t("invx.trace.noMovementsForOrder")}</Callout> : null}

          <Section
            title={t("invx.trace.batchesTitle")}
            hint={t("invx.trace.batchesHint")}
            padded={false}
            action={
              <ExportButton
                filename={`trace-backward-${text.trim()}`}
                title={`${t("invx.trace.backward")} — ${text.trim()}`}
                rows={trace.batches}
                onExported={setMessage}
                columns={[
                  { key: "batch", header: t("inv.batchNumber"), value: (row) => batchById.get(row.batchId)?.batchNumber ?? row.batchId },
                  { key: "item", header: t("inv.item"), value: (row) => tx(row.itemName) },
                  { key: "qty", header: t("common.quantity"), value: (row) => row.quantity.toFixed(3) },
                  { key: "supplier", header: t("invx.trace.supplier"), value: (row) => tx(batchById.get(row.batchId)?.supplierName) },
                  { key: "expiry", header: t("inv.expiryDate"), value: (row) => batchById.get(row.batchId)?.expiryDate ?? "" },
                  { key: "origin", header: t("invx.trace.origin"), value: (row) => (row.origin ? `${row.origin.referenceType}:${row.origin.referenceId}` : "") },
                  { key: "depth", header: t("invx.trace.depth"), value: (row) => row.depth },
                ]}
              />
            }
          >
            <DataTable
              columns={[
                {
                  key: "batch",
                  header: t("inv.batchNumber"),
                  render: (row) => {
                    const batch = batchById.get(row.batchId);
                    return (
                      <CellStack
                        primary={<span className="font-mono">{batch?.batchNumber ?? row.batchId}</span>}
                        secondary={tx(row.itemName)}
                      />
                    );
                  },
                },
                {
                  key: "qty",
                  header: t("common.quantity"),
                  numeric: true,
                  render: (row) => (
                    <span dir="ltr" className="font-mono">
                      {formatNumber(row.quantity, fmt, 3)} {row.unit}
                    </span>
                  ),
                },
                {
                  key: "origin",
                  header: t("invx.trace.origin"),
                  render: (row) => {
                    const batch = batchById.get(row.batchId);
                    if (batch?.supplierName) return tx(batch.supplierName);
                    return row.origin ? (
                      <CellStack primary={tx(labelOf(MOVEMENT_TYPE, row.origin.movementType).label)} secondary={<span className="font-mono text-xs">{row.origin.referenceId}</span>} />
                    ) : (
                      <span className="text-fg-subtle">{t("invx.trace.originUnknown")}</span>
                    );
                  },
                },
                {
                  key: "expiry",
                  header: t("inv.expiryDate"),
                  secondary: true,
                  render: (row) => {
                    const batch = batchById.get(row.batchId);
                    return batch ? formatDate(batch.expiryDate, fmt) : "—";
                  },
                },
                {
                  key: "depth",
                  header: t("invx.trace.depth"),
                  render: (row) =>
                    row.depth === 0 ? <Badge tone="muted">{t("invx.trace.direct")}</Badge> : <Badge tone="accent">{t("invx.trace.viaProduction").replace("{n}", String(row.depth))}</Badge>,
                },
              ]}
              rows={trace.batches}
              rowKey={(row) => `${row.batchId}-${row.depth}`}
              caption={t("invx.trace.batchesTitle")}
              emptyTitle={t("invx.trace.noBatches")}
              dense
            />
          </Section>

          <Section title={t("invx.trace.allEvents")} padded={false}>
            <DataTable columns={columns} rows={trace.direct} rowKey={(row) => row.movementId} caption={t("invx.trace.allEvents")} dense />
          </Section>
        </>
      ) : (
        <Callout tone="muted" icon={<ArrowLeft size={14} />}>
          {t("invx.trace.backwardIdle")}
        </Callout>
      )}
      <Toast message={message} />
    </div>
  );
}
