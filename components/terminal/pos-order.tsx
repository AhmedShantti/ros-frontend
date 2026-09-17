"use client";

/**
 * The bill.
 *
 * Everything that changes money passes through here, and every one of those
 * changes is gated on saying why: a discount needs a reason, a void after
 * firing needs a disposition, a comp is recorded as a comp rather than as a
 * hundred-percent discount. None of that is bureaucracy — it is the
 * difference between a variance report that names a cause and one that just
 * says the numbers do not agree.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  Combine,
  Gift,
  Hand,
  Link2,
  Percent,
  Play,
  ScrollText,
  Send,
  Split,
  SquareParking,
  StickyNote,
  Trash2,
  UserCog,
  UserRound,
  Utensils,
  X,
} from "lucide-react";
import type { ApprovalStamp, AuditEntry, Customer, Id, Localised, Order, OrderDiscount, OrderLine } from "@/lib/console/types";
import type { ConsoleKey } from "@/locales";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { CustomerQuickCreate, normalisePhone } from "@/components/console/customer";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { formatDateTime, formatMoney, formatRelative, formatTime, money, numberFromInput } from "@/lib/console/format";
import { ORDER_LINE_STATE, ORDER_STATE, ORDER_TYPE } from "@/lib/console/labels";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { balanceOf, resolveStacking } from "@/lib/console/live/engine";
import type { DiscountPreset, VoidDisposition } from "@/lib/console/live/state";
import {
  NOTE_SEPARATOR,
  activeDiscountsOf,
  isEditable,
  openOrdersOf,
  packForBranch,
  tablesOf,
  type LiveAction,
} from "@/lib/console/live/reducer";
import {
  cancelNeedsApproval,
  discountTriggers,
  voidNeedsApproval,
  worksAt,
  type DiscountTrigger,
} from "@/lib/console/live/approval";
import { useConfirm } from "@/components/console/confirm";
import { ManagerApproval, OrderApprovals, type ApprovalRequestSpec } from "@/components/terminal/pos-approval";
import { PromotionPanel } from "@/components/terminal/pos-promotions";
import { isPromotionDiscount } from "@/lib/console/live/promotions";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Field,
  Input,
  Modal,
  Select,
  SegmentedControl,
  Textarea,
  cx,
} from "@/components/console/ui";

const VOID_REASONS = [
  { en: "Customer changed their mind", ar: "غيّر العميل رأيه" },
  { en: "Wrong item entered", ar: "أُدخل صنف خاطئ" },
  { en: "Kitchen unable to prepare", ar: "المطبخ غير قادر على التحضير" },
  { en: "Quality issue", ar: "مشكلة في الجودة" },
];

/** FR-POS-050 — why something was given free. A comp is service recovery, not pricing. */
const COMP_REASONS = [
  { en: "Service recovery", ar: "تعويض خدمة" },
  { en: "Long wait", ar: "انتظار طويل" },
  { en: "Quality complaint", ar: "شكوى جودة" },
  { en: "Manager goodwill", ar: "مجاملة من المدير" },
];

type Sheet =
  | { kind: "void"; line: OrderLine }
  | { kind: "comp"; line: OrderLine }
  | { kind: "lineDiscount"; line: OrderLine }
  | { kind: "orderDiscount" }
  | { kind: "cancel" }
  | { kind: "table" }
  | { kind: "seat"; line: OrderLine }
  | { kind: "note"; line: OrderLine }
  | { kind: "server" }
  | { kind: "history" }
  | { kind: "customer" }
  | null;

/** How many seat chips to offer: the party, or whatever is already in use. */
function seatCount(order: Order, current: number | null): number {
  const used = order.lines.reduce((max, line) => Math.max(max, line.seatNumber ?? 0), 0);
  return Math.min(20, Math.max(order.guestCount ?? 2, used, current ?? 0, 2));
}

