"use client";

/**
 * Everything between "that will be 240" and a settled bill —
 * FR-POS-060 … FR-POS-067, FR-POS-055 … FR-POS-057.
 *
 * Three pieces the payment sheet was missing:
 *
 *   - **Splitting that is not just "divide by four"** (FR-POS-062). By seat,
 *     by selected items and by an arbitrary amount are different requests
 *     from different tables, and a single equal-split control answers none
 *     of them.
 *   - **The full tender set** (FR-POS-060), including the ones with their own
 *     capture: a gift card has a number, loyalty points have a balance, an
 *     on-account sale has a credit limit that can refuse it.
 *   - **A card terminal that can fail** (FR-POS-064). Timeout, decline,
 *     partial approval and comms failure are four different outcomes and
 *     each needs a different next action. Leaving the order in an
 *     indeterminate state is the defect this exists to prevent.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Check,
  CreditCard,
  Gift,
  Landmark,
  Loader2,
  Receipt,
  Smartphone,
  Ticket,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";

import type { Customer, Id, LoyaltyProgramme, Money, Order, OrderLine, TenderType } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useLive } from "@/lib/console/live/store";
import { redemptionFor } from "@/lib/console/loyalty-earn";
import { LoyaltyBalanceQr } from "@/components/console/crm-customer-record";
import { TENDER_TYPE } from "@/lib/console/labels";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, minorFromInput, money } from "@/lib/console/format";
import { MoneyInput } from "@/components/console/fields";
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
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Tender catalogue — FR-POS-060
// ---------------------------------------------------------------------------

export const ALL_TENDERS: { tender: TenderType; icon: typeof Banknote }[] = [
  { tender: "cash", icon: Banknote },
  { tender: "card", icon: CreditCard },
  { tender: "wallet", icon: Smartphone },
  { tender: "gift_card", icon: Gift },
  { tender: "loyalty_points", icon: Ticket },
  { tender: "store_credit", icon: Wallet },
  { tender: "voucher", icon: Ticket },
  { tender: "bank_transfer", icon: Landmark },
  { tender: "on_account", icon: UserCheck },
  { tender: "aggregator_settled", icon: Receipt },
];

/** Tenders that need something captured before they can be taken. */
const NEEDS_REFERENCE: TenderType[] = ["gift_card", "voucher", "bank_transfer"];

