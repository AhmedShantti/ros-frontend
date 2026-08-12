"use client";

/**
 * Shared framing for the console screens that read the live store.
 *
 * These pages show what the terminals on this device have actually done, so
 * they need to say so, and they need somewhere to send a reader who is
 * looking at an empty table because nobody has rung anything up yet.
 */

import Link from "next/link";
import { ChefHat, ScanLine } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatMoney, formatPercent, money } from "@/lib/console/format";
import { Callout, Card, CardHeader } from "./ui";
import { EmptyPanel } from "./states";

export function LiveNotice() {
  const { t } = useI18n();
  return (
    <Callout tone="accent" title={t("live.title")}>
      {t("live.note")}
    </Callout>
  );
}

export function TerminalLinks() {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TerminalButton href="/pos" icon={<ScanLine size={14} />}>
        {t("live.openPos")}
      </TerminalButton>
      <TerminalButton href="/kds" icon={<ChefHat size={14} />}>
        {t("live.openKds")}
      </TerminalButton>
    </div>
  );
}

function TerminalButton({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="border-line bg-raised text-fg hover:bg-sunken inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors"
    >
      {icon}
      {children}
    </Link>
  );
}

export function LiveEmpty({ title }: { title?: string }) {
  const { t } = useI18n();
  return (
    <EmptyPanel
      title={title ?? t("live.empty")}
      body={t("live.emptyBody")}
      action={<TerminalLinks />}
    />
  );
}

/** True once the store has been read from storage — avoids an empty flash. */
export function useLiveReady(): boolean {
  return useLive().ready;
}

/**
 * What the terminals have added today, sitting above the seeded analytics so
 * the two are never confused for each other. It disappears entirely until
 * the first order, rather than showing a row of zeroes.
 */
export function LiveTodayStrip() {
  const { t, fmt } = useI18n();
  const { state } = useLive();

  const completed = state.orderIds
    .map((id) => state.orders[id]!)
    .filter((order) => order && order.state !== "draft" && order.state !== "cancelled");

  if (completed.length === 0) return null;

  const currency = completed[0]!.currency;
  const net = completed.reduce(
    (sum, order) => sum + order.grandTotal.amount + order.roundingAdjustment.amount,
    0,
  );
  const cogs = completed.reduce((sum, order) => sum + order.cogsTotal.amount, 0);
  const foodCost = net > 0 ? (cogs / net) * 100 : 0;

  return (
    <Card>
      <CardHeader
        title={t("live.todayOnDevice")}
        hint={t("live.seededNote")}
        action={<TerminalLinks />}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Figure label={t("orders.title")} value={String(completed.length)} />
        <Figure
          label={t("fin.netSales")}
          value={formatMoney(money(net, currency), fmt)}
        />
        <Figure label={t("orders.cogs")} value={formatMoney(money(cogs, currency), fmt)} />
        <Figure label={t("dash.foodCost")} value={formatPercent(foodCost, fmt)} />
      </div>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-fg-muted text-xs">{label}</p>
      <p className="text-fg mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
