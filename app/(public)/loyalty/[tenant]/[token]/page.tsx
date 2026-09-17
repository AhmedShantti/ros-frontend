"use client";

/**
 * The loyalty balance a receipt QR opens — FR-CRM-022.
 *
 * A lightweight page: no app, no sign-in, no account. It shows the first name,
 * the points, what they are worth, the tier and the last few movements — and
 * nothing that identifies the person to whoever else picks up the receipt
 * (no phone, no email, no surname).
 *
 * ## What works today
 *
 * There is no customer-balance endpoint on the server, so the balance is
 * resolved from the tenant's browser-local loyalty data. That works on the
 * device that holds the data (the till or console that printed the receipt)
 * and nowhere else; on a customer's own phone the page says the balance
 * service is not available yet, rather than showing a number it cannot know.
 */

import { use, useEffect, useState } from "react";
import { Languages } from "lucide-react";

import { resolveBalanceLink, type PublicBalance } from "@/lib/console/services/crm";
import { usePreferences, useI18n } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, money } from "@/lib/console/format";
import { Badge, Button, Callout, Meter, Spinner } from "@/components/console/ui";

export default function LoyaltyBalancePage({
  params,
}: {
  params: Promise<{ tenant: string; token: string }>;
}) {
  const { tenant, token } = use(params);
  const { t, tx, fmt, locale } = useI18n();
  const { setLocale } = usePreferences();
  const [state, setState] = useState<{ loaded: boolean; balance: PublicBalance | null }>({
    loaded: false,
    balance: null,
  });

  useEffect(() => {
    setState({ loaded: true, balance: resolveBalanceLink(decodeURIComponent(tenant), token) });
  }, [tenant, token]);

  const balance = state.balance;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-fg text-lg font-semibold">{t("crm.public.title")}</h1>
        <Button
          size="sm"
          variant="ghost"
          icon={<Languages size={14} />}
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
        >
          {locale === "ar" ? "English" : "العربية"}
        </Button>
      </div>

      {!state.loaded ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !balance ? (
        <Callout tone="warn" title={t("crm.public.notFoundTitle")}>
          {t("crm.public.notFoundBody")}
        </Callout>
      ) : (
        <>
          <section className="border-line bg-raised rounded-2xl border p-5 text-center">
            <p className="text-fg-muted text-sm">{t("crm.public.hello").replace("{name}", balance.firstName)}</p>
            <p className="text-fg mt-2 font-mono text-4xl font-semibold tabular-nums">{formatNumber(balance.points, fmt)}</p>
            <p className="text-fg-muted text-sm">{t("crm.public.points")}</p>
            <p className="text-fg mt-3 text-sm">
              {t("crm.public.worth").replace("{value}", formatMoney(money(balance.valueMinor, "EGP"), fmt))}
            </p>
            {balance.tier ? (
              <Badge tone="accent" className="mt-3">
                <span style={{ color: balance.tier.colour }} aria-hidden>
                  ●
                </span>{" "}
                {tx(balance.tier.name)}
              </Badge>
            ) : null}
          </section>

          {balance.nextTier ? (
            <section className="space-y-1.5">
              <p className="text-fg-muted text-xs">
                {t("crm.public.nextTier")
                  .replace("{n}", formatNumber(balance.nextTier.pointsToGo, fmt))
                  .replace("{tier}", tx(balance.nextTier.name))}
              </p>
              <Meter value={(balance.points / Math.max(1, balance.points + balance.nextTier.pointsToGo)) * 100} />
            </section>
          ) : null}

          {balance.recent.length > 0 ? (
            <section>
              <h2 className="text-fg mb-2 text-sm font-semibold">{t("crm.public.recent")}</h2>
              <ul className="border-line divide-line divide-y rounded-lg border text-sm">
                {balance.recent.map((row, index) => (
                  <li key={index} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-fg-muted">{formatDate(row.occurredAt, fmt)}</span>
                    <span className={row.points >= 0 ? "text-good font-mono tabular-nums" : "text-bad font-mono tabular-nums"}>
                      {row.points > 0 ? "+" : ""}
                      {formatNumber(row.points, fmt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {balance.expiryMonths ? (
            <p className="text-fg-subtle text-xs">
              {t("crm.public.expiry").replace("{n}", String(balance.expiryMonths))}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
