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

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Batch } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { BATCH_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Toast, cx } from "@/components/console/ui";

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
  const [message, setMessage] = useTransientMessage();

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
        render: (row) =>
          canRecordWaste && row.daysToExpiry <= 0 ? (
            <Button
              size="sm"
              variant="danger"
              onClick={(event) => {
                event.stopPropagation();
                setMessage(t("common.notInBuild"));
              }}
            >
              {t("inv.writeOff")}
            </Button>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
    ],
    [t, tx, fmt, canRecordWaste, setMessage],
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

      <Toast message={message} />
    </>
  );
}
