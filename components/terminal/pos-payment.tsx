"use client";

/**
 * Payment, receipt and refund.
 *
 * FR-POS-061 — split payment across tenders, with the balance always shown.
 *
 * The running balance is the whole design. Split tenders, split bills and
 * partial payments all reduce to "what is still owed", displayed at all
 * times, so a cashier is never guessing whether the last tap registered —
 * which is the state that produces double charges.
 */

import { useMemo, useRef, useState } from "react";
import { Banknote, CreditCard, Printer, Smartphone, Ticket, Undo2 } from "lucide-react";
import type { CountryPack, Order, TaxClassCode, TenderType } from "@/lib/console/types";
import { branchById } from "@/lib/console/mock/org";
import { menuItemById } from "@/lib/console/mock/catalogue";
import { countryPacks } from "@/lib/console/mock/platform";
import {
  formatDateTime,
  formatMoney,
  minorFromInput,
  money,
  tx as pick,
} from "@/lib/console/format";
import { TENDER_TYPE, ORDER_TYPE } from "@/lib/console/labels";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { balanceOf, cashIncrement, roundCash } from "@/lib/console/live/engine";
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
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

const TENDERS: { tender: TenderType; icon: React.ReactNode }[] = [
  { tender: "cash", icon: <Banknote size={16} /> },
  { tender: "card", icon: <CreditCard size={16} /> },
  { tender: "wallet", icon: <Smartphone size={16} /> },
  { tender: "voucher", icon: <Ticket size={16} /> },
];

