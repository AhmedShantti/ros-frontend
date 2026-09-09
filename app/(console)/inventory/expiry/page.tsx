"use client";

/**
 * Expiry watch — SRS §11.4, FR-INV-024.
 *
 * The same batch data as /inventory/batches, asked a different question. That
 * screen is a register: what have we got. This one is a queue: what runs out
 * of time first, and what is it worth.
 *
 * The horizon buckets are the point. "Expiring soon" as a single badge is not
 * actionable — a kitchen can use up something with three days left and cannot
 * do much about something expiring tonight. So the tiles split the value at
 * risk by how much time is left to act on it.
 *
 * Expired stock is shown at the top rather than filtered away. It is still on
 * the balance sheet until somebody writes it off, and the write-off is the
 * action this screen exists to prompt.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Batch } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  numberFromInput,
} from "@/lib/console/format";
import { BATCH_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { MetricTile } from "@/components/console/charts";
import { PercentInput } from "@/components/console/fields";
import { Gate } from "@/components/console/states";
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
  Toast,
  cx,
} from "@/components/console/ui";

/** How much time is left to do something about it. */
type Horizon = "expired" | "today" | "soon" | "later";

function horizonOf(days: number): Horizon {
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days <= 3) return "soon";
  return "later";
}

const HORIZON_TONE: Record<Horizon, "bad" | "warn" | "neutral"> = {
  expired: "bad",
  today: "bad",
  soon: "warn",
  later: "neutral",
};

export default function ExpiryPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <ExpiryScreen />
    </Gate>
  );
}

function ExpiryScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canRecordWaste = usePermission("inventory.waste.record");
  const canTransfer = usePermission("inventory.transfer.create");
  const canMarkdown = usePermission("menu.price.change");
  const [message, setMessage] = useTransientMessage();
  const [writingOff, setWritingOff] = useState<Batch | null>(null);
  const [transferring, setTransferring] = useState<Batch | null>(null);
  const [markingDown, setMarkingDown] = useState<Batch | null>(null);

  // Locations from the service, so the filter offers ids that exist.
  const locationList = useAsync(() => services.organisation.locations(), []);
  const locations = locationList.data ?? [];

  // Nearest expiry first — the list is a queue, so the order is the whole
  // point and is not offered as a sortable preference.
  const collection = useCollection<Batch>(
    (query) => services.inventory.batches.list(query),
    { scope, initialSort: "daysToExpiry", pageSize: 50 },
  );

  const buckets = useMemo(() => {
    const empty = { expired: 0, today: 0, soon: 0, later: 0 };
    const value = { ...empty };
    const count = { ...empty };

    for (const batch of collection.rows) {
      const horizon = horizonOf(batch.daysToExpiry);
      value[horizon] += batch.value.amount;
      count[horizon] += 1;
    }

    return { value, count };
  }, [collection.rows]);

  const currency = collection.rows[0]?.value.currency ?? "EGP";
  const money = (amount: number) => formatMoney({ amount, currency }, fmt, true);

  const columns = useMemo<Column<Batch>[]>(
    () => [
      {
        key: "itemName",
        header: t("inv.sku"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.batchNumber}</span>}
          />
        ),
      },
      {
        key: "location",
        header: t("common.location"),
        secondary: true,
        render: (row) => tx(row.locationName),
      },
      {
        key: "quantity",
        header: t("inv.onHand"),
        numeric: true,
        render: (row) => formatQuantity(row.quantity, fmt),
      },
      {
        key: "expiryDate",
        header: t("inv.expiryDate"),
        render: (row) => formatDate(row.expiryDate, fmt),
      },
      {
        key: "daysToExpiry",
        header: t("inv.daysToExpiry"),
        numeric: true,
        render: (row) => {
          const horizon = horizonOf(row.daysToExpiry);
          return (
            <span
              className={cx(
                "font-semibold",
                horizon === "expired" && "text-bad",
                horizon === "today" && "text-bad",
                horizon === "soon" && "text-warn",
                horizon === "later" && "text-fg-muted",
              )}
            >
              {formatNumber(row.daysToExpiry, fmt)}
            </span>
          );
        },
      },
      {
        key: "value",
        header: t("inv.valueAtRisk"),
        numeric: true,
        render: (row) => formatMoney(row.value, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(BATCH_STATUS, row.status);
          const horizon = horizonOf(row.daysToExpiry);
          return (
            <Badge tone={HORIZON_TONE[horizon] === "neutral" ? status.tone : HORIZON_TONE[horizon]} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
      {
        key: "action",
        header: t("common.actions"),
        align: "end",
        /*
         * FR-INV-025 — one-tap actions, and all three of them.
         *
         * The point of this screen is acting *before* the loss, so the
         * actions are live at every horizon rather than appearing only once
         * the batch has already expired. A write-off button that unlocks on
         * the day the stock becomes worthless is a record of failure, not a
         * worklist.
         */
        render: (row) => (
          <div className="flex justify-end gap-1">
            {canTransfer ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setTransferring(row);
                }}
              >
                {t("inv.transferAction")}
              </Button>
            ) : null}
            {canMarkdown ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setMarkingDown(row);
                }}
              >
                {t("inv.markdownAction")}
              </Button>
            ) : null}
            {canRecordWaste ? (
              <Button
                size="sm"
                variant={row.daysToExpiry <= 0 ? "danger" : "ghost"}
                onClick={(event) => {
                  event.stopPropagation();
                  setWritingOff(row);
                }}
              >
                {t("inv.writeOff")}
              </Button>
            ) : null}
            {!canTransfer && !canMarkdown && !canRecordWaste ? (
              <span className="text-fg-subtle">—</span>
            ) : null}
          </div>
        ),
      },
    ],
    [t, tx, fmt, canRecordWaste, canTransfer, canMarkdown],
  );

  const urgent = buckets.count.expired + buckets.count.today;

  return (
    <>
      <PageHeader
        title={t("inv.expiryTitle")}
        subtitle={t("inv.expirySubtitle")}
        spec="FR-INV-024"
      />

      <PageBody>
        {urgent > 0 ? (
          <Callout tone="bad" icon={<AlertTriangle size={14} />} title={t("inv.expiryUrgent")}>
            {t("inv.expiryUrgentBody")}
          </Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile
            label={tx(BATCH_STATUS.expired.label)}
            value={money(buckets.value.expired)}
            footer={
              <span>
                {formatNumber(buckets.count.expired, fmt)} {t("inv.batchesLower")}
              </span>
            }
          />
          <MetricTile
            label={t("inv.expiringToday")}
            value={money(buckets.value.today)}
            footer={
              <span>
                {formatNumber(buckets.count.today, fmt)} {t("inv.batchesLower")}
              </span>
            }
          />
          <MetricTile
            label={t("inv.expiringSoon")}
            value={money(buckets.value.soon)}
            footer={
              <span>
                {formatNumber(buckets.count.soon, fmt)} {t("inv.batchesLower")}
              </span>
            }
          />
          <MetricTile
            label={t("inv.expiringLater")}
            value={money(buckets.value.later)}
            footer={
              <span>
                {formatNumber(buckets.count.later, fmt)} {t("inv.batchesLower")}
              </span>
            }
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("inv.batchSearchPlaceholder")}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(BATCH_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "locationId",
              label: t("common.location"),
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
          caption={t("inv.expiryTitle")}
          emptyTitle={t("inv.expiryClear")}
          emptyBody={t("inv.expiryClearBody")}
          dense
        />
      </PageBody>

      <WriteOffDrawer
        batch={writingOff}
        onClose={() => setWritingOff(null)}
        onWritten={() => {
          setWritingOff(null);
          setMessage(t("inv.writeOffDone"));
          collection.reload();
        }}
      />

      <ExpiryTransferDrawer
        batch={transferring}
        onClose={() => setTransferring(null)}
        onDone={() => {
          setTransferring(null);
          setMessage(t("inv.transferQueued"));
          collection.reload();
        }}
      />

      <MarkdownDrawer
        batch={markingDown}
        onClose={() => setMarkingDown(null)}
        onDone={() => {
          setMarkingDown(null);
          setMessage(t("inv.markdownCreated"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-024 — writing off an expired batch is a waste record, not a
 * special document of its own: `services.inventory.waste.create` (the same
 * call the waste ledger reads back) is what this button was always meant to
 * reach. The reason is required — the backend refuses a waste line without
 * one — and the quantity defaults to the whole batch but stays editable,
 * because part of a batch can still be usable right up to the cutoff.
 */
function WriteOffDrawer({
  batch,
  onClose,
  onWritten,
}: {
  batch: Batch | null;
  onClose: () => void;
  onWritten: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [quantity, setQuantity] = useState(() => batch?.quantity.value ?? "");
  const [reasonCode, setReasonCode] = useState("");
  const [notes, setNotes] = useState("");

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  if (!batch) return null;

  const parsed = numberFromInput(quantity);
  const max = Number(batch.quantity.value);
  const valid = parsed !== null && parsed > 0 && parsed <= max && Boolean(reasonCode);

  async function submit() {
    if (!batch || !valid) return;
    await action.run(
      () =>
        services.inventory.waste.create({
          locationId: batch.locationId,
          itemId: batch.itemId,
          quantity: { value: quantity.trim(), unit: batch.quantity.unit },
          reasonCode,
          notes: notes.trim() || undefined,
        }),
      { onSuccess: onWritten },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("inv.writeOff")} · ${tx(batch.itemName)}`}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("inv.writeOff")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("inv.onHand")} hint={formatQuantity(batch.quantity, fmt)}>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-label={t("common.quantity")}
          />
        </Field>

        <AsyncPanel
          state={reasons}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("pos.noReasonCodes")}</Callout>}
        >
          {(rows) => (
            <Field label={t("inv.reason")} required>
              <Select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
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

        <Field label={t("shift.comment")}>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}


// ---------------------------------------------------------------------------

/**
 * FR-INV-025 / FR-BRN-017 — move it somewhere it will actually be used.
 *
 * The most common reason a batch expires is that it is in the wrong place:
 * one branch is long on cream and another ran out on Tuesday. Dispatching
 * from here is what turns the expiry watchlist from a record of losses into
 * a way of avoiding them.
 */
function ExpiryTransferDrawer({
  batch,
  onClose,
  onDone,
}: {
  batch: Batch | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [quantity, setQuantity] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");

  const locations = useAsync(() => services.organisation.locations().catch(() => []), []);

  useEffect(() => {
    setQuantity(batch?.quantity.value ?? "");
    setToLocationId("");
    setNotes("");
  }, [batch?.id]);

  if (!batch) return null;

  const parsed = numberFromInput(quantity);
  const max = Number(batch.quantity.value);
  const valid =
    parsed !== null && parsed > 0 && parsed <= max && Boolean(toLocationId);

  async function submit() {
    if (!batch || !valid) return;
    await action.run(
      () =>
        services.inventory.transfers.create({
          fromLocationId: batch.locationId,
          toLocationId,
          lines: [
            {
              id: `${batch.id}_line`,
              itemId: batch.itemId,
              itemName: batch.itemName,
              dispatched: { value: quantity.trim(), unit: batch.quantity.unit },
              received: null,
              discrepancy: 0,
              unitCost: batch.unitCost,
            },
          ],
        }),
      { onSuccess: onDone },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("inv.transferAction")} · ${tx(batch.itemName)}`}
      subtitle="FR-INV-025"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={submit}>
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

        <Callout tone="muted">{t("inv.transferExpiryNote")}</Callout>

        <DescList>
          <DescRow label={t("inv.batch")} mono>
            {batch.batchNumber}
          </DescRow>
          <DescRow label={t("inv.expires")}>{formatDate(batch.expiryDate, fmt)}</DescRow>
          <DescRow label={t("inv.onHand")} mono>
            {formatQuantity(batch.quantity, fmt)}
          </DescRow>
        </DescList>

        <Field label={t("common.quantity")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-label={t("common.quantity")}
            className="text-end font-mono tabular-nums"
          />
        </Field>

        <Field label={t("inv.destination")} required>
          <Select value={toLocationId} onChange={(event) => setToLocationId(event.target.value)}>
            <option value="">{t("entry.chooseLocation")}</option>
            {(locations.data ?? [])
              .filter((location) => location.id !== batch.locationId)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {tx(location.name)}
                </option>
              ))}
          </Select>
        </Field>

        <Field label={t("shift.comment")}>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

/**
 * FR-INV-025 — sell it cheaper rather than throw it away.
 *
 * A markdown is a time-boxed promotion scoped to the item, which is why it
 * carries a window: an open-ended discount on yoghurt outlives the yoghurt
 * and quietly becomes the price.
 */
function MarkdownDrawer({
  batch,
  onClose,
  onDone,
}: {
  batch: Batch | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [percent, setPercent] = useState("25");
  const [until, setUntil] = useState("");

  useEffect(() => {
    setPercent("25");
    setUntil(batch?.expiryDate?.slice(0, 10) ?? "");
  }, [batch?.id]);

  if (!batch) return null;

  const numeric = Number(percent);
  const valid =
    Number.isFinite(numeric) && numeric > 0 && numeric < 100 && Boolean(until);

  async function submit() {
    if (!batch || !valid) return;
    await action.run(
      () =>
        services.crm.promotions.create({
          name: {
            en: `Markdown — ${batch.itemName.en}`,
            ar: `تخفيض — ${batch.itemName.ar}`,
          },
          kind: "markdown",
          effect: { type: "percent_off_items", value: numeric },
          conditions: { stockItemIds: [batch.itemId] },
          startsOn: new Date().toISOString().slice(0, 10),
          endsOn: until,
          active: true,
        } as never),
      { onSuccess: onDone },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("inv.markdownAction")} · ${tx(batch.itemName)}`}
      subtitle="FR-INV-025"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("inv.createMarkdown")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted">{t("inv.markdownNote")}</Callout>

        <DescList>
          <DescRow label={t("inv.expires")}>{formatDate(batch.expiryDate, fmt)}</DescRow>
          <DescRow label={t("inv.valueAtRisk")} mono>
            {formatMoney(batch.value, fmt)}
          </DescRow>
        </DescList>

        <Field label={t("inv.markdownPercent")} required>
          <PercentInput
            value={percent}
            onChange={setPercent}
            max={99}
            aria-label={t("inv.markdownPercent")}
          />
        </Field>

        <Field label={t("inv.markdownUntil")} hint={t("inv.markdownUntilHint")} required>
          <Input
            type="date"
            dir="ltr"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
