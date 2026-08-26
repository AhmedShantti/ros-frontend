"use client";

/**
 * Stock levels — SRS FR-INV-010.
 *
 * On-hand is read through `services`, so against a backend it is the ledger
 * projection and in demo mode it is the in-memory store. This screen used to
 * read `mock/stock-items` and the live reducer directly, which meant that
 * with a real API configured it showed fixture items at fixture balances —
 * numbers that belonged to nothing.
 *
 * Negative balances are shown, never clamped. A negative is a signal that a
 * receipt was not entered, and hiding it only delays the investigation. The
 * backend computes both that list (FR-INV-014) and the reorder list
 * (FR-INV-066), so neither is re-derived here.
 */

import { useMemo, useState } from "react";
import { PackageSearch, Settings2, TriangleAlert } from "lucide-react";
import type { StockLevel } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatQuantity, unitLabel } from "@/lib/console/format";
import { STOCK_STATUS } from "@/lib/console/labels";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
  cx,
} from "@/components/console/ui";

export default function StockLevelsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <StockLevelsScreen />
    </Gate>
  );
}

function StockLevelsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canConfigure = usePermission("inventory.item.manage");

  const [configuring, setConfiguring] = useState<StockLevel | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<StockLevel>(
    (query) => services.inventory.levels.list(query),
    { scope, pageSize: 50 },
  );

  /**
   * FR-INV-066 and FR-INV-014 are server-side computations, not filters over
   * the page above. Asking for them separately is what makes them correct
   * across the whole tenant rather than across whatever page is loaded.
   */
  const lowStock = useAsync(
    () => services.inventory.lowStock({ scope }),
    [scope.tenantId, scope.branchId],
  );
  const negative = useAsync(
    () => services.inventory.negativeStock({ scope }),
    [scope.tenantId, scope.branchId],
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      value: rows.reduce((sum, row) => sum + row.value.amount, 0),
      currency: rows[0]?.value.currency ?? "EGP",
    };
  }, [collection.rows]);

  const columns = useMemo<Column<StockLevel>[]>(
    () => [
      {
        key: "sku",
        header: t("inv.sku"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.sku}</span>}
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
        key: "onHand",
        header: t("inv.onHand"),
        numeric: true,
        render: (row) => (
          <span className={cx(Number(row.onHand.value) < 0 && "text-bad font-semibold")}>
            {formatQuantity(row.onHand, fmt)}
          </span>
        ),
      },
      {
        key: "reorderPoint",
        header: t("inv.reorderPoint"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.reorderPoint, fmt),
      },
      {
        key: "value",
        header: t("inv.stockValue"),
        numeric: true,
        render: (row) => formatMoney(row.value, fmt, true),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={STOCK_STATUS[row.status].tone}>{tx(STOCK_STATUS[row.status].label)}</Badge>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("inv.levelsTitle")}
        subtitle={t("inv.levelsSubtitle")}
        spec="FR-INV-010"
      />

      <PageBody>
        <TileGrid>
          <MetricTile
            label={t("inv.stockValue")}
            value={formatMoney({ amount: totals.value, currency: totals.currency }, fmt, true)}
          />
          <MetricTile label={t("inv.levelsTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={tx(STOCK_STATUS.low.label)}
            value={formatNumber(lowStock.data?.length ?? 0, fmt)}
            spec="FR-INV-066"
          />
          <MetricTile
            label={tx(STOCK_STATUS.negative.label)}
            value={formatNumber(negative.data?.length ?? 0, fmt)}
            spec="FR-INV-014"
            footer={<span className="text-fg-subtle text-xs">{t("inv.negativeNote")}</span>}
          />
        </TileGrid>

        <CollectionToolbar collection={collection} />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => `${row.itemId}-${row.locationId}`}
          caption={t("inv.levelsTitle")}
          onRowClick={canConfigure ? setConfiguring : undefined}
          activeRowKey={
            configuring ? `${configuring.itemId}-${configuring.locationId}` : null
          }
          dense
        />

        <Section title={t("inv.reorderTitle")}>
          <Card>
            <CardHeader
              title={t("inv.reorderTitle")}
              hint={t("inv.reorderNote")}
              spec="FR-INV-066"
            />
            <AsyncPanel
              state={lowStock}
              isEmpty={(rows) => rows.length === 0}
              empty={
                <Callout tone="good" icon={<PackageSearch size={14} />}>
                  {t("inv.reorderClear")}
                </Callout>
              }
            >
              {(rows) => (
                <DataTable
                  columns={[
                    {
                      key: "item",
                      header: t("inv.sku"),
                      render: (row) => <CellStack primary={tx(row.itemName)} />,
                    },
                    {
                      key: "location",
                      header: t("common.location"),
                      secondary: true,
                      render: (row) => tx(row.locationName),
                    },
                    {
                      key: "onHand",
                      header: t("inv.onHand"),
                      numeric: true,
                      render: (row) => formatQuantity(row.onHand, fmt),
                    },
                    {
                      key: "point",
                      header: t("inv.reorderPoint"),
                      numeric: true,
                      render: (row) =>
                        row.reorderPoint ? formatQuantity(row.reorderPoint, fmt) : "—",
                    },
                    {
                      key: "order",
                      header: t("inv.reorderQuantity"),
                      numeric: true,
                      render: (row) =>
                        row.reorderQuantity ? formatQuantity(row.reorderQuantity, fmt) : "—",
                    },
                  ]}
                  rows={rows}
                  rowKey={(row) => `${row.stockItemId}-${row.locationId}`}
                  caption={t("inv.reorderTitle")}
                  dense
                />
              )}
            </AsyncPanel>
          </Card>
        </Section>

        <Section title={tx(STOCK_STATUS.negative.label)}>
          <Card>
            <CardHeader
              title={tx(STOCK_STATUS.negative.label)}
              hint={t("inv.negativeNote")}
              spec="FR-INV-014"
            />
            <AsyncPanel
              state={negative}
              isEmpty={(rows) => rows.length === 0}
              empty={
                <Callout tone="good" icon={<PackageSearch size={14} />}>
                  {t("inv.negativeClear")}
                </Callout>
              }
            >
              {(rows) => (
                <>
                  <Callout tone="warn" icon={<TriangleAlert size={14} />} className="mb-3">
                    {t("inv.negativeAction")}
                  </Callout>
                  <DataTable
                    columns={[
                      {
                        key: "item",
                        header: t("inv.sku"),
                        render: (row) => <CellStack primary={tx(row.itemName)} />,
                      },
                      {
                        key: "location",
                        header: t("common.location"),
                        secondary: true,
                        render: (row) => tx(row.locationName),
                      },
                      {
                        key: "onHand",
                        header: t("inv.onHand"),
                        numeric: true,
                        render: (row) => (
                          <span className="text-bad font-semibold">
                            {formatQuantity(row.onHand, fmt)}
                          </span>
                        ),
                      },
                    ]}
                    rows={rows}
                    rowKey={(row) => `${row.stockItemId}-${row.locationId}`}
                    caption={tx(STOCK_STATUS.negative.label)}
                    dense
                  />
                </>
              )}
            </AsyncPanel>
          </Card>
        </Section>

        <ReconciliationCard />
      </PageBody>

      <ReorderConfigDrawer
        level={configuring}
        onClose={() => setConfiguring(null)}
        onSaved={() => {
          setConfiguring(null);
          setMessage(t("inv.reorderSaved"));
          lowStock.reload();
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-011/051 — the ledger against the projection it should equal.
 *
 * A divergence means a movement was written without the projection being
 * updated, which is the kind of fault that silently corrupts every costing
 * report downstream. It is worth a panel of its own even when it is empty.
 */
function ReconciliationCard() {
  const { t, tx, fmt } = useI18n();
  const report = useAsync(() => services.inventory.reconciliation(), []);

  return (
    <Section title={t("inv.reconciliationTitle")}>
      <Card>
        <CardHeader
          title={t("inv.reconciliationTitle")}
          hint={t("inv.reconciliationNote")}
          spec="FR-INV-011"
        />

        <AsyncPanel state={report}>
          {(data) => (
            <div className="space-y-3">
              <Callout tone={data.reconciled ? "good" : "bad"}>
                {data.reconciled ? t("inv.reconciled") : t("inv.notReconciled")}
              </Callout>

              {data.note ? <p className="text-fg-subtle text-xs">{data.note}</p> : null}

              {data.divergences.length > 0 ? (
                <DataTable
                  columns={[
                    {
                      key: "item",
                      header: t("inv.sku"),
                      render: (row) => <CellStack primary={tx(row.itemName)} />,
                    },
                    {
                      key: "location",
                      header: t("common.location"),
                      secondary: true,
                      render: (row) => tx(row.locationName),
                    },
                    {
                      key: "ledger",
                      header: t("inv.ledger"),
                      numeric: true,
                      render: (row) => formatQuantity(row.ledger, fmt),
                    },
                    {
                      key: "projected",
                      header: t("inv.projected"),
                      numeric: true,
                      render: (row) => formatQuantity(row.projected, fmt),
                    },
                  ]}
                  rows={data.divergences}
                  rowKey={(row) => `${row.stockItemId}-${row.locationId}`}
                  caption={t("inv.reconciliationTitle")}
                  dense
                />
              ) : null}
            </div>
          )}
        </AsyncPanel>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------

/** FR-INV-065 — per-location reorder point and quantity for one item. */
function ReorderConfigDrawer({
  level,
  onClose,
  onSaved,
}: {
  level: StockLevel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, locale } = useI18n();
  const action = useAction();
  const [reorderPoint, setPoint] = useState("");
  const [reorderQuantity, setQuantity] = useState("");

  // Seeded from the row each time the drawer opens on a different item.
  const key = level ? `${level.itemId}-${level.locationId}` : "";
  const [seededFor, setSeededFor] = useState("");
  if (level && seededFor !== key) {
    setSeededFor(key);
    setPoint(String(level.reorderPoint ?? 0));
    setQuantity(String(level.reorderQuantity ?? 0));
  }

  if (!level) return null;

  const valid =
    Number.isFinite(Number(reorderPoint)) && Number.isFinite(Number(reorderQuantity));

  async function save() {
    if (!level || !valid) return;
    await action.run(
      () =>
        services.inventory.setReorderConfig(level.itemId, {
          locationId: level.locationId,
          reorderPoint: reorderPoint.trim(),
          reorderQuantity: reorderQuantity.trim(),
        }),
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(level.itemName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {level.sku}
        </span>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted" icon={<Settings2 size={14} />}>
          {t("inv.reorderConfigNote")}
        </Callout>

        <DescList>
          <DescRow label={t("common.location")}>{tx(level.locationName)}</DescRow>
          <DescRow label={t("inv.onHand")} mono>
            {formatQuantity(level.onHand, { locale, arabicIndicNumerals: false })}
          </DescRow>
        </DescList>

        <Field
          label={t("inv.reorderPoint")}
          hint={`${t("inv.reorderPointHint")} · ${unitLabel(level.onHand.unit, locale)}`}
          required
        >
          <Input
            inputMode="decimal"
            dir="ltr"
            value={reorderPoint}
            onChange={(event) => setPoint(event.target.value)}
          />
        </Field>

        <Field
          label={t("inv.reorderQuantity")}
          hint={t("inv.reorderQuantityHint")}
          required
        >
          <Input
            inputMode="decimal"
            dir="ltr"
            value={reorderQuantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