export function PaymentSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();

  const pack = useMemo(() => {
    const branch = branchById.get(state.branchId);
    return countryPacks.find((p) => p.code === branch?.countryCode) ?? countryPacks[0]!;
  }, [state.branchId]);

  const [tender, setTender] = useState<TenderType>("cash");
  const [amount, setAmount] = useState("");
  const [parties, setParties] = useState(1);
  /**
   * FR-POS-060 — one tap, one payment.
   *
   * A ref rather than state, because state updates are batched and a second
   * tap can land in the same batch as the first, reading the old value and
   * dispatching again. A ref is written synchronously inside the handler, so
   * the second tap sees it however fast it arrives.
   *
   * Cash had accidental cover — clearing the field made `tenderedMinor <
   * share` true and disabled the button on re-render. Card had none: its
   * `disabled` only ever checked `share <= 0`, so a double-tap wrote two
   * payment records against the same order.
   */
  const paying = useRef(false);

  const balance = balanceOf(order);
  const settled = order.state === "completed";

  // FR-POS-063 — cash settles to the smallest coin actually in circulation.
  const cashRounding = roundCash(balance, pack);
  const dueNow = tender === "cash" ? cashRounding.rounded : balance;
  /**
   * FR-POS-062 — an equal split stays equal as it is paid down.
   *
   * `dueNow` is the *remaining* balance, so dividing it by the original party
   * count made every share smaller than the last: four covers of 100 became
   * 100, then 75, then 50. The divisor has to shrink with the balance, so it
   * is the number of shares still outstanding.
   *
   * Derived from what has been paid rather than tracked separately, because a
   * counter would drift the moment a payment was refunded or an item added.
   */
  const total = order.grandTotal.amount;
  const paidShares =
    parties > 1 && total > 0
      ? Math.min(parties - 1, Math.round((order.paidTotal.amount / total) * parties))
      : 0;
  const remainingShares = Math.max(1, parties - paidShares);
  const share =
    parties > 1 ? Math.ceil(dueNow.amount / remainingShares) : dueNow.amount;

  /**
   * Unreadable input reads as nothing tendered rather than as NaN. The old
   * form made `tenderedMinor` NaN, and `NaN < share` is `false` — which
   * *enabled* the Take Payment button on invalid input instead of holding it.
   */
  const tenderedMinor = minorFromInput(amount) ?? 0;
  const changeDue = tender === "cash" ? Math.max(0, tenderedMinor - share) : 0;
  const step = cashIncrement(order.currency);

  const quickCash = useMemo(() => {
    const base = Math.max(share, step);
    const notes = [base, roundUp(base, 5000), roundUp(base, 10000), roundUp(base, 20000)];
    return [...new Set(notes)].slice(0, 4);
  }, [share, step]);

  if (settled) {
    return <ReceiptSheet order={order} onClose={onClose} />;
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`${t("pos.payment")} · ${order.orderNumber}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button
            variant="primary"
            disabled={share <= 0 || (tender === "cash" && tenderedMinor < share)}
            onClick={() => {
              if (paying.current) return;
              paying.current = true;
              dispatch({
                type: "ORDER_PAY",
                orderId: order.id,
                tender,
                amountMinor: share,
                tenderedMinor: tender === "cash" ? tenderedMinor : undefined,
                tipMinor: 0,
                cardLast4: tender === "card" ? "4242" : null,
                cardScheme: tender === "card" ? "Visa" : null,
              });
              setAmount("");
              // Released on the next frame: the dispatch has been applied by
              // then, so the button's own `disabled` takes over from here and
              // a legitimate second payment on a split bill is not blocked.
              requestAnimationFrame(() => {
                paying.current = false;
              });
            }}
          >
            {t("pos.takePayment")} · {formatMoney(money(share, order.currency), fmt)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <DescList>
            <DescRow label={t("pos.total")} mono>
              {formatMoney(
                money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
                fmt,
              )}
            </DescRow>
            <DescRow label={t("pos.paid")} mono>
              {formatMoney(order.paidTotal, fmt)}
            </DescRow>
            <DescRow label={t("pos.balance")} mono>
              <span className="text-fg text-lg font-bold">{formatMoney(balance, fmt)}</span>
            </DescRow>
            {tender === "cash" && cashRounding.adjustment.amount !== 0 ? (
              <DescRow label={t("pos.rounding")} mono>
                {formatMoney(cashRounding.adjustment, fmt)}
              </DescRow>
            ) : null}
          </DescList>

          {order.payments.length > 0 ? (
            <ul className="border-line mt-3 space-y-1 border-t pt-2 text-xs">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">
                    {tx(TENDER_TYPE[p.tender].label)}
                    {p.cardLast4 ? ` ···· ${p.cardLast4}` : ""}
                  </span>
                  <span className="text-fg tabular-nums">{formatMoney(p.amount, fmt)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <Field label={t("pos.splitEqually")} hint={t("pos.parties")}>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setParties(n)}
                    className={cx(
                      "h-9 w-9 rounded-lg border text-sm tabular-nums",
                      parties === n
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
        </div>

        <div>
          <Field label={t("pos.tender")}>
            <div className="grid grid-cols-2 gap-1.5">
              {TENDERS.map(({ tender: value, icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTender(value)}
                  className={cx(
                    "flex items-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium",
                    tender === value
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-raised text-fg-muted hover:text-fg",
                  )}
                >
                  {icon}
                  {tx(TENDER_TYPE[value].label)}
                </button>
              ))}
            </div>
          </Field>

          {tender === "cash" ? (
            <div className="mt-4 space-y-3">
              <Field label={`${t("pos.tendered")} (${order.currency})`}>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {quickCash.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount((value / 100).toFixed(2))}
                    className="border-line bg-raised text-fg hover:bg-sunken rounded-lg border px-3 py-2 text-sm tabular-nums"
                  >
                    {formatMoney(money(value, order.currency), fmt, true)}
                  </button>
                ))}
              </div>
              <DescList>
                <DescRow label={t("pos.changeDue")} mono>
                  <span className={cx("text-lg font-bold", changeDue > 0 ? "text-good" : "text-fg")}>
                    {formatMoney(money(changeDue, order.currency), fmt)}
                  </span>
                </DescRow>
              </DescList>
            </div>
          ) : (
            <div className="mt-4">
              <Callout tone="neutral">
                {tender === "card"
                  ? "Card data never reaches the system: only the last four digits, the scheme and the authorisation code are kept — FR-POS-066."
                  : `${tx(TENDER_TYPE[tender].label)} — FR-POS-060.`}
              </Callout>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function roundUp(value: number, to: number): number {
  return Math.ceil(value / to) * to;
}

// ---------------------------------------------------------------------------
// Receipt — FR-POS-100/102
// ---------------------------------------------------------------------------

export function ReceiptSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, locale, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const [refunding, setRefunding] = useState(false);

  const branch = branchById.get(order.branchId);
  const pack = countryPacks.find((p) => p.code === branch?.countryCode);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.receipt")}
      footer={
        <>
          <Button icon={<Undo2 size={14} />} onClick={() => setRefunding(true)}>
            {t("pos.refund")}
          </Button>
          <Button icon={<Printer size={14} />} onClick={() => window.print()}>
            {t("pos.printReceipt")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: "ORDER_SELECT", orderId: null });
              onClose();
            }}
          >
            {t("pos.newOrderAfter")}
          </Button>
        </>
      }
    >
      <div className="bg-sunken border-line rounded-xl border p-4 font-mono text-xs">
        <div className="text-center">
          <p className="text-fg text-sm font-bold">{tx(branch?.name)}</p>
          <p className="text-fg-muted">{branch?.address}</p>
          <p className="text-fg-muted mt-1">
            {pack?.taxEngine === "vat_standard" ? "VAT" : "TAX"} REG 100-238-991
          </p>
        </div>

        <div className="border-line my-3 border-t border-dashed pt-2">
          <Row label={t("orders.number")} value={order.orderNumber} />
          <Row label={t("common.date")} value={formatDateTime(order.openedAt, fmt)} />
          <Row label={t("pos.orderType")} value={pick(ORDER_TYPE[order.orderType].label, locale)} />
          {order.tableLabel ? <Row label={t("nav.tables")} value={order.tableLabel} /> : null}
          <Row label={t("shift.cashier")} value={pick(order.openedByName, locale)} />
        </div>

        <div className="border-line my-3 border-t border-dashed pt-2">
          {order.lines
            .filter((l) => l.state !== "voided")
            .map((line) => (
              <div key={line.id} className="mb-1">
                <div className="flex justify-between gap-3">
                  <span className="text-fg min-w-0 truncate">
                    {line.quantity} × {tx(line.itemNameSnapshot)}
                  </span>
                  <span className="text-fg shrink-0 tabular-nums">
                    {formatMoney(line.lineTotal, fmt)}
                  </span>
                </div>
                {line.modifiers.map((m) => (
                  <div key={m.id} className="text-fg-subtle ps-3">
                    {m.kind === "removal" ? "− " : "+ "}
                    {tx(m.name)}
                  </div>
                ))}
              </div>
            ))}
        </div>

        <div className="border-line border-t border-dashed pt-2">
          <Row label={t("pos.subtotal")} value={formatMoney(order.subtotal, fmt)} />
          {order.discountTotal.amount > 0 ? (
            <Row label={t("pos.discountTotal")} value={`−${formatMoney(order.discountTotal, fmt)}`} />
          ) : null}
          {order.serviceChargeTotal.amount > 0 ? (
            <Row label={t("pos.serviceCharge")} value={formatMoney(order.serviceChargeTotal, fmt)} />
          ) : null}
          <TaxBreakdown order={order} pack={pack} />
          {order.roundingAdjustment.amount !== 0 ? (
            <Row label={t("pos.rounding")} value={formatMoney(order.roundingAdjustment, fmt)} />
          ) : null}
          <div className="text-fg mt-1 flex justify-between border-t pt-1 text-sm font-bold">
            <span>{t("pos.total")}</span>
            <span className="tabular-nums">
              {formatMoney(
                money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
                fmt,
              )}
            </span>
          </div>
        </div>

        <div className="border-line my-2 border-t border-dashed pt-2">
          {order.payments.map((p) => (
            <Row
              key={p.id}
              label={pick(TENDER_TYPE[p.tender].label, locale)}
              value={formatMoney(p.amount, fmt)}
            />
          ))}
          <Row
            label={t("pos.amountPaid")}
            value={formatMoney(
              money(
                order.payments.reduce((sum, p) => sum + p.tenderedAmount.amount, 0),
                order.currency,
              ),
              fmt,
            )}
          />
          {order.payments.some((p) => p.changeAmount.amount > 0) ? (
            <Row
              label={t("pos.changeDue")}
              value={formatMoney(
                money(
                  order.payments.reduce((sum, p) => sum + p.changeAmount.amount, 0),
                  order.currency,
                ),
                fmt,
              )}
            />
          ) : null}
        </div>

        <p className="text-fg-subtle mt-3 text-center leading-relaxed">
          {locale === "ar" ? "شكرًا لزيارتكم" : "Thank you"}
          <br />
          {pack?.fiscalProvider ? `${pack.fiscalProvider.toUpperCase()} · ${pack.fiscalMode}` : null}
        </p>
      </div>

      <p className="text-fg-subtle mt-3 text-xs leading-relaxed">
        {state.settings.blindCount ? "FR-POS-100 · FR-POS-102" : "FR-POS-100"}
      </p>

      {refunding ? <RefundSheet order={order} onClose={() => setRefunding(false)} /> : null}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-muted min-w-0 truncate">{label}</span>
      <span className="text-fg shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refund — FR-POS-072/073/074
// ---------------------------------------------------------------------------

function RefundSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();

  const refunded = order.payments
    .filter((p) => p.amount.amount < 0)
    .reduce((s, p) => s + -p.amount.amount, 0);
  const refundable = order.paidTotal.amount - refunded;

  const [amount, setAmount] = useState((refundable / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [returnToStock, setReturnToStock] = useState(false);

  const parsedRefund = minorFromInput(amount);
  const amountMinor = parsedRefund === null ? null : Math.min(refundable, parsedRefund);
  const originalTender = order.payments[0]?.tender ?? "cash";

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.refund")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={
              amountMinor === null || amountMinor <= 0 || reason.trim().length === 0
            }
            onClick={() => {
              if (amountMinor === null) return;
              dispatch({
                type: "ORDER_REFUND",
                orderId: order.id,
                amountMinor,
                reason: reason.trim(),
                returnToStock,
              });
              onClose();
            }}
          >
            {t("pos.refund")} ·{" "}
            {formatMoney(money(amountMinor ?? 0, order.currency), fmt)}
          </Button>
        </>
      }
    >
      <Callout tone="warn">{t("pos.refundNote")}</Callout>
      <div className="mt-4 space-y-3">
        <DescList>
          <DescRow label={t("pos.paid")} mono>
            {formatMoney(order.paidTotal, fmt)}
          </DescRow>
          <DescRow label={t("pos.tender")}>
            <Badge tone="neutral">{tx(TENDER_TYPE[originalTender].label)}</Badge>
          </DescRow>
        </DescList>
        <Field label={`${t("pos.refundAmount")} (${order.currency})`}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("pos.refundReason")} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Toggle
          checked={returnToStock}
          onChange={setReturnToStock}
          label={t("pos.refundReturnStock")}
          hint="FR-POS-070"
        />
      </div>
    </Modal>
  );
}

/**
 * FR-FIN-020 — the receipt carries the breakdown the country pack requires.
 *
 * A single summed "Tax" line is only honest when every line on the order sits
 * in the same class. The Egypt pack defines four — standard 14%, reduced 5%,
 * zero-rated, exempt — and a mixed order (hot food beside bottled water) was
 * printing one undifferentiated figure, which is exactly the number a fiscal
 * authority cannot check.
 *
 * The lines already carry their class, so the breakdown is a grouping rather
 * than a new calculation: nothing here re-derives tax, it only reports what
 * the engine already worked out per line.
 *
 * An order that really is single-class still prints one row, so the common
 * case does not get longer for the sake of the general one.
 */
function TaxBreakdown({
  order,
  pack,
}: {
  order: Order;
  pack: CountryPack | undefined;
}) {
  const { t, tx, fmt } = useI18n();
  const inclusive = pack?.pricingMode === "tax_inclusive";
  const suffix = inclusive ? ` (${t("pos.taxIncluded")})` : "";

  const groups = useMemo(() => {
    const byClass = new Map<TaxClassCode, { taxable: number; tax: number }>();

    for (const line of order.lines) {
      if (line.state === "voided") continue;
      // The class lives on the menu item, not on the line — the line carries
      // the tax it was charged, and the item says which class charged it.
      const code = menuItemById.get(line.menuItemId)?.taxClass ?? "standard";
      const entry = byClass.get(code) ?? { taxable: 0, tax: 0 };
      entry.taxable += line.lineTotal.amount;
      entry.tax += line.taxAmount.amount;
      byClass.set(code, entry);
    }

    // Ordered by the pack rather than by encounter, so two receipts from the
    // same branch always list their classes the same way round.
    const order_ = pack?.taxClasses.map((c) => c.code) ?? [...byClass.keys()];
    return order_
      .filter((code) => byClass.has(code))
      .map((code) => {
        const definition = pack?.taxClasses.find((c) => c.code === code);
        const entry = byClass.get(code)!;
        return {
          code,
          label: definition?.label ?? { en: code, ar: code },
          rate: definition?.rate ?? null,
          ...entry,
        };
      });
  }, [order.lines, pack]);

  // The service charge is taxed at the standard rate but is not a line, so
  // it is whatever the total does not account for.
  const lineTax = groups.reduce((sum, g) => sum + g.tax, 0);
  const otherTax = order.taxTotal.amount - lineTax;

  if (groups.length <= 1 && otherTax === 0) {
    return (
      <Row
        label={`${t("pos.tax")}${suffix}`}
        value={formatMoney(order.taxTotal, fmt)}
      />
    );
  }

  return (
    <>
      <Row label={`${t("pos.tax")}${suffix}`} value={formatMoney(order.taxTotal, fmt)} />
      {groups.map((group) => (
        <div
          key={group.code}
          className="text-fg-subtle flex justify-between ps-3 text-[0.7rem]"
        >
          <span>
            {tx(group.label)}
            {group.rate === null ? "" : ` ${group.rate}%`}
            {" · "}
            {formatMoney(money(group.taxable, order.currency), fmt)}
          </span>
          <span className="tabular-nums">
            {formatMoney(money(group.tax, order.currency), fmt)}
          </span>
        </div>
      ))}
      {otherTax !== 0 ? (
        <div className="text-fg-subtle flex justify-between ps-3 text-[0.7rem]">
          <span>{t("pos.serviceCharge")}</span>
          <span className="tabular-nums">
            {formatMoney(money(otherTax, order.currency), fmt)}
          </span>
        </div>
      ) : null}
    </>
  );
}
