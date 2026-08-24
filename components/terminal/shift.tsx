"use client";

/**
 * Shift and drawer — FR-POS-090 to FR-POS-097.
 *
 * The controls here exist because of specific ways cash goes missing. The
 * opening float is declared before the first sale so there is a baseline to
 * measure against. Safe drops are prompted by a drawer limit rather than
 * left to judgement. And the close is a blind count: if the cashier can see
 * the expected figure first, a shortage can be "counted" away, which is why
 * blind is the default rather than an option.
 */

import { useMemo, useState } from "react";
import { Banknote, ClipboardCheck, Lock, Wallet } from "lucide-react";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { branchById } from "@/lib/console/mock/org";
import type { DenominationCount, TenderType } from "@/lib/console/types";
import {
  countFromInput,
  formatMoney,
  formatTime,
  minorFromInput,
  money,
  tx as pick,
} from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { completedOrdersOf } from "@/lib/console/live/reducer";
import { TENDER_TYPE } from "@/lib/console/labels";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Field,
  Input,
  Modal,
  Select,
  SpecTag,
  Textarea,
  cx,
} from "@/components/console/ui";

/** Egyptian notes and coins, in minor units, largest first. */
const DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25];

const MOVEMENT_LABEL = {
  pay_in: "shift.payIn",
  pay_out: "shift.payOut",
  safe_drop: "shift.safeDrop",
} as const;

// ---------------------------------------------------------------------------
// Open shift
// ---------------------------------------------------------------------------