export function TenderGrid({
  enabled,
  value,
  onChange,
}: {
  /** Which tenders this branch accepts. Empty means all of them. */
  enabled?: TenderType[];
  value: TenderType;
  onChange: (next: TenderType) => void;
}) {
  const { t, tx } = useI18n();
  const list = enabled?.length
    ? ALL_TENDERS.filter((entry) => enabled.includes(entry.tender))
    : ALL_TENDERS;

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {list.map(({ tender, icon: Icon }) => (
        <button
          key={tender}
          type="button"
          aria-pressed={value === tender}
          onClick={() => onChange(tender)}
          // NFR-USA-002 — 48dp targets with real separation.
          className={cx(
            "flex min-h-12 items-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium",
            value === tender
              ? "border-accent bg-accent-soft text-accent"
              : "border-line bg-raised text-fg-muted hover:text-fg",
          )}
        >
          <Icon size={16} aria-hidden />
          <span className="min-w-0 truncate">{tx(TENDER_TYPE[tender].label)}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split — FR-POS-062
// ---------------------------------------------------------------------------

export type SplitMode = "none" | "equal" | "seat" | "items" | "amount";

export interface SplitState {
  mode: SplitMode;
  parties: number;
  seat: number | null;
  lineIds: string[];
  amountMinor: number | null;
}

export const NO_SPLIT: SplitState = {
  mode: "none",
  parties: 2,
  seat: null,
  lineIds: [],
  amountMinor: null,
};

/**
 * What the current split says is due right now.
 *
 * Equal splits shrink their divisor as shares are paid (a four-way split
 * paid down twice is two shares of the remainder, not four), which is why
 * this takes the outstanding balance rather than the order total.
 */
export function shareOf(order: Order, split: SplitState, outstandingMinor: number): number {
  switch (split.mode) {
    case "equal": {
      const total = order.grandTotal.amount;
      const paidShares =
        split.parties > 1 && total > 0
          ? Math.min(
              split.parties - 1,
              Math.round((order.paidTotal.amount / total) * split.parties),
            )
          : 0;
      const remaining = Math.max(1, split.parties - paidShares);
      return Math.ceil(outstandingMinor / remaining);
    }
    case "seat":
      return order.lines
        .filter((line) => line.state !== "voided" && line.seatNumber === split.seat)
        .reduce((sum, line) => sum + line.lineTotal.amount, 0);
    case "items":
      return order.lines
        .filter((line) => line.state !== "voided" && split.lineIds.includes(line.id))
        .reduce((sum, line) => sum + line.lineTotal.amount, 0);
    case "amount":
      return Math.min(outstandingMinor, split.amountMinor ?? 0);
    default:
      return outstandingMinor;
  }
}

export function SplitPicker({
  order,
  split,
  onChange,
  outstandingMinor,
}: {
  order: Order;
  split: SplitState;
  onChange: (next: SplitState) => void;
  outstandingMinor: number;
}) {
  const { t, tx, fmt } = useI18n();

  const seats = useMemo(() => {
    const found = new Set<number>();
    for (const line of order.lines) {
      if (line.state !== "voided" && line.seatNumber !== null) found.add(line.seatNumber);
    }
    return [...found].sort((a, b) => a - b);
  }, [order.lines]);

  const payableLines = order.lines.filter((line) => line.state !== "voided" && !line.isComp);
  const share = shareOf(order, split, outstandingMinor);

  const MODES: { mode: SplitMode; labelKey: string; enabled: boolean }[] = [
    { mode: "none", labelKey: "pos.splitNone", enabled: true },
    { mode: "equal", labelKey: "pos.splitEqual", enabled: true },
    { mode: "seat", labelKey: "pos.splitSeat", enabled: seats.length > 0 },
    { mode: "items", labelKey: "pos.splitItems", enabled: payableLines.length > 1 },
    { mode: "amount", labelKey: "pos.splitAmount", enabled: true },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            disabled={!entry.enabled}
            aria-pressed={split.mode === entry.mode}
            onClick={() => onChange({ ...NO_SPLIT, mode: entry.mode, parties: split.parties })}
            className={cx(
              "rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40",
              split.mode === entry.mode
                ? "border-accent bg-accent-soft text-accent font-medium"
                : "border-line bg-raised text-fg-muted",
            )}
          >
            {t(entry.labelKey as never)}
          </button>
        ))}
      </div>

      {split.mode === "equal" ? (
        <Field label={t("pos.parties")} hint={t("pos.equalHint")}>
          <div className="flex flex-wrap gap-1.5">
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...split, parties: n })}
                className={cx(
                  "h-11 w-11 rounded-lg border text-sm tabular-nums",
                  split.parties === n
                    ? "border-accent bg-accent-soft text-accent font-semibold"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {split.mode === "seat" ? (
        <Field label={t("pos.whichSeat")} hint={t("pos.seatHint")}>
          <div className="flex flex-wrap gap-1.5">
            {seats.map((seat) => {
              const seatTotal = order.lines
                .filter((line) => line.state !== "voided" && line.seatNumber === seat)
                .reduce((sum, line) => sum + line.lineTotal.amount, 0);
              return (
                <button
                  key={seat}
                  type="button"
                  onClick={() => onChange({ ...split, seat })}
                  className={cx(
                    "min-h-11 rounded-lg border px-3 py-1.5 text-xs",
                    split.seat === seat
                      ? "border-accent bg-accent-soft text-accent font-semibold"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  <span className="block">
                    {t("pos.seat")} {seat}
                  </span>
                  <span className="block font-mono tabular-nums">
                    {formatMoney(money(seatTotal, order.currency), fmt, true)}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      {split.mode === "items" ? (
        <Field label={t("pos.whichItems")} hint={t("pos.itemsHint")}>
          <ul className="border-line divide-line max-h-56 divide-y overflow-y-auto rounded-lg border">
            {payableLines.map((line) => {
              const on = split.lineIds.includes(line.id);
              return (
                <li key={line.id}>
                  <label className="hover:bg-sunken flex cursor-pointer items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        onChange({
                          ...split,
                          lineIds: on
                            ? split.lineIds.filter((id) => id !== line.id)
                            : [...split.lineIds, line.id],
                        })
                      }
                      className="accent-accent h-4 w-4 shrink-0"
                    />
                    <span className="text-fg min-w-0 flex-1 truncate text-sm">
                      {line.quantity} × {tx(line.itemNameSnapshot)}
                      {line.seatNumber !== null ? (
                        <span className="text-fg-subtle ms-1.5 text-xs">
                          {t("pos.seat")} {line.seatNumber}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-fg-muted shrink-0 font-mono text-xs tabular-nums">
                      {formatMoney(line.lineTotal, fmt, true)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Field>
      ) : null}

      {split.mode === "amount" ? (
        <Field label={t("pos.howMuch")} hint={t("pos.amountHint")}>
          <MoneyInput
            value={split.amountMinor}
            currency={order.currency}
            onChange={(amountMinor) => onChange({ ...split, amountMinor })}
            max={outstandingMinor}
            aria-label={t("pos.howMuch")}
          />
        </Field>
      ) : null}

      {split.mode !== "none" ? (
        <DescList>
          <DescRow label={t("pos.dueNow")} mono>
            <span className="text-fg text-lg font-semibold">
              {formatMoney(money(share, order.currency), fmt)}
            </span>
          </DescRow>
        </DescList>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tips — FR-POS-056
// ---------------------------------------------------------------------------

export function TipPicker({
  baseMinor,
  currency,
  value,
  onChange,
}: {
  baseMinor: number;
  currency: string;
  value: number;
  onChange: (minor: number) => void;
}) {
  const { t, fmt } = useI18n();
  const presets = [0, 10, 12.5, 15, 20];

  return (
    <Field label={t("pos.tip")} hint={t("pos.tipHint")}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((percent) => {
          const minor = Math.round(baseMinor * (percent / 100));
          const on = value === minor;
          return (
            <button
              key={percent}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(minor)}
              className={cx(
                "min-h-11 rounded-lg border px-3 py-1.5 text-xs",
                on
                  ? "border-accent bg-accent-soft text-accent font-semibold"
                  : "border-line bg-raised text-fg-muted",
              )}
            >
              <span className="block">{percent === 0 ? t("pos.noTip") : `${percent}%`}</span>
              {percent > 0 ? (
                <span className="block font-mono tabular-nums">
                  {formatMoney(money(minor, currency as never), fmt, true)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        <MoneyInput
          value={value}
          currency={currency as never}
          onChange={(minor) => onChange(minor ?? 0)}
          aria-label={t("pos.customTip")}
        />
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Card terminal — FR-POS-064, FR-POS-065
// ---------------------------------------------------------------------------

export type TerminalOutcome =
  | { state: "idle" }
  | { state: "waiting" }
  | { state: "approved"; last4: string; authCode: string }
  | { state: "partial"; approvedMinor: number; last4: string }
  | { state: "declined"; reason: string }
  | { state: "timeout" }
  | { state: "comms" };

/**
 * The five ways a card payment ends, each with its own next action.
 *
 * The one thing this must never do is leave the order looking paid when it
 * is not, or unpaid when it is. So every terminal outcome is explicit, none
 * of them dismisses itself, and the amount stays on the balance until an
 * approval says otherwise.
 */
export function CardTerminalPanel({
  amountMinor,
  currency,
  outcome,
  onStart,
  onAccept,
  onAbandon,
  onFallbackManual,
}: {
  amountMinor: number;
  currency: string;
  outcome: TerminalOutcome;
  onStart: () => void;
  onAccept: (approvedMinor: number, last4: string, authCode: string) => void;
  onAbandon: () => void;
  onFallbackManual: () => void;
}) {
  const { t, fmt } = useI18n();

  if (outcome.state === "idle") {
    return (
      <div className="space-y-3">
        <Callout tone="neutral">{t("pos.cardPciNote")}</Callout>
        <Button variant="primary" className="w-full" onClick={onStart}>
          {t("pos.sendToTerminal")} · {formatMoney(money(amountMinor, currency as never), fmt)}
        </Button>
        <Button className="w-full" onClick={onFallbackManual}>
          {t("pos.useExternalTerminal")}
        </Button>
      </div>
    );
  }

  if (outcome.state === "waiting") {
    return (
      <div
        className="border-accent bg-accent-soft/40 flex flex-col items-center gap-3 rounded-xl border p-6 text-center"
        aria-live="polite"
      >
        <Loader2 size={28} className="text-accent animate-spin" aria-hidden />
        <p className="text-fg text-sm font-medium">{t("pos.waitingTerminal")}</p>
        <p className="text-fg-muted text-xs">{t("pos.waitingTerminalHint")}</p>
        <Button variant="ghost" size="sm" onClick={onAbandon}>
          {t("pos.cancelAtTerminal")}
        </Button>
      </div>
    );
  }

  if (outcome.state === "approved") {
    return (
      <div className="border-good bg-good/10 space-y-3 rounded-xl border p-4" aria-live="polite">
        <p className="text-good flex items-center gap-2 text-sm font-semibold">
          <Check size={16} aria-hidden /> {t("pos.approved")}
        </p>
        <DescList>
          <DescRow label={t("pos.amount")} mono>
            {formatMoney(money(amountMinor, currency as never), fmt)}
          </DescRow>
          <DescRow label={t("pos.card")} mono>
            ···· {outcome.last4}
          </DescRow>
          <DescRow label={t("pos.authCode")} mono>
            {outcome.authCode}
          </DescRow>
        </DescList>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => onAccept(amountMinor, outcome.last4, outcome.authCode)}
        >
          {t("pos.recordPayment")}
        </Button>
      </div>
    );
  }

  if (outcome.state === "partial") {
    return (
      <div className="border-warn bg-warn-soft space-y-3 rounded-xl border p-4" aria-live="assertive">
        <p className="text-warn flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle size={16} aria-hidden /> {t("pos.partialApproval")}
        </p>
        <p className="text-fg-muted text-xs leading-relaxed">{t("pos.partialApprovalBody")}</p>
        <DescList>
          <DescRow label={t("pos.requested")} mono>
            {formatMoney(money(amountMinor, currency as never), fmt)}
          </DescRow>
          <DescRow label={t("pos.approvedAmount")} mono>
            <span className="text-warn font-semibold">
              {formatMoney(money(outcome.approvedMinor, currency as never), fmt)}
            </span>
          </DescRow>
          <DescRow label={t("pos.stillOwing")} mono>
            {formatMoney(money(amountMinor - outcome.approvedMinor, currency as never), fmt)}
          </DescRow>
        </DescList>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => onAccept(outcome.approvedMinor, outcome.last4, "PARTIAL")}
        >
          {t("pos.acceptPartial")}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onAbandon}>
          {t("pos.voidAtTerminal")}
        </Button>
      </div>
    );
  }

  const failure =
    outcome.state === "declined"
      ? { title: t("pos.declined"), body: outcome.reason }
      : outcome.state === "timeout"
        ? { title: t("pos.terminalTimeout"), body: t("pos.terminalTimeoutBody") }
        : { title: t("pos.commsFailure"), body: t("pos.commsFailureBody") };

  return (
    <div className="border-bad bg-bad-soft space-y-3 rounded-xl border p-4" aria-live="assertive">
      <p className="text-bad flex items-center gap-2 text-sm font-semibold">
        <X size={16} aria-hidden /> {failure.title}
      </p>
      <p className="text-fg-muted text-xs leading-relaxed">{failure.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onStart}>
          {t("pos.retryTerminal")}
        </Button>
        <Button onClick={onFallbackManual}>{t("pos.useExternalTerminal")}</Button>
        <Button variant="ghost" onClick={onAbandon}>
          {t("pos.chooseAnotherTender")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reference-carrying tenders
// ---------------------------------------------------------------------------

export function TenderReferencePanel({
  tender,
  currency,
  amountMinor,
  reference,
  onReference,
  loyaltyBalance,
  creditLimitMinor,
  creditUsedMinor,
  orderId,
}: {
  /** The order being paid; defaults to the till's active order. */
  orderId?: Id | null;
  tender: TenderType;
  currency: string;
  amountMinor: number;
  reference: string;
  onReference: (next: string) => void;
  /** Points available, when paying with loyalty. */
  loyaltyBalance?: number | null;
  /** FR-POS-067 — an on-account sale can be refused by the limit. */
  creditLimitMinor?: number | null;
  creditUsedMinor?: number;
}) {
  const { t, fmt } = useI18n();

  if (tender === "loyalty_points") {
    // FR-CRM-017 — points convert at the programme's rate and are taken by
    // the panel's own Redeem button, which posts the ledger entry first.
    void loyaltyBalance;
    return <LoyaltyTenderPanel orderId={orderId} amountMinor={amountMinor} currency={currency} />;
  }

  if (tender === "on_account") {
    const limit = creditLimitMinor ?? 0;
    const used = creditUsedMinor ?? 0;
    const headroom = limit - used;
    const wouldExceed = amountMinor > headroom;
    return (
      <div className="space-y-3">
        <DescList>
          <DescRow label={t("pos.creditLimit")} mono>
            {formatMoney(money(limit, currency as never), fmt)}
          </DescRow>
          <DescRow label={t("pos.creditUsed")} mono>
            {formatMoney(money(used, currency as never), fmt)}
          </DescRow>
          <DescRow label={t("pos.creditHeadroom")} mono>
            <span className={cx(wouldExceed ? "text-bad font-semibold" : "text-good")}>
              {formatMoney(money(headroom, currency as never), fmt)}
            </span>
          </DescRow>
        </DescList>
        {wouldExceed ? (
          <Callout tone="bad" title={t("pos.overCreditLimit")}>
            {t("pos.overCreditLimitBody")}
          </Callout>
        ) : null}
      </div>
    );
  }

  if (NEEDS_REFERENCE.includes(tender)) {
    return (
      <Field
        label={
          tender === "gift_card"
            ? t("pos.giftCardNumber")
            : tender === "voucher"
              ? t("pos.voucherCode")
              : t("pos.transferReference")
        }
        required
      >
        <Input
          data-autofocus
          dir="ltr"
          value={reference}
          onChange={(event) => onReference(event.target.value)}
          className="font-mono"
        />
      </Field>
    );
  }

  if (tender === "aggregator_settled") {
    return <Callout tone="muted">{t("pos.aggregatorSettledNote")}</Callout>;
  }

  return null;
}

/** Whether the chosen tender has everything it needs to be taken. */
export function tenderReady(
  tender: TenderType,
  reference: string,
  context: { loyaltyBalance?: number | null; headroomMinor?: number; amountMinor: number },
): boolean {
  if (NEEDS_REFERENCE.includes(tender)) return reference.trim().length >= 4;
  // FR-CRM-017 — loyalty is taken by `LoyaltyTenderPanel`'s own Redeem button,
  // which must post the points to the ledger before the payment is recorded;
  // the generic Take Payment button never settles it.
  if (tender === "loyalty_points") return false;
  if (tender === "on_account") return (context.headroomMinor ?? 0) >= context.amountMinor;
  return true;
}

// ---------------------------------------------------------------------------
// Loyalty points as a tender — FR-CRM-017
// ---------------------------------------------------------------------------

/**
 * FR-CRM-017 — pay with points, converted to money at the programme's rate.
 *
 * The order's attached customer is the one whose points are spent; without
 * one there is nothing to redeem against, and the panel says to attach the
 * customer first. Only whole points are taken and never more value than is
 * owed, so a remainder smaller than a point stays for another tender.
 *
 * Ordering matters: the redemption is posted to the loyalty ledger (which
 * refuses to go below zero) *before* the payment is recorded on the order. A
 * payment recorded against points the ledger then refuses is a free meal.
 *
 * Offline, redemption is capped (FR-CRM-021) and the entry is marked as an
 * offline capture for reconciliation.
 *
 * Afterwards the balance QR (FR-CRM-022) is shown for the customer to scan.
 */
function LoyaltyTenderPanel({
  orderId,
  amountMinor,
  currency,
}: {
  orderId?: Id | null;
  amountMinor: number;
  currency: string;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const action = useAction();
  const order = state.orders[orderId ?? state.activeOrderId ?? ""] ?? null;
  const customerId = order?.customerId ?? null;
  const [requested, setRequested] = useState<string>("");
  const [done, setDone] = useState<{ points: number; valueMinor: number; path: string } | null>(null);

  const data = useAsync<{ customer: Customer | null; programme: LoyaltyProgramme }>(
    async () => ({
      customer: customerId ? await services.crm.customers.get(customerId) : null,
      programme: await services.crm.loyalty.programme(),
    }),
    [customerId, done?.points],
  );

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (!order) return <Callout tone="muted">{t("pos.loyalty.noOrder")}</Callout>;
  if (!customerId) return <Callout tone="warn">{t("pos.loyalty.attachCustomer")}</Callout>;
  if (!data.data) {
    return data.error ? <Callout tone="bad">{data.error.message}</Callout> : <Loader2 size={16} className="animate-spin" aria-hidden />;
  }

  const { customer, programme } = data.data;
  if (!customer) return <Callout tone="bad">{t("pos.loyalty.customerMissing")}</Callout>;
  if (!programme.enabled || programme.model !== "points") {
    return <Callout tone="muted">{t("pos.loyalty.programmeOff")}</Callout>;
  }

  const quote = redemptionFor(
    {
      amountMinor,
      balance: customer.loyaltyPoints,
      requestedPoints: requested === "" ? null : Number(requested.replace(/\D/g, "")),
      capMinor: offline ? programme.offlineRedemptionCapMinor : null,
    },
    programme,
  );

  async function redeem() {
    if (!order || quote.points <= 0) return;
    await action.run(
      async () => {
        await services.crm.loyalty.post({
          customerId: customer!.id,
          kind: "redeem",
          points: quote.points,
          reason: `Order ${order.orderNumber}`,
          orderId: order.id,
          offlineCapture: offline,
        });
        dispatch({
          type: "ORDER_PAY",
          orderId: order.id,
          tender: "loyalty_points",
          amountMinor: quote.valueMinor,
          tipMinor: 0,
        });
        const link = await services.crm.loyalty.balanceLink(customer!.id);
        return { points: quote.points, valueMinor: quote.valueMinor, path: link.path };
      },
      {
        onSuccess: (result) => {
          setRequested("");
          setDone(result);
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <DescList>
        <DescRow label={t("pos.loyalty.customer")}>{tx(customer.name)}</DescRow>
        <DescRow label={t("pos.pointsAvailable")} mono>
          {customer.loyaltyPoints}
        </DescRow>
        <DescRow label={t("pos.loyalty.rate")} mono>
          {t("pos.loyalty.rateValue").replace("{value}", formatMoney(money(programme.redeemValueMinor, currency as never), fmt))}
        </DescRow>
      </DescList>

      {offline ? (
        <Callout tone="warn">
          {t("pos.loyalty.offlineCap").replace(
            "{cap}",
            formatMoney(money(programme.offlineRedemptionCapMinor, currency as never), fmt),
          )}
        </Callout>
      ) : null}

      {quote.maxPoints <= 0 ? (
        <Callout tone="bad">{t("pos.notEnoughPoints")}</Callout>
      ) : (
        <>
          <Field label={t("pos.loyalty.pointsToUse")} hint={t("pos.loyalty.max").replace("{n}", String(quote.maxPoints))}>
            <Input
              dir="ltr"
              inputMode="numeric"
              placeholder={String(quote.maxPoints)}
              value={requested}
              onChange={(event) => setRequested(event.target.value.replace(/\D/g, ""))}
              className="text-end font-mono tabular-nums"
            />
          </Field>
          <DescList>
            <DescRow label={t("pos.pointsNeeded")} mono>
              {quote.points}
            </DescRow>
            <DescRow label={t("pos.loyalty.pays")} mono>
              <span className="text-fg font-semibold">{formatMoney(money(quote.valueMinor, currency as never), fmt)}</span>
            </DescRow>
            {quote.valueMinor < amountMinor ? (
              <DescRow label={t("pos.stillOwing")} mono>
                {formatMoney(money(amountMinor - quote.valueMinor, currency as never), fmt)}
              </DescRow>
            ) : null}
          </DescList>
          <Button variant="primary" className="w-full" loading={action.pending} disabled={quote.points <= 0} onClick={() => void redeem()}>
            {t("pos.loyalty.redeem")
              .replace("{n}", String(quote.points))
              .replace("{value}", formatMoney(money(quote.valueMinor, currency as never), fmt))}
          </Button>
        </>
      )}

      {done ? (
        <div className="border-good bg-good/10 flex flex-col items-center gap-2 rounded-xl border p-3 text-center">
          <p className="text-good flex items-center gap-1.5 text-sm font-semibold">
            <Check size={14} aria-hidden />
            {t("pos.loyalty.redeemed")
              .replace("{n}", String(done.points))
              .replace("{value}", formatMoney(money(done.valueMinor, currency as never), fmt))}
          </p>
          <LoyaltyBalanceQr path={done.path} size="h-28 w-28" />
          <p className="text-fg-muted text-xs">{t("pos.loyalty.scanBalance")}</p>
        </div>
      ) : null}
    </div>
  );
}
