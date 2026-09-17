"use client";

/**
 * Cash session detail — FR-FIN-003, FR-FIN-007, FR-FIN-010.
 *
 * A closed session is shown as it was closed and nothing on it can be
 * changed. Corrections are recorded beside it as adjusting entries that name
 * the session, and the adjusted variance is presented next to the original,
 * never in place of it.
 */

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";

import type { Order } from "@/lib/console/types";
import type { LiveCashSession } from "@/lib/console/live/state";
import { services } from "@/lib/console/services";
import {
  CASH_ADJUSTMENT_KINDS,
  type CashAdjustment,
  type CashAdjustmentKind,
} from "@/lib/console/services/finance-adjustments";
import { sessionTenderTotals } from "@/lib/console/finance-tenders";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { TenderTotalsTable } from "@/components/console/finance-tenders";
import { SharedDrawerBadge } from "@/components/console/finance-policy";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  SegmentedControl,
  Select,
  Textarea,
  cx,
} from "@/components/console/ui";

export function SessionDrawer({
  session,
  orders,
  shared,
  onClose,
}: {
  session: LiveCashSession | null;
  orders: Order[];
  shared: boolean;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();

  const adjustments = useAsync<CashAdjustment[]>(
    () => (session ? services.cashAdjustments.forSession(session.id) : Promise.resolve([])),
    [session?.id],
  );

  const tenders = useMemo(
    () => (session ? sessionTenderTotals(orders, session) : null),
    [orders, session],
  );

  if (!session) return null;

  const closed = session.status === "closed" && session.closedAt !== null;
  const currency = session.openingFloat.currency;
  const adjustmentTotal = (adjustments.data ?? []).reduce((sum, row) => sum + row.amount.amount, 0);
  const adjustedVariance = session.variance.amount + adjustmentTotal;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${session.terminalName} · ${tx(session.employeeName)}`}
      subtitle={formatDateTime(session.openedAt, fmt)}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5">
          {closed ? (
            <Badge tone="muted">
              <Lock size={11} aria-hidden />
              {t("fnc.immutable")}
            </Badge>
          ) : (
            <Badge tone="accent">{t("fnc.sessionOpen")}</Badge>
          )}
          {shared ? <SharedDrawerBadge /> : null}
        </div>

        {shared ? (
          // FR-FIN-003 — the cashier named here opened the drawer; others may
          // have worked it, so the variance belongs to the shift.
          <Callout tone="warn" title={t("fnc.reducedControlTitle")}>
            {t("fnc.sharedSessionNote")}
          </Callout>
        ) : null}

        {/* FR-FIN-007 — read-only as closed: no edit control exists for these figures. */}
        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.asClosed")}</h3>
          <DescList>
            <DescRow label={t("fin.openingFloat")} mono>{formatMoney(session.openingFloat, fmt)}</DescRow>
            <DescRow label={t("fin.cashSales")} mono>{formatMoney(session.cashSales, fmt)}</DescRow>
            <DescRow label={t("fin.cashRefunds")} mono>{formatMoney(session.cashRefunds, fmt)}</DescRow>
            <DescRow label={t("fin.payIns")} mono>{formatMoney(session.payIns, fmt)}</DescRow>
            <DescRow label={t("fin.payOuts")} mono>{formatMoney(session.payOuts, fmt)}</DescRow>
            <DescRow label={t("fin.safeDrops")} mono>{formatMoney(session.safeDrops, fmt)}</DescRow>
            <DescRow label={t("fin.expectedCash")} mono>{formatMoney(session.expectedCash, fmt)}</DescRow>
            <DescRow label={t("fin.countedCash")} mono>
              {session.countedCash ? formatMoney(session.countedCash, fmt) : "—"}
            </DescRow>
            <DescRow label={t("fin.closing")}>{session.closedAt ? formatDateTime(session.closedAt, fmt) : "—"}</DescRow>
          </DescList>
        </section>

        {closed ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("common.variance")}</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <VarianceCell label={t("fnc.originalVariance")} amount={session.variance.amount} currency={currency} />
              <VarianceCell label={t("fnc.adjustmentsTotal")} amount={adjustmentTotal} currency={currency} />
              <VarianceCell label={t("fnc.adjustedVariance")} amount={adjustedVariance} currency={currency} strong />
            </div>
          </section>
        ) : null}

        {/* FR-FIN-010 — tender totals attributed to this session. */}
        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("fnc.tenderTotals")}</h3>
          <p className="text-fg-subtle mb-2 text-xs">{t("fnc.attributionNote")}</p>
          {tenders && tenders.rows.length > 0 ? (
            <TenderTotalsTable rows={tenders.rows} currency={tenders.currency ?? currency} />
          ) : (
            <p className="text-fg-subtle text-sm">{t("fnc.noPayments")}</p>
          )}
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.adjustingEntries")}</h3>
          {(adjustments.data ?? []).length === 0 ? (
            <p className="text-fg-subtle text-sm">{t("fnc.noAdjustments")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {(adjustments.data ?? []).map((row) => (
                <li key={row.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone="neutral">{t(`fnc.adjKind.${row.kind}` as ConsoleKey)}</Badge>
                    <span className={cx("font-mono tabular-nums", row.amount.amount < 0 ? "text-bad" : "text-good")}>
                      {formatMoney(row.amount, fmt)}
                    </span>
                  </div>
                  <p className="text-fg-muted mt-1 text-xs">{row.reason}</p>
                  <p className="text-fg-subtle mt-0.5 text-[0.7rem]">
                    {formatDateTime(row.at, fmt)} · {row.by ?? "—"} ·{" "}
                    <span className="font-mono" dir="ltr">{row.id}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}

          {closed ? (
            <AdjustmentForm session={session} onRecorded={adjustments.reload} />
          ) : (
            <Callout tone="muted">{t("fnc.adjustOnlyClosed")}</Callout>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function VarianceCell({
  label,
  amount,
  currency,
  strong,
}: {
  label: string;
  amount: number;
  currency: LiveCashSession["variance"]["currency"];
  strong?: boolean;
}) {
  const { fmt } = useI18n();
  return (
    <div className="border-line rounded-lg border p-2">
      <p className="text-fg-subtle text-[0.7rem]">{label}</p>
      <p
        className={cx(
          "mt-1 font-mono text-sm tabular-nums",
          strong && "font-semibold",
          amount < 0 ? "text-bad" : amount > 0 ? "text-good" : "text-fg",
        )}
      >
        {formatMoney(money(amount, currency), fmt)}
      </p>
    </div>
  );
}

function AdjustmentForm({ session, onRecorded }: { session: LiveCashSession; onRecorded: () => void }) {
  const { t, fmt } = useI18n();
  const { session: auth } = useSession();
  const canRecord = usePermission("cash.session.view");
  const confirm = useConfirm();
  const [kind, setKind] = useState<CashAdjustmentKind>("counted_cash");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency = session.openingFloat.currency;
  const valid = amount !== null && amount > 0 && reason.trim().length >= 10;

  async function submit() {
    if (!valid || amount === null) return;
    const signed = direction === "increase" ? amount : -amount;
    const ok = await confirm({
      title: t("fnc.confirmAdjustTitle"),
      body: t("fnc.confirmAdjustBody")
        .replace("{amount}", formatMoney(money(signed, currency), fmt))
        .replace("{session}", session.id),
      confirmLabel: t("fnc.recordAdjustment"),
      tone: "warn",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await services.cashAdjustments.record({
        session,
        kind,
        amount: money(signed, currency),
        reason,
        by: auth?.user.email ?? null,
      });
      setAmount(null);
      setReason("");
      onRecorded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!canRecord) return null;

  return (
    <div className="border-line mt-4 space-y-3 rounded-lg border p-3">
      <p className="text-fg text-sm font-medium">{t("fnc.recordAdjustment")}</p>
      <p className="text-fg-subtle text-xs">{t("fnc.adjustmentHint")}</p>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <Field label={t("fnc.adjustmentKind")}>
        <Select value={kind} onChange={(event) => setKind(event.target.value as CashAdjustmentKind)}>
          {CASH_ADJUSTMENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`fnc.adjKind.${value}` as ConsoleKey)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("fnc.direction")}>
        <SegmentedControl
          value={direction}
          onChange={setDirection}
          options={[
            { value: "increase", label: t("fnc.increase") },
            { value: "decrease", label: t("fnc.decrease") },
          ]}
        />
      </Field>
      <Field label={t("fin.amount")} required>
        <MoneyInput value={amount} onChange={setAmount} currency={currency} min={0} />
      </Field>
      <Field label={t("fnc.reason")} hint={t("fnc.reasonHint")} required>
        <Textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <Button variant="primary" disabled={!valid || busy} loading={busy} onClick={submit}>
        {t("fnc.recordAdjustment")}
      </Button>
      <p className="text-fg-subtle text-[0.7rem]">
        {formatNumber((reason.trim().length), fmt)} / 10
      </p>
    </div>
  );
}
