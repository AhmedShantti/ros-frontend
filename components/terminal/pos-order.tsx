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

import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  Gift,
  Percent,
  Send,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import type { Id, Order, OrderLine } from "@/lib/console/types";
import { menuItemById } from "@/lib/console/mock/catalogue";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { formatMoney, formatTime, money } from "@/lib/console/format";
import { ORDER_LINE_STATE, ORDER_STATE, ORDER_TYPE } from "@/lib/console/labels";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { balanceOf } from "@/lib/console/live/engine";
import type { VoidDisposition } from "@/lib/console/live/state";
import { packForBranch, tablesOf } from "@/lib/console/live/reducer";
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

const DISCOUNT_REASONS = [
  { en: "Staff discount", ar: "خصم موظفين" },
  { en: "Service recovery", ar: "تعويض خدمة" },
  { en: "Loyalty tier benefit", ar: "ميزة مستوى الولاء" },
  { en: "Promotional campaign", ar: "حملة ترويجية" },
  { en: "Manager goodwill", ar: "مجاملة من المدير" },
];

const VOID_REASONS = [
  { en: "Customer changed their mind", ar: "غيّر العميل رأيه" },
  { en: "Wrong item entered", ar: "أُدخل صنف خاطئ" },
  { en: "Kitchen unable to prepare", ar: "المطبخ غير قادر على التحضير" },
  { en: "Quality issue", ar: "مشكلة في الجودة" },
];

type Sheet =
  | { kind: "void"; line: OrderLine }
  | { kind: "comp"; line: OrderLine }
  | { kind: "lineDiscount"; line: OrderLine }
  | { kind: "orderDiscount" }
  | { kind: "cancel" }
  | { kind: "move" }
  | null;

