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

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { CountLine, CountSession } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  unitLabel,
} from "@/lib/console/format";
import { COUNT_MODE, COUNT_STATUS, labelOf } from "@/lib/console/labels";
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
  Toggle,
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
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useTransientMessage();

  // Locations come from the service so the filter offers real ids.
  const locationList = useAsync(() => services.organisation.locations(), []);
  const locations = locationList.data ?? [];

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
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpening(true)}>
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
          caption={t("inv.countsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <CountDrawer
        session={selected}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <OpenCountDrawer
        open={opening}
        onClose={() => setOpening(false)}
        onOpened={() => {
          setOpening(false);
          setMessage(t("inv.countOpened"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function CountDrawer({
  session,
  onClose,
  onChanged,
}: {
  session: CountSession | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canPost = usePermission("inventory.count.post");
  const canCount = usePermission("inventory.count.perform");
  const action = useAction();
  const [editing, setEditing] = useState<CountLine | null>(null);

  /**
   * Lines are fetched, not read off the row: `GET /inventory/counts` has no
   * list endpoint for them, they hang off `/counts/{id}/lines`, and
   * `counts.get()` is what fans that out.
   */
  const detail = useAsync(
    async () => (session ? services.inventory.counts.get(session.id) : null),
    [session?.id],
  );

  const current = detail.data ?? session;
  const hidden = current ? expectedIsHidden(current) : false;

  async function post() {
    if (!session) return;
    await action.run(() => services.inventory.counts.update(session.id, { status: "posted" }), {
      onSuccess: () => {
        detail.reload();
        onChanged(t("inv.countPosted"));
      },
    });
  }

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

  if (!session || !current) return null;

  const status = labelOf(COUNT_STATUS, current.status);
  const mode = labelOf(COUNT_MODE, current.mode);

  return (
    <Drawer
      open
      onClose={onClose}
      title={current.reference}
      subtitle={tx(current.scope)}
      footer={
        canPost && (current.status === "submitted" || current.status === "counting") ? (
          <Button variant="primary" loading={action.pending} onClick={post}>
            {t("inv.postCount")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {hidden ? <Callout tone="accent">{t("inv.blindNote")}</Callout> : null}

        <DescList>
          <DescRow label={t("common.location")}>{tx(current.locationName)}</DescRow>
          <DescRow label={t("inv.mode")}>
            <Badge tone={mode.tone}>{tx(mode.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("inv.countedBy")}>{tx(current.countedByName)}</DescRow>
          <DescRow label={t("common.created")}>{formatDateTime(current.openedAt, fmt)}</DescRow>
          <DescRow label={t("inv.submitted")}>
            {current.submittedAt ? formatDateTime(current.submittedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.posted")}>
            {current.postedAt ? formatDateTime(current.postedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.flagged")} mono>
            {formatNumber(current.flaggedCount, fmt)} / {formatNumber(current.lineCount, fmt)}
          </DescRow>
          {!hidden ? (
            <DescRow label={t("inv.netVariance")} mono>
              <DeltaCell value={current.netVarianceValue.amount}>
                {formatMoney(current.netVarianceValue, fmt)}
              </DeltaCell>
            </DescRow>
          ) : null}
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("inv.countLines")}</h3>
          <DataTable
            columns={columns}
            rows={current.lines}
            rowKey={(row) => row.id}
            caption={t("inv.countLines")}
            emptyTitle={t("inv.countLines")}
            onRowClick={canCount && current.status !== "posted" ? setEditing : undefined}
            dense
          />

          <RecordCountDrawer
            line={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              detail.reload();
              onChanged(t("inv.countRecorded"));
            }}
          />
        </section>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-042 — record what was actually on the shelf for one line.
 *
 * The expected figure stays hidden while a blind count is in progress, so
 * this form deliberately shows the counter nothing to anchor against.
 */
function RecordCountDrawer({
  line,
  onClose,
  onSaved,
}: {
  line: CountLine | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, locale } = useI18n();
  const action = useAction();
  const [counted, setCounted] = useState("");

  useEffect(() => {
    if (line) setCounted(line.counted?.value ?? "");
  }, [line]);

  if (!line) return null;

  const valid = counted.trim() !== "" && Number.isFinite(Number(counted));

  async function save() {
    if (!line || !valid) return;
    await action.run(() => services.inventory.recordCount(line.id, counted.trim()), {
      onSuccess: onSaved,
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(line.itemName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {line.sku}
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

        <Field
          label={t("inv.counted")}
          hint={`${t("inv.countedHint")} · ${unitLabel(line.expected.unit, locale)}`}
          required
        >
          <Input
            inputMode="decimal"
            dir="ltr"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** FR-INV-041 — open a session and freeze expected quantities for its scope. */
function OpenCountDrawer({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [locationId, setLocationId] = useState("");
  const [blind, setBlind] = useState(true);

  const locations = useAsync(() => services.organisation.locations(), []);

  useEffect(() => {
    const rows = locations.data;
    if (rows && rows.length > 0 && !locationId) setLocationId(rows[0]!.id);
  }, [locations.data, locationId]);

  if (!open) return null;

  async function create() {
    if (!locationId) return;
    await action.run(
      () => services.inventory.counts.create({ locationId, mode: blind ? "blind" : "open" }),
      { onSuccess: onOpened },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("inv.newCount")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!locationId}
            onClick={create}
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted">{t("inv.newCountNote")}</Callout>

        <AsyncPanel state={locations} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <Field label={t("common.location")} required>
              <Select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                disabled={action.pending}
              >
                {rows.map((location) => (
                  <option key={location.id} value={location.id}>
                    {tx(location.name)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>

        <Toggle
          checked={blind}
          onChange={setBlind}
          label={t("inv.blindCount")}
          hint={t("inv.blindNote")}
        />
      </div>
    </Drawer>
  );
}
