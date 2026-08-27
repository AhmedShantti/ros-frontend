"use client";

/**
 * The kitchen display.
 *
 * The KDS answers one question from two metres away: what should I make
 * next? So the type is large, the colour is doing real work (elapsed time
 * against target, FR-KDS-022), and bumping takes a deliberate hold rather
 * than a tap — every kitchen that has used a single-tap screen has the same
 * complaint, which is that elbows and splashes make food disappear.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, ChefHat, RotateCcw, Timer, Utensils } from "lucide-react";
import type { Id, KitchenTicket, TicketUrgency } from "@/lib/console/types";
import { ORDER_TYPE, TICKET_URGENCY } from "@/lib/console/labels";
import { formatElapsed } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { stationsByBranch } from "@/lib/console/live/reducer";
import { recallableAt } from "@/lib/console/live/state";
import { urgencyFor } from "@/lib/console/live/engine";
import { Badge, Button, SegmentedControl, Spinner, cx } from "@/components/console/ui";
import { TerminalBar } from "@/components/terminal/chrome";

type SortMode = "oldest" | "target" | "course";

const URGENCY_CARD: Record<TicketUrgency, string> = {
  on_target: "border-line bg-raised",
  approaching: "border-warn/60 bg-warn-soft",
  exceeded: "border-bad/70 bg-bad-soft",
  critical: "border-bad bg-bad-soft ring-2 ring-bad/40",
};

const URGENCY_TIMER: Record<TicketUrgency, string> = {
  on_target: "text-fg",
  approaching: "text-warn",
  exceeded: "text-bad",
  critical: "text-bad animate-pulse",
};

export default function KdsPage() {
  const { t, tx } = useI18n();
  const { state, dispatch, ready } = useLive();
  const now = useNow(1000);

  const [stationId, setStationId] = useState<Id | "all" | "pass">("all");
  const [sort, setSort] = useState<SortMode>("oldest");

  const stations = useMemo(
    () => (stationsByBranch.get(state.branchId) ?? []).filter((s) => s.active),
    [state.branchId],
  );

  const tickets = useMemo(() => {
    const live = state.ticketIds
      .map((id) => state.tickets[id]!)
      .filter((ticket) => ticket.state !== "bumped" && ticket.branchId === state.branchId);

    const filtered =
      stationId === "all" || stationId === "pass"
        ? live
        : live.filter((ticket) => ticket.stationId === stationId);

    return [...filtered].sort((a, b) => {
      // A cancellation outranks every sort: it is the one card that saves
      // food rather than sequencing it.
      const aDead = a.state === "cancelled" ? 0 : 1;
      const bDead = b.state === "cancelled" ? 0 : 1;
      if (aDead !== bDead) return aDead - bDead;
      if (sort === "course" && a.course !== b.course) return a.course - b.course;
      if (sort === "target") {
        const aLeft = a.targetSeconds - (elapsedSince(a.firedAt, now) ?? 0);
        const bLeft = b.targetSeconds - (elapsedSince(b.firedAt, now) ?? 0);
        return aLeft - bLeft;
      }
      return new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime();
    });
  }, [state, stationId, sort, now]);

  const allDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of tickets) {
      for (const line of ticket.lines) {
        if (line.state === "ready" || line.state === "voided") continue;
        const key = line.name.en;
        counts.set(key, (counts.get(key) ?? 0) + line.quantity);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [tickets]);

  // Bounded by the retention window rather than by a count, so what the
  // strip offers matches what TICKET_RECALL will actually accept.
  const recallable = recallableAt(state.recallable, now)
    .map((entry) => state.tickets[entry.id])
    .filter((x): x is KitchenTicket => Boolean(x))
    .slice(0, 4);

  if (!ready) {
    return (
      <>
        <TerminalBar />
        <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 text-sm">
          <Spinner /> {t("term.loading")}
        </div>
      </>
    );
  }

  return (
    <>
      <TerminalBar />

      <div className="border-line flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <StationChip active={stationId === "all"} onClick={() => setStationId("all")}>
          {t("term.allStations")}
        </StationChip>
        {stations
          .filter((s) => s.type !== "pass")
          .map((station) => {
            const count = state.ticketIds.filter((id) => {
              const ticket = state.tickets[id];
              return ticket && ticket.state !== "bumped" && ticket.stationId === station.id;
            }).length;
            return (
              <StationChip
                key={station.id}
                active={stationId === station.id}
                colour={station.colour}
                onClick={() => setStationId(station.id)}
              >
                {tx(station.name)}
                {count > 0 ? (
                  <span className="ms-1.5 tabular-nums opacity-80">{count}</span>
                ) : null}
              </StationChip>
            );
          })}
        <StationChip active={stationId === "pass"} onClick={() => setStationId("pass")}>
          {t("kds.passTitle")}
        </StationChip>

        <div className="flex-1" />

        <SegmentedControl
          value={sort}
          onChange={setSort}
          label={t("kds.sortBy")}
          options={[
            { value: "oldest", label: t("kds.sortOldest") },
            { value: "target", label: t("kds.sortTarget") },
            { value: "course", label: t("kds.sortCourse") },
          ]}
        />
      </div>

      {stationId === "pass" ? (
        <PassView />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tickets.length === 0 ? (
              <div className="text-fg-subtle grid h-full place-items-center p-8 text-center">
                <div>
                  <Utensils size={28} className="mx-auto mb-3 opacity-40" aria-hidden />
                  <p className="text-fg text-sm font-medium">{t("kds.noTickets")}</p>
                  <p className="mt-1 text-xs">{t("kds.noTicketsNote")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {tickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} now={now} />
                ))}
              </div>
            )}
          </div>

          <aside className="border-line bg-raised hidden w-60 shrink-0 flex-col border-s p-3 lg:flex">
            <h2 className="text-fg text-xs font-semibold">{t("kds.allDay")}</h2>
            <p className="text-fg-subtle mt-0.5 mb-2 text-[0.68rem] leading-relaxed">
              {t("kds.allDayNote")}
            </p>
            {allDay.length === 0 ? (
              <p className="text-fg-subtle text-xs">—</p>
            ) : (
              <ul className="space-y-1">
                {allDay.map(([name, count]) => (
                  <li
                    key={name}
                    className="border-line flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                  >
                    <span className="text-fg min-w-0 truncate text-xs">{name}</span>
                    <span className="text-fg text-base font-bold tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}

            {recallable.length > 0 ? (
              <>
                <h2 className="text-fg mt-5 text-xs font-semibold">{t("kds.recall")}</h2>
                <p className="text-fg-subtle mt-0.5 mb-2 text-[0.68rem]">FR-KDS-025</p>
                <ul className="space-y-1">
                  {recallable.map((ticket) => (
                    <li key={ticket.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "TICKET_RECALL", ticketId: ticket.id })}
                        className="border-line hover:bg-sunken flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-start"
                      >
                        <span className="text-fg font-mono text-xs">{ticket.orderNumber}</span>
                        <RotateCcw size={12} className="text-fg-subtle" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}

function StationChip({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? colour
            ? "text-white"
            : "border-accent bg-accent-soft text-accent"
          : "border-line bg-raised text-fg-muted hover:text-fg",
      )}
      style={active && colour ? { background: colour, borderColor: colour } : undefined}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ticket card
// ---------------------------------------------------------------------------

function TicketCard({ ticket, now }: { ticket: KitchenTicket; now: number }) {
  const { t, tx } = useI18n();
  const { dispatch } = useLive();

  const elapsed = elapsedSince(ticket.firedAt, now) ?? 0;
  const urgency = urgencyFor(elapsed, ticket.targetSeconds);
  const outstanding = ticket.lines.filter((l) => l.state !== "ready" && l.state !== "voided");

  // Two different questions, and the elapsed clock alone answers only the
  // first: how long has the guest waited, and how long has anyone actually
  // been cooking? A ticket sitting untouched has a large first and no second.
  const started = ticket.startedAt !== null;
  const cooking = started ? (elapsedSince(ticket.startedAt!, now) ?? 0) : null;
  const pickup = started ? Math.max(0, elapsed - (cooking ?? 0)) : elapsed;

  // A cancelled ticket is a different card, not a variant of this one. It
  // carries no timers, no line controls and one action, because the only
  // thing being asked of the cook is to stop and say they have seen it.
  if (ticket.state === "cancelled") {
    return <CancelledCard ticket={ticket} />;
  }

  return (
    <article
      className={cx(
        "flex flex-col rounded-xl border p-3 transition-colors",
        URGENCY_CARD[urgency],
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-fg font-mono text-lg leading-none font-bold">{ticket.orderNumber}</p>
          <p className="text-fg-muted mt-1 text-xs">
            {tx(ORDER_TYPE[ticket.orderType].label)}
            {ticket.tableLabel ? ` · ${ticket.tableLabel}` : ""}
            {ticket.course > 1 ? ` · ${t("pos.course")} ${ticket.course}` : ""}
          </p>
        </div>
        <div className="text-end">
          <p className="text-fg-subtle text-[0.6rem] leading-none uppercase">
            {t("kds.waitTotal")}
          </p>
          <p
            className={cx(
              "mt-0.5 text-2xl leading-none font-bold tabular-nums",
              URGENCY_TIMER[urgency],
            )}
          >
            {formatElapsed(elapsed)}
          </p>
          <p className="text-fg-subtle mt-1 inline-flex items-center gap-1 text-[0.68rem] tabular-nums">
            <Timer size={10} aria-hidden />
            {formatElapsed(ticket.targetSeconds)}
          </p>
        </div>
      </header>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone={TICKET_URGENCY[urgency].tone}>{tx(TICKET_URGENCY[urgency].label)}</Badge>
        {/*
          Who is on it, stated rather than implied by the Start button's
          absence. On a shared line the difference between "queued" and
          "someone has this" is the thing that stops two cooks making it twice.
        */}
        {started ? (
          <Badge tone="accent">
            <ChefHat size={11} aria-hidden />
            {t("kds.started")}
          </Badge>
        ) : (
          <Badge tone="muted">{t("kds.waiting")}</Badge>
        )}
        {ticket.priority === "rush" ? <Badge tone="bad">{t("kds.rush")}</Badge> : null}
        {ticket.priority === "vip" ? <Badge tone="accent">{t("kds.vip")}</Badge> : null}
        {ticket.priority === "remake" ? <Badge tone="warn">{t("kds.amended")}</Badge> : null}
        <Badge tone="muted">{tx(ticket.stationName)}</Badge>
      </div>

      <ul className="my-3 flex-1 space-y-2">
        {ticket.lines.map((line) => {
          const done = line.state === "ready";
          const cancelled = line.state === "voided";
          return (
            <li key={line.id}>
              <button
                type="button"
                disabled={done || cancelled}
                onClick={() =>
                  dispatch({
                    type: "TICKET_BUMP_LINE",
                    ticketId: ticket.id,
                    lineId: line.id,
                  })
                }
                className={cx(
                  "w-full rounded-lg px-2 py-1.5 text-start transition-colors",
                  !done && !cancelled && "hover:bg-fg/5",
                  (done || cancelled) && "opacity-50",
                )}
              >
                <span className="flex items-start gap-2">
                  <span className="text-fg w-7 shrink-0 text-xl leading-tight font-bold tabular-nums">
                    {line.quantity}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        "text-fg block text-lg leading-tight font-semibold",
                        (done || cancelled) && "line-through",
                      )}
                    >
                      {tx(line.name)}
                    </span>
                    {line.modifiers.map((m, i) => (
                      <span
                        key={`${line.id}-${i}`}
                        className={cx(
                          "block text-sm leading-snug font-medium",
                          m.kind === "removal" ? "text-bad" : "text-accent",
                        )}
                      >
                        {m.kind === "removal" ? "− " : m.kind === "addition" ? "+ " : "⇄ "}
                        {tx(m.name)}
                      </span>
                    ))}
                    {line.notes ? (
                      <span className="text-fg-muted block text-sm italic">“{line.notes}”</span>
                    ) : null}
                    {cancelled ? (
                      <span className="text-bad block text-xs font-semibold">
                        {t("kds.voidedLine")}
                      </span>
                    ) : null}
                  </span>
                  {done ? <Check size={16} className="text-good shrink-0" aria-hidden /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        The split the elapsed clock cannot show: time lost before anyone
        picked the ticket up, against time actually spent cooking.
      */}
      <dl className="border-line text-fg-subtle mb-2 flex items-center gap-3 border-t pt-2 text-[0.68rem] tabular-nums">
        <div className="flex items-center gap-1">
          <dt>{t("kds.pickup")}</dt>
          <dd className="text-fg-muted font-medium">{formatElapsed(pickup)}</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt>{t("kds.cookTime")}</dt>
          <dd className={cx("font-medium", started ? "text-fg-muted" : "text-fg-subtle")}>
            {cooking === null ? "—" : formatElapsed(cooking)}
          </dd>
        </div>
      </dl>

      <div className="flex gap-1.5">
        {ticket.state === "queued" ? (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => dispatch({ type: "TICKET_START", ticketId: ticket.id })}
          >
            {t("kds.start")}
          </Button>
        ) : null}
        <HoldToBump
          disabled={outstanding.length === 0}
          onBump={() => dispatch({ type: "TICKET_BUMP", ticketId: ticket.id })}
        />
      </div>
    </article>
  );
}

