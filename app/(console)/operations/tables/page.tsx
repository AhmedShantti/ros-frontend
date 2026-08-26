"use client";

/**
 * Table status — SRS FR-POS-081/083.
 *
 * The floor as the manager sees it: state per table and time since seated,
 * which is the number service pacing is judged on.
 */

import { useMemo, useState } from "react";
import type { RestaurantTable, TableState } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { tablesOf } from "@/lib/console/live/reducer";
import { formatElapsed, formatMoney, formatNumber } from "@/lib/console/format";
import { TABLE_STATE } from "@/lib/console/labels";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { Plus } from "lucide-react";
import { MetricTile } from "@/components/console/charts";
import { Badge, Button, Callout, Card, CardHeader, Toast, cx } from "@/components/console/ui";
import { DataTable } from "@/components/console/data-table";
import { AsyncPanel } from "@/components/console/states";
import { RecordDrawer } from "@/components/console/record-drawer";

const TONE: Record<TableState, string> = {
  available: "border-line bg-raised",
  seated: "border-accent/50 bg-accent-soft",
  ordered: "border-accent bg-accent-soft",
  food_served: "border-good/50 bg-good-soft",
  bill_requested: "border-warn/60 bg-warn-soft",
  payment_in_progress: "border-warn bg-warn-soft",
  needs_cleaning: "border-line bg-sunken",
};

