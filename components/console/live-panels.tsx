"use client";

/**
 * Shared framing for the console screens that read the live store.
 *
 * These pages show what the terminals on this device have actually done, so
 * they need to say so, and they need somewhere to send a reader who is
 * looking at an empty table because nobody has rung anything up yet.
 */

import Link from "next/link";
import { useMemo } from "react";
import { ChefHat, ScanLine } from "lucide-react";
import type { OperationalAlert } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { urgencyFor } from "@/lib/console/live/engine";
import { branchById } from "@/lib/console/mock/org";
import { formatMoney, formatPercent, money } from "@/lib/console/format";
import { DATA_MODE } from "@/lib/api/config";
import { Callout, Card, CardHeader } from "./ui";
import { EmptyPanel } from "./states";

/**
 * Where the rows below actually came from.
 *
 * Three answers, and getting it wrong is the whole reason this takes a prop.
 * In demo mode every one of these screens is fed by the terminals on this
 * device. Against a backend, most are fed by the tenant's own record — but a
 * few domains (the kitchen display, tender summaries, the audit trail) have
 * no endpoint at all, and those screens are still device-fed even though the
 * console is live. Saying "take an order on the POS and it lands here" on one
 * of those is a promise the system cannot keep.
 */
export function LiveNotice({ source = "device" }: { source?: "device" | "backend" }) {
  const { t } = useI18n();

  if (DATA_MODE !== "http") {
    return (
      <Callout tone="accent" title={t("live.title")}>
        {t("live.note")}
      </Callout>
    );
  }

  if (source === "backend") {
    return (
      <Callout tone="accent" title={t("live.httpTitle")}>
        {t("live.httpNote")}
      </Callout>
    );
  }

  return (
    <Callout tone="warn" title={t("live.deviceOnlyTitle")}>
      {t("live.deviceOnlyNote")}
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

/**
 * The empty state that matches the notice above it.
 *
 * "Open the POS on this device and ring something up" is the right advice
 * when the device *is* the source. Against a backend it is not: the till the
 * rows would come from may be in another branch entirely, and the usual
 * reason for an empty table is a scope that excludes it.
 */
export function LiveEmpty({
  title,
  source = "device",
}: {
  title?: string;
  source?: "device" | "backend";
}) {
  const { t } = useI18n();

  if (DATA_MODE === "http" && source === "backend") {
    return <EmptyPanel title={title ?? t("live.emptyBackend")} body={t("live.emptyBackendBody")} />;
  }

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

  // The live store is the in-memory simulator, seeded from the fixtures. It
  // is the whole point of the demo build and has no business on a console
  // pointed at a real deployment, where every figure on screen must have
  // come off the wire.
  if (DATA_MODE === "http") return null;

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

/**
 * The alerts the running restaurant has actually raised.
 *
 * The dashboard's alert rail was fed entirely from a static fixture, so two
 * things the site documents as raising an alert produced nothing at all:
 * stock driven negative by a fire, and a ticket past its threshold. Both are
 * surfaced here, mapped onto the same `OperationalAlert` shape the rail
 * already renders so nothing downstream has to know where they came from.
 *
 * The two are sourced differently on purpose:
 *
 *  - **Negative stock** is an event. It happens at a known instant, in the
 *    reducer, so it is stored in live state and survives a reload.
 *  - **A delayed ticket** is not an event — nothing fires when a ticket
 *    crosses its threshold, because the threshold is crossed by the clock
 *    rather than by an action. It is therefore derived on each tick from the
 *    tickets still open, and clears itself when the ticket is bumped.
 */
export function useLiveAlerts(): OperationalAlert[] {
  const { state, ready } = useLive();
  const now = useNow(15_000);

  return useMemo(() => {
    if (!ready) return [];
    // Simulator-raised alerts, on fixture stock. Not a live deployment's.
    if (DATA_MODE === "http") return [];

    const branch = branchById.get(state.branchId) ?? null;
    const branchName = branch?.name ?? null;
    const stockAlerts: OperationalAlert[] = state.alerts.map((alert) => {
      const short = Math.abs(alert.value);
      return {
        id: alert.id,
        kind: "negative_stock",
        severity: alert.severity,
        title: {
          en: "Stock went negative on a fired line",
          ar: "رصيد سالب بعد إرسال طلب للمطبخ",
        },
        detail: {
          en: `${alert.subjectName.en} is ${short.toFixed(0)} ${alert.unit ?? ""} short. The sale was recorded, not blocked — the count needs correcting.`.replace(
            /\s+/g,
            " ",
          ),
          ar: `${alert.subjectName.ar} بالسالب بمقدار ${short.toFixed(0)} ${alert.unit ?? ""}. البيع سُجّل ولم يُمنع — الجرد يحتاج تصحيحًا.`.replace(
            /\s+/g,
            " ",
          ),
        },
        branchId: state.branchId,
        branchName,
        raisedAt: alert.at,
        acknowledged: alert.acknowledged,
        href: "/inventory/levels",
        specRef: "FR-INV-030",
      } satisfies OperationalAlert;
    });

    // FR-KDS-018 — a ticket past critical urgency, still not bumped.
    const delayed = state.ticketIds
      .map((id) => state.tickets[id]!)
      .filter((ticket) => ticket && ticket.state !== "bumped")
      .filter(
        (ticket) =>
          urgencyFor(elapsedSince(ticket.firedAt, now) ?? 0, ticket.targetSeconds) === "critical",
      );

    const ticketAlerts: OperationalAlert[] = delayed.map((ticket) => {
      const lateSeconds = Math.max(0, (elapsedSince(ticket.firedAt, now) ?? 0) - ticket.targetSeconds);
      const lateMinutes = Math.round(lateSeconds / 60);
      return {
        id: `alt_live_${ticket.id}`,
        kind: "order_delayed",
        severity: "high",
        title: {
          en: "Order past its kitchen threshold",
          ar: "طلب تجاوز الحد الزمني في المطبخ",
        },
        detail: {
          en: `${ticket.orderNumber} on ${ticket.stationName.en} is ${lateMinutes} min past target and has not been bumped.`,
          ar: `${ticket.orderNumber} على ${ticket.stationName.ar} متأخر ${lateMinutes} دقيقة عن المستهدف ولم يُسلَّم بعد.`,
        },
        branchId: state.branchId,
        branchName,
        raisedAt: ticket.firedAt,
        acknowledged: false,
        href: "/operations/kitchen",
        specRef: "FR-KDS-018",
      } satisfies OperationalAlert;
    });

    return [...ticketAlerts, ...stockAlerts];
  }, [ready, state, now]);
}