export function PosOrderPane({
  order,
  course,
  onCourseChange,
  seat = null,
  onSeatChange,
  onPay,
}: {
  order: Order | null;
  course: number;
  onCourseChange: (course: number) => void;
  /** FR-POS-004 — the seat new lines are put on; null is shared. */
  seat?: number | null;
  onSeatChange?: (seat: number | null) => void;
  onPay: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const [sheet, setSheet] = useState<Sheet>(null);

  const pack = packForBranch(state.branchId);

  if (!order) {
    return (
      <aside className="border-line bg-raised flex w-full shrink-0 flex-col border-s md:w-80 lg:w-[26rem]">
        <div className="text-fg-subtle grid flex-1 place-items-center p-8 text-center text-sm">
          {t("pos.startPrompt")}
        </div>
      </aside>
    );
  }

  const live = order.lines.filter((l) => l.state !== "voided");
  const pending = live.filter((l) => l.state === "pending");
  const courses = [...new Set(order.lines.map((l) => l.course))].sort((a, b) => a - b);
  const nextCourse = pending.length > 0 ? Math.min(...pending.map((l) => l.course)) : null;
  const balance = balanceOf(order);
  const inclusive = pack.pricingMode === "tax_inclusive";
  // Nothing on a closed order can change, and a parked one waits to be
  // resumed first — either way the editing controls are off.
  const closed = ["completed", "refunded", "partially_refunded", "cancelled", "merged"].includes(order.state);
  const parked = order.state === "parked";
  const settled = closed || parked;
  const dineIn = order.orderType === "dine_in";
  // FR-POS-049 — every record, including the ones taken off again. Promotion
  // records are shown by the promotions panel, grouped by promotion.
  const discounts = order.discounts.filter((d) => !isPromotionDiscount(d));
  const activeDiscounts = activeDiscountsOf(order);
  const mergedInto = order.mergedIntoOrderId ? state.orders[order.mergedIntoOrderId] : null;
  const linkedLabels = (order.linkedTableIds ?? [])
    .map((id) => tablesOf(state).find((tbl) => tbl.id === id)?.label)
    .filter(Boolean);

  // What the kitchen holds for this order: held courses (FR-POS-037) and
  // lines that went out as an addition (FR-POS-038).
  const orderTickets = state.ticketIds
    .map((id) => state.tickets[id]!)
    .filter((ticket) => ticket && ticket.orderId === order.id && ticket.state !== "cancelled");
  const heldCourses = [...new Set(orderTickets.filter((ticket) => ticket.held).map((ticket) => ticket.course))].sort(
    (a, b) => a - b,
  );
  const additionLineIds = new Set(
    orderTickets.filter((ticket) => ticket.amendment).flatMap((ticket) => ticket.lines.map((line) => line.id)),
  );
  const alreadySent = orderTickets.length > 0;
  const blockedByTable = dineIn && !order.tableId;

  // Stacked on a phone the bill would grow with the order and squeeze the menu
  // to nothing, so it is capped at half the viewport there; the lines list
  // inside already scrolls. From `md` it is a fixed-width column again.
  return (
    <aside className="border-line bg-raised flex max-h-[50vh] w-full min-h-0 shrink-0 flex-col border-s md:max-h-none md:w-80 lg:w-[26rem]">
      {/* header */}
      <div className="border-line shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-fg font-mono text-sm font-semibold">{order.orderNumber}</p>
            <p className="text-fg-subtle mt-0.5 text-xs">
              {tx(ORDER_TYPE[order.orderType].label)}
              {order.tableLabel ? ` · ${order.tableLabel}` : ""}
              {linkedLabels.length > 0 ? ` + ${linkedLabels.join(", ")}` : ""}
              {order.guestCount ? ` · ${order.guestCount} ${t("pos.guests")}` : ""}
              {" · "}
              {formatTime(order.openedAt, fmt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setSheet({ kind: "history" })}
              className="text-fg-subtle hover:text-fg rounded p-1"
              aria-label={t("pos.history")}
              title={t("pos.history")}
            >
              <ScrollText size={14} aria-hidden />
            </button>
            <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
          </div>
        </div>

        {/* FR-POS-007 — opened by, served by, and once closed, closed by. */}
        <div className="text-fg-subtle mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem]">
          <span>
            {t("pos.openedBy")} <span className="text-fg-muted">{tx(order.openedByName)}</span>
          </span>
          <button
            type="button"
            disabled={closed}
            onClick={() => setSheet({ kind: "server" })}
            className="hover:text-fg inline-flex items-center gap-1 disabled:pointer-events-none"
          >
            <UserCog size={11} aria-hidden />
            {t("pos.servedBy")} <span className="text-fg-muted">{order.servedByName ? tx(order.servedByName) : "—"}</span>
          </button>
          {order.closedByName ? (
            <span>
              {t("pos.closedBy")} <span className="text-fg-muted">{tx(order.closedByName)}</span>
            </span>
          ) : null}
        </div>

        {/*
          FR-KDS-027 — rush or VIP on the whole order. Every ticket it has in
          the kitchen takes the flag now, and every later firing inherits it.
        */}
        {!closed ? <PriorityChips orderId={order.id} /> : null}

        {/* FR-POS-006 — parked: who, where, when, and the way back. */}
        {parked && order.parked ? (
          <div className="mt-2">
            <Callout tone="warn" icon={<SquareParking size={14} />} title={t("pos.parkedTitle")}>
              {t("pos.parkedBy")
                .replace("{who}", tx(order.parked.byName))
                .replace("{terminal}", order.parked.terminalName)
                .replace("{when}", formatRelative(order.parked.at, fmt))}
            </Callout>
          </div>
        ) : null}

        {/* FR-POS-082 — a merged order points at the one that took its lines. */}
        {order.state === "merged" ? (
          <div className="mt-2">
            <Callout tone="muted" icon={<Link2 size={14} />}>
              {t("pos.mergedInto").replace("{order}", mergedInto?.orderNumber ?? "—")}
            </Callout>
          </div>
        ) : null}

        {order.splitFromOrderId ? (
          <p className="text-fg-subtle mt-1 text-[0.7rem]">
            {t("pos.splitFrom").replace("{order}", state.orders[order.splitFromOrderId]?.orderNumber ?? "—")}
          </p>
        ) : null}

        {/* FR-POS-048 — what is waiting on a manager, and how it came out. */}
        <div className="mt-2">
          <OrderApprovals orderId={order.id} />
        </div>

        {/* FR-CRM-004 — who the order is for, and a way to find out. */}
        <button
          type="button"
          onClick={() => setSheet({ kind: "customer" })}
          disabled={settled && !order.customerId}
          className="border-line hover:bg-sunken mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-50"
        >
          <UserRound size={13} className="text-fg-subtle shrink-0" aria-hidden />
          {order.customerName ? (
            <span className="text-fg min-w-0 flex-1 truncate font-medium">{tx(order.customerName)}</span>
          ) : (
            <span className="text-fg-subtle flex-1">{t("pos.attachCustomer")}</span>
          )}
        </button>

        {order.orderType === "dine_in" && !order.tableId ? (
          <div className="mt-2">
            <Callout tone="warn">{t("pos.tableRequired")}</Callout>
          </div>
        ) : null}
      </div>

      {/* lines */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.lines.length === 0 ? (
          <p className="text-fg-subtle p-6 text-center text-sm">{t("pos.emptyOrder")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {courses.map((c) => (
              <li key={c}>
                {courses.length > 1 ? (
                  <p className="bg-sunken text-fg-subtle px-3 py-1 text-[0.68rem] font-semibold tracking-wide uppercase">
                    {t("pos.course")} {c}
                  </p>
                ) : null}
                <ul className="divide-line divide-y">
                  {order.lines
                    .filter((l) => l.course === c)
                    .map((line, index, list) => {
                      // FR-POS-030 — a combo's components sit under one heading
                      // carrying the combo's name and what it came to.
                      const firstOfCombo =
                        line.combo && list.findIndex((l) => l.combo?.instanceId === line.combo!.instanceId) === index;
                      const comboLines = firstOfCombo
                        ? order.lines.filter((l) => l.combo?.instanceId === line.combo!.instanceId)
                        : [];
                      return (
                        <LineRow
                          key={line.id}
                          order={order}
                          line={line}
                          onSheet={setSheet}
                          settled={settled}
                          addition={additionLineIds.has(line.id)}
                          comboHeader={
                            firstOfCombo
                              ? {
                                  name: line.combo!.name,
                                  totalMinor: comboLines
                                    .filter((l) => l.state !== "voided")
                                    .reduce((sum, l) => sum + l.lineSubtotal.amount, 0),
                                  listMinor: comboLines.reduce((sum, l) => sum + (l.combo?.listPrice.amount ?? 0), 0),
                                }
                              : null
                          }
                        />
                      );
                    })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* course selector for new lines */}
      {!settled ? (
        <div className="border-line flex shrink-0 items-center gap-2 border-t px-3 py-2">
          <span className="text-fg-subtle text-xs">{t("pos.course")}</span>
          <SegmentedControl
            value={String(course)}
            onChange={(v) => onCourseChange(Number(v))}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
            label={t("pos.course")}
          />
          <div className="flex-1" />
          {/* FR-POS-082 — transfer, merge and split, each audited. */}
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowRightLeft size={13} />}
            onClick={() => setSheet({ kind: "table" })}
            disabled={order.orderType !== "dine_in"}
          >
            {t("pos.tableActions")}
          </Button>
        </div>
      ) : null}

      {/* FR-POS-004 — which seat new lines go to. */}
      {!settled && dineIn && onSeatChange ? (
        <div className="border-line flex shrink-0 items-center gap-2 overflow-x-auto border-t px-3 py-2">
          <span className="text-fg-subtle shrink-0 text-xs">{t("pos.seat")}</span>
          <SegmentedControl
            value={seat === null ? "shared" : String(seat)}
            onChange={(v) => onSeatChange(v === "shared" ? null : Number(v))}
            options={[
              { value: "shared", label: t("pos.shared") },
              ...Array.from({ length: seatCount(order, seat) }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              })),
            ]}
            label={t("pos.seat")}
          />
          <button
            type="button"
            onClick={() => onSeatChange(seatCount(order, seat) + 1)}
            className="border-line text-fg-muted hover:text-fg shrink-0 rounded-lg border px-2 py-1 text-xs"
            aria-label={t("pos.addSeat")}
          >
            +
          </button>
        </div>
      ) : null}

      {/* FR-POS-037 — courses the kitchen has but may not start. */}
      {!settled && heldCourses.length > 0 ? (
        <div className="border-line bg-warn-soft/60 flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
          <Hand size={13} className="text-warn" aria-hidden />
          <span className="text-warn flex-1 text-xs font-medium">
            {t("pos.heldCourses").replace("{courses}", heldCourses.join(", "))}
          </span>
          {heldCourses.map((held) => (
            <Button
              key={held}
              size="sm"
              variant="primary"
              icon={<Play size={12} />}
              onClick={() => dispatch({ type: "ORDER_RELEASE_HOLD", orderId: order.id, course: held })}
            >
              {t("pos.releaseCourse").replace("{n}", String(held))}
            </Button>
          ))}
        </div>
      ) : null}

      {/* totals */}
      <div className="border-line shrink-0 border-t px-3 py-2">
        <DescList>
          <DescRow label={t("pos.subtotal")} mono>
            {formatMoney(order.subtotal, fmt)}
          </DescRow>
          {order.discountTotal.amount > 0 ? (
            <DescRow label={t("pos.discountTotal")} mono>
              <span className="text-bad">−{formatMoney(order.discountTotal, fmt)}</span>
            </DescRow>
          ) : null}
          <PromotionPanel order={order} />
          {discounts.length > 0 ? (
            <div className="border-line border-b py-1.5">
              <DiscountLog
                order={order}
                records={discounts}
                activeIds={new Set(activeDiscounts.map((d) => d.id))}
                editable={!settled}
              />
            </div>
          ) : null}
          {order.serviceChargeTotal.amount > 0 ? (
            <DescRow label={`${t("pos.serviceCharge")} ${state.settings.serviceChargePercent}%`} mono>
              {formatMoney(order.serviceChargeTotal, fmt)}
            </DescRow>
          ) : null}
          <DescRow
            label={`${t("pos.tax")}${inclusive ? ` (${t("pos.taxIncluded")})` : ""}`}
            mono
          >
            {formatMoney(order.taxTotal, fmt)}
          </DescRow>
          {order.roundingAdjustment.amount !== 0 ? (
            <DescRow label={t("pos.rounding")} mono>
              {formatMoney(order.roundingAdjustment, fmt)}
            </DescRow>
          ) : null}
          <DescRow label={<span className="text-fg font-semibold">{t("pos.total")}</span>} mono>
            <span className="text-fg text-lg font-bold">
              {formatMoney(
                money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
                fmt,
              )}
            </span>
          </DescRow>
          {order.paidTotal.amount > 0 ? (
            <>
              <DescRow label={t("pos.paid")} mono>
                {formatMoney(order.paidTotal, fmt)}
              </DescRow>
              <DescRow label={t("pos.balance")} mono>
                <span className={balance.amount > 0 ? "text-warn font-semibold" : "text-good"}>
                  {formatMoney(balance, fmt)}
                </span>
              </DescRow>
            </>
          ) : null}
        </DescList>
      </div>

      {/* actions */}
      <div className="border-line grid shrink-0 grid-cols-2 gap-1.5 border-t p-2.5">
        {parked ? (
          <>
            {/* FR-POS-006 — anyone signed on, on any till in the branch. */}
            <Button
              className="col-span-2"
              variant="primary"
              icon={<Play size={14} />}
              onClick={() => dispatch({ type: "ORDER_RESUME", orderId: order.id })}
            >
              {t("pos.resume")}
            </Button>
            <Button className="col-span-2" size="sm" onClick={() => dispatch({ type: "ORDER_SELECT", orderId: null })}>
              {t("pos.backToFloor")}
            </Button>
          </>
        ) : order.state === "merged" && mergedInto ? (
          <Button
            className="col-span-2"
            variant="primary"
            icon={<Link2 size={14} />}
            onClick={() => dispatch({ type: "ORDER_SELECT", orderId: mergedInto.id })}
          >
            {t("pos.openMerged").replace("{order}", mergedInto.orderNumber)}
          </Button>
        ) : settled ? (
          <Button
            className="col-span-2"
            variant="primary"
            onClick={() => dispatch({ type: "ORDER_SELECT", orderId: null })}
          >
            {t("pos.newOrderAfter")}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon={<Send size={14} />}
              data-coach="fire"
              disabled={pending.length === 0 || blockedByTable}
              onClick={() =>
                dispatch({ type: "ORDER_FIRE", orderId: order.id, course: nextCourse })
              }
              title={alreadySent && pending.length > 0 ? t("pos.sendsAsAddition") : undefined}
            >
              {courses.length > 1 && nextCourse !== null
                ? t("pos.fireCourse").replace("{n}", String(nextCourse))
                : alreadySent && pending.length > 0
                  ? t("pos.fireAddition")
                  : t("pos.fire")}
            </Button>
            <Button
              variant="primary"
              icon={<Utensils size={14} />}
              data-coach="pay"
              disabled={live.length === 0 || (order.orderType === "dine_in" && !order.tableId)}
              onClick={onPay}
            >
              {t("pos.pay")}
            </Button>
            <Button
              size="sm"
              icon={<Percent size={13} />}
              disabled={live.length === 0}
              onClick={() => setSheet({ kind: "orderDiscount" })}
            >
              {t("pos.discountOrder")}
            </Button>
            <Button
              size="sm"
              icon={<SquareParking size={13} />}
              data-coach="park"
              onClick={() => dispatch({ type: "ORDER_PARK", orderId: order.id })}
              title={t("pos.parkHint")}
            >
              {t("pos.park")}
            </Button>
            <Button
              size="sm"
              className="col-span-2"
              icon={<Hand size={13} />}
              disabled={pending.length === 0 || blockedByTable}
              onClick={() =>
                dispatch({ type: "ORDER_FIRE", orderId: order.id, course: nextCourse, hold: true })
              }
              title={t("pos.holdFireHint")}
            >
              {nextCourse !== null && courses.length > 1
                ? t("pos.holdFireCourse").replace("{n}", String(nextCourse))
                : t("pos.holdFire")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="col-span-2"
              icon={<Trash2 size={13} />}
              // FR-POS-070 — cancelling is before payment; after it, it is a refund.
              disabled={order.paidTotal.amount > 0}
              title={order.paidTotal.amount > 0 ? t("pos.cancelAfterPayment") : undefined}
              onClick={() => setSheet({ kind: "cancel" })}
            >
              {t("pos.cancelOrder")}
            </Button>
          </>
        )}
      </div>

      {sheet?.kind === "void" ? (
        <VoidSheet order={order} line={sheet.line} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "comp" ? (
        <CompSheet order={order} line={sheet.line} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "lineDiscount" ? (
        <DiscountSheet order={order} line={sheet.line} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "orderDiscount" ? (
        <DiscountSheet order={order} line={null} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "cancel" ? (
        <CancelSheet order={order} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "table" ? (
        <TableActionsSheet order={order} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "note" ? (
        <NoteSheet order={order} line={sheet.line} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "server" ? (
        <ServerSheet order={order} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "history" ? (
        <OrderHistorySheet order={order} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "seat" ? (
        <SeatSheet
          order={order}
          line={sheet.line}
          count={seatCount(order, sheet.line.seatNumber)}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === "customer" ? (
        <CustomerSheet order={order} onClose={() => setSheet(null)} />
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Seats — FR-POS-004
// ---------------------------------------------------------------------------

function SeatSheet({
  order,
  line,
  count,
  onClose,
}: {
  order: Order;
  line: OrderLine;
  count: number;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { dispatch } = useLive();

  const choose = (seat: number | null) => {
    dispatch({ type: "LINE_SEAT", orderId: order.id, lineId: line.id, seat });
    onClose();
  };

  const options: (number | null)[] = [null, ...Array.from({ length: count + 1 }, (_, index) => index + 1)];

  return (
    <Modal open onClose={onClose} title={t("pos.assignSeat").replace("{item}", tx(line.itemNameSnapshot))}>
      <p className="text-fg-muted mb-3 text-xs">{t("pos.assignSeatHint")}</p>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => (
          <button
            key={option ?? "shared"}
            type="button"
            onClick={() => choose(option)}
            className={cx(
              "min-h-14 rounded-xl border text-sm font-semibold transition-colors",
              line.seatNumber === option
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-raised text-fg hover:bg-sunken",
            )}
          >
            {option === null ? t("pos.shared") : `${t("pos.seat")} ${option}`}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Customer — FR-CRM-002, FR-CRM-003, FR-CRM-004
// ---------------------------------------------------------------------------

/**
 * Find a customer by phone, or create one in two fields, and attach them.
 *
 * Attached, the order carries the customer for loyalty and history; the
 * sheet shows what the POS may know about them — visits, spend, the last
 * order, a block — and their orders on this till.
 */
function CustomerSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const action = useAction();
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Customer | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);

  const [current, setCurrent] = useState<Customer | null>(null);

  // The attached customer's record, for the summary.
  useEffect(() => {
    if (!order.customerId) {
      setCurrent(null);
      return;
    }
    let live = true;
    void services.crm.customers
      .get(order.customerId)
      .then((row) => {
        if (live) setCurrent(row);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [order.customerId]);

  const shown = found ?? current;

  async function lookUp() {
    const normalised = normalisePhone(phone);
    if (normalised.length < 8) return;
    setMissing(false);
    await action.run(() => services.crm.customers.findByPhone(normalised), {
      onSuccess: (row) => {
        setFound(row);
        setMissing(row === null);
      },
    });
  }

  function attach(customer: Customer) {
    dispatch({
      type: "ORDER_SET_CUSTOMER",
      orderId: order.id,
      customerId: customer.id,
      customerName: customer.name,
    });
    onClose();
  }

  const history = shown
    ? state.orderIds
        .map((id) => state.orders[id]!)
        .filter((row) => row && row.customerId === shown.id && row.id !== order.id)
        .slice(0, 5)
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.customerTitle")}
      footer={
        <>
          {order.customerId ? (
            <Button
              variant="ghost"
              onClick={() => {
                dispatch({ type: "ORDER_SET_CUSTOMER", orderId: order.id, customerId: null, customerName: null });
                onClose();
              }}
            >
              {t("pos.detachCustomer")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {found && found.id !== order.customerId ? (
            <Button variant="primary" disabled={found.blocked && order.orderType === "delivery"} onClick={() => attach(found)}>
              {t("pos.attach")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {order.state !== "completed" ? (
          <div className="flex gap-2">
            <Input
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookUp();
                }
              }}
              placeholder={t("pos.customerPhone")}
              aria-label={t("pos.customerPhone")}
              className="text-base"
              data-autofocus
            />
            <Button loading={action.pending} onClick={() => void lookUp()} disabled={normalisePhone(phone).length < 8}>
              {t("common.search")}
            </Button>
          </div>
        ) : null}

        {missing ? (
          <Callout tone="muted">
            {t("pos.customerNotFound")}{" "}
            <button type="button" className="font-medium underline" onClick={() => setCreating(true)}>
              {t("pos.createCustomer")}
            </button>
          </Callout>
        ) : null}

        {shown ? (
          <div className="border-line rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-fg text-base font-semibold">{tx(shown.name)}</p>
              <span className="text-fg-muted font-mono text-xs" dir="ltr">
                {shown.phone}
              </span>
            </div>
            {shown.blocked ? (
              <Callout tone="bad" className="mt-2">
                {t("pos.customerBlocked")}
                {shown.blockedReason ? ` — ${shown.blockedReason}` : ""}
              </Callout>
            ) : null}
            <DescList>
              <DescRow label={t("crm.orders")} mono>
                {shown.orderCount}
              </DescRow>
              <DescRow label={t("crm.totalSpend")} mono>
                {formatMoney(shown.totalSpend, fmt)}
              </DescRow>
              <DescRow label={t("crm.lastOrder")}>
                {shown.lastOrderAt ? formatTime(shown.lastOrderAt, fmt) : "—"}
              </DescRow>
              {shown.favouriteItem ? (
                <DescRow label={t("pos.usualOrder")}>{tx(shown.favouriteItem)}</DescRow>
              ) : null}
              <DescRow label={t("pos.loyalty")} mono>
                {shown.loyaltyPoints}
                {shown.loyaltyTier ? ` · ${shown.loyaltyTier}` : ""}
              </DescRow>
            </DescList>
            {history.length > 0 ? (
              <div className="mt-3">
                <p className="text-fg-subtle mb-1 text-[0.68rem] tracking-wide uppercase">{t("pos.onThisTill")}</p>
                <ul className="space-y-1 text-xs">
                  {history.map((row) => (
                    <li key={row.id} className="flex justify-between gap-2">
                      <span className="font-mono">{row.orderNumber}</span>
                      <span className="text-fg-muted">{formatTime(row.openedAt, fmt)}</span>
                      <span className="font-mono tabular-nums">{formatMoney(row.grandTotal, fmt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <CustomerQuickCreate
        open={creating}
        compact
        onClose={() => setCreating(false)}
        onCreated={(customer) => {
          setCreating(false);
          attach(customer);
        }}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function LineRow({
  order,
  line,
  onSheet,
  settled,
  addition,
  comboHeader = null,
}: {
  order: Order;
  line: OrderLine;
  onSheet: (sheet: Sheet) => void;
  settled: boolean;
  /** FR-POS-038 — went to the kitchen as an addition to a course already sent. */
  addition: boolean;
  /** FR-POS-030 — set on the first line of a combo, to head the group. */
  comboHeader?: { name: Localised; totalMinor: number; listMinor: number } | null;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const voided = line.state === "voided";
  const editable = !settled && line.state === "pending";

  return (
    <>
      {comboHeader ? (
        <li className="bg-accent-soft/30 flex items-center justify-between gap-2 px-3 pt-2 pb-1">
          <span className="text-accent text-xs font-semibold">{tx(comboHeader.name)}</span>
          <span className="text-fg-muted font-mono text-xs tabular-nums">
            {formatMoney(money(comboHeader.totalMinor, order.currency), fmt)}
            {comboHeader.listMinor > comboHeader.totalMinor ? (
              <span className="text-fg-subtle ms-1.5 line-through">
                {formatMoney(money(comboHeader.listMinor, order.currency), fmt, true)}
              </span>
            ) : null}
          </span>
        </li>
      ) : null}
    <li className={cx("px-3 py-2", voided && "opacity-55", line.combo && "bg-accent-soft/10 ps-6")}>
      <div className="flex items-start gap-2">
        <span
          className={cx(
            "text-fg w-7 shrink-0 text-center text-sm font-semibold tabular-nums",
            voided && "line-through",
          )}
        >
          {line.quantity}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx("text-fg text-sm leading-snug", voided && "line-through")}>
            {tx(line.itemNameSnapshot)}
          </p>
          {line.modifiers.length > 0 ? (
            <p className="mt-0.5 text-xs leading-snug">
              {line.modifiers.map((m) => (
                <span
                  key={m.id}
                  className={cx(
                    "me-2",
                    m.kind === "removal" ? "text-bad" : "text-accent",
                  )}
                >
                  {m.kind === "removal" ? "− " : m.kind === "addition" ? "+ " : "⇄ "}
                  {tx(m.name)}
                </span>
              ))}
            </p>
          ) : null}
          {line.notes ? (
            <p className="text-fg-subtle mt-0.5 flex items-center gap-1 text-xs italic">
              <StickyNote size={11} className="shrink-0 not-italic" aria-hidden />“{line.notes}”
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {order.orderType === "dine_in" && !voided ? (
              <button
                type="button"
                disabled={settled}
                onClick={() => onSheet({ kind: "seat", line })}
                className={cx(
                  "rounded-full border px-1.5 py-0.5 text-[0.68rem] font-medium transition-colors disabled:opacity-60",
                  line.seatNumber === null
                    ? "border-line text-fg-subtle border-dashed"
                    : "border-accent/40 bg-accent-soft text-accent",
                )}
                aria-label={t("pos.assignSeat").replace("{item}", tx(line.itemNameSnapshot))}
              >
                {line.seatNumber === null ? t("pos.shared") : `${t("pos.seat")} ${line.seatNumber}`}
              </button>
            ) : null}
            {line.state !== "pending" ? (
              <Badge tone={ORDER_LINE_STATE[line.state].tone}>
                {tx(ORDER_LINE_STATE[line.state].label)}
              </Badge>
            ) : null}
            {line.held && line.state === "fired" ? <Badge tone="warn">{t("pos.held")}</Badge> : null}
            {addition ? <Badge tone="accent">{t("pos.addition")}</Badge> : null}
            {line.isComp ? <Badge tone="warn">{t("pos.comp")}</Badge> : null}
            {line.lineDiscount.amount > 0 ? (
              <Badge tone="bad">−{formatMoney(line.lineDiscount, fmt, true)}</Badge>
            ) : null}
            {line.voidReason ? (
              <span className="text-fg-subtle text-xs">{line.voidReason}</span>
            ) : null}
            {/* FR-POS-022 — a modifier priced by a context rule says so. */}
            {line.modifiers.some((m) => m.priceRuleId) ? (
              <Badge tone="muted">{t("pos.contextPrice")}</Badge>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-end">
          <p
            className={cx(
              "text-fg text-sm font-medium tabular-nums",
              (voided || line.isComp) && "line-through",
            )}
          >
            {formatMoney(line.lineSubtotal, fmt)}
          </p>
          {line.combo && line.combo.premium.amount > 0 ? (
            <p className="text-fg-subtle text-[0.65rem]">
              {t("pos.comboPremium").replace("{p}", formatMoney(line.combo.premium, fmt, true))}
            </p>
          ) : null}
        </div>
      </div>

      {!settled && !voided ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 ps-9">
          {/* A combo component's quantity is the combo's. */}
          {editable && !line.combo ? (
            <>
              <IconAction
                label="−"
                onClick={() =>
                  dispatch({
                    type: "LINE_QTY",
                    orderId: order.id,
                    lineId: line.id,
                    quantity: line.quantity - 1,
                  })
                }
                disabled={line.quantity <= 1}
              />
              <IconAction
                label="+"
                onClick={() =>
                  dispatch({
                    type: "LINE_QTY",
                    orderId: order.id,
                    lineId: line.id,
                    quantity: line.quantity + 1,
                  })
                }
              />
            </>
          ) : null}
          <TextAction icon={<Percent size={12} />} onClick={() => onSheet({ kind: "lineDiscount", line })}>
            {t("pos.discount")}
          </TextAction>
          {!line.isComp ? (
            <TextAction icon={<Gift size={12} />} onClick={() => onSheet({ kind: "comp", line })}>
              {t("pos.comp")}
            </TextAction>
          ) : null}
          <TextAction icon={<X size={12} />} onClick={() => onSheet({ kind: "void", line })}>
            {t("pos.void")}
          </TextAction>
          {/* FR-POS-025/026 — only before firing: after that the kitchen has its copy. */}
          {editable && (state.settings.lineNotes || state.settings.noteChips.length > 0) ? (
            <TextAction icon={<StickyNote size={12} />} onClick={() => onSheet({ kind: "note", line })}>
              {t("pos.note")}
            </TextAction>
          ) : null}
        </div>
      ) : null}
    </li>
    </>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="border-line text-fg-muted hover:bg-sunken hover:text-fg h-7 w-7 rounded-lg border text-sm disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function TextAction({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-fg-muted hover:bg-sunken hover:text-fg inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Void — FR-POS-070/071
// ---------------------------------------------------------------------------

function VoidSheet({
  order,
  line,
  onClose,
}: {
  order: Order;
  line: OrderLine;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  // A combo is voided as a unit; the sheet says so and lists what goes.
  const targets = line.combo
    ? order.lines.filter((l) => l.combo?.instanceId === line.combo!.instanceId && l.state !== "voided")
    : [line];
  const preFire = targets.every((l) => l.state === "pending");
  const [reason, setReason] = useState(VOID_REASONS[0]!.en);
  const [disposition, setDisposition] = useState<VoidDisposition>("wasted");
  const [approving, setApproving] = useState(false);
  const needsApproval = voidNeedsApproval(preFire, state.settings);
  const amountMinor = targets.reduce((sum, l) => sum + l.lineTotal.amount, 0);

  const action = (approval: ApprovalStamp | null): LiveAction => ({
    type: "LINE_VOID",
    at: new Date().toISOString(),
    orderId: order.id,
    lineId: line.id,
    reason,
    disposition: preFire ? null : disposition,
    approval,
  });

  const submit = (approval: ApprovalStamp | null) => {
    dispatch(action(approval));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.void")} · ${line.combo ? tx(line.combo.name) : tx(line.itemNameSnapshot)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            icon={<Ban size={14} />}
            onClick={() => (needsApproval ? setApproving(true) : submit(null))}
          >
            {needsApproval ? t("pos.voidWithManager") : t("pos.void")}
          </Button>
        </>
      }
    >
      <Callout tone={preFire ? "neutral" : "warn"}>
        {preFire ? t("pos.voidPreFire") : t("pos.voidPostFire")}
      </Callout>

      {line.combo && targets.length > 1 ? (
        <div className="mt-3">
          <Callout tone="muted" title={t("pos.voidCombo")}>
            {targets.map((l) => tx(l.itemNameSnapshot)).join(" · ")}
          </Callout>
        </div>
      ) : null}

      {needsApproval ? (
        <p className="text-fg-muted mt-3 text-xs">{t("pos.voidNeedsManager")}</p>
      ) : null}

      {approving ? (
        <ManagerApproval
          request={{
            kind: "void",
            summary: {
              en: `Void ${targets.map((l) => l.itemNameSnapshot.en).join(", ")}`,
              ar: `إلغاء ${targets.map((l) => l.itemNameSnapshot.ar).join("، ")}`,
            },
            because: [t(preFire ? "pos.voidPolicyAll" : "pos.voidPolicyPostFire")],
            amountMinor,
            currency: order.currency,
            reason,
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: action(null),
          }}
          onApproved={(stamp) => submit(stamp)}
          onRequested={onClose}
          onClose={() => setApproving(false)}
        />
      ) : null}

      <div className="mt-4 space-y-3">
        <Field label={t("pos.voidReason")} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {VOID_REASONS.map((r) => (
              <option key={r.en} value={r.en}>
                {tx(r)}
              </option>
            ))}
          </Select>
        </Field>

        {!preFire ? (
          <Field label={t("pos.disposition")} hint={t("pos.dispositionNote")} required>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["returned_to_stock", t("pos.dispositionReturn")],
                  ["wasted", t("pos.dispositionWaste")],
                  ["staff_meal", t("pos.dispositionStaff")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDisposition(value)}
                  className={cx(
                    "rounded-lg border px-3 py-2 text-sm",
                    disposition === value
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Comp — FR-POS-050
// ---------------------------------------------------------------------------

function CompSheet({
  order,
  line,
  onClose,
}: {
  order: Order;
  line: OrderLine;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { dispatch } = useLive();
  const [reason, setReason] = useState(COMP_REASONS[0]!.en);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.comp")} · ${tx(line.itemNameSnapshot)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: "LINE_COMP", orderId: order.id, lineId: line.id, reason });
              onClose();
            }}
          >
            {t("pos.comp")}
          </Button>
        </>
      }
    >
      <Callout tone="warn">{t("pos.compNote")}</Callout>
      <div className="mt-4">
        <Field label={t("pos.discountReason")} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {COMP_REASONS.map((r) => (
              <option key={r.en} value={r.en}>
                {tx(r)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Discount — FR-POS-045 … FR-POS-051
// ---------------------------------------------------------------------------

const TRIGGER_KEY: Record<DiscountTrigger, ConsoleKey> = {
  percent: "pos.trigger.percent",
  amount: "pos.trigger.amount",
  count: "pos.trigger.count",
  after_payment: "pos.trigger.afterPayment",
};

/**
 * A discount on one line or on the whole order.
 *
 * The reason is picked from the configured presets (FR-POS-046), which also
 * say whether it is exclusive (FR-POS-051) and fill in a starting value. The
 * sheet then shows, before anything is applied, what the discount comes to,
 * whether it will combine with what is already on the order or replace it,
 * and which approval thresholds it crosses (FR-POS-047). Crossing any of
 * them routes through a manager's PIN, card or remote approval (FR-POS-048)
 * without leaving the order.
 */
function DiscountSheet({
  order,
  line,
  onClose,
}: {
  order: Order;
  line: OrderLine | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const presets = state.settings.discountPresets;

  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const preset: DiscountPreset | undefined = presets.find((p) => p.id === presetId);
  const [kind, setKind] = useState<"percent" | "amount">(preset?.kind ?? "percent");
  const [value, setValue] = useState(preset ? presetValue(preset) : "10");
  const [approving, setApproving] = useState(false);

  function choose(next: DiscountPreset) {
    setPresetId(next.id);
    setKind(next.kind);
    setValue(presetValue(next));
  }

  const base = line
    ? (line.unitPrice.amount + line.modifiers.reduce((s, m) => s + m.priceDelta.amount, 0)) * line.quantity
    : order.lines.filter((l) => l.state !== "voided" && !l.isComp).reduce((s, l) => s + l.lineSubtotal.amount, 0);

  /**
   * `null` when the field is unreadable, so the thresholds below are asked a
   * real question. `Number(x || 0)` produced NaN, and `NaN > threshold` is
   * `false` — the gate was bypassed rather than tripped.
   */
  const parsed = numberFromInput(value);
  const amountMinor =
    parsed === null
      ? null
      : kind === "percent"
        ? Math.round((base * Math.max(0, Math.min(100, parsed))) / 100)
        : Math.min(base, Math.round(parsed * 100));
  const valid = amountMinor !== null && amountMinor > 0 && Boolean(preset);

  const operatorId = state.session?.employeeId ?? "";
  const sessionStart = state.session?.openedAt ?? "";
  const discountsThisShift = Object.values(state.orders)
    .flatMap((o) => o.discounts)
    .filter((d) => d.appliedById === operatorId && d.appliedAt >= sessionStart).length;
  const triggers =
    valid && base > 0
      ? discountTriggers(
          {
            percent: ((amountMinor ?? 0) / base) * 100,
            amountMinor: amountMinor ?? 0,
            discountsThisShift,
            paymentStarted: order.paidTotal.amount > 0,
          },
          state.settings,
        )
      : [];

  // FR-POS-051 — what this does to the discounts already on the order.
  const active = activeDiscountsOf(order);
  const verdict = valid
    ? resolveStacking(
        active.map((d) => ({ id: d.id, amountMinor: d.amount.amount, exclusive: d.exclusive === true })),
        { amountMinor: amountMinor ?? 0, exclusive: preset?.exclusive ?? false },
        state.settings.discountStacking,
      )
    : null;
  const blockedByStacking = verdict?.outcome === "keep_existing";

  const action = (approval: ApprovalStamp | null): LiveAction => {
    const discount = {
      percentage: kind === "percent" ? parsed : null,
      amountMinor: kind === "amount" ? (amountMinor ?? 0) : null,
      reason: preset?.name ?? { en: "Discount", ar: "خصم" },
      presetId: preset?.id ?? null,
      exclusive: preset?.exclusive ?? false,
      approval,
    };
    const at = new Date().toISOString();
    return line
      ? { type: "LINE_DISCOUNT", at, orderId: order.id, lineId: line.id, discount }
      : { type: "ORDER_DISCOUNT", at, orderId: order.id, discount };
  };

  const apply = (approval: ApprovalStamp | null) => {
    dispatch(action(approval));
    onClose();
  };

  const conflictNames = verdict
    ? active.filter((d) => verdict.conflictIds.includes(d.id)).map((d) => tx(d.reason))
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={line ? `${t("pos.discountLine")} · ${tx(line.itemNameSnapshot)}` : t("pos.discountOrder")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid || blockedByStacking}
            onClick={() => (triggers.length > 0 ? setApproving(true) : apply(null))}
          >
            {triggers.length > 0 ? t("pos.applyWithManager") : t("pos.apply")}
            {valid ? ` · −${formatMoney(money(amountMinor ?? 0, order.currency), fmt)}` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("pos.discountReason")} required hint={t("pos.discountReasonHint")}>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={presetId === p.id}
                onClick={() => choose(p)}
                className={cx(
                  "min-h-11 rounded-lg border px-3 py-1.5 text-start text-sm",
                  presetId === p.id
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted hover:text-fg",
                )}
              >
                <span className="block">{tx(p.name)}</span>
                <span className="text-fg-subtle block text-[0.68rem]">
                  {p.kind === "percent" ? `${p.value}%` : formatMoney(money(p.value, order.currency), fmt, true)}
                  {p.exclusive ? ` · ${t("pos.exclusive")}` : ""}
                </span>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
          <Field label={t("pos.discountType")}>
            <SegmentedControl
              value={kind}
              onChange={setKind}
              options={[
                { value: "percent", label: "%" },
                { value: "amount", label: order.currency },
              ]}
            />
          </Field>
          <Field label={kind === "percent" ? t("pos.discountPercent") : t("pos.discountAmount")}>
            <Input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={kind === "percent" ? t("pos.discountPercent") : t("pos.discountAmount")}
            />
          </Field>
        </div>
        {kind === "percent" ? (
          <div className="flex flex-wrap gap-1.5">
            {["5", "10", "15", "20", "25", "50"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setValue(p)}
                className={cx(
                  "min-h-10 rounded-lg border px-3 text-sm tabular-nums",
                  value === p
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                {p}%
              </button>
            ))}
          </div>
        ) : null}

        {valid ? (
          <DescList>
            <DescRow label={t("pos.discountBase")} mono>
              {formatMoney(money(base, order.currency), fmt)}
            </DescRow>
            <DescRow label={t("pos.discountComesTo")} mono>
              <span className="text-bad">−{formatMoney(money(amountMinor ?? 0, order.currency), fmt)}</span>
            </DescRow>
          </DescList>
        ) : null}

        {/* FR-POS-051 — said before it happens, not discovered on the receipt. */}
        {verdict?.outcome === "replace" ? (
          <Callout tone="warn" title={t("pos.stackReplace")}>
            {t("pos.stackReplaceBody")
              .replace("{old}", conflictNames.join(", "))
              .replace("{oldValue}", formatMoney(money(verdict.conflictValueMinor, order.currency), fmt))
              .replace("{newValue}", formatMoney(money(verdict.candidateValueMinor, order.currency), fmt))}
          </Callout>
        ) : blockedByStacking && verdict ? (
          <Callout tone="bad" title={t("pos.stackKeep")}>
            {t("pos.stackKeepBody")
              .replace("{old}", conflictNames.join(", "))
              .replace("{oldValue}", formatMoney(money(verdict.conflictValueMinor, order.currency), fmt))}
          </Callout>
        ) : null}

        {triggers.length > 0 ? (
          <Callout tone="warn" title={t("pos.needsManager")}>
            <ul className="list-disc space-y-0.5 ps-4">
              {triggers.map((trigger) => (
                <li key={trigger}>
                  {t(TRIGGER_KEY[trigger])
                    .replace("{n}", String(state.settings.discountApprovalThreshold))
                    .replace(
                      "{amount}",
                      formatMoney(money(state.settings.discountApprovalAmountMinor, order.currency), fmt),
                    )
                    .replace("{count}", String(state.settings.maxDiscountsPerShift))}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </div>

      {approving && valid ? (
        <ManagerApproval
          request={{
            kind: "discount",
            summary: {
              en: `${preset?.name.en ?? "Discount"} −${((amountMinor ?? 0) / 100).toFixed(2)} ${order.currency}${line ? ` on ${line.itemNameSnapshot.en}` : ""}`,
              ar: `${preset?.name.ar ?? "خصم"} −${((amountMinor ?? 0) / 100).toFixed(2)} ${order.currency}${line ? ` على ${line.itemNameSnapshot.ar}` : ""}`,
            },
            because: triggers.map((trigger) =>
              t(TRIGGER_KEY[trigger])
                .replace("{n}", String(state.settings.discountApprovalThreshold))
                .replace("{amount}", formatMoney(money(state.settings.discountApprovalAmountMinor, order.currency), fmt))
                .replace("{count}", String(state.settings.maxDiscountsPerShift)),
            ),
            amountMinor: amountMinor ?? 0,
            currency: order.currency,
            reason: preset ? tx(preset.name) : "",
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: action(null),
          }}
          onApproved={(stamp) => apply(stamp)}
          onRequested={onClose}
          onClose={() => setApproving(false)}
        />
      ) : null}
    </Modal>
  );
}

function presetValue(preset: DiscountPreset): string {
  return preset.kind === "percent" ? String(preset.value) : (preset.value / 100).toFixed(2);
}

/**
 * FR-POS-049 — every discount on the bill, and who stands behind it.
 *
 * Applied by, approved by and how, when, and for how much. A discount that
 * was replaced by a better exclusive one, or removed, stays in the list
 * struck through with the reason: the till is where a manager checking a
 * complaint looks first.
 */
function DiscountLog({
  order,
  records,
  activeIds,
  editable,
}: {
  order: Order;
  records: OrderDiscount[];
  activeIds: Set<Id>;
  editable: boolean;
}) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();
  const [removing, setRemoving] = useState<OrderDiscount | null>(null);
  const [why, setWhy] = useState("");

  return (
    <>
      <ul className="space-y-1">
        {records.map((record) => {
          const on = activeIds.has(record.id);
          const onLine = record.lineId ? order.lines.find((l) => l.id === record.lineId) : null;
          return (
            <li key={record.id} className={cx("text-[0.7rem] leading-snug", !on && "opacity-60")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cx("text-fg-muted min-w-0 truncate", !on && "line-through")}>
                  {tx(record.reason)}
                  {record.percentage != null ? ` ${record.percentage}%` : ""}
                  {onLine ? ` · ${tx(onLine.itemNameSnapshot)}` : ""}
                  {record.exclusive ? ` · ${t("pos.exclusive")}` : ""}
                </span>
                <span className="text-bad shrink-0 font-mono tabular-nums">−{formatMoney(record.amount, fmt, true)}</span>
              </div>
              <div className="text-fg-subtle flex flex-wrap items-center gap-x-2">
                <span>
                  {t("pos.appliedBy")} {tx(record.appliedBy)} · {formatTime(record.appliedAt, fmt)}
                </span>
                {record.approvedBy ? (
                  <span>
                    {t("orders.approvedBy")} {tx(record.approvedBy)}
                    {record.approvalMethod ? ` (${t(`apv.via.${record.approvalMethod}` as ConsoleKey)})` : ""}
                  </span>
                ) : null}
                {record.removedReason ? <span className="italic">{record.removedReason}</span> : null}
                {on && editable ? (
                  <button type="button" className="hover:text-fg underline" onClick={() => setRemoving(record)}>
                    {t("common.remove")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {removing ? (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title={t("pos.removeDiscount")}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
              <Button
                variant="danger"
                disabled={!why.trim()}
                onClick={() => {
                  dispatch({ type: "DISCOUNT_REMOVE", orderId: order.id, discountId: removing.id, reason: why.trim() });
                  setRemoving(null);
                  setWhy("");
                }}
              >
                {t("common.remove")}
              </Button>
            </>
          }
        >
          <Field label={t("common.reason")} required>
            <Input value={why} onChange={(e) => setWhy(e.target.value)} data-autofocus />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Notes — FR-POS-025, FR-POS-026
// ---------------------------------------------------------------------------

/**
 * A kitchen note on a line not yet sent.
 *
 * Chips first and toggleable, so "no ice" and "separate packaging" combine
 * without typing (FR-POS-026). Free text only where the branch allows it
 * (FR-POS-025); with it switched off the reducer keeps just the chips, so a
 * stale screen cannot sneak free text through either.
 */
function NoteSheet({ order, line, onClose }: { order: Order; line: OrderLine; onClose: () => void }) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const chips = state.settings.noteChips;
  const freeText = state.settings.lineNotes;

  const initial = splitNote(line.notes, chips);
  const [picked, setPicked] = useState<string[]>(initial.chips);
  const [text, setText] = useState(initial.rest);

  const note = [...picked, ...(freeText && text.trim() ? [text.trim()] : [])].join(NOTE_SEPARATOR);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.note")} · ${tx(line.itemNameSnapshot)}`}
      footer={
        <>
          {line.notes ? (
            <Button
              variant="ghost"
              onClick={() => {
                dispatch({ type: "LINE_NOTE", orderId: order.id, lineId: line.id, notes: null });
                onClose();
              }}
            >
              {t("pos.clearNote")}
            </Button>
          ) : null}
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: "LINE_NOTE", orderId: order.id, lineId: line.id, notes: note || null });
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <NoteChips chips={chips} picked={picked} onChange={setPicked} />
        {freeText ? (
          <Field label={t("pos.lineNote")} hint={t("pos.lineNoteHint")}>
            <Input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : (
          <Callout tone="muted">{t("pos.freeNotesOff")}</Callout>
        )}
        {note ? <p className="text-fg-muted text-xs italic">“{note}”</p> : null}
        <p className="text-fg-subtle text-[0.68rem]">FR-POS-025 · FR-POS-026</p>
      </div>
    </Modal>
  );
}

/** The chips, as toggles. Shared with the item sheet in the menu pane. */
export function NoteChips({
  chips,
  picked,
  onChange,
}: {
  chips: Localised[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const { t, tx } = useI18n();
  if (chips.length === 0) return null;
  return (
    <Field label={t("pos.noteChips")}>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const label = tx(chip);
          const on = picked.includes(label);
          return (
            <button
              key={chip.en}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? picked.filter((p) => p !== label) : [...picked, label])}
              className={cx(
                "min-h-10 rounded-full border px-3 text-xs",
                on ? "border-accent bg-accent-soft text-accent font-medium" : "border-line text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/** A stored note, split back into the chips it contains and whatever else was typed. */
export function splitNote(notes: string | null, chips: Localised[]): { chips: string[]; rest: string } {
  if (!notes) return { chips: [], rest: "" };
  const known = new Set(chips.flatMap((chip) => [chip.en, chip.ar]));
  const parts = notes.split(NOTE_SEPARATOR.trim()).map((part) => part.trim()).filter(Boolean);
  return {
    chips: parts.filter((part) => known.has(part)),
    rest: parts.filter((part) => !known.has(part)).join(" "),
  };
}

// ---------------------------------------------------------------------------
// Server — FR-POS-007
// ---------------------------------------------------------------------------

function ServerSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const staff = useMemo(
    () =>
      activeEmployees.filter(
        (e) => worksAt(e, state.branchId) && /waiter|cashier|supervisor|manager/i.test(e.position.en),
      ),
    [state.branchId],
  );

  return (
    <Modal open onClose={onClose} title={t("pos.changeServer")}>
      <p className="text-fg-muted mb-3 text-xs">{t("pos.changeServerHint")}</p>
      <ul className="border-line divide-line max-h-80 divide-y overflow-y-auto rounded-lg border">
        {staff.map((employee) => (
          <li key={employee.id}>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "ORDER_SET_SERVER", orderId: order.id, serverId: employee.id });
                onClose();
              }}
              className={cx(
                "hover:bg-sunken flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm",
                order.servedBy === employee.id && "bg-accent-soft/50",
              )}
            >
              <span className="text-fg">{tx(employee.name)}</span>
              <span className="text-fg-subtle text-xs">{tx(employee.position)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// History — FR-POS-075
// ---------------------------------------------------------------------------

/**
 * Every audit entry this order has, on the till.
 *
 * Voids, cancellations and refunds carry the actor, the approver, the
 * reason, the amount and the whole order before and after (FR-POS-075);
 * this is where the person at the till can see that record without leaving
 * for the console's audit log, which holds the same entries.
 */
function OrderHistorySheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const [open, setOpen] = useState<Id | null>(null);

  const lineIds = new Set(order.lines.map((l) => l.id));
  const entries: AuditEntry[] = state.audit.filter(
    (entry) =>
      entry.entityId === order.id ||
      lineIds.has(entry.entityId) ||
      (entry.entityType === "approval_request" &&
        (entry.after as { orderNumber?: string } | null)?.orderNumber === order.orderNumber),
  );

  return (
    <Modal open onClose={onClose} wide title={`${t("pos.history")} · ${order.orderNumber}`}>
      {entries.length === 0 ? (
        <p className="text-fg-subtle text-sm">{t("pos.historyEmpty")}</p>
      ) : (
        <ol className="border-line divide-line divide-y rounded-lg border">
          {entries.map((entry) => {
            const amount = (entry.after as { amount?: number } | null)?.amount;
            return (
              <li key={entry.id} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-start"
                >
                  <span className="text-fg font-mono text-xs">{entry.action}</span>
                  <span className="text-fg-subtle text-xs tabular-nums">{formatDateTime(entry.occurredAt, fmt)}</span>
                </button>
                <div className="text-fg-muted mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  <span>{tx(entry.actorName)}</span>
                  {entry.approverName ? (
                    <span>
                      {t("orders.approvedBy")} {tx(entry.approverName)}
                    </span>
                  ) : null}
                  {typeof amount === "number" ? (
                    <span className="font-mono tabular-nums">{formatMoney(money(amount, order.currency), fmt)}</span>
                  ) : null}
                  {entry.reasonText ? <span className="italic">“{entry.reasonText}”</span> : null}
                </div>
                {open === entry.id && (entry.before || entry.after) ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {entry.before ? (
                      <pre className="bg-sunken text-fg-muted max-h-56 overflow-auto rounded p-2 text-[0.65rem]" dir="ltr">
                        {JSON.stringify(entry.before, null, 2)}
                      </pre>
                    ) : null}
                    {entry.after ? (
                      <pre className="bg-sunken text-fg-muted max-h-56 overflow-auto rounded p-2 text-[0.65rem]" dir="ltr">
                        {JSON.stringify(entry.after, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-fg-subtle mt-3 text-[0.68rem]">FR-POS-075 · FR-AUD-006</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cancel — FR-POS-070, FR-POS-075
// ---------------------------------------------------------------------------

function CancelSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t } = useI18n();
  const { state, dispatch } = useLive();
  const [reason, setReason] = useState("");
  const [approving, setApproving] = useState(false);
  const needsApproval = cancelNeedsApproval(order, state.settings);

  const action = (approval: ApprovalStamp | null): LiveAction => ({
    type: "ORDER_CANCEL",
    at: new Date().toISOString(),
    orderId: order.id,
    reason: reason.trim(),
    approval,
  });
  const submit = (approval: ApprovalStamp | null) => {
    dispatch(action(approval));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.cancelOrder")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0}
            onClick={() => (needsApproval ? setApproving(true) : submit(null))}
          >
            {needsApproval ? t("pos.cancelWithManager") : t("pos.cancelOrder")}
          </Button>
        </>
      }
    >
      {needsApproval ? (
        <div className="mb-3">
          <Callout tone="warn">{t("pos.cancelNeedsManager")}</Callout>
        </div>
      ) : null}
      <Field label={t("pos.cancelReason")} required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {approving ? (
        <ManagerApproval
          request={{
            kind: "cancel",
            summary: { en: `Cancel ${order.orderNumber}`, ar: `إلغاء ${order.orderNumber}` },
            because: [t("pos.cancelNeedsManager")],
            amountMinor: order.grandTotal.amount,
            currency: order.currency,
            reason: reason.trim(),
            orderId: order.id,
            orderNumber: order.orderNumber,
            action: action(null),
          }}
          onApproved={(stamp) => submit(stamp)}
          onRequested={onClose}
          onClose={() => setApproving(false)}
        />
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Table — FR-POS-082
// ---------------------------------------------------------------------------

/**
 * Transfer, merge and split — the three things that happen to a table's
 * order mid-service. Each is its own reducer action with its own audit entry.
 */
function TableActionsSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const [mode, setMode] = useState<"transfer" | "merge" | "split" | "join">("transfer");
  const [joinId, setJoinId] = useState<Id>("");
  const [tableId, setTableId] = useState<Id>("");
  const [mergeId, setMergeId] = useState<Id>("");
  const [lineIds, setLineIds] = useState<Id[]>([]);
  const [splitTo, setSplitTo] = useState<"same" | Id>("same");

  const free = tablesOf(state).filter(
    (tbl) => tbl.id !== order.tableId && (tbl.state === "available" || tbl.state === "needs_cleaning"),
  );
  const available = tablesOf(state).filter((tbl) => tbl.state === "available" && tbl.id !== order.tableId);
  const mergeable = openOrdersOf(state).filter(
    (other) => other.id !== order.id && other.orderType === "dine_in" && other.tableId && isEditable(other) && other.paidTotal.amount === 0,
  );
  const paid = order.paidTotal.amount > 0;
  const liveLines = order.lines.filter((l) => l.state !== "voided");
  const canSplit = !paid && liveLines.length > 1;

  const run = () => {
    if (mode === "transfer" && tableId) dispatch({ type: "ORDER_MOVE_TABLE", orderId: order.id, tableId });
    if (mode === "merge" && mergeId) dispatch({ type: "ORDER_MERGE", targetOrderId: order.id, sourceOrderId: mergeId });
    // FR-POS-082 — merge tables physically: a free table joins this order.
    if (mode === "join" && joinId) dispatch({ type: "ORDER_LINK_TABLE", orderId: order.id, tableId: joinId });
    if (mode === "split" && lineIds.length > 0) {
      dispatch({ type: "ORDER_SPLIT", orderId: order.id, lineIds, tableId: splitTo === "same" ? null : splitTo });
    }
    onClose();
  };

  const ready =
    (mode === "transfer" && Boolean(tableId)) ||
    (mode === "merge" && Boolean(mergeId) && !paid) ||
    (mode === "join" && Boolean(joinId)) ||
    (mode === "split" && canSplit && lineIds.length > 0 && lineIds.length < liveLines.length);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.tableActions")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready} onClick={run}>
            {mode === "transfer"
              ? t("pos.moveTable")
              : mode === "merge"
                ? t("pos.mergeTables")
                : mode === "join"
                  ? t("floor.joinTable")
                  : t("pos.splitOrder")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "transfer", label: t("pos.moveTable") },
            { value: "merge", label: t("pos.mergeTables") },
            { value: "split", label: t("pos.splitOrder") },
            { value: "join", label: t("floor.joinTable") },
          ]}
          label={t("pos.tableActions")}
        />

        {mode === "join" ? (
          <JoinTables order={order} joinId={joinId} onPick={setJoinId} onDone={onClose} />
        ) : mode === "transfer" ? (
          <Field label={t("pos.selectTable")} hint={t("pos.transferHint")}>
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">—</option>
              {free.map((tbl) => (
                <option key={tbl.id} value={tbl.id}>
                  {tbl.label} · {tx(tbl.area)} · {tbl.capacity} {t("pos.seats")}
                </option>
              ))}
            </Select>
          </Field>
        ) : mode === "merge" ? (
          <>
            {paid ? <Callout tone="warn">{t("pos.mergePaid")}</Callout> : null}
            <Field label={t("pos.mergeWhich")} hint={t("pos.mergeHint").replace("{order}", order.orderNumber)}>
              {mergeable.length === 0 ? (
                <Callout tone="muted">{t("pos.mergeNone")}</Callout>
              ) : (
                <div className="space-y-1.5">
                  {mergeable.map((other) => (
                    <button
                      key={other.id}
                      type="button"
                      aria-pressed={mergeId === other.id}
                      onClick={() => setMergeId(other.id)}
                      className={cx(
                        "flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm",
                        mergeId === other.id ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Combine size={14} className="text-fg-subtle" aria-hidden />
                        <span className="text-fg font-medium">{other.tableLabel}</span>
                        <span className="text-fg-subtle font-mono text-xs">{other.orderNumber}</span>
                      </span>
                      <span className="text-fg-muted font-mono text-xs tabular-nums">
                        {formatMoney(other.grandTotal, fmt, true)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </>
        ) : (
          <>
            {!canSplit ? <Callout tone="warn">{paid ? t("pos.splitPaid") : t("pos.splitTooSmall")}</Callout> : null}
            <Field label={t("pos.splitWhich")} hint={t("pos.splitHint")}>
              <ul className="border-line divide-line max-h-56 divide-y overflow-y-auto rounded-lg border">
                {liveLines.map((line) => {
                  const on = lineIds.includes(line.id);
                  return (
                    <li key={line.id}>
                      <label className="hover:bg-sunken flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canSplit}
                          onChange={() => {
                            // A combo's components move together.
                            const group = line.combo
                              ? liveLines.filter((l) => l.combo?.instanceId === line.combo!.instanceId).map((l) => l.id)
                              : [line.id];
                            setLineIds((current) =>
                              on ? current.filter((id) => !group.includes(id)) : [...new Set([...current, ...group])],
                            );
                          }}
                          className="accent-accent h-4 w-4"
                        />
                        <span className="text-fg min-w-0 flex-1 truncate text-sm">
                          {line.quantity} × {tx(line.itemNameSnapshot)}
                          {line.combo ? <span className="text-accent ms-1.5 text-xs">{tx(line.combo.name)}</span> : null}
                        </span>
                        <span className="text-fg-muted font-mono text-xs tabular-nums">
                          {formatMoney(line.lineSubtotal, fmt, true)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Field>
            <Field label={t("pos.splitTo")}>
              <Select value={splitTo} onChange={(e) => setSplitTo(e.target.value)}>
                <option value="same">{t("pos.splitSameTable").replace("{table}", order.tableLabel ?? "—")}</option>
                {available.map((tbl) => (
                  <option key={tbl.id} value={tbl.id}>
                    {tbl.label} · {tx(tbl.area)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-fg-subtle flex items-center gap-1.5 text-xs">
              <Split size={12} aria-hidden /> {t("pos.splitNote")}
            </p>
          </>
        )}
        <p className="text-fg-subtle text-[0.68rem]">FR-POS-082</p>
      </div>
    </Modal>
  );
}


/**
 * FR-POS-082 — join a free table to this order, or release one already joined.
 *
 * Merging two bills is `ORDER_MERGE`; this is the physical half of "merge
 * tables" — a party that outgrew its table. Both directions are audited by
 * the reducer; releasing a table is confirmed first because the table goes
 * to needs-cleaning straight away.
 */
function JoinTables({
  order,
  joinId,
  onPick,
  onDone,
}: {
  order: Order;
  joinId: Id;
  onPick: (tableId: Id) => void;
  onDone: () => void;
}) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const confirm = useConfirm();
  const all = tablesOf(state);
  const joined = (order.linkedTableIds ?? [])
    .map((id) => all.find((tbl) => tbl.id === id))
    .filter((tbl): tbl is NonNullable<typeof tbl> => Boolean(tbl));
  const free = all.filter((tbl) => tbl.state === "available" && tbl.id !== order.tableId);

  async function unjoin(tableId: Id, label: string) {
    const ok = await confirm({
      title: t("floor.unjoinTitle").replace("{table}", label),
      body: t("floor.unjoinBody"),
      tone: "warn",
      confirmLabel: t("floor.unjoin"),
    });
    if (!ok) return;
    dispatch({ type: "ORDER_UNLINK_TABLE", orderId: order.id, tableId });
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label={t("pos.selectTable")} hint={t("floor.joinHint").replace("{table}", order.tableLabel ?? "—")}>
        {free.length === 0 ? (
          <Callout tone="muted">{t("floor.joinNone")}</Callout>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {free.map((tbl) => (
              <button
                key={tbl.id}
                type="button"
                aria-pressed={joinId === tbl.id}
                onClick={() => onPick(tbl.id)}
                className={cx(
                  "flex min-h-12 flex-col items-center justify-center rounded-lg border px-2 text-sm",
                  joinId === tbl.id ? "border-accent bg-accent-soft text-fg font-semibold" : "border-line text-fg-muted",
                )}
              >
                {tbl.label}
                <span className="text-fg-subtle text-[0.62rem]">
                  {tx(tbl.area)} · {tbl.capacity}
                </span>
              </button>
            ))}
          </div>
        )}
      </Field>
      {joined.length > 0 ? (
        <Field label={t("floor.joinedTables")}>
          <ul className="space-y-1.5">
            {joined.map((tbl) => (
              <li key={tbl.id} className="border-line flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5">
                <span className="text-fg text-sm font-medium">{tbl.label}</span>
                <Button className="min-h-12" onClick={() => void unjoin(tbl.id, tbl.label)}>
                  {t("floor.unjoin")}
                </Button>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
    </div>
  );
}

/** FR-KDS-027 — Normal / Rush / VIP for an order, at 48px targets. */
function PriorityChips({ orderId }: { orderId: Id }) {
  const { t } = useI18n();
  const { state, dispatch } = useLive();
  const current = state.priorities?.[orderId] ?? "normal";
  const options: { value: "normal" | "rush" | "vip"; label: string; on: string }[] = [
    { value: "normal", label: t("floor.priorityNormal"), on: "border-accent bg-accent-soft text-accent" },
    { value: "rush", label: t("floor.priorityRush"), on: "border-bad bg-bad-soft text-bad" },
    { value: "vip", label: t("floor.priorityVip"), on: "border-warn bg-warn-soft text-warn" },
  ];
  return (
    <div role="radiogroup" aria-label={t("floor.priority")} className="mt-2 grid grid-cols-3 gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={current === option.value}
          onClick={() => dispatch({ type: "ORDER_PRIORITY", orderId, priority: option.value })}
          className={cx(
            "min-h-12 rounded-lg border px-2 text-xs font-semibold transition-colors",
            current === option.value ? option.on : "border-line text-fg-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
