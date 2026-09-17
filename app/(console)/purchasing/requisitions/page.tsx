"use client";

/**
 * Purchase requisitions — SRS §12.4.
 *
 * A requisition is a branch saying what it needs; a purchase order is head
 * office committing money to a supplier. Keeping them separate is what makes
 * central purchasing possible: several branches' requisitions consolidate into
 * one order at a better price.
 *
 * Consolidation retains branch attribution (FR-PRC-014). That matters because
 * the cost has to land on the branch that asked for the goods, not on the
 * office that placed the order — otherwise every branch P&L understates its
 * own consumption and central overhead absorbs the difference.
 *
 * Approved requisitions are ticked and consolidated into one order per
 * supplier with that attribution kept (FR-PRC-016); a submitted requisition
 * is approved or rejected from its drawer by anyone except the person who
 * raised it (FR-PRC-019).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { GitMerge, Plus } from "lucide-react";
import type { Requisition, RequisitionLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage, useBranches } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { REQUISITION_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { RequisitionDrawer as RequisitionFormDrawer } from "@/components/console/purchasing-forms";
import { ConsolidateDrawer, RequisitionDecision } from "@/components/console/purchasing-requisitions";
import { usePolicy } from "@/components/console/purchasing-shared";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";

export default function RequisitionsPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <RequisitionsScreen />
    </Gate>
  );
}

function RequisitionsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const [selected, setSelected] = useState<Requisition | null>(null);
  const [message, setMessage] = useTransientMessage();
  const [creating, setCreating] = useState(false);
  // FR-PRC-016 — approved requisitions ticked for consolidation.
  const [picked, setPicked] = useState<Map<string, Requisition>>(new Map());
  const [consolidating, setConsolidating] = useState(false);
  const { policy } = usePolicy();
  const requisitionsSkipped = policy ? !policy.steps.requisition : false;

  function togglePick(row: Requisition) {
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  const collection = useCollection<Requisition>(
    (query) => services.purchasing.requisitions.list(query),
    { scope, initialSort: "-requestedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      awaiting: rows.filter((row) => row.status === "submitted").length,
      ready: rows.filter((row) => row.status === "approved").length,
      value: rows
        .filter((row) => row.status === "submitted" || row.status === "approved")
        .reduce((sum, row) => sum + row.estimatedTotal.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.estimatedTotal.currency ?? "EGP";

  const columns = useMemo<Column<Requisition>[]>(
    () => [
      {
        key: "pick",
        header: <span className="sr-only">{t("prc.cons.pick")}</span>,
        width: "2.5rem",
        render: (row) =>
          row.status === "approved" ? (
            <input
              type="checkbox"
              aria-label={`${t("prc.cons.pick")} ${row.reference}`}
              checked={picked.has(row.id)}
              onClick={(event) => event.stopPropagation()}
              onChange={() => togglePick(row)}
            />
          ) : null,
      },
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
        key: "branch",
        header: t("common.branch"),
        render: (row) => tx(row.branchName),
      },
      {
        key: "requestedAt",
        header: t("pur.requestedBy"),
        sortable: true,
        secondary: true,
        render: (row) => formatDateTime(row.requestedAt, fmt),
      },
      {
        key: "neededBy",
        header: t("pur.neededBy"),
        sortable: true,
        render: (row) => formatDate(row.neededBy, fmt),
      },
      {
        key: "lines",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lines.length, fmt),
      },
      {
        key: "estimatedTotal",
        header: t("pur.estimatedTotal"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.estimatedTotal, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(REQUISITION_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt, picked],
  );

  return (
    <>
      <PageHeader
        title={t("pur.requisitionsTitle")}
        subtitle={t("pur.requisitionsSubtitle")}
        spec="FR-PRC-014"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<GitMerge size={14} />} disabled={picked.size === 0} onClick={() => setConsolidating(true)}>
              {t("prc.cons.action").replace("{n}", String(picked.size))}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              disabled={requisitionsSkipped}
              onClick={() => setCreating(true)}
            >
              {t("common.new")}
            </Button>
          </div>
        }
      />

      <PageBody>
        {requisitionsSkipped ? (
          <Callout tone="warn" title={t("prc.req.skippedTitle")}>
            {t("prc.req.skipped")}{" "}
            <Link href="/purchasing/policy" className="font-medium underline">
              {t("prc.policy.title")}
            </Link>
          </Callout>
        ) : null}
        <Callout tone="muted">{t("prc.cons.hint")}</Callout>
        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.awaitingApproval")}
            value={formatNumber(totals.awaiting, fmt)}
          />
          <MetricTile label={t("pur.readyToConsolidate")} value={formatNumber(totals.ready, fmt)} />
          <MetricTile
            label={t("pur.estimatedTotal")}
            value={formatMoney({ amount: totals.value, currency }, fmt, true)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(REQUISITION_STATUS).map(([value, entry]) => ({
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
          caption={t("pur.requisitionsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <RequisitionDrawer
        requisition={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated, note) => {
          setSelected(updated);
          setMessage(note);
          collection.reload();
        }}
      />
      {consolidating ? (
        <ConsolidateDrawer
          requisitions={[...picked.values()]}
          onClose={() => setConsolidating(false)}
          onDone={(_orders, note) => {
            setConsolidating(false);
            setPicked(new Map());
            setMessage(note);
            collection.reload();
          }}
        />
      ) : null}
      <RequisitionFormDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(note) => {
          setCreating(false);
          setMessage(note);
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function RequisitionDrawer({
  requisition,
  onClose,
  onChanged,
}: {
  requisition: Requisition | null;
  onClose: () => void;
  onChanged: (requisition: Requisition, message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<RequisitionLine>[]>(
    () => [
      {
        key: "item",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "quantity",
        header: t("common.quantity"),
        numeric: true,
        render: (row) => formatQuantity(row.quantity, fmt),
      },
      {
        key: "estimatedCost",
        header: t("pur.estimatedTotal"),
        numeric: true,
        render: (row) => formatMoney(row.estimatedCost, fmt),
      },
    ],
    [t, tx, fmt],
  );

  if (!requisition) return null;

  const status = labelOf(REQUISITION_STATUS, requisition.status);

  return (
    <Drawer
      open
      onClose={onClose}
      title={requisition.reference}
      subtitle={tx(requisition.branchName)}
    >
      <div className="space-y-5">
        {/* FR-PRC-019 */}
        <RequisitionDecision key={`${requisition.id}:${requisition.status}`} requisition={requisition} channel="console" onDone={onChanged} />

        {requisition.status === "consolidated" ? (
          <Callout tone="accent">{t("pur.consolidatedNote")}</Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("pur.requestedBy")}>{tx(requisition.requestedBy)}</DescRow>
          <DescRow label={t("common.date")}>
            {formatDateTime(requisition.requestedAt, fmt)}
          </DescRow>
          <DescRow label={t("pur.neededBy")}>{formatDate(requisition.neededBy, fmt)}</DescRow>
          <DescRow label={t("pur.estimatedTotal")} mono>
            {formatMoney(requisition.estimatedTotal, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          <DataTable
            columns={columns}
            rows={requisition.lines}
            rowKey={(row) => row.id}
            caption={requisition.reference}
            dense
          />
        </section>

        {requisition.notes ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("common.notes")}</h3>
            <p className="text-fg-muted text-sm leading-relaxed">{requisition.notes}</p>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
