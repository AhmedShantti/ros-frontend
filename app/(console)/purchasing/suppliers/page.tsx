"use client";

/**
 * Suppliers — SRS §12.3, FR-PRC-009.
 *
 * The master data half of this screen is unremarkable: terms, lead time,
 * delivery days. The scorecard is the part that earns its place.
 *
 * Price stability is the metric restaurants usually discover too late. A
 * supplier can hold a perfect on-time record and still cost more every month
 * through quiet unit-price drift, and because each individual delivery looks
 * fine, nothing raises it. Tracking it as a score makes the drift visible
 * while the contract is still negotiable.
 *
 * Quality rejection is inverted — low is good — so it is coloured against the
 * opposite scale from the other four. Reading all five with the same "higher
 * is better" instinct is exactly the mistake this note exists to prevent.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Supplier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  DescList,
  DescRow,
  Drawer,
  Meter,
  Toast,
  cx,
} from "@/components/console/ui";

/** Colour a rate against a target; `invert` for metrics where low is good. */
function rateTone(value: number, good: number, warn: number, invert = false) {
  if (invert) {
    if (value <= good) return "good" as const;
    if (value <= warn) return "warn" as const;
    return "bad" as const;
  }
  if (value >= good) return "good" as const;
  if (value >= warn) return "warn" as const;
  return "bad" as const;
}

export default function SuppliersPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <SuppliersScreen />
    </Gate>
  );
}

function SuppliersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Supplier>(
    (query) => services.purchasing.suppliers.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const onTime = rows.map((row) => row.scorecard.onTimeDeliveryRate);
    return {
      outstanding: rows.reduce((sum, row) => sum + row.outstandingBalance.amount, 0),
      averageOnTime:
        onTime.length > 0 ? onTime.reduce((s, v) => s + v, 0) / onTime.length : 0,
      underperforming: rows.filter((row) => row.scorecard.onTimeDeliveryRate < 90).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.outstandingBalance.currency ?? "EGP";

  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        key: "name",
        header: t("pur.supplier"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.tradingName)}
            secondary={<span className="font-mono">{row.code}</span>}
          />
        ),
      },
      {
        key: "contact",
        header: t("pur.contact"),
        secondary: true,
        render: (row) => (
          <CellStack primary={row.contactName} secondary={<span dir="ltr">{row.phone}</span>} />
        ),
      },
      {
        key: "terms",
        header: t("pur.terms"),
        numeric: true,
        secondary: true,
        render: (row) => (
          <span dir="ltr">
            {t("pur.netDays")}
            {formatNumber(row.paymentTermsDays, fmt)}
          </span>
        ),
      },
      {
        key: "leadTimeDays",
        header: t("pur.leadTime"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span>
            {formatNumber(row.leadTimeDays, fmt)} {t("inv.days")}
          </span>
        ),
      },
      {
        key: "onTime",
        header: t("pur.onTime"),
        sortable: true,
        numeric: true,
        render: (row) => {
          const rate = row.scorecard.onTimeDeliveryRate;
          const tone = rateTone(rate, 95, 88);
          return (
            <span
              className={cx(
                tone === "good" && "text-good",
                tone === "warn" && "text-warn",
                tone === "bad" && "text-bad",
              )}
            >
              {formatPercent(rate, fmt, 1)}
            </span>
          );
        },
      },
      {
        key: "priceStability",
        header: t("pur.priceStability"),
        numeric: true,
        secondary: true,
        render: (row) => formatPercent(row.scorecard.priceStability, fmt, 1),
      },
      {
        key: "outstanding",
        header: t("pur.outstanding"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.outstandingBalance, fmt),
      },
      {
        key: "active",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={row.active ? "good" : "muted"} dot>
            {row.active ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("pur.suppliersTitle")}
        subtitle={t("pur.suppliersSubtitle")}
        spec="FR-PRC-009"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.outstanding")}
            value={formatMoney({ amount: totals.outstanding, currency }, fmt, true)}
          />
          <MetricTile
            label={t("pur.onTime")}
            value={formatPercent(totals.averageOnTime, fmt, 1)}
          />
          <MetricTile
            label={t("pur.underperforming")}
            value={formatNumber(totals.underperforming, fmt)}
            hint={t("pur.underperformingHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("pur.supplierSearchPlaceholder")}
          filters={[
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("pur.suppliersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <SupplierDrawer supplier={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SupplierDrawer({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!supplier) return null;

  const card = supplier.scorecard;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(supplier.tradingName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {supplier.code}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.name")}>{tx(supplier.legalName)}</DescRow>
          <DescRow label={t("pur.contact")}>{supplier.contactName}</DescRow>
          <DescRow label={t("usr.phone")} mono>
            <span dir="ltr">{supplier.phone}</span>
          </DescRow>
          <DescRow label={t("auth.email")}>
            <span dir="ltr">{supplier.email}</span>
          </DescRow>
          <DescRow label={t("pur.taxRegistration")} mono>
            <span dir="ltr">{supplier.taxRegistration || "—"}</span>
          </DescRow>
          <DescRow label={t("pur.terms")} mono>
            <span dir="ltr">
              {t("pur.netDays")}
              {formatNumber(supplier.paymentTermsDays, fmt)}
            </span>
          </DescRow>
          <DescRow label={t("pur.leadTime")} mono>
            {formatNumber(supplier.leadTimeDays, fmt)} {t("inv.days")}
          </DescRow>
          <DescRow label={t("pur.minOrder")} mono>
            {formatMoney(supplier.minimumOrderValue, fmt)}
          </DescRow>
          <DescRow label={t("pur.outstanding")} mono>
            {formatMoney(supplier.outstandingBalance, fmt)}
          </DescRow>
        </DescList>

        {supplier.deliveryDays.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("pur.deliveryDays")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {supplier.deliveryDays.map((day) => (
                <Badge key={day} tone="neutral">
                  {day}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="text-fg mb-3 text-sm font-semibold">{t("pur.scorecard")}</h3>
          <div className="space-y-3">
            <ScoreRow
              label={t("pur.onTime")}
              value={card.onTimeDeliveryRate}
              tone={rateTone(card.onTimeDeliveryRate, 95, 88)}
            />
            <ScoreRow
              label={t("pur.fillRate")}
              value={card.fillRate}
              tone={rateTone(card.fillRate, 96, 90)}
            />
            <ScoreRow
              label={t("pur.priceStability")}
              value={card.priceStability}
              tone={rateTone(card.priceStability, 95, 88)}
            />
            <ScoreRow
              label={t("pur.invoiceAccuracy")}
              value={card.invoiceAccuracy}
              tone={rateTone(card.invoiceAccuracy, 97, 92)}
            />
            <ScoreRow
              label={t("pur.qualityRejection")}
              value={card.qualityRejectionRate}
              tone={rateTone(card.qualityRejectionRate, 1, 3, true)}
              lowerIsBetter
            />
          </div>

          <DescList>
            <DescRow label={t("pur.avgLeadTime")} mono>
              {formatNumber(card.averageLeadTimeDays, fmt, 1)} {t("inv.days")}
            </DescRow>
          </DescList>
        </section>
      </div>
    </Drawer>
  );
}

function ScoreRow({
  label,
  value,
  tone,
  lowerIsBetter,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";
  lowerIsBetter?: boolean;
}) {
  const { t, fmt } = useI18n();

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-fg-muted flex items-center gap-1.5 text-xs">
          {label}
          {lowerIsBetter ? (
            <span className="text-fg-subtle text-[0.65rem]">{t("pur.lowerIsBetter")}</span>
          ) : null}
        </span>
        <span className="text-fg font-mono text-sm tabular-nums">
          {formatPercent(value, fmt, 1)}
        </span>
      </div>
      <Meter value={lowerIsBetter ? Math.min(100, value * 10) : value} tone={tone} />
    </div>
  );
}
