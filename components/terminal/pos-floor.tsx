"use client";

/**
 * Floor plan and the open-order rail — FR-POS-005/006/080/081/083/084.
 *
 * The floor is the entry point for table service: state, occupancy, time
 * since seated and time since the last course at a glance, because service
 * pacing is the thing a manager is actually watching. Takeaway and delivery
 * skip it entirely and start from the order-type row above.
 *
 * When the branch has a drawn plan (console → Floor plan) the room is shown
 * as drawn; otherwise, or when the cashier prefers it, as a grid.
 */

import { useEffect, useMemo, useState } from "react";
import { Clock, Link2, Plus, Users, UsersRound, Utensils } from "lucide-react";
import type { Id, OrderType, RestaurantTable, TableState } from "@/lib/console/types";
import { ORDER_STATE, ORDER_TYPE, TABLE_STATE } from "@/lib/console/labels";
import { formatElapsed, formatMoney } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { openOrdersOf, sectionOfTable, tablesOf } from "@/lib/console/live/reducer";
import type { LiveState, ServerSection } from "@/lib/console/live/state";
import { branchById } from "@/lib/console/mock/org";
import { Badge, Button, Callout, Field, Modal, SegmentedControl, Select, Toast, cx } from "@/components/console/ui";
import {
  FixtureBox,
  FloorRoom,
  areaKeyOf,
  areasFor,
  footprint,
  lastCourseAt,
  placedStyle,
  shapeClass,
  useFloorPlan,
} from "@/components/console/floor-canvas";
import { FloorSectionsSheet } from "@/components/terminal/floor-sections";

/**
 * "delivery" stays a valid `OrderType` for historical orders and pricing,
 * but the POS never offers it — dine-in, takeaway, pickup and (branch
 * permitting) drive-through are the only order types a cashier can start.
 */
const BASE_ORDER_TYPES: OrderType[] = ["dine_in", "takeaway", "pickup"];

/** FR-POS-081 — every live state has its own look, legend included. */
export const TABLE_TONE: Record<TableState, string> = {
  available: "border-line bg-raised hover:border-accent",
  seated: "border-accent/50 bg-accent-soft",
  ordered: "border-accent bg-accent-soft",
  food_served: "border-good/50 bg-good-soft",
  bill_requested: "border-warn/60 bg-warn-soft",
  payment_in_progress: "border-warn bg-warn-soft",
  needs_cleaning: "border-line bg-sunken opacity-70",
};

const VIEW_KEY = "ros.pos.floorView";

/** Open when a dine-in order is being started; carries the tapped table. */
interface SeatIntent {
  tableId: Id | null;
}

/**
 * FR-POS-084 — how sections apply to this signed-on server.
 *
 * "Mine" is every section the server is assigned to. A table in nobody's
 * section is open to everyone; one in another server's section is dimmed
 * (highlight) or closed to new seating (restrict).
 */
function useSectionRules(state: LiveState) {
  const me = state.session?.employeeId ?? null;
  const mode = state.settings.sectionMode;
  const sections = state.sections.filter((s) => s.branchId === state.branchId);
  const mine = sections.filter((s) => me !== null && s.serverId === me);
  const myTables = new Set(mine.flatMap((s) => s.tableIds));

  return {
    mode,
    sections,
    mine,
    sectionOf: (tableId: Id) => sectionOfTable(state, tableId),
    dimmed: (tableId: Id) => mode === "highlight" && myTables.size > 0 && !myTables.has(tableId),
    /** Why a new order may not be seated here, or null if it may. */
    refusal: (tableId: Id): ServerSection | null => {
      if (mode !== "restrict") return null;
      const section = sectionOfTable(state, tableId);
      if (!section || !section.serverId || section.serverId === me) return null;
      return section;
    },
  };
}

