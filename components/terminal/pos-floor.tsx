"use client";

/**
 * Floor plan and the open-order rail — FR-POS-005/006/080/081/083.
 *
 * The floor is the entry point for table service: state, occupancy and
 * time-since-seated at a glance, because service pacing is the thing a
 * manager is actually watching. Takeaway and delivery skip it entirely and
 * start from the order-type row above.
 */

import { useMemo, useState } from "react";
import { Clock, Plus, Users } from "lucide-react";
import type { Id, OrderType, RestaurantTable } from "@/lib/console/types";
import { ORDER_STATE, ORDER_TYPE, TABLE_STATE } from "@/lib/console/labels";
import { formatElapsed, formatMoney } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { openOrdersOf, tablesOf } from "@/lib/console/live/reducer";
import { Badge, Button, Field, Modal, Select, cx } from "@/components/console/ui";

const ORDER_TYPES: OrderType[] = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup"];

const TABLE_TONE: Record<RestaurantTable["state"], string> = {
  available: "border-line bg-raised hover:border-accent",
  seated: "border-accent/50 bg-accent-soft",
  ordered: "border-accent bg-accent-soft",
  food_served: "border-good/50 bg-good-soft",
  bill_requested: "border-warn/60 bg-warn-soft",
  payment_in_progress: "border-warn bg-warn-soft",
  needs_cleaning: "border-line bg-sunken opacity-70",
};

/** Open when a dine-in order is being started; carries the tapped table. */
interface SeatIntent {
  tableId: Id | null;
}

export function PosFloor() {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const now = useNow(15_000);

  const [seatIntent, setSeatIntent] = useState<SeatIntent | null>(null);
  const [area, setArea] = useState<string>("all");

  const tables = useMemo(() => tablesOf(state), [state]);
  const open = useMemo(() => openOrdersOf(state), [state]);

  const areas = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tbl of tables) seen.set(tbl.area.en, tx(tbl.area));
    return [...seen.entries()];
  }, [tables, tx]);

  const visible = tables.filter((tbl) => area === "all" || tbl.area.en === area);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {ORDER_TYPES.map((type) => (
          <Button
            key={type}
            size="sm"
            variant={type === "dine_in" ? "primary" : "secondary"}
            icon={<Plus size={13} />}
            onClick={() =>
              type === "dine_in"
                ? setSeatIntent({ tableId: null })
                : dispatch({
                    type: "ORDER_NEW",
                    orderType: type,
                    tableId: null,
                    guestCount: null,
                  })
            }
          >
            {tx(ORDER_TYPE[type].label)}
          </Button>
        ))}
      </div>

      {open.length > 0 ? (
        <div className="border-line shrink-0 border-b px-3 py-2">
          <p className="text-fg-subtle mb-1.5 text-[0.68rem] font-semibold tracking-wide uppercase">
            {t("pos.openOrders")} · {open.length}
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {open.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => dispatch({ type: "ORDER_SELECT", orderId: order.id })}
                className={cx(
                  "border-line bg-raised hover:border-accent shrink-0 rounded-lg border px-3 py-2 text-start transition-colors",
                  state.activeOrderId === order.id && "border-accent bg-accent-soft",
                )}
              >
                <p className="text-fg font-mono text-xs font-semibold">{order.orderNumber}</p>
                <p className="text-fg-subtle mt-0.5 text-[0.68rem]">
                  {order.tableLabel ?? tx(ORDER_TYPE[order.orderType].label)} ·{" "}
                  {formatMoney(order.grandTotal, fmt, true)}
                </p>
                <div className="mt-1">
                  <Badge tone={ORDER_STATE[order.state].tone}>
                    {tx(ORDER_STATE[order.state].label)}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {areas.length > 1 ? (
        <div className="border-line flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2">
          <AreaChip active={area === "all"} onClick={() => setArea("all")}>
            {t("pos.allCategories")}
          </AreaChip>
          {areas.map(([key, label]) => (
            <AreaChip key={key} active={area === key} onClick={() => setArea(key)}>
              {label}
            </AreaChip>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <p className="text-fg-subtle p-6 text-center text-sm">{t("common.noResults")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {visible.map((tbl) => {
              const seated = tbl.seatedAt ? elapsedSince(tbl.seatedAt, now) : null;
              const order = tbl.orderId ? state.orders[tbl.orderId] : null;
              return (
                <button
                  key={tbl.id}
                  type="button"
                  onClick={() => {
                    if (order) {
                      dispatch({ type: "ORDER_SELECT", orderId: order.id });
                    } else if (tbl.state === "needs_cleaning") {
                      dispatch({ type: "TABLE_STATE", tableId: tbl.id, state: "available" });
                    } else {
                      setSeatIntent({ tableId: tbl.id });
                    }
                  }}
                  className={cx(
                    "flex min-h-20 flex-col items-start gap-1 rounded-xl border p-2.5 text-start transition-colors",
                    TABLE_TONE[tbl.state],
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="text-fg text-sm font-bold">{tbl.label}</span>
                    <span className="text-fg-subtle inline-flex items-center gap-0.5 text-[0.68rem]">
                      <Users size={11} aria-hidden />
                      {tbl.capacity}
                    </span>
                  </span>
                  <span className="text-fg-muted text-[0.68rem] leading-tight">
                    {tx(TABLE_STATE[tbl.state].label)}
                  </span>
                  {seated !== null ? (
                    <span className="text-fg-subtle mt-auto inline-flex items-center gap-0.5 text-[0.68rem] tabular-nums">
                      <Clock size={10} aria-hidden />
                      {formatElapsed(seated)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {seatIntent ? (
        <SeatSheet
          preselected={seatIntent.tableId}
          onClose={() => setSeatIntent(null)}
          onConfirm={(tableId, guests) => {
            dispatch({
              type: "ORDER_NEW",
              orderType: "dine_in",
              tableId,
              guestCount: guests,
            });
            setSeatIntent(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AreaChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line bg-raised text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function SeatSheet({
  preselected,
  onConfirm,
  onClose,
}: {
  preselected: Id | null;
  onConfirm: (tableId: Id, guests: number) => void;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { state } = useLive();

  const free = useMemo(
    () => tablesOf(state).filter((tbl) => tbl.state === "available" || tbl.id === preselected),
    [state, preselected],
  );

  const [tableId, setTableId] = useState<Id>(preselected ?? free[0]?.id ?? "");
  const [guests, setGuests] = useState(2);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.selectTable")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!tableId} onClick={() => onConfirm(tableId, guests)}>
            {t("pos.newOrder")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("pos.selectTable")} required>
          <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            {free.length === 0 ? <option value="">—</option> : null}
            {free.map((tbl) => (
              <option key={tbl.id} value={tbl.id}>
                {tbl.label} · {tx(tbl.area)} · {tbl.capacity} {t("pos.seats")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pos.guests")}>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setGuests(n)}
                className={cx(
                  "h-10 w-10 rounded-lg border text-sm tabular-nums",
                  guests === n
                    ? "border-accent bg-accent-soft text-accent font-semibold"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
