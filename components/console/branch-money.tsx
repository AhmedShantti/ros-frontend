"use client";

/**
 * Multi-currency money display — FR-BRN-003, FR-BRN-004.
 *
 * Reusable wherever a figure from one branch is read beside figures from
 * others. The original amount is always shown in its own currency; the
 * converted amount sits next to it with the rate, its source and its date
 * inline, never behind a tooltip, because a number that silently changed
 * currency is exactly what FR-BRN-004 forbids.
 */

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";

import type { Currency, IsoDate, Money } from "@/lib/console/types";
import { consolidate, effectiveRate, findRate, convertMoney, type AppliedRate, type Consolidation, type FxRate } from "@/lib/console/branch-fx";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDate, formatMoney } from "@/lib/console/format";
import { Badge, Callout, cx } from "@/components/console/ui";

/** FR-BRN-004 — the tenant's recorded FX rates. */
export function useFxRates() {
  return useAsync(() => services.branchNetwork.fxRates.all(), []);
}

function RateNote({ rate, from, to }: { rate: AppliedRate; from: Currency; to: Currency }) {
  const { t, fmt } = useI18n();
  return (
    <span className="text-fg-subtle text-[11px] leading-tight" dir="ltr">
      1 {from} = {effectiveRate(rate)} {to} · {rate.source} · {formatDate(rate.rateDate, fmt)}
      {rate.inverted ? ` · ${t("brn.fx.inverse").replace("{base}", rate.base).replace("{quote}", rate.quote)}` : ""}
    </span>
  );
}

/** One amount: original, and — when it differs — converted with the rate named. FR-BRN-004 */
export function ConvertedMoney({
  money,
  to,
  rates,
  asOf,
  compact,
  className,
}: {
  money: Money;
  to: Currency;
  rates: FxRate[];
  asOf: IsoDate;
  compact?: boolean;
  className?: string;
}) {
  const { t, fmt } = useI18n();
  const rate = money.currency === to ? null : findRate(rates, money.currency, to, asOf);
  const converted = convertMoney(money, to, rate);
  return (
    <span className={cx("inline-flex flex-col items-end gap-0.5 text-end", className)}>
      <span className="text-fg font-mono tabular-nums">{formatMoney(money, fmt, compact)}</span>
      {money.currency === to ? null : converted && rate ? (
        <>
          <span className="text-fg-muted font-mono text-xs tabular-nums">≈ {formatMoney(converted, fmt, compact)}</span>
          <RateNote rate={rate} from={money.currency} to={to} />
        </>
      ) : (
        <Badge tone="warn">
          <AlertTriangle size={11} aria-hidden />
          {t("brn.fx.noRate").replace("{from}", money.currency).replace("{to}", to).replace("{date}", formatDate(asOf, fmt))}
        </Badge>
      )}
    </span>
  );
}

/** FR-BRN-004 — a consolidated figure: originals by currency, converted total, rates used. */
export function ConsolidatedTotal<K extends string>({
  consolidation,
  label,
}: {
  consolidation: Consolidation<K>;
  label?: string;
}) {
  const { t, fmt } = useI18n();
  const used = useMemo(() => {
    const seen = new Map<string, { rate: AppliedRate; from: Currency }>();
    for (const line of consolidation.lines) {
      if (line.rate) seen.set(`${line.original.currency}:${line.rate.rateId}`, { rate: line.rate, from: line.original.currency });
    }
    return [...seen.values()];
  }, [consolidation]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-fg-muted text-xs">{label ?? t("brn.fx.convertedTotal").replace("{currency}", consolidation.reportingCurrency)}</p>
          <p className={cx("font-mono text-2xl font-semibold tabular-nums", consolidation.complete ? "text-fg" : "text-warn")}>
            {formatMoney(consolidation.total, fmt)}
          </p>
          <p className="text-fg-subtle text-xs">{t("brn.fx.asOf").replace("{date}", formatDate(consolidation.asOf, fmt))}</p>
        </div>
        <div className="text-end">
          <p className="text-fg-muted text-xs">{t("brn.fx.originals")}</p>
          <ul className="font-mono text-sm tabular-nums">
            {consolidation.byCurrency.map((money) => (
              <li key={money.currency}>{formatMoney(money, fmt)}</li>
            ))}
          </ul>
        </div>
      </div>
      {!consolidation.complete ? (
        <Callout tone="warn">
          {t("brn.fx.incomplete").replace(
            "{pairs}",
            consolidation.missing.map((currency) => `${currency}→${consolidation.reportingCurrency}`).join(", "),
          )}
        </Callout>
      ) : null}
      {used.length > 0 ? (
        <div>
          <p className="text-fg-muted mb-1 text-xs">{t("brn.fx.ratesUsed")}</p>
          <ul className="space-y-0.5">
            {used.map(({ rate, from }) => (
              <li key={`${from}:${rate.rateId}`}>
                <RateNote rate={rate} from={from} to={consolidation.reportingCurrency} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export { consolidate };