export function ShiftGate() {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();

  const roster = useMemo(() => {
    const local = activeEmployees.filter((e) => e.homeBranchId === state.branchId);
    return local.length > 0 ? local : activeEmployees.slice(0, 8);
  }, [state.branchId]);

  const [employeeId, setEmployeeId] = useState("");
  const [float, setFloat] = useState("1000");

  const currency = branchById.get(state.branchId)?.currency ?? "EGP";
  /**
   * `null` when the field cannot be read as a number, which is a different
   * thing from a float of zero and has to stay different: opening a shift on
   * a NaN float makes every variance figure for the rest of the session
   * meaningless, and nothing downstream would ever flag it.
   */
  const floatMinor = minorFromInput(float);
  const chosen = employeeId || roster[0]?.id || "";

  return (
    <div className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader title={t("shift.none")} hint={t("shift.noneLede")} spec="FR-POS-090" />
        <div className="space-y-4">
          <Field label={t("shift.cashier")}>
            <Select value={chosen} onChange={(e) => setEmployeeId(e.target.value)}>
              {roster.map((e) => (
                <option key={e.id} value={e.id}>
                  {tx(e.name)} — {tx(e.position)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`${t("shift.openingFloat")} (${currency})`}
            hint={
              floatMinor === null
                ? t("shift.floatInvalid")
                : formatMoney(money(floatMinor, currency), fmt)
            }
          >
            <Input
              inputMode="decimal"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              aria-invalid={float.trim() !== "" && floatMinor === null}
            />
          </Field>

          <Button
            variant="primary"
            className="w-full"
            icon={<Wallet size={15} />}
            disabled={!chosen || floatMinor === null}
            onClick={() => {
              if (floatMinor === null) return;
              dispatch({ type: "SHIFT_OPEN", employeeId: chosen, openingFloatMinor: floatMinor });
            }}
          >
            {t("shift.open")}
          </Button>

          <p className="text-fg-subtle text-xs leading-relaxed">{t("term.offlineNote")}</p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer operations — FR-POS-091/092
// ---------------------------------------------------------------------------

function DrawerPanel({ onClose }: { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const session = state.session;

  const [kind, setKind] = useState<"pay_in" | "pay_out" | "safe_drop">("safe_drop");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  if (!session) return null;
  const currency = session.openingFloat.currency;
  const amountMinor = minorFromInput(amount);
  const overLimit = session.expectedCash.amount > state.settings.drawerLimitMinor;

  return (
    <Modal open onClose={onClose} title={t("shift.drawerOps")}>
      {overLimit ? (
        <div className="mb-4">
          <Callout tone="warn" title={t("shift.drawerLimit")}>
            {formatMoney(session.expectedCash, fmt)} ·{" "}
            {formatMoney(money(state.settings.drawerLimitMinor, currency), fmt)} · FR-POS-092
          </Callout>
        </div>
      ) : null}

      <DescList>
        <DescRow label={t("shift.openingFloat")}>{formatMoney(session.openingFloat, fmt)}</DescRow>
        <DescRow label={t("shift.cashSales")}>{formatMoney(session.cashSales, fmt)}</DescRow>
        <DescRow label={t("shift.payIn")}>{formatMoney(session.payIns, fmt)}</DescRow>
        <DescRow label={t("shift.payOut")}>{formatMoney(session.payOuts, fmt)}</DescRow>
        <DescRow label={t("shift.safeDrop")}>{formatMoney(session.safeDrops, fmt)}</DescRow>
        <DescRow label={t("shift.expected")} mono>
          {formatMoney(session.expectedCash, fmt)}
        </DescRow>
      </DescList>

      <div className="border-line mt-4 space-y-3 border-t pt-4">
        <Field label={t("shift.drawerOps")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="pay_in">{t("shift.payIn")}</option>
            <option value="pay_out">{t("shift.payOut")}</option>
            <option value="safe_drop">{t("shift.safeDrop")}</option>
          </Select>
        </Field>
        <Field label={`${t("shift.amount")} (${currency})`}>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount.trim() !== "" && amountMinor === null}
          />
        </Field>
        <Field label={t("shift.reason")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={
              amountMinor === null || amountMinor <= 0 || reason.trim().length === 0
            }
            onClick={() => {
              if (amountMinor === null) return;
              dispatch({ type: "SHIFT_CASH", kind, amountMinor, reason: reason.trim() });
              setAmount("");
              setReason("");
            }}
          >
            {t("shift.record")}
          </Button>
          <SpecTag id="FR-POS-091" />
        </div>
      </div>

      {session.movements.length > 0 ? (
        <ul className="border-line mt-4 space-y-1.5 border-t pt-3 text-xs">
          {[...session.movements].reverse().map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3">
              <span className="text-fg-muted shrink-0">
                {formatTime(m.at, fmt)} · {t(MOVEMENT_LABEL[m.kind])}
              </span>
              <span className="text-fg-subtle min-w-0 flex-1 truncate">{m.reason}</span>
              <span className="text-fg shrink-0 font-medium">{formatMoney(m.amount, fmt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// X report — FR-POS-093
// ---------------------------------------------------------------------------

function XReport({ onClose }: { onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const session = state.session;

  const { byTender, netSales } = useMemo(() => {
    const totals = new Map<TenderType, number>();
    let net = 0;
    for (const order of completedOrdersOf(state)) {
      net += order.grandTotal.amount + order.roundingAdjustment.amount;
      for (const payment of order.payments) {
        totals.set(payment.tender, (totals.get(payment.tender) ?? 0) + payment.amount.amount);
      }
    }
    return {
      byTender: [...totals.entries()].sort((a, b) => b[1] - a[1]),
      netSales: net,
    };
  }, [state]);

  if (!session) return null;
  const currency = session.openingFloat.currency;

  return (
    <Modal open onClose={onClose} title={t("shift.xReport")}>
      <p className="text-fg-subtle mb-3 text-xs leading-relaxed">{t("shift.xReportNote")}</p>
      <DescList>
        <DescRow label={t("shift.cashier")}>{tx(session.employeeName)}</DescRow>
        <DescRow label={t("shift.openedAt")}>{formatTime(session.openedAt, fmt)}</DescRow>
        <DescRow label={t("shift.ordersTaken")}>{session.orderCount}</DescRow>
        <DescRow label={t("common.total")} mono>
          {formatMoney(money(netSales, currency), fmt)}
        </DescRow>
      </DescList>

      <h3 className="text-fg mt-4 mb-1 text-xs font-semibold">{t("shift.tenderBreakdown")}</h3>
      <DescList>
        {byTender.length === 0 ? (
          <DescRow label={t("common.noResults")}>—</DescRow>
        ) : (
          byTender.map(([tender, amount]) => (
            <DescRow key={tender} label={tx(TENDER_TYPE[tender].label)} mono>
              {formatMoney(money(amount, currency), fmt)}
            </DescRow>
          ))
        )}
      </DescList>

      <h3 className="text-fg mt-4 mb-1 text-xs font-semibold">{t("shift.drawerOps")}</h3>
      <DescList>
        <DescRow label={t("shift.openingFloat")}>{formatMoney(session.openingFloat, fmt)}</DescRow>
        <DescRow label={t("shift.cashSales")}>{formatMoney(session.cashSales, fmt)}</DescRow>
        <DescRow label={t("shift.cashRefunds")}>{formatMoney(session.cashRefunds, fmt)}</DescRow>
        <DescRow label={t("shift.payIn")}>{formatMoney(session.payIns, fmt)}</DescRow>
        <DescRow label={t("shift.payOut")}>{formatMoney(session.payOuts, fmt)}</DescRow>
        <DescRow label={t("shift.safeDrop")}>{formatMoney(session.safeDrops, fmt)}</DescRow>
        <DescRow label={t("shift.expected")} mono>
          {formatMoney(session.expectedCash, fmt)}
        </DescRow>
      </DescList>
      <div className="mt-3">
        <SpecTag id="FR-POS-093" />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Close shift — blind denomination count, FR-POS-094/095/096/097
// ---------------------------------------------------------------------------

function CloseShiftPanel({ onClose }: { onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const session = state.session;

  const [counts, setCounts] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");

  const managers = useMemo(
    () => activeEmployees.filter((e) => /manager|supervisor|chef|head/i.test(e.position.en)),
    [],
  );

  if (!session) return null;
  const currency = session.openingFloat.currency;
  const blind = session.blindCount;

  /**
   * A count field that cannot be read is tracked rather than coerced.
   *
   * Reading it as zero would understate the drawer; reading it as NaN — which
   * is what `Number(x || 0)` did — made `counted` NaN, and `Math.abs(NaN) >
   * 2000` is `false`. The approval gate below was therefore *satisfied* by
   * unreadable input rather than tripped by it, which is the wrong way round
   * for a control whose whole job is to catch a discrepancy.
   */
  const invalidCounts = DENOMINATIONS.filter(
    (value) => (counts[value] ?? "").trim() !== "" && countFromInput(counts[value]) === null,
  );
  const counted = DENOMINATIONS.reduce(
    (sum, value) => sum + value * (countFromInput(counts[value]) ?? 0),
    0,
  );
  const expected = session.expectedCash.amount;
  const variance = counted - expected;
  const needsApproval = Math.abs(variance) > 2_000;
  const anyEntered = DENOMINATIONS.some((v) => (counts[v] ?? "").trim() !== "");
  const showVariance = !blind || revealed;

  const denominations: DenominationCount[] = DENOMINATIONS.map((value) => ({
    value,
    count: countFromInput(counts[value]) ?? 0,
  })).filter((d) => d.count > 0);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("shift.close")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {blind && !revealed ? (
            <Button variant="primary" disabled={!anyEntered} onClick={() => setRevealed(true)}>
              {t("shift.countedTotal")} {formatMoney(money(counted, currency), fmt)}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={
                invalidCounts.length > 0 || (needsApproval && (!reason.trim() || !approver))
              }
              onClick={() => {
                dispatch({
                  type: "SHIFT_CLOSE",
                  denominations,
                  varianceReason: reason.trim() || null,
                  acknowledgedByName: managers.find((m) => m.id === approver)?.name ?? null,
                });
                onClose();
              }}
            >
              {t("shift.confirmClose")}
            </Button>
          )}
        </>
      }
    >
      {blind ? (
        <Callout tone="accent" title={t("shift.countDrawer")}>
          {t("shift.blindNote")}
        </Callout>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {DENOMINATIONS.map((value) => (
          <label
            key={value}
            className="border-line flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
          >
            <span className="text-fg w-16 shrink-0 text-xs font-medium tabular-nums">
              {formatMoney(money(value, currency), fmt, true)}
            </span>
            <Input
              inputMode="numeric"
              value={counts[value] ?? ""}
              placeholder="0"
              aria-label={`${t("shift.count")} ${value / 100}`}
              onChange={(e) => setCounts((c) => ({ ...c, [value]: e.target.value }))}
              className="text-end"
            />
            <span className="text-fg-subtle w-20 shrink-0 text-end text-xs tabular-nums">
              {formatMoney(
                money(value * (countFromInput(counts[value]) ?? 0), currency),
                fmt,
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="border-line mt-4 border-t pt-3">
        <DescList>
          <DescRow label={t("shift.countedTotal")} mono>
            {formatMoney(money(counted, currency), fmt)}
          </DescRow>
          {showVariance ? (
            <>
              <DescRow label={t("shift.expected")} mono>
                {formatMoney(money(expected, currency), fmt)}
              </DescRow>
              <DescRow label={t("shift.variance")} mono>
                <span
                  className={cx(
                    "font-semibold",
                    variance === 0 ? "text-fg" : variance > 0 ? "text-good" : "text-bad",
                  )}
                >
                  {formatMoney(money(variance, currency), fmt)}
                  {variance === 0
                    ? ""
                    : ` · ${variance > 0 ? t("shift.varianceOver") : t("shift.varianceShort")}`}
                </span>
              </DescRow>
            </>
          ) : (
            <DescRow label={t("shift.expected")}>
              <span className="text-fg-subtle inline-flex items-center gap-1.5 text-xs">
                <Lock size={12} aria-hidden /> FR-POS-095
              </span>
            </DescRow>
          )}
        </DescList>
      </div>

      {showVariance && needsApproval ? (
        <div className="mt-4 space-y-3">
          <Callout tone="warn" title={t("shift.acknowledgeHint")}>
            FR-POS-096
          </Callout>
          <Field label={t("shift.varianceReason")} required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={t("shift.acknowledge")} required>
            <Select value={approver} onChange={(e) => setApprover(e.target.value)}>
              <option value="">—</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {pick(m.name, "en")}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The buttons that open the three panels above
// ---------------------------------------------------------------------------

export function ShiftControls() {
  const { t } = useI18n();
  const { state } = useLive();
  const [panel, setPanel] = useState<"drawer" | "x" | "close" | null>(null);

  if (!state.session) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" icon={<Banknote size={13} />} onClick={() => setPanel("drawer")}>
          {t("shift.drawerOps")}
        </Button>
        <Button size="sm" icon={<ClipboardCheck size={13} />} onClick={() => setPanel("x")}>
          {t("shift.xReport")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Lock size={13} />}
          onClick={() => setPanel("close")}
        >
          {t("shift.close")}
        </Button>
        {state.session.expectedCash.amount > state.settings.drawerLimitMinor ? (
          <Badge tone="warn">{t("shift.drawerLimit")}</Badge>
        ) : null}
      </div>

      {panel === "drawer" ? <DrawerPanel onClose={() => setPanel(null)} /> : null}
      {panel === "x" ? <XReport onClose={() => setPanel(null)} /> : null}
      {panel === "close" ? <CloseShiftPanel onClose={() => setPanel(null)} /> : null}
    </>
  );
}