export function PosOrderPane({
  order,
  course,
  onCourseChange,
  onPay,
}: {
  order: Order | null;
  course: number;
  onCourseChange: (course: number) => void;
  onPay: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const [sheet, setSheet] = useState<Sheet>(null);

  const pack = packForBranch(state.branchId);

  if (!order) {
    return (
      <aside className="border-line bg-raised flex w-full flex-col border-s lg:w-[26rem]">
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
  const settled = order.state === "completed";

  return (
    <aside className="border-line bg-raised flex w-full min-h-0 flex-col border-s lg:w-[26rem]">
      {/* header */}
      <div className="border-line shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-fg font-mono text-sm font-semibold">{order.orderNumber}</p>
            <p className="text-fg-subtle mt-0.5 text-xs">
              {tx(ORDER_TYPE[order.orderType].label)}
              {order.tableLabel ? ` · ${order.tableLabel}` : ""}
              {order.guestCount ? ` · ${order.guestCount} ${t("pos.guests")}` : ""}
              {" · "}
              {formatTime(order.openedAt, fmt)}
            </p>
          </div>
          <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
        </div>

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
                    .map((line) => (
                      <LineRow
                        key={line.id}
                        order={order}
                        line={line}
                        onSheet={setSheet}
                        settled={settled}
                      />
                    ))}
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
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowRightLeft size={13} />}
            onClick={() => setSheet({ kind: "move" })}
            disabled={order.orderType !== "dine_in"}
          >
            {t("pos.moveTable")}
          </Button>
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
        {settled ? (
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
              disabled={
                pending.length === 0 ||
                (order.orderType === "dine_in" && !order.tableId)
              }
              onClick={() =>
                dispatch({ type: "ORDER_FIRE", orderId: order.id, course: nextCourse })
              }
            >
              {courses.length > 1 && nextCourse !== null
                ? t("pos.fireCourse").replace("{n}", String(nextCourse))
                : t("pos.fire")}
            </Button>
            <Button
              variant="primary"
              icon={<Utensils size={14} />}
              disabled={live.length === 0}
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
              onClick={() => dispatch({ type: "ORDER_PARK", orderId: order.id })}
            >
              {t("pos.park")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="col-span-2"
              icon={<Trash2 size={13} />}
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
      {sheet?.kind === "move" ? (
        <MoveTableSheet order={order} onClose={() => setSheet(null)} />
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------

function LineRow({
  order,
  line,
  onSheet,
  settled,
}: {
  order: Order;
  line: OrderLine;
  onSheet: (sheet: Sheet) => void;
  settled: boolean;
}) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();
  const voided = line.state === "voided";
  const editable = !settled && line.state === "pending";

  return (
    <li className={cx("px-3 py-2", voided && "opacity-55")}>
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
            <p className="text-fg-subtle mt-0.5 text-xs italic">“{line.notes}”</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {line.state !== "pending" ? (
              <Badge tone={ORDER_LINE_STATE[line.state].tone}>
                {tx(ORDER_LINE_STATE[line.state].label)}
              </Badge>
            ) : null}
            {line.isComp ? <Badge tone="warn">{t("pos.comp")}</Badge> : null}
            {line.lineDiscount.amount > 0 ? (
              <Badge tone="bad">−{formatMoney(line.lineDiscount, fmt, true)}</Badge>
            ) : null}
            {line.voidReason ? (
              <span className="text-fg-subtle text-xs">{line.voidReason}</span>
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
        </div>
      </div>

      {!settled && !voided ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 ps-9">
          {editable ? (
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
        </div>
      ) : null}
    </li>
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
  const { dispatch } = useLive();
  const preFire = line.state === "pending";
  const [reason, setReason] = useState(VOID_REASONS[0]!.en);
  const [disposition, setDisposition] = useState<VoidDisposition>("wasted");

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.void")} · ${tx(line.itemNameSnapshot)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            icon={<Ban size={14} />}
            onClick={() => {
              dispatch({
                type: "LINE_VOID",
                orderId: order.id,
                lineId: line.id,
                reason,
                disposition: preFire ? null : disposition,
              });
              onClose();
            }}
          >
            {t("pos.void")}
          </Button>
        </>
      }
    >
      <Callout tone={preFire ? "neutral" : "warn"}>
        {preFire ? t("pos.voidPreFire") : t("pos.voidPostFire")}
      </Callout>

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
  const [reason, setReason] = useState(DISCOUNT_REASONS[1]!.en);

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
            {DISCOUNT_REASONS.map((r) => (
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
// Discount — FR-POS-045/046/047/049
// ---------------------------------------------------------------------------

function DiscountSheet({
  order,
  line,
  onClose,
}: {
  order: Order;
  line: OrderLine | null;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();

  const [percent, setPercent] = useState("10");
  const [reasonEn, setReasonEn] = useState(DISCOUNT_REASONS[0]!.en);
  const [approver, setApprover] = useState("");

  const managers = useMemo(
    () => activeEmployees.filter((e) => /manager|supervisor|head/i.test(e.position.en)),
    [],
  );

  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  const threshold = state.settings.discountApprovalThreshold;
  const needsApproval = value > threshold;
  const reason = DISCOUNT_REASONS.find((r) => r.en === reasonEn)!;

  return (
    <Modal
      open
      onClose={onClose}
      title={line ? t("pos.discountLine") : t("pos.discountOrder")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={value <= 0 || (needsApproval && !approver)}
            onClick={() => {
              const approvedByName = managers.find((m) => m.id === approver)?.name ?? null;
              const discount = {
                percentage: value,
                amountMinor: null,
                reason,
                approvedByName,
              };
              if (line) {
                dispatch({
                  type: "LINE_DISCOUNT",
                  orderId: order.id,
                  lineId: line.id,
                  discount,
                });
              } else {
                dispatch({ type: "ORDER_DISCOUNT", orderId: order.id, discount });
              }
              onClose();
            }}
          >
            {t("pos.apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("pos.discountPercent")}>
          <div className="flex flex-wrap gap-1.5">
            {["5", "10", "15", "20", "25", "50"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(p)}
                className={cx(
                  "rounded-lg border px-3 py-2 text-sm tabular-nums",
                  percent === p
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="mt-2">
            <Input
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-label={t("pos.discountPercent")}
            />
          </div>
        </Field>

        <Field label={t("pos.discountReason")} required>
          <Select value={reasonEn} onChange={(e) => setReasonEn(e.target.value)}>
            {DISCOUNT_REASONS.map((r) => (
              <option key={r.en} value={r.en}>
                {tx(r)}
              </option>
            ))}
          </Select>
        </Field>

        {needsApproval ? (
          <>
            <Callout tone="warn">
              {t("pos.needsApproval").replace("{n}", String(threshold))} — FR-POS-047
            </Callout>
            <Field label={t("pos.approver")} required>
              <Select value={approver} onChange={(e) => setApprover(e.target.value)}>
                <option value="">—</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {tx(m.name)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function CancelSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t } = useI18n();
  const { dispatch } = useLive();
  const [reason, setReason] = useState("");

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
            onClick={() => {
              dispatch({ type: "ORDER_CANCEL", orderId: order.id, reason: reason.trim() });
              onClose();
            }}
          >
            {t("pos.cancelOrder")}
          </Button>
        </>
      }
    >
      <Field label={t("pos.cancelReason")} required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function MoveTableSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const free = tablesOf(state).filter(
    (tbl) => tbl.id !== order.tableId && (tbl.state === "available" || tbl.state === "needs_cleaning"),
  );
  const [tableId, setTableId] = useState<Id>("");

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.moveTable")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!tableId}
            onClick={() => {
              dispatch({ type: "ORDER_MOVE_TABLE", orderId: order.id, tableId });
              onClose();
            }}
          >
            {t("pos.moveTable")}
          </Button>
        </>
      }
    >
      <Field label={t("pos.selectTable")}>
        <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">—</option>
          {free.map((tbl) => (
            <option key={tbl.id} value={tbl.id}>
              {tbl.label} · {tx(tbl.area)} · {tbl.capacity} {t("pos.seats")}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
