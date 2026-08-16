"use client";

/**
 * Stock counts — SRS §11.6, UC-INV-01.
 *
 * A blind count hides the expected quantity from the counter (FR-INV-042).
 * That is the entire control: if the counter can see what the system expects,
 * the count stops being evidence and becomes confirmation. So this screen
 * withholds the expected column while a blind session is still open, and
 * reveals it — along with the variance — only once the count is submitted.
 *
 * Posting a count writes count_adjustment movements against the ledger, which
 * is why the flagged-line count matters more than the net variance: offsetting
 * errors net to zero and still mean two items are wrong.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { CountLine, CountSession } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from "@/lib/console/format";
import { COUNT_MODE, COUNT_STATUS, labelOf } from "@/lib/console/labels";
import { stockLocations } from "@/lib/console/mock/org";
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

/** FR-INV-042 — the expected figure stays hidden until the count is in. */
function expectedIsHidden(session: CountSession): boolean {
  return session.mode === "blind" && (session.status === "draft" || session.status === "counting");
}

export default function StockCountsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <CountsScreen />
    </Gate>
  );
}

function CountsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<CountSession | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<CountSession>(
    (query) => services.inventory.counts.list(query),
    { scope, initialSort: "-openedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      open: rows.filter((row) => row.status === "counting" || row.status === "draft").length,
      awaiting: rows.filter((row) => row.status === "submitted").length,
      flagged: rows.reduce((sum, row) => sum + row.flaggedCount, 0),
      netVariance: rows.reduce((sum, row) => sum + row.netVarianceValue.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.netVarianceValue.currency ?? "EGP";

  const columns = useMemo<Column<CountSession>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.scope)}
          />
        ),
      },
      {
        key: "location",
        header: t("common.location"),
        render: (row) => tx(row.locationName),
      },
      {
        key: "mode",
        header: t("inv.mode"),
        render: (row) => {
          const mode = labelOf(COUNT_MODE, row.mode);
          return <Badge tone={mode.tone}>{tx(mode.label)}</Badge>;
        },
      },
      {
        key: "openedAt",
        header: t("common.created"),
        sortable: true,
        secondary: true,
        render: (row) => formatDateTime(row.openedAt, fmt),
      },
      {
        key: "lineCount",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lineCount, fmt),
      },
      {
        key: "flaggedCount",
        header: t("inv.flagged"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.flaggedCount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="text-warn font-semibold">{formatNumber(row.flaggedCount, fmt)}</span>
          ),
      },
      {
        key: "netVarianceValue",
        header: t("inv.netVariance"),
        sortable: true,
        numeric: true,
        render: (row) =>
          expectedIsHidden(row) ? (
            <span className="text-fg-subtle" title={t("inv.blindNote")}>
              ••••
            </span>
          ) : (
            <DeltaCell value={row.netVarianceValue.amount}>
              {formatMoney(row.netVarianceValue, fmt)}
            </DeltaCell>
          ),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(COUNT_STATUS, row.status);
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
        title={t("inv.countsTitle")}
        subtitle={t("inv.countsSubtitle")}
        spec="FR-INV-042"
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
        <Callout tone="muted">{t("inv.blindNote")}</Callout>

        <TileGrid columns={4}>
          <MetricTile label={t("inv.countsOpen")} value={formatNumber(totals.open, fmt)} />
          <MetricTile
            label={t("inv.countsAwaiting")}
            value={formatNumber(totals.awaiting, fmt)}
            spec="FR-INV-047"
          />
          <MetricTile label={t("inv.flagged")} value={formatNumber(totals.flagged, fmt)} />
          <MetricTile
            label={t("inv.netVariance")}
            value={formatMoney({ amount: totals.netVariance, currency }, fmt, true)}
            hint={t("inv.netVarianceHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(COUNT_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "mode",
              label: t("inv.mode"),
              options: Object.entries(COUNT_MODE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "locationId",
              label: t("common.location"),
              options: stockLocations.map((location) => ({
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
          caption={t("inv.countsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <CountDrawer
        session={selected}
        onClose={() => setSelected(null)}
        onPost={() => setMessage(t("common.notInBuild"))}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function CountDrawer({
  session,
  onClose,
  onPost,
}: {
  session: CountSession | null;
  onClose: () => void;
  onPost: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canPost = usePermission("inventory.count.post");
  const hidden = session ? expectedIsHidden(session) : false;

  const columns = useMemo<Column<CountLine>[]>(() => {
    const base: Column<CountLine>[] = [
      {
        key: "item",
        header: t("inv.sku"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.sku}</span>}
          />
        ),
      },
      {
        key: "counted",
        header: t("inv.counted"),
        numeric: true,
        render: (row) =>
          row.counted ? (
            formatQuantity(row.counted, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
    ];

    // Expected and variance only exist once the blind is lifted.
    if (!hidden) {
      base.splice(1, 0, {
        key: "expected",
        header: t("inv.expected"),
        numeric: true,
        render: (row) => formatQuantity(row.expected, fmt),
      });
      base.push(
        {
          key: "varianceQty",
          header: t("common.variance"),
          numeric: true,
          render: (row) => (
            <DeltaCell value={row.varianceQty}>
              {row.varianceQty > 0 ? "+" : ""}
              {formatNumber(row.varianceQty, fmt, 2)}
            </DeltaCell>
          ),
        },
        {
          key: "variancePercent",
          header: "%",
          numeric: true,
          secondary: true,
          render: (row) => (
            <DeltaCell value={row.variancePercent}>
              {formatPercent(row.variancePercent, fmt, 1)}
            </DeltaCell>
          ),
        },
        {
          key: "varianceValue",
          header: t("common.value"),
          numeric: true,
          render: (row) => (
            <DeltaCell value={row.varianceValue.amount}>
              {formatMoney(row.varianceValue, fmt)}
            </DeltaCell>
          ),
        },
      );
    }

    base.push({
      key: "flagged",
      header: t("inv.flagged"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.flagged ? <Badge tone="warn">{t("inv.flagged")}</Badge> : null}
          {row.recount ? <Badge tone="bad">{t("inv.recount")}</Badge> : null}
          {!row.flagged && !row.recount ? <span className="text-fg-subtle">—</span> : null}
        </span>
      ),
    });

    return base;
  }, [t, tx, fmt, hidden]);

  if (!session) return null;

  const status = labelOf(COUNT_STATUS, session.status);
  const mode = labelOf(COUNT_MODE, session.mode);

  return (
    <Drawer
      open
      onClose={onClose}
      title={session.reference}
      subtitle={tx(session.scope)}
      footer={
        canPost && session.status === "submitted" ? (
          <Button variant="primary" onClick={onPost}>
            {t("inv.postCount")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {hidden ? <Callout tone="accent">{t("inv.blindNote")}</Callout> : null}

        <DescList>
          <DescRow label={t("common.location")}>{tx(session.locationName)}</DescRow>
          <DescRow label={t("inv.mode")}>
            <Badge tone={mode.tone}>{tx(mode.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("inv.countedBy")}>{tx(session.countedByName)}</DescRow>
          <DescRow label={t("common.created")}>{formatDateTime(session.openedAt, fmt)}</DescRow>
          <DescRow label={t("inv.submitted")}>
            {session.submittedAt ? formatDateTime(session.submittedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.posted")}>
            {session.postedAt ? formatDateTime(session.postedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.flagged")} mono>
            {formatNumber(session.flaggedCount, fmt)} / {formatNumber(session.lineCount, fmt)}
          </DescRow>
          {!hidden ? (
            <DescRow label={t("inv.netVariance")} mono>
              <DeltaCell value={session.netVarianceValue.amount}>
                {formatMoney(session.netVarianceValue, fmt)}
              </DeltaCell>
            </DescRow>
          ) : null}
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("inv.countLines")}</h3>
          <DataTable
            columns={columns}
            rows={session.lines}
            rowKey={(row) => row.id}
            caption={t("inv.countLines")}
            emptyTitle={t("inv.countLines")}
            dense
          />
        </section>
      </div>
    </Drawer>
  );
}