export function PosFloor() {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const now = useNow(15_000);

  const [seatIntent, setSeatIntent] = useState<SeatIntent | null>(null);
  const [area, setArea] = useState<string>("all");
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"plan" | "grid">("plan");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (stored === "grid" || stored === "plan") setView(stored);
    } catch {
      // Storage blocked — the plan is the default.
    }
  }, []);

  const chooseView = (next: "plan" | "grid") => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A preference that cannot be kept is still honoured for this session.
    }
  };

  const tables = useMemo(() => tablesOf(state), [state]);
  const open = useMemo(() => openOrdersOf(state), [state]);
  const rules = useSectionRules(state);
  const { plan } = useFloorPlan(state.branchId);
  const hasPlan = Boolean(plan && plan.placements.some((p) => tables.some((tbl) => tbl.id === p.tableId)));
  const showPlan = hasPlan && view === "plan";

  const orderTypes = useMemo(() => {
    const driveThroughEnabled = branchById.get(state.branchId)?.driveThroughEnabled ?? false;
    return driveThroughEnabled ? [...BASE_ORDER_TYPES, "drive_thru" as const] : BASE_ORDER_TYPES;
  }, [state.branchId]);

  const areas = useMemo(() => areasFor(tables, plan), [tables, plan]);
  const planArea = areas.find((a) => a.key === area) ?? areas.find((a) => plan?.placements.some((p) => p.areaKey === a.key)) ?? areas[0];

  const visible = tables.filter((tbl) => area === "all" || areaKeyOf(tbl) === area);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  function tap(tbl: RestaurantTable) {
    const order = tbl.orderId ? state.orders[tbl.orderId] : null;
    if (order) {
      // Opening an existing order is never restricted — anyone may help a table.
      dispatch({ type: "ORDER_SELECT", orderId: order.id });
      return;
    }
    if (tbl.state === "needs_cleaning") {
      dispatch({ type: "TABLE_STATE", tableId: tbl.id, state: "available" });
      return;
    }
    // FR-POS-084 — restrict mode: a new party goes to the server whose section it is.
    const refused = rules.refusal(tbl.id);
    if (refused) {
      flash(
        t("floor.restricted")
          .replace("{table}", tbl.label)
          .replace("{section}", refused.name)
          .replace("{server}", refused.serverName ? tx(refused.serverName) : "—"),
      );
      return;
    }
    setSeatIntent({ tableId: tbl.id });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {orderTypes.map((type) => (
          <Button
            key={type}
            size="sm"
            className="min-h-12"
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

      <div className="border-line flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {areas.length > 1 || showPlan ? (
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {showPlan ? null : (
              <AreaChip active={area === "all"} onClick={() => setArea("all")}>
                {t("pos.allCategories")}
              </AreaChip>
            )}
            {areas.map((a) => (
              <AreaChip
                key={a.key}
                active={showPlan ? planArea?.key === a.key : area === a.key}
                onClick={() => setArea(a.key)}
              >
                {tx(a.name)}
              </AreaChip>
            ))}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {rules.mine.length > 0 && rules.mode !== "off" ? (
          <Badge tone="accent" dot>
            {t("floor.mySection")}: {rules.mine.map((s) => s.name).join(", ")}
          </Badge>
        ) : null}
        {hasPlan ? (
          <SegmentedControl
            value={view}
            onChange={chooseView}
            label={t("floor.view")}
            options={[
              { value: "plan", label: t("floor.viewPlan") },
              { value: "grid", label: t("floor.viewGrid") },
            ]}
          />
        ) : null}
        <Button size="sm" className="min-h-12" icon={<UsersRound size={13} />} onClick={() => setSectionsOpen(true)}>
          {t("floor.sections")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {showPlan && planArea && plan ? (
          <div dir="ltr">
            <FloorRoom area={planArea}>
              {plan.fixtures
                .filter((f) => f.areaKey === planArea.key)
                .map((fixture) => (
                  <FixtureBox
                    key={fixture.id}
                    fixture={fixture}
                    area={planArea}
                    label={fixture.label ? tx(fixture.label) : ""}
                    aria-hidden
                  />
                ))}
              {plan.placements.map((placement) => {
                const tbl = tables.find((row) => row.id === placement.tableId);
                if (!tbl || areaKeyOf(tbl) !== planArea.key) return null;
                return (
                  <TableTile
                    key={tbl.id}
                    table={tbl}
                    state={state}
                    now={now}
                    compact
                    shape={shapeClass(placement.shape)}
                    style={placedStyle({ x: placement.x, y: placement.y, ...footprint(placement) }, planArea)}
                    dimmed={rules.dimmed(tbl.id)}
                    section={rules.sectionOf(tbl.id)}
                    onTap={() => tap(tbl)}
                  />
                );
              })}
            </FloorRoom>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-fg-subtle p-6 text-center text-sm">{t("common.noResults")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-4 xl:grid-cols-6">
            {visible.map((tbl) => (
              <TableTile
                key={tbl.id}
                table={tbl}
                state={state}
                now={now}
                dimmed={rules.dimmed(tbl.id)}
                section={rules.sectionOf(tbl.id)}
                onTap={() => tap(tbl)}
              />
            ))}
          </div>
        )}

        {/* FR-POS-081 — the legend, so colour is never the only cue. */}
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("floor.legend")}>
          {(Object.keys(TABLE_STATE) as TableState[]).map((key) => (
            <li
              key={key}
              className={cx("text-fg-muted rounded-md border px-2 py-0.5 text-[0.68rem]", TABLE_TONE[key])}
            >
              {tx(TABLE_STATE[key].label)} · {tables.filter((tbl) => tbl.state === key).length}
            </li>
          ))}
        </ul>
      </div>

      {seatIntent ? (
        <SeatSheet
          preselected={seatIntent.tableId}
          allowed={(id) => rules.refusal(id) === null}
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

      {sectionsOpen ? <FloorSectionsSheet onClose={() => setSectionsOpen(false)} /> : null}

      <Toast message={message} />
    </div>
  );
}

/**
 * One table, on the grid or on the drawn plan.
 *
 * FR-POS-081 — its live state; FR-POS-083 — time since seated and since the
 * last course; FR-POS-082 — a table joined to another's order says whose;
 * FR-POS-084 — its section's colour and whether it is someone else's.
 */
function TableTile({
  table,
  state,
  now,
  compact = false,
  shape = "rounded-xl",
  style,
  dimmed,
  section,
  onTap,
}: {
  table: RestaurantTable;
  state: LiveState;
  now: number;
  compact?: boolean;
  shape?: string;
  style?: React.CSSProperties;
  dimmed: boolean;
  section: ServerSection | null;
  onTap: () => void;
}) {
  const { t, tx } = useI18n();
  const order = table.orderId ? state.orders[table.orderId] : null;
  const joinedTo = order && order.tableId && order.tableId !== table.id ? order.tableLabel : null;
  const seated = table.seatedAt ? elapsedSince(table.seatedAt, now) : null;
  const lastCourse = lastCourseAt(order);
  const sinceCourse = lastCourse ? elapsedSince(lastCourse, now) : null;

  return (
    <button
      type="button"
      onClick={onTap}
      style={{ ...style, ...(section ? { boxShadow: `inset 0 0 0 3px ${section.colour}` } : null) }}
      aria-label={[
        table.label,
        tx(TABLE_STATE[table.state].label),
        section ? `${t("floor.section")} ${section.name}` : null,
        joinedTo ? t("floor.joinedTo").replace("{table}", joinedTo) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cx(
        "flex flex-col border text-start transition-[colors,opacity]",
        compact ? "min-h-12 items-center justify-center gap-0 overflow-hidden p-1 text-center" : "min-h-20 items-start gap-1 p-2.5",
        shape,
        TABLE_TONE[table.state],
        dimmed && "opacity-40",
      )}
    >
      <span className={cx("flex items-center gap-1", compact ? "justify-center" : "w-full justify-between")}>
        <span className={cx("text-fg font-bold", compact ? "text-xs" : "text-sm")}>{table.label}</span>
        {compact ? null : (
          <span className="text-fg-subtle inline-flex items-center gap-0.5 text-[0.68rem]">
            <Users size={11} aria-hidden />
            {table.capacity}
          </span>
        )}
      </span>
      {compact ? null : (
        <span className="text-fg-muted text-[0.68rem] leading-tight">{tx(TABLE_STATE[table.state].label)}</span>
      )}
      {joinedTo ? (
        <span className="text-accent inline-flex items-center gap-0.5 text-[0.62rem] font-medium">
          <Link2 size={10} aria-hidden />
          {joinedTo}
        </span>
      ) : null}
      {seated !== null || sinceCourse !== null ? (
        <span
          className={cx(
            "text-fg-subtle inline-flex flex-wrap items-center gap-x-1.5 tabular-nums",
            compact ? "justify-center text-[0.6rem]" : "mt-auto text-[0.68rem]",
          )}
        >
          {seated !== null ? (
            <span className="inline-flex items-center gap-0.5" title={t("floor.sinceSeated")}>
              <Clock size={10} aria-hidden />
              {formatElapsed(seated)}
            </span>
          ) : null}
          {sinceCourse !== null ? (
            <span className="inline-flex items-center gap-0.5" title={t("floor.sinceLastCourse")}>
              <Utensils size={10} aria-hidden />
              {formatElapsed(sinceCourse)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
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
        "min-h-12 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap",
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
  allowed,
  onConfirm,
  onClose,
}: {
  preselected: Id | null;
  /** FR-POS-084 — whether section rules let this server seat a party here. */
  allowed: (tableId: Id) => boolean;
  onConfirm: (tableId: Id, guests: number) => void;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { state } = useLive();

  const candidates = useMemo(
    () => tablesOf(state).filter((tbl) => tbl.state === "available" || tbl.id === preselected),
    [state, preselected],
  );
  const free = candidates.filter((tbl) => allowed(tbl.id));
  const hidden = candidates.length - free.length;

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
        {hidden > 0 ? <Callout tone="muted">{t("floor.hiddenBySection").replace("{n}", String(hidden))}</Callout> : null}
        <Field label={t("pos.guests")}>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setGuests(n)}
                className={cx(
                  "h-12 w-12 rounded-lg border text-sm tabular-nums",
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
