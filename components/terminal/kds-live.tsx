"use client";

/**
 * The kitchen display, driven by the backend.
 *
 * ## Why this is a separate screen from the demo KDS
 *
 * `app/(terminal)/kds/page.tsx` runs on the in-memory engine in
 * `lib/console/live/`, which simulates more of ch.9 than the API implements:
 * staggered release, an expediter pass view, cancellation acknowledgement,
 * rush and VIP priorities, per-branch station routing. The backend offers
 * this much:
 *
 *   GET  /kds/stations/{id}/queue                 the FIFO queue + config
 *   POST /kds/stations/{id}/tickets/view          first-viewed, write-once
 *   POST /kds/tickets/{id}/lines/{lineId}/start   a cook has taken it on
 *   POST /kds/tickets/{id}/lines/{lineId}/bump    one line is ready
 *   POST /kds/tickets/{id}/bump-all               every eligible line
 *   POST /kds/tickets/{id}/recall                 back inside the window
 *
 * Bridging the simulator onto that would give a display whose Pass tab shows
 * nothing the server knows about and whose rush badge is always absent. So
 * this renders what the API can perform and names the rest as unavailable —
 * the same choice `pos-live.tsx` makes for the till.
 *
 * ## The station is the device's, not the user's
 *
 * The backend binds a KDS terminal to exactly one station and answers 403
 * for any other, so the picker below sets a device setting that survives a
 * reload. A screen on a kitchen wall gets power-cycled, and it has to come
 * back showing the line it was showing — not a chooser nobody is standing at.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, Check, RotateCcw, Timer, Utensils } from "lucide-react";

import type { Id, KitchenTicket, TicketUrgency } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { StationQueue } from "@/lib/console/services/types";
import { useAsync, useStations } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { useNow, elapsedSince } from "@/lib/console/live/store";
import { formatElapsed } from "@/lib/console/format";
import { ORDER_TYPE, TICKET_URGENCY } from "@/lib/console/labels";
import { urgencyFor } from "@/lib/console/live/engine";
import { getKdsStationId, setKdsStationId } from "@/lib/api/session";
import { ErrorPanel } from "@/components/console/states";
import { HoldToBump } from "@/components/terminal/chrome";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Spinner,
  Toast,
  cx,
} from "@/components/console/ui";

/** How often the queue is re-read. Kitchen work is measured in seconds. */
const POLL_MS = 5_000;

/** What the API has no endpoint for, listed once so the copy stays honest. */
const UNSUPPORTED_KEYS = [
  "kds.unsupportedPass",
  "kds.unsupportedPriority",
  "kds.unsupportedCancelReason",
  "kds.unsupportedStagger",
] as const;

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

