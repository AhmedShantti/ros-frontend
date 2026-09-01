"use client";

/**
 * Day close — SRS §16.5, FR-FIN-021, FR-FIN-023.
 *
 * The day cannot close while a cash session is open. That is not a
 * convenience check: the Z report is the immutable, sequentially numbered
 * statement of the trading day, and issuing one while a drawer is still taking
 * money produces a number that was wrong the moment it was printed.
 *
 * So blocked is a real state with named blockers, and the close button is
 * disabled rather than hidden — a manager needs to know why they cannot close,
 * and which terminal to go and deal with.
 *
 * Z numbers are sequential per branch and never reused. Gaps are the thing an
 * auditor looks for first, which is why the number is issued by the close and
 * not chosen.
 *
 * Against a backend the rows are two different reads. A sealed day is its
 * persisted Z snapshot, byte-stable forever. A day with no Z yet has no
 * snapshot to read, so its figures come from the live daily-trading report —
 * which is also where the blockers come from, and without it this screen
 * could only ever show history and never the day anyone needs to close.
 */

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import type { DayClose, DayCloseResult } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage, useBranches } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/console/format";
import { DAY_CLOSE_STATUS, TENDER_TYPE, labelOf } from "@/lib/console/labels";
import {
  CellStack,
  CollectionTable,
  DataTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";

export default function DayClosePage() {
  return (
    <Gate permissions={["cash.session.view", "report.view.financial"]}>
      <DayCloseScreen />
    </Gate>
  );
}

function DayCloseScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const [selected, setSelected] = useState<DayClose | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<DayClose>(
    (query) => services.finance.dayCloses.list(query),
    { scope, initialSort: "-businessDay", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      open: rows.filter((row) => row.status !== "closed").length,
      blocked: rows.filter((row) => isBlocked(row)).length,
      netSales: rows.reduce((sum, row) => sum + row.netSales.amount, 0),
      variance: rows.reduce((sum, row) => sum + row.cashVariance.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.netSales.currency ?? "EGP";

  const [closing, setClosing] = useState(false);
  const [activated, setActivated] = useState<DayCloseResult | null>(null);

  /**
   * The first request a branch ever makes activates its close epoch and
   * seals nothing. Reporting that as "business day closed" would be a lie
   * the manager acts on, so the outcome is read and the two are worded
   * differently — see `DayCloseResult`.
   */
  async function closeDay(day: DayClose) {
    setClosing(true);
    try {
      const result = await services.finance.closeDay(day.branchId, day.businessDay);

      if (result.outcome === "ACTIVATED") {
        // Consequential and easy to misread, so it stays on the page rather
        // than passing by in a toast: nothing was sealed, and the manager
        // needs the date they can actually close from.
        setActivated(result);
        setMessage(t("fin.dayActivated"));
      } else {
        setActivated(null);
        setMessage(t("fin.dayClosed"));
      }

      setSelected(null);
      collection.reload();
    } catch (error) {
      // The backend's own 409 names which of several reasons refused the
      // close — an open order, an open drawer, a day outside the epoch. It
      // is far more useful than a generic failure, so it is shown as sent.
      setMessage(error instanceof Error ? error.message : t("state.errorTitle"));
    } finally {
      setClosing(false);
    }
  }

  const columns = useMemo<Column<DayClose>[]>(
    () => [
      {
        key: "businessDay",
        header: t("fin.businessDay"),
        sortable: true,
        render: (row) => (
          <CellStack primary={formatDate(row.businessDay, fmt)} secondary={tx(row.branchName)} />
        ),
      },
      {
        key: "zNumber",
        header: t("fin.zNumber"),
        render: (row) =>
          row.zReportNumber === null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="font-mono text-xs" dir="ltr">
              Z-{formatNumber(row.zReportNumber, fmt)}
            </span>
          ),
      },
      {
        key: "netSales",
        header: t("fin.netSales"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.netSales, fmt, true),
      },
      {
        key: "transactionCount",
        header: t("fin.transactionCount"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.transactionCount, fmt),
      },
      {
        key: "cashVariance",
        header: t("wf.cashVariance"),
        numeric: true,
        render: (row) =>
          row.cashVariance.amount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <DeltaCell value={-Math.abs(row.cashVariance.amount)}>
              {formatMoney(row.cashVariance, fmt)}
            </DeltaCell>
          ),
      },
      {
        key: "blocking",
        header: t("fin.blockedBy"),
        render: (row) =>
          !isBlocked(row) ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="inline-flex flex-wrap gap-1">
              {row.blockingSessions.length > 0 ? (
                <Badge tone="warn">
                  {formatNumber(row.blockingSessions.length, fmt)} {t("fin.openSessions")}
                </Badge>
              ) : null}
              {row.blockingOrderCount > 0 ? (
                <Badge tone="warn">
                  {formatNumber(row.blockingOrderCount, fmt)} {t("fin.blockedByOrders")}
                </Badge>
              ) : null}
            </span>
          ),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(DAY_CLOSE_STATUS, row.status);
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
        title={t("fin.dayCloseTitle")}
        subtitle={t("fin.dayCloseSubtitle")}
        spec="FR-FIN-021"
      />

      <PageBody>
        {activated ? (
          <Callout tone="accent" title={t("fin.dayActivated")}>
            {t("fin.dayActivatedNote").replace(
              "{day}",
              formatDate(activated.firstEligibleBusinessDay, fmt),
            )}
          </Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile label={t("fin.daysOpen")} value={formatNumber(totals.open, fmt)} />
          <MetricTile
            label={t("fin.blockedBy")}
            value={formatNumber(totals.blocked, fmt)}
            spec="FR-FIN-021"
            hint={t("fin.blockedHint")}
          />
          <MetricTile
            label={t("fin.netSales")}
            value={formatMoney({ amount: totals.netSales, currency }, fmt, true)}
          />
          <MetricTile
            label={t("wf.cashVariance")}
            value={formatMoney({ amount: totals.variance, currency }, fmt, true)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(DAY_CLOSE_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "branchId",
              label: t("common.branch"),
              options: branches.map((branch) => ({
                value: branch.id,
                label: tx(branch.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("fin.dayCloseTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <DayCloseDrawer
        day={selected}
        closing={closing}
        onClose={() => setSelected(null)}
        onCloseDay={closeDay}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** FR-FIN-021 — an open drawer or an open order both hold the day open. */
function isBlocked(day: DayClose): boolean {
  return day.blockingSessions.length > 0 || day.blockingOrderCount > 0;
}

function DayCloseDrawer({
  day,
  closing,
  onClose,
  onCloseDay,
}: {
  day: DayClose | null;
  closing: boolean;
  onClose: () => void;
  onCloseDay: (day: DayClose) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canClose = usePermission("cash.day.close");

  const tenderColumns = useMemo<Column<DayClose["tenders"][number]>[]>(
    () => [
      {
        key: "tender",
        header: t("fin.tenderType"),
        render: (row) => {
          const tender = labelOf(TENDER_TYPE, row.tender);
          return <Badge tone={tender.tone}>{tx(tender.label)}</Badge>;
        },
      },
      {
        key: "count",
        header: t("fin.count"),
        numeric: true,
        render: (row) => formatNumber(row.count, fmt),
      },
      {
        key: "amount",
        header: t("fin.amount"),
        numeric: true,
        render: (row) => formatMoney(row.amount, fmt),
      },
    ],
    [t, tx, fmt],
  );

  if (!day) return null;

  const status = labelOf(DAY_CLOSE_STATUS, day.status);
  const blocked = isBlocked(day);

  return (
    <Drawer
      open
      onClose={onClose}
      title={formatDate(day.businessDay, fmt)}
      subtitle={tx(day.branchName)}
      footer={
        canClose && day.status !== "closed" ? (
          <Button
            variant="primary"
            icon={<Lock size={14} />}
            disabled={blocked || closing}
            loading={closing}
            title={blocked ? t("fin.blockedHint") : undefined}
            onClick={() => onCloseDay(day)}
          >
            {t("fin.closeDay")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {blocked ? (
          <Callout tone="warn" title={t("fin.blockedBy")}>
            {day.blockingSessions.length > 0 ? (
              <>
                <p>{t("fin.blockedHint")}</p>
                <ul className="mt-2 space-y-0.5 font-mono text-[0.68rem]" dir="ltr">
                  {day.blockingSessions.map((session) => (
                    <li key={session}>{session}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {day.blockingOrderCount > 0 ? (
              <p className={day.blockingSessions.length > 0 ? "mt-2" : undefined}>
                {formatNumber(day.blockingOrderCount, fmt)} {t("fin.blockedByOrders")} —{" "}
                {t("fin.blockedOrdersHint")}
              </p>
            ) : null}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("fin.zNumber")} mono>
            {day.zReportNumber === null ? "—" : `Z-${formatNumber(day.zReportNumber, fmt)}`}
          </DescRow>
          <DescRow label={t("fin.closing")}>
            {day.closedAt ? formatDateTime(day.closedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("common.by")}>
            {day.closedBy ? tx(day.closedBy) : "—"}
          </DescRow>
          <DescRow label={t("fin.grossSales")} mono>
            {formatMoney(day.grossSales, fmt)}
          </DescRow>
          <DescRow label={t("pl.discounts")} mono>
            {formatMoney(day.discounts, fmt)}
          </DescRow>
          <DescRow label={t("pl.refunds")} mono>
            {formatMoney(day.refunds, fmt)}
          </DescRow>
          <DescRow label={t("fin.netSales")} mono>
            {formatMoney(day.netSales, fmt)}
          </DescRow>
          <DescRow label={t("fin.taxAmount")} mono>
            {formatMoney(day.taxTotal, fmt)}
          </DescRow>
          <DescRow label={t("fin.transactionCount")} mono>
            {formatNumber(day.transactionCount, fmt)}
          </DescRow>
          <DescRow label={t("dash.aov")} mono>
            {formatMoney(day.averageOrderValue, fmt)}
          </DescRow>
          <DescRow label={t("fin.voids")} mono>
            {formatNumber(day.voidCount, fmt)}
          </DescRow>
          <DescRow label={t("fin.comps")} mono>
            {formatMoney(day.compValue, fmt)}
          </DescRow>
          <DescRow label={t("wf.cashVariance")} mono>
            <DeltaCell value={-Math.abs(day.cashVariance.amount)}>
              {formatMoney(day.cashVariance, fmt)}
            </DeltaCell>
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fin.paymentsTitle")}</h3>
          <DataTable
            columns={tenderColumns}
            rows={day.tenders}
            rowKey={(row) => row.tender}
            caption={t("fin.paymentsTitle")}
            dense
          />
        </section>

        <Callout tone="muted">{t("fin.zSequenceNote")}</Callout>
      </div>
    </Drawer>
  );
}