export default function TablesPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const now = useNow(10_000);

  const tables = useMemo(() => tablesOf(state), [state]);

  const byArea = useMemo(() => {
    const groups = new Map<string, typeof tables>();
    for (const table of tables) {
      const list = groups.get(table.area.en) ?? [];
      list.push(table);
      groups.set(table.area.en, list);
    }
    return [...groups.entries()];
  }, [tables]);

  const occupied = tables.filter(
    (table) => table.state !== "available" && table.state !== "needs_cleaning",
  );
  const seats = tables.reduce((s, table) => s + table.capacity, 0);
  const occupiedSeats = occupied.reduce((s, table) => s + table.capacity, 0);

  return (
    <>
      <PageHeader
        title={t("nav.tables")}
        subtitle={t("orders.openOrdersSubtitle")}
        spec="FR-POS-081"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid columns={3}>
          <MetricTile label={t("nav.tables")} value={`${occupied.length} / ${tables.length}`} />
          <MetricTile
            label={t("pos.seats")}
            value={`${occupiedSeats} / ${seats}`}
            footer={
              <span className="text-fg-subtle text-xs">
                {seats > 0 ? `${Math.round((occupiedSeats / seats) * 100)}%` : "—"}
              </span>
            }
          />
          <MetricTile
            label={tx(TABLE_STATE.needs_cleaning.label)}
            value={String(tables.filter((table) => table.state === "needs_cleaning").length)}
          />
        </TileGrid>

        {byArea.map(([areaKey, list]) => (
          <Section key={areaKey} title={tx(list[0]!.area)}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              {list.map((table) => {
                const seated = table.seatedAt ? elapsedSince(table.seatedAt, now) : null;
                const order = table.orderId ? state.orders[table.orderId] : null;
                return (
                  <Card
                    key={table.id}
                    padded={false}
                    className={cx("border p-3", TONE[table.state])}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-fg text-sm font-bold">{table.label}</span>
                      <span className="text-fg-subtle text-xs tabular-nums">{table.capacity}</span>
                    </div>
                    <p className="text-fg-muted mt-1 text-xs">{tx(TABLE_STATE[table.state].label)}</p>
                    {seated !== null ? (
                      <p className="text-fg-subtle mt-1 text-xs tabular-nums">
                        {formatElapsed(seated)}
                      </p>
                    ) : null}
                    {order ? (
                      <p className="text-fg mt-1 font-mono text-[0.68rem]">
                        {order.orderNumber} · {formatMoney(order.grandTotal, fmt, true)}
                      </p>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          </Section>
        ))}

        <Card>
          <CardHeader title={t("common.status")} spec="FR-POS-083" />
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TABLE_STATE) as TableState[]).map((key) => (
              <Badge key={key} tone={TABLE_STATE[key].tone} dot>
                {tx(TABLE_STATE[key].label)} ·{" "}
                {tables.filter((table) => table.state === key).length}
              </Badge>
            ))}
          </div>
        </Card>

        <TableDefinitions />
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The floor plan itself — the tables a branch has, not what is happening on
 * them right now.
 *
 * Live occupancy (seated, bill requested, needs cleaning) has no endpoint:
 * the API models a table's label, section and seat count and nothing about
 * its current state. So the grid above stays on the local engine and this
 * section edits the part the backend actually owns.
 */
function TableDefinitions() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const canManage = usePermission("ops.live.manage");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [message, setMessage] = useTransientMessage();

  const branchId = scope.branchId ?? availableBranches[0]?.id ?? "";

  const tables = useAsync(
    () => services.operations.tables({ scope, limit: 500 }),
    [scope.tenantId, scope.branchId],
  );

  return (
    <Section title={t("ops.tableDefinitions")}>
      <Card>
        <CardHeader
          title={t("ops.tableDefinitions")}
          hint={t("ops.tableDefinitionsNote")}
          spec="FR-BRN-020"
          action={
            canManage && branchId ? (
              <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
                {t("common.new")}
              </Button>
            ) : null
          }
        />

        <AsyncPanel
          state={tables}
          isEmpty={(page) => page.rows.length === 0}
          empty={<Callout tone="muted">{t("ops.noTables")}</Callout>}
        >
          {(page) => (
            <DataTable
              columns={[
                {
                  key: "label",
                  header: t("ops.tableLabel"),
                  render: (row) => <span className="text-fg text-sm">{row.label}</span>,
                },
                {
                  key: "area",
                  header: t("ops.section"),
                  secondary: true,
                  render: (row) => tx(row.area),
                },
                {
                  key: "capacity",
                  header: t("pos.seats"),
                  numeric: true,
                  render: (row) => formatNumber(row.capacity, fmt),
                },
              ]}
              rows={page.rows}
              rowKey={(row) => row.id}
              caption={t("ops.tableDefinitions")}
              onRowClick={canManage ? setEditing : undefined}
              dense
            />
          )}
        </AsyncPanel>
      </Card>

      <RecordDrawer
        open={creating}
        title={t("ops.newTable")}
        fields={[
          { name: "label", label: t("ops.tableLabel"), required: true, maxLength: 24 },
          { name: "section", label: t("ops.section"), maxLength: 48 },
          { name: "capacity", label: t("pos.seats"), kind: "number", initial: "4" },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.operations.createTable(branchId, {
            label: values.label.trim(),
            area: { en: values.section.trim(), ar: values.section.trim() },
            capacity: Number(values.capacity) || 0,
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("ops.tableCreated"));
          tables.reload();
        }}
      />

      <RecordDrawer
        open={editing !== null}
        title={editing?.label ?? ""}
        submitLabel={t("common.save")}
        fields={[
          {
            name: "label",
            label: t("ops.tableLabel"),
            required: true,
            maxLength: 24,
            initial: editing?.label ?? "",
          },
          {
            name: "section",
            label: t("ops.section"),
            maxLength: 48,
            initial: editing ? tx(editing.area) : "",
          },
          {
            name: "capacity",
            label: t("pos.seats"),
            kind: "number",
            initial: String(editing?.capacity ?? 0),
          },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={(values) =>
          services.operations.updateTable(editing?.id ?? "", {
            label: values.label.trim(),
            area: { en: values.section.trim(), ar: values.section.trim() },
            capacity: Number(values.capacity) || 0,
          })
        }
        onDone={() => {
          setEditing(null);
          setMessage(t("ops.tableUpdated"));
          tables.reload();
        }}
      />

      <Toast message={message} />
    </Section>
  );
}