/**
 * The card a cook sees when the till cancels an order they may be cooking.
 *
 * Loud on purpose. This is the only card on the display whose job is to stop
 * work rather than direct it, and the cost of it being missed is food that
 * gets made, plated and thrown away.
 */
function CancelledCard({ ticket }: { ticket: KitchenTicket }) {
  const { t, tx } = useI18n();
  const { dispatch } = useLive();

  return (
    <article className="border-bad bg-bad-soft ring-bad/40 flex flex-col rounded-xl border-2 p-3 ring-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-fg font-mono text-lg leading-none font-bold">{ticket.orderNumber}</p>
          <p className="text-fg-muted mt-1 text-xs">
            {tx(ORDER_TYPE[ticket.orderType].label)}
            {ticket.tableLabel ? ` · ${ticket.tableLabel}` : ""}
          </p>
        </div>
        <Ban size={28} className="text-bad shrink-0" aria-hidden />
      </header>

      <p className="text-bad mt-3 text-xl leading-none font-extrabold tracking-wide">
        {t("kds.orderCancelled")}
      </p>
      <p className="text-fg mt-1.5 text-sm font-medium">{t("kds.stopMaking")}</p>

      {ticket.cancelReason ? (
        <p className="text-fg-muted mt-2 text-xs">
          <span className="text-fg-subtle">{t("kds.cancelReason")}: </span>
          <span className="italic">“{ticket.cancelReason}”</span>
        </p>
      ) : null}

      <ul className="text-fg-muted my-3 flex-1 space-y-1 text-sm">
        {ticket.lines.map((line) => (
          <li key={line.id} className="flex gap-2 line-through">
            <span className="font-bold">{line.quantity}</span>
            <span className="min-w-0 flex-1">{tx(line.name)}</span>
          </li>
        ))}
      </ul>

      {/*
        A plain button, not a hold: the hold on Bump guards against food
        vanishing by accident, and here the accident it would guard against
        has already happened at the till.
      */}
      <Button
        variant="danger"
        className="w-full"
        onClick={() => dispatch({ type: "TICKET_ACK_CANCEL", ticketId: ticket.id })}
      >
        {t("kds.ackCancel")}
      </Button>
    </article>
  );
}