export function LiveKds() {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const now = useNow(1000);

  const stations = useStations(scope);

  /**
   * The stored station is in `localStorage`, which the server render cannot
   * see. Reading it during render would make the first client paint disagree
   * with the server's, so nothing is decided until after mount.
   */
  const [mounted, setMounted] = useState(false);
  const [stationId, setStation] = useState<Id | null>(null);

  useEffect(() => {
    setStation(getKdsStationId());
    setMounted(true);
  }, []);

  const chooseStation = useCallback((next: Id | null) => {
    setKdsStationId(next);
    setStation(next);
  }, []);

  const [message, setMessage] = useState<string | null>(null);
  const action = useAction(setMessage);

  const queue = useAsync<StationQueue | null>(
    async () => (stationId ? services.kitchen.queue(stationId) : null),
    [stationId],
  );

  /*
   * Polling, not sockets: the API offers no stream, and a kitchen display
   * that is five seconds stale is a kitchen display that works. The interval
   * is torn down while a mutation is in flight so a bump is never overwritten
   * by a queue read that started before it.
   */
  const reload = queue.reload;
  useEffect(() => {
    if (!stationId || action.pending) return;
    const timer = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(timer);
  }, [stationId, action.pending, reload]);

  /*
   * FR-KDS-021 — record that these tickets have been seen on this station.
   *
   * The acknowledgement is write-once on the server, so re-sending an id is
   * harmless and returns zero. This tracks what has already been sent only to
   * avoid a pointless request on every five-second poll; after a reload the
   * set is empty and one no-op call goes out, which is the correct trade for
   * not inventing a client-side notion of "seen".
   */
  const acknowledged = useRef<Set<Id>>(new Set());
  const tickets = useMemo(() => queue.data?.tickets ?? [], [queue.data]);

  useEffect(() => {
    if (!stationId || tickets.length === 0) return;

    const unseen = tickets
      .map((ticket) => ticket.id)
      .filter((id) => !acknowledged.current.has(id));
    if (unseen.length === 0) return;

    for (const id of unseen) acknowledged.current.add(id);

    services.kitchen.acknowledgeViewed(stationId, unseen).catch(() => {
      // A failed acknowledgement must not hide a ticket or stop the display;
      // it is a timing record, and the next mount will send it again.
      for (const id of unseen) acknowledged.current.delete(id);
    });
  }, [stationId, tickets]);

  // The station changed: what was acknowledged on the old one is irrelevant.
  useEffect(() => {
    acknowledged.current = new Set();
  }, [stationId]);

  const active = useMemo(
    () =>
      tickets
        .filter((ticket) => ticket.state !== "bumped")
        .sort((a, b) => new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime()),
    [tickets],
  );

  /**
   * FR-KDS-025 — what can still be pulled back.
   *
   * Only tickets the queue itself returned. There is no endpoint that lists
   * bumped tickets, so if the station queue drops them at the bump this strip
   * is simply empty — which is the truth, rather than a list built from what
   * this browser happens to remember.
   */
  const recallable = useMemo(() => {
    const window = queue.data?.recallWindowSeconds ?? 0;
    return tickets
      .filter((ticket) => {
        if (ticket.state !== "bumped" || !ticket.bumpedAt) return false;
        if (window <= 0) return true;
        return (elapsedSince(ticket.bumpedAt, now) ?? 0) <= window;
      })
      .slice(0, 4);
  }, [tickets, queue.data, now]);

  const allDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of active) {
      for (const line of ticket.lines) {
        if (line.state === "ready" || line.state === "voided") continue;
        counts.set(line.name.en, (counts.get(line.name.en) ?? 0) + line.quantity);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [active]);

  const station = stations.find((row) => row.id === stationId) ?? null;

  // --- gates -------------------------------------------------------------

  if (!mounted) {
    return (
      <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 text-sm">
        <Spinner /> {t("term.loading")}
      </div>
    );
  }

  if (!stationId) {
    return (
      <StationPicker
        stations={stations}
        onChoose={chooseStation}
        title={t("kds.pickStation")}
        note={t("kds.pickStationNote")}
      />
    );
  }

  // --- the display -------------------------------------------------------

  return (
    <>
      <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Badge tone="accent">
          <ChefHat size={12} aria-hidden />
          {station ? tx(station.name) : t("term.station")}
        </Badge>
        <span className="text-fg-subtle text-xs tabular-nums">
          {t("kds.queue")} {active.length}
        </span>
        <div className="flex-1" />
        {action.pending ? <Spinner /> : null}
        <Button size="sm" variant="ghost" onClick={() => chooseStation(null)}>
          {t("kds.changeStation")}
        </Button>
      </div>

      {queue.error ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ErrorPanel error={queue.error} onRetry={queue.reload} />
        </div>
      ) : queue.loading && queue.data === null ? (
        <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 text-sm">
          <Spinner /> {t("term.loading")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {active.length === 0 ? (
              <div className="text-fg-subtle grid h-full place-items-center p-8 text-center">
                <div>
                  <Utensils size={28} className="mx-auto mb-3 opacity-40" aria-hidden />
                  <p className="text-fg text-sm font-medium">{t("kds.noTickets")}</p>
                  <p className="mt-1 text-xs">{t("kds.noTicketsLive")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {active.map((ticket) => (
                  <LiveTicketCard
                    key={ticket.id}
                    ticket={ticket}
                    now={now}
                    cancelledVisibleFor={queue.data?.cancelledLineVisibilitySeconds ?? null}
                    pending={action.pending}
                    onStartLine={(lineId) =>
                      action.run(() => services.kitchen.startLine(ticket.id, lineId), {
                        onSuccess: queue.reload,
                      })
                    }
                    onBumpLine={(lineId) =>
                      action.run(() => services.kitchen.bumpLine(ticket.id, lineId), {
                        onSuccess: queue.reload,
                      })
                    }
                    onBumpAll={() =>
                      action.run(() => services.kitchen.bumpAll(ticket.id), {
                        onSuccess: queue.reload,
                        success: t("kds.bumpedTicket"),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="border-line bg-raised hidden w-60 shrink-0 flex-col overflow-y-auto border-s p-3 lg:flex">
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
                        disabled={action.pending}
                        onClick={() =>
                          action.run(() => services.kitchen.recall(ticket.id), {
                            onSuccess: queue.reload,
                            success: t("kds.recalled"),
                          })
                        }
                        className="border-line hover:bg-sunken flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-start disabled:opacity-50"
                      >
                        <span className="text-fg font-mono text-xs">{ticket.orderNumber}</span>
                        <RotateCcw size={12} className="text-fg-subtle" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="mt-5">
              <h2 className="text-fg text-xs font-semibold">{t("kds.unsupportedTitle")}</h2>
              <ul className="text-fg-subtle mt-1.5 space-y-1 text-[0.68rem] leading-relaxed">
                {UNSUPPORTED_KEYS.map((key) => (
                  <li key={key}>· {t(key)}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function StationPicker({
  stations,
  onChoose,
  title,
  note,
}: {
  stations: ReturnType<typeof useStations>;
  onChoose: (id: Id) => void;
  title: string;
  note: string;
}) {
  const { t, tx } = useI18n();

  return (
    <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto p-4">
      <Card>
        <CardHeader title={title} spec="FR-KDS-020" />
        <Callout tone="muted">{note}</Callout>

        {stations.length === 0 ? (
          <p className="text-fg-muted mt-4 text-sm">{t("kds.noStations")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {stations.map((station) => (
              <li key={station.id}>
                <button
                  type="button"
                  onClick={() => onChoose(station.id)}
                  className="border-line hover:border-accent hover:bg-accent-soft flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-start transition-colors"
                >
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: station.colour }}
                  />
                  <span className="text-fg flex-1 text-sm font-medium">{tx(station.name)}</span>
                  <ChefHat size={14} className="text-fg-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LiveTicketCard({
  ticket,
  now,
  cancelledVisibleFor,
  pending,
  onStartLine,
  onBumpLine,
  onBumpAll,
}: {
  ticket: KitchenTicket;
  now: number;
  cancelledVisibleFor: number | null;
  pending: boolean;
  onStartLine: (lineId: Id) => void;
  onBumpLine: (lineId: Id) => void;
  onBumpAll: () => void;
}) {
  const { t, tx } = useI18n();

  const elapsed = elapsedSince(ticket.firedAt, now) ?? ticket.elapsedSeconds;
  const urgency = urgencyFor(elapsed, ticket.targetSeconds);

  const started = ticket.startedAt !== null;
  const cooking = started ? (elapsedSince(ticket.startedAt!, now) ?? 0) : null;
  const pickup = started ? Math.max(0, elapsed - (cooking ?? 0)) : elapsed;

  /*
   * `cancelledLineVisibilitySeconds` is the branch's answer to how long a
   * struck-off line stays up. It is enforced here rather than filtered on the
   * server, so a line that has been visible longer than the branch asks for
   * drops off — and a null means "keep it up", not "hide it".
   */
  const lines = ticket.lines.filter((line) => {
    if (line.state !== "voided" || cancelledVisibleFor === null) return true;
    // No cancellation timestamp means nothing to time out against, so it
    // stays up — the safe direction for a line a cook may be mid-way through.
    if (!line.cancelledAt) return true;
    return (elapsedSince(line.cancelledAt, now) ?? 0) <= cancelledVisibleFor;
  });

  const outstanding = lines.filter((line) => line.state !== "ready" && line.state !== "voided");

  return (
    <article
      className={cx("flex flex-col rounded-xl border p-3 transition-colors", URGENCY_CARD[urgency])}
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
          {ticket.targetSeconds > 0 ? (
            <p className="text-fg-subtle mt-1 inline-flex items-center gap-1 text-[0.68rem] tabular-nums">
              <Timer size={10} aria-hidden />
              {formatElapsed(ticket.targetSeconds)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone={TICKET_URGENCY[urgency].tone}>{tx(TICKET_URGENCY[urgency].label)}</Badge>
        {started ? (
          <Badge tone="accent">
            <ChefHat size={11} aria-hidden />
            {t("kds.started")}
          </Badge>
        ) : (
          <Badge tone="muted">{t("kds.waiting")}</Badge>
        )}
        {ticket.state === "recalled" ? <Badge tone="warn">{t("kds.recalled")}</Badge> : null}
        <Badge tone="muted">{tx(ticket.stationName)}</Badge>
      </div>

      <ul className="my-3 flex-1 space-y-2">
        {lines.map((line) => {
          const done = line.state === "ready";
          const cancelled = line.state === "voided";
          const cooking = line.state === "preparing";

          return (
            <li key={line.id}>
              <div
                className={cx(
                  "rounded-lg px-2 py-1.5 transition-colors",
                  (done || cancelled) && "opacity-50",
                )}
              >
                <button
                  type="button"
                  disabled={done || cancelled || pending}
                  onClick={() => onBumpLine(line.id)}
                  className={cx(
                    "w-full text-start",
                    !done && !cancelled && "hover:bg-fg/5 rounded-lg",
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
                      {line.modifiers.map((modifier, index) => (
                        <span
                          key={`${line.id}-${index}`}
                          className={cx(
                            "block text-sm leading-snug font-medium",
                            modifier.kind === "removal" ? "text-bad" : "text-accent",
                          )}
                        >
                          {modifier.kind === "removal"
                            ? "− "
                            : modifier.kind === "addition"
                              ? "+ "
                              : "⇄ "}
                          {tx(modifier.name)}
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
                    {done ? (
                      <Check size={16} className="text-good shrink-0" aria-hidden />
                    ) : null}
                  </span>
                </button>

                {/*
                  Start is per line on this API — there is no ticket-level
                  start — so it sits with the line it applies to rather than
                  in the footer where the demo display puts it.
                */}
                {!done && !cancelled && !cooking ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 ms-9"
                    disabled={pending}
                    onClick={() => onStartLine(line.id)}
                  >
                    {t("kds.start")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

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
        <HoldToBump disabled={outstanding.length === 0 || pending} onBump={onBumpAll} />
      </div>
    </article>
  );
}
