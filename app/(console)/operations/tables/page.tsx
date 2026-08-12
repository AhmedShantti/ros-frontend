"use client";

/**
 * Table status — SRS FR-POS-081/083.
 *
 * The floor as the manager sees it: state per table and time since seated,
 * which is the number service pacing is judged on.
 */

import { useMemo } from "react";
import type { TableState } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { tablesOf } from "@/lib/console/live/reducer";
import { formatElapsed, formatMoney } from "@/lib/console/format";
import { TABLE_STATE } from "@/lib/console/labels";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge, Card, CardHeader, cx } from "@/components/console/ui";

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
      </PageBody>
    </>
  );
}