/**
 * FR-KDS-026 — bumping requires a deliberate hold. The progress fill is the
 * feedback that makes an 800 ms press feel intentional rather than laggy.
 */
function HoldToBump({ onBump, disabled }: { onBump: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  function start() {
    if (disabled) return;
    const startedAt = Date.now();
    timer.current = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / 800);
      setProgress(ratio);
      if (ratio >= 1) {
        stop();
        onBump();
      }
    }, 30);
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      title={t("kds.bumpNote")}
      className="bg-accent text-accent-fg relative flex-1 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-45"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 bg-black/25 transition-[width] duration-75"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative">{progress > 0 ? t("kds.holdToBump") : t("kds.bumpAll")}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Expediter — FR-KDS-013
// ---------------------------------------------------------------------------

function PassView() {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const now = useNow(1000);

  const orders = useMemo(() => {
    const ids = new Set<Id>();
    for (const id of state.ticketIds) {
      const ticket = state.tickets[id];
      if (ticket && ticket.branchId === state.branchId) ids.add(ticket.orderId);
    }
    return [...ids]
      .map((id) => state.orders[id])
      .filter((order) => order && order.state !== "completed" && order.state !== "cancelled")
      .map((order) => order!);
  }, [state]);

  if (orders.length === 0) {
    return (
      <div className="text-fg-subtle grid flex-1 place-items-center p-8 text-center">
        <div>
          <Utensils size={28} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p className="text-fg text-sm font-medium">{t("kds.noTickets")}</p>
          <p className="mt-1 text-xs">{t("kds.passNote")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => {
          const tickets = state.ticketIds
            .map((id) => state.tickets[id]!)
            .filter((ticket) => ticket.orderId === order.id);
          const pendingStations = tickets.filter((ticket) => ticket.state !== "bumped");
          const ready = pendingStations.length === 0;
          const elapsed = order.firstFiredAt ? (elapsedSince(order.firstFiredAt, now) ?? 0) : 0;

          return (
            <article
              key={order.id}
              className={cx(
                "rounded-xl border p-3",
                ready ? "border-good bg-good-soft" : "border-line bg-raised",
              )}
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-fg font-mono text-lg font-bold">{order.orderNumber}</p>
                  <p className="text-fg-muted text-xs">
                    {tx(ORDER_TYPE[order.orderType].label)}
                    {order.tableLabel ? ` · ${order.tableLabel}` : ""}
                  </p>
                </div>
                <p className="text-fg text-xl font-bold tabular-nums">{formatElapsed(elapsed)}</p>
              </header>

              <ul className="mt-2 flex flex-wrap gap-1">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Badge tone={ticket.state === "bumped" ? "good" : "warn"} dot>
                      {tx(ticket.stationName)}
                    </Badge>
                  </li>
                ))}
              </ul>

              <ul className="mt-3 space-y-1">
                {order.lines
                  .filter((line) => line.state !== "voided")
                  .map((line) => (
                    <li key={line.id} className="text-fg flex gap-2 text-sm">
                      <span className="w-6 shrink-0 font-bold tabular-nums">{line.quantity}</span>
                      <span className="min-w-0">{tx(line.itemNameSnapshot)}</span>
                    </li>
                  ))}
              </ul>

              <div className="mt-3">
                {ready ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    icon={<Check size={14} />}
                    onClick={() => dispatch({ type: "ORDER_SERVE", orderId: order.id })}
                  >
                    {t("kds.serve")}
                  </Button>
                ) : (
                  <p className="text-fg-subtle text-xs">
                    {t("kds.waitingOn").replace(
                      "{stations}",
                      pendingStations.map((ticket) => tx(ticket.stationName)).join(", "),
                    )}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
