"use client";

/**
 * The kitchen display.
 *
 * The KDS answers one question from two metres away: what should I make
 * next? So the type is large (NFR-USA-006), the colour is doing real work
 * (elapsed time against target, FR-KDS-022), and bumping takes a deliberate
 * hold rather than a tap — every kitchen that has used a single-tap screen
 * has the same complaint, which is that elbows and splashes make food
 * disappear.
 */

import { useEffect, useMemo, useState } from "react";
import { Ban, Check, ChefHat, Flag, Hourglass, ImageIcon, LayoutList, ListOrdered, RotateCcw, RefreshCcw, Timer, Utensils } from "lucide-react";
import type { Id, KitchenTicket, TicketLine, TicketUrgency } from "@/lib/console/types";
import { ORDER_TYPE, TICKET_URGENCY } from "@/lib/console/labels";
import { formatElapsed, formatTime } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { services } from "@/lib/console/services";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { stationsByBranch } from "@/lib/console/live/reducer";
import { recallableAt } from "@/lib/console/live/state";
import { urgencyFor } from "@/lib/console/live/engine";
import {
  allDayCounts,
  cancelledLineVisible,
  capacityReading,
  groupAmendments,
  lineUrgency,
  secondsUntilRelease,
  sortTickets,
  stationSetupOf,
  type KdsSortMode,
} from "@/lib/console/live/kds";
import { Badge, Button, Modal, Spinner, Toast, cx } from "@/components/console/ui";
import { HoldToBump, TerminalBar } from "@/components/terminal/chrome";
import { DATA_MODE } from "@/lib/api/config";
import { LiveKds } from "@/components/terminal/kds-live";
import { KdsSoundControl, useKdsSound } from "@/components/terminal/kds-audio";
import { useKdsAlerts } from "@/components/terminal/kds-alerts";
import {
  AllDayBoard,
  AllDayList,
  ArmedHint,
  CapacityBanner,
  ItemPicture,
  KDS_ITEM_TEXT,
  KDS_QTY_TEXT,
  PRIORITY_FRAME,
  PriorityBand,
  SortPicker,
  TimelineButton,
  TimelineSheet,
  useArmedTap,
  useItemVisuals,
} from "@/components/terminal/kds-parts";
import { useKdsDevicePrefs } from "@/components/terminal/kds-prefs";

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

/** FR-KDS-044 — a line's own timer chip, coloured against its own target. */
const URGENCY_CHIP: Record<TicketUrgency, string> = {
  on_target: "border-line text-fg-muted",
  approaching: "border-warn bg-warn-soft text-warn",
  exceeded: "border-bad bg-bad-soft text-bad",
  critical: "border-bad bg-bad text-white animate-pulse",
};

/**
 * Two displays, chosen by whether a backend is configured.
 *
 * The demo display below runs on the in-memory engine and simulates the
 * whole of ch.9 — staggered release, the expediter pass, cancellation
 * acknowledgement, rush and VIP. The backend implements six KDS operations
 * and none of that, so `LiveKds` renders exactly what the API can perform
 * and names the rest as unavailable. Same split as `/pos`.
 */
export default function KdsPage() {
  const { training } = useLive();
  // NFR-USA-005 — the training sandbox always runs on the simulator.
  if (DATA_MODE === "http" && !training) {
    return (
      <>
        <TerminalBar />
        <LiveKds />
      </>
    );
  }
  return <DemoKds />;
}

function DemoKds() {
  const { t, tx } = useI18n();
  const { state, dispatch, ready } = useLive();
  const now = useNow(1000);
  const sound = useKdsSound();
  const visuals = useItemVisuals();
  const prefs = useKdsDevicePrefs();

  const [stationId, setStationId] = useState<Id | "all" | "pass">("all");
  const [view, setView] = useState<"tickets" | "allday">("tickets");
  const [message, setMessage] = useState<string | null>(null);
  const [timelineOf, setTimelineOf] = useState<{ ticket: KitchenTicket; amendments: KitchenTicket[] } | null>(null);
  const [flagging, setFlagging] = useState<KitchenTicket | null>(null);

  const setup = state.kdsSetup;
  const iconMode = prefs.iconMode ?? setup.iconMode;

  const stations = useMemo(
    () => (stationsByBranch.get(state.branchId) ?? []).filter((s) => s.active),
    [state.branchId],
  );
  const selectedStation = stations.find((s) => s.id === stationId) ?? null;

  const live = useMemo(
    () =>
      state.ticketIds
        .map((id) => state.tickets[id]!)
        .filter((ticket) => ticket && ticket.state !== "bumped" && ticket.branchId === state.branchId),
    [state.ticketIds, state.tickets, state.branchId],
  );

  const onScreen = useMemo(
    () => (selectedStation ? live.filter((ticket) => ticket.stationId === selectedStation.id) : live),
    [live, selectedStation],
  );

  // FR-KDS-023 — a station's sort is the station's; the all-stations view is this screen's own.
  const sortMode: KdsSortMode = selectedStation ? stationSetupOf(setup, selectedStation.id).sort : prefs.allSort;

  const groups = useMemo(
    () => groupAmendments(sortTickets(onScreen, sortMode, now, setup.orderTypePriority)),
    [onScreen, sortMode, now, setup.orderTypePriority],
  );

  // FR-KDS-030 — outstanding quantity per item on what this screen shows.
  const allDay = useMemo(() => allDayCounts(onScreen, now), [onScreen, now]);

  // FR-KDS-045 — every station's queue against its next fifteen minutes.
  const capacity = useMemo(() => {
    const map = new Map<Id, ReturnType<typeof capacityReading>>();
    for (const station of stations) {
      if (station.type === "pass") continue;
      map.set(
        station.id,
        capacityReading(
          live.filter((ticket) => ticket.stationId === station.id),
          station.capacityPerHour,
          stationSetupOf(setup, station.id),
        ),
      );
    }
    return map;
  }, [stations, live, setup]);
  const overStations = stations.filter((station) => capacity.get(station.id)?.over);
  const overCapacity = selectedStation ? Boolean(capacity.get(selectedStation.id)?.over) : overStations.length > 0;

  const flashing = useKdsAlerts({
    tickets: stationId === "pass" ? live : onScreen,
    nowMs: now,
    alerts: setup.alerts,
    overCapacity,
    play: sound.play,
  });

  /*
   * FR-KDS-040 — first viewed. Recorded once, the first time a ticket is on
   * a station display. The pass view shows orders, not tickets, so it does
   * not count.
   */
  const unseenKey = onScreen
    .filter((ticket) => !ticket.timeline?.firstViewedAt && secondsUntilRelease(ticket, now) === 0)
    .map((ticket) => ticket.id)
    .join(",");
  useEffect(() => {
    if (!ready || stationId === "pass" || view !== "tickets" || !unseenKey) return;
    dispatch({ type: "TICKET_VIEWED", ticketIds: unseenKey.split(",") });
  }, [ready, stationId, view, unseenKey, dispatch]);

  // Bounded by the retention window rather than by a count, so what the
  // strip offers matches what TICKET_RECALL will actually accept.
  const recallable = recallableAt(state.recallable, now)
    .map((entry) => state.tickets[entry.id])
    .filter((x): x is KitchenTicket => Boolean(x))
    .filter((ticket) => !selectedStation || ticket.stationId === selectedStation.id)
    .slice(0, 4);

  async function changeSort(next: KdsSortMode) {
    if (!selectedStation) {
      prefs.setAllSort(next);
      return;
    }
    try {
      await services.kdsSetup.save({
        ...setup,
        stations: { ...setup.stations, [selectedStation.id]: { ...stationSetupOf(setup, selectedStation.id), sort: next } },
      });
      setMessage(t("kdsView.sortSaved").replace("{station}", tx(selectedStation.name)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("kdsView.sortNotSaved"));
    }
  }

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
            const count = live.filter((ticket) => ticket.stationId === station.id).length;
            const over = capacity.get(station.id)?.over === true;
            return (
              <StationChip
                key={station.id}
                active={stationId === station.id}
                colour={station.colour}
                warn={over}
                onClick={() => setStationId(station.id)}
              >
                {tx(station.name)}
                {count > 0 ? <span className="ms-1.5 tabular-nums opacity-80">{count}</span> : null}
              </StationChip>
            );
          })}
        <StationChip active={stationId === "pass"} onClick={() => setStationId("pass")}>
          {t("kds.passTitle")}
        </StationChip>
      </div>

      <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {stationId !== "pass" ? (
          <>
            <ToolToggle
              pressed={view === "allday"}
              onClick={() => setView(view === "allday" ? "tickets" : "allday")}
              icon={view === "allday" ? <LayoutList size={18} /> : <ListOrdered size={18} />}
            >
              {view === "allday" ? t("kdsView.showTickets") : t("kds.allDay")}
            </ToolToggle>
            {view === "tickets" ? (
              <SortPicker
                value={sortMode}
                onChange={(next) => void changeSort(next)}
                note={selectedStation ? t("kdsView.sortStationNote") : t("kdsView.sortScreenNote")}
              />
            ) : null}
          </>
        ) : null}
        <div className="flex-1" />
        {/* FR-KDS-031 — pictures for kitchens where reading cannot be assumed. */}
        <ToolToggle pressed={iconMode} onClick={() => prefs.setIconMode(!iconMode)} icon={<ImageIcon size={18} />}>
          {t("kdsView.iconMode")}
        </ToolToggle>
        <KdsSoundControl sound={sound} />
      </div>

      {stationId !== "pass" ? (
        selectedStation ? (
          <CapacityBanner reading={capacity.get(selectedStation.id)!} stationName={tx(selectedStation.name)} />
        ) : overStations.length > 0 ? (
          <div role="alert" className="border-bad bg-bad-soft text-bad shrink-0 border-b px-4 py-2 text-base font-semibold">
            {t("kdsView.capacityOverMany").replace("{stations}", overStations.map((s) => tx(s.name)).join(", "))}
          </div>
        ) : null
      ) : null}

      {stationId === "pass" ? (
        <PassView />
      ) : view === "allday" ? (
        <AllDayBoard rows={allDay} iconMode={iconMode} visuals={visuals} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {groups.length === 0 ? (
              <div className="text-fg-subtle grid h-full place-items-center p-8 text-center">
                <div>
                  <Utensils size={28} className="mx-auto mb-3 opacity-40" aria-hidden />
                  <p className="text-fg text-sm font-medium">{t("kds.noTickets")}</p>
                  <p className="mt-1 text-xs">{t("kds.noTicketsNote")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {groups.map(({ ticket, amendments }) =>
                  ticket.state === "cancelled" ? (
                    <CancelledCard key={ticket.id} ticket={ticket} />
                  ) : (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      amendments={amendments}
                      now={now}
                      iconMode={iconMode}
                      visuals={visuals}
                      flashing={flashing.has(ticket.id) || amendments.some((a) => flashing.has(a.id))}
                      cancelledLineSeconds={setup.cancelledLineSeconds}
                      onTimeline={() => setTimelineOf({ ticket, amendments })}
                      onFlag={() => setFlagging(ticket)}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          <aside className="border-line bg-raised hidden w-72 shrink-0 flex-col overflow-y-auto border-s p-3 lg:flex">
            <h2 className="text-fg text-sm font-semibold">{t("kds.allDay")}</h2>
            <p className="text-fg-subtle mt-0.5 mb-2 text-xs leading-relaxed">{t("kds.allDayNote")}</p>
            <AllDayList rows={allDay} iconMode={iconMode} visuals={visuals} />

            {recallable.length > 0 ? (
              <>
                <h2 className="text-fg mt-5 text-sm font-semibold">{t("kds.recall")}</h2>
                <p className="text-fg-subtle mt-0.5 mb-2 text-xs">{t("kdsView.recallNote")}</p>
                <ul className="space-y-2">
                  {recallable.map((ticket) => (
                    <li key={ticket.id} className="border-line rounded-lg border p-2">
                      <p className="text-fg font-mono text-sm font-semibold">
                        {ticket.orderNumber} <span className="text-fg-subtle font-sans text-xs">· {tx(ticket.stationName)}</span>
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {/* FR-KDS-025 */}
                        <button
                          type="button"
                          onClick={() => dispatch({ type: "TICKET_RECALL", ticketId: ticket.id })}
                          className="border-line hover:bg-sunken text-fg inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium"
                        >
                          <RotateCcw size={16} aria-hidden />
                          {t("kds.recall")}
                        </button>
                        {/* FR-KDS-027 — the dish came back: recall it flagged as a remake. */}
                        <button
                          type="button"
                          onClick={() => dispatch({ type: "TICKET_RECALL", ticketId: ticket.id, remake: true })}
                          className="border-warn text-warn hover:bg-warn-soft inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm font-semibold"
                        >
                          <RefreshCcw size={16} aria-hidden />
                          {t("kdsView.remake")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        </div>
      )}

      {timelineOf ? (
        <TimelineSheet
          ticket={state.tickets[timelineOf.ticket.id] ?? timelineOf.ticket}
          amendments={timelineOf.amendments.map((a) => state.tickets[a.id] ?? a)}
          onClose={() => setTimelineOf(null)}
        />
      ) : null}

      {flagging ? (
        <PrioritySheet
          ticket={state.tickets[flagging.id] ?? flagging}
          onClose={() => setFlagging(null)}
          onPick={(priority) => {
            dispatch({ type: "TICKET_PRIORITY", ticketId: flagging.id, priority });
            setFlagging(null);
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}

function StationChip({
  active,
  colour,
  warn,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  warn?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex min-h-12 shrink-0 items-center rounded-lg border px-4 text-base font-medium whitespace-nowrap transition-colors",
        active
          ? colour
            ? "text-white"
            : "border-accent bg-accent-soft text-accent"
          : "border-line bg-raised text-fg-muted hover:text-fg",
        warn && "ring-bad ring-2",
      )}
      style={active && colour ? { background: colour, borderColor: colour } : undefined}
    >
      {children}
      {warn ? <span className="bg-bad ms-2 h-2.5 w-2.5 rounded-full" aria-hidden /> : null}
    </button>
  );
}

function ToolToggle({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm font-medium",
        pressed ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ticket card
// ---------------------------------------------------------------------------

function TicketCard({
  ticket,
  amendments,
  now,
  iconMode,
  visuals,
  flashing,
  cancelledLineSeconds,
  onTimeline,
  onFlag,
}: {
  ticket: KitchenTicket;
  amendments: KitchenTicket[];
  now: number;
  iconMode: boolean;
  visuals: ReturnType<typeof useItemVisuals>;
  flashing: boolean;
  cancelledLineSeconds: number | null;
  onTimeline: () => void;
  onFlag: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();
  const armed = useArmedTap();

  // FR-KDS-012 — a ticket the staggered release has not let out yet.
  const releaseIn = secondsUntilRelease(ticket, now);
  const scheduled = releaseIn > 0;

  // A held course's clock has not started: it starts when the till releases it.
  const elapsed = ticket.held || scheduled ? 0 : (elapsedSince(ticket.firedAt, now) ?? 0);
  const urgency = urgencyFor(elapsed, ticket.targetSeconds);
  const everything = [ticket, ...amendments];
  const outstanding = everything.flatMap((tk) => tk.lines).filter((l) => l.state !== "ready" && l.state !== "voided");

  // Two different questions, and the elapsed clock alone answers only the
  // first: how long has the guest waited, and how long has anyone actually
  // been cooking? A ticket sitting untouched has a large first and no second.
  const started = ticket.startedAt !== null;
  const cooking = started ? (elapsedSince(ticket.startedAt!, now) ?? 0) : null;
  const pickup = started ? Math.max(0, elapsed - (cooking ?? 0)) : elapsed;
  const blocked = ticket.held === true || scheduled;

  function bumpAll() {
    // FR-KDS-024 / FR-KDS-028 — one card, one bump: the amendments folded
    // into it go with it.
    for (const tk of everything) {
      if (tk.state !== "bumped" && tk.lines.some((l) => l.state !== "ready" && l.state !== "voided")) {
        dispatch({ type: "TICKET_BUMP", ticketId: tk.id });
      }
    }
  }

  return (
    <article
      className={cx(
        "flex flex-col rounded-xl border p-3 transition-colors",
        URGENCY_CARD[urgency],
        PRIORITY_FRAME[ticket.priority],
        flashing && "ring-accent animate-pulse ring-4",
        scheduled && "opacity-75",
      )}
    >
      <PriorityBand ticket={ticket} />

      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-fg font-mono text-2xl leading-none font-bold">{ticket.orderNumber}</p>
          <p className="text-fg-muted mt-1.5 text-sm">
            {tx(ORDER_TYPE[ticket.orderType].label)}
            {ticket.tableLabel ? ` · ${ticket.tableLabel}` : ""}
            {ticket.course > 1 ? ` · ${t("pos.course")} ${ticket.course}` : ""}
          </p>
        </div>
        <div className="flex items-start gap-1">
          <div className="text-end">
            <p className="text-fg-subtle text-[0.65rem] leading-none uppercase">{t("kds.waitTotal")}</p>
            <p className={cx("mt-0.5 text-3xl leading-none font-bold tabular-nums", URGENCY_TIMER[urgency])}>
              {formatElapsed(elapsed)}
            </p>
            <p className="text-fg-subtle mt-1 inline-flex items-center gap-1 text-xs tabular-nums">
              <Timer size={11} aria-hidden />
              {formatElapsed(ticket.targetSeconds)}
            </p>
          </div>
        </div>
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-1">
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
        {scheduled ? (
          <Badge tone="warn">
            <Hourglass size={11} aria-hidden />
            {t("kdsView.releasesIn").replace("{time}", formatElapsed(releaseIn))}
          </Badge>
        ) : null}
        {/* FR-KDS-028 — updated in place, and says so. */}
        {amendments.length > 0 ? <Badge tone="accent">{t("kdsView.updated")}</Badge> : null}
        {/* FR-POS-038 — an addition whose original already left the screen. */}
        {ticket.amendment ? <Badge tone="accent">{t("kds.addition")}</Badge> : null}
        {ticket.state === "recalled" ? <Badge tone="warn">{t("kds.recalled")}</Badge> : null}
        {ticket.held ? <Badge tone="warn">{t("kds.held")}</Badge> : null}
        <Badge tone="muted">{tx(ticket.stationName)}</Badge>
        <div className="ms-auto flex items-center">
          <button
            type="button"
            onClick={onFlag}
            aria-label={t("kdsView.flag")}
            title={t("kdsView.flag")}
            className="text-fg-muted hover:text-fg hover:bg-fg/5 grid h-12 w-12 place-items-center rounded-lg"
          >
            <Flag size={20} aria-hidden />
          </button>
          <TimelineButton onClick={onTimeline} />
        </div>
      </div>

      <ul className="my-3 flex-1 space-y-2">
        {ticket.lines
          .filter((line) => cancelledLineVisible(line, cancelledLineSeconds, now))
          .map((line) => (
            <KdsLine
              key={line.id}
              line={line}
              elapsed={elapsed}
              iconMode={iconMode}
              visuals={visuals}
              armed={armed.armed === `${ticket.id}:${line.id}`}
              disabled={blocked}
              onTap={() =>
                armed.tap(`${ticket.id}:${line.id}`, () =>
                  dispatch({ type: "TICKET_BUMP_LINE", ticketId: ticket.id, lineId: line.id }),
                )
              }
            />
          ))}
      </ul>

      {/*
        FR-KDS-028 — amendments to this order at this station arrive inside
        this card, visibly marked as an update, never as a second card.
      */}
      {amendments.map((amendment) => (
        <section
          key={amendment.id}
          className={cx(
            "border-accent bg-accent-soft mb-3 rounded-lg border-2 p-2",
            now - Date.parse(amendment.timeline?.createdAt ?? amendment.firedAt) < 60_000 && "animate-pulse",
          )}
        >
          <p className="text-accent mb-1 text-sm font-extrabold tracking-wide uppercase">
            {t("kdsView.updateAt").replace("{time}", formatTime(amendment.timeline?.createdAt ?? amendment.firedAt, fmt))}
          </p>
          <ul className="space-y-2">
            {amendment.lines
              .filter((line) => cancelledLineVisible(line, cancelledLineSeconds, now))
              .map((line) => (
                <KdsLine
                  key={line.id}
                  line={line}
                  elapsed={elapsed}
                  iconMode={iconMode}
                  visuals={visuals}
                  armed={armed.armed === `${amendment.id}:${line.id}`}
                  disabled={amendment.held === true || secondsUntilRelease(amendment, now) > 0}
                  onTap={() =>
                    armed.tap(`${amendment.id}:${line.id}`, () =>
                      dispatch({ type: "TICKET_BUMP_LINE", ticketId: amendment.id, lineId: line.id }),
                    )
                  }
                />
              ))}
          </ul>
        </section>
      ))}

      {/*
        The split the elapsed clock cannot show: time lost before anyone
        picked the ticket up, against time actually spent cooking.
      */}
      <dl className="border-line text-fg-subtle mb-2 flex items-center gap-3 border-t pt-2 text-xs tabular-nums">
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

      <div className="flex min-h-12 gap-1.5">
        {ticket.state === "queued" ? (
          <Button
            className="flex-1 text-base"
            // FR-POS-037 — the till holds this course; FR-KDS-012 — or the release has not come.
            disabled={blocked}
            title={ticket.held ? t("kds.heldNote") : scheduled ? t("kdsView.scheduledNote") : undefined}
            onClick={() => dispatch({ type: "TICKET_START", ticketId: ticket.id })}
          >
            {ticket.held ? t("kds.held") : t("kds.start")}
          </Button>
        ) : null}
        {/* FR-KDS-024 — bump all; the lines above are bump item. */}
        <HoldToBump disabled={outstanding.length === 0 || blocked} onBump={bumpAll} />
      </div>
    </article>
  );
}

function KdsLine({
  line,
  elapsed,
  iconMode,
  visuals,
  armed,
  disabled,
  onTap,
}: {
  line: TicketLine;
  elapsed: number;
  iconMode: boolean;
  visuals: ReturnType<typeof useItemVisuals>;
  armed: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  const { t, tx } = useI18n();
  const done = line.state === "ready" || line.state === "served";
  const cancelled = line.state === "voided";
  const own = lineUrgency(line, elapsed);

  return (
    <li>
      <button
        type="button"
        disabled={done || cancelled || disabled}
        onClick={onTap}
        aria-label={`${line.quantity} × ${tx(line.name)}${cancelled ? ` — ${t("kds.voidedLine")}` : ""}`}
        className={cx(
          "min-h-12 w-full rounded-lg px-2 py-1.5 text-start transition-colors",
          !done && !cancelled && !disabled && "hover:bg-fg/5",
          done && "opacity-50",
          // FR-KDS-029 — struck through and highlighted, not faded away.
          cancelled && "border-bad bg-bad-soft border-2",
          armed && "ring-accent ring-4",
        )}
      >
        <span className="flex items-start gap-2">
          <span className={cx("text-fg w-9 shrink-0 font-extrabold tabular-nums", KDS_QTY_TEXT)}>{line.quantity}</span>
          {iconMode ? <ItemPicture visual={visuals(line.menuItemId, line.name)} name={tx(line.name)} /> : null}
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                "text-fg block font-semibold",
                KDS_ITEM_TEXT,
                (done || cancelled) && "line-through decoration-4",
                cancelled && "text-bad",
              )}
            >
              {tx(line.name)}
            </span>
            {line.modifiers.map((m, i) => (
              <span
                key={`${line.id}-${i}`}
                className={cx(
                  "block text-lg leading-snug font-semibold",
                  m.kind === "removal" ? "text-bad" : "text-accent",
                )}
              >
                {m.kind === "removal" ? "− " : m.kind === "addition" ? "+ " : "⇄ "}
                {tx(m.name)}
              </span>
            ))}
            {line.notes ? <span className="text-fg-muted block text-base italic">“{line.notes}”</span> : null}
            {typeof line.seatNumber === "number" ? (
              <span className="text-accent block text-sm font-semibold">
                {t("pos.seat")} {line.seatNumber}
              </span>
            ) : null}
            {/* FR-KDS-011 — the same line is also being made elsewhere. */}
            {line.alsoAt && line.alsoAt.length > 0 ? (
              <span className="text-fg-muted mt-0.5 block text-sm">
                {t("kdsView.alsoAt").replace("{stations}", line.alsoAt.map((name) => tx(name)).join(", "))}
              </span>
            ) : null}
            {cancelled ? (
              <span className="text-bad block text-base font-extrabold uppercase">{t("kds.voidedLine")}</span>
            ) : null}
            <ArmedHint show={armed} />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {done ? <Check size={22} className="text-good" aria-hidden /> : null}
            {cancelled ? <Ban size={22} className="text-bad" aria-hidden /> : null}
            {/* FR-KDS-044 — this item against its own target. */}
            {own && line.targetSeconds ? (
              <span
                className={cx("rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums", URGENCY_CHIP[own])}
                title={t("kdsView.itemTarget")}
              >
                {formatElapsed(line.targetSeconds)}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function PrioritySheet({
  ticket,
  onClose,
  onPick,
}: {
  ticket: KitchenTicket;
  onClose: () => void;
  onPick: (priority: KitchenTicket["priority"]) => void;
}) {
  const { t } = useI18n();
  const options: { value: KitchenTicket["priority"]; label: string; tone: string }[] = [
    { value: "normal", label: t("kdsView.normal"), tone: "border-line" },
    { value: "rush", label: t("kdsView.rush"), tone: "border-bad text-bad" },
    { value: "vip", label: t("kdsView.vip"), tone: "border-accent text-accent" },
    { value: "remake", label: t("kdsView.remake"), tone: "border-warn text-warn border-dashed" },
  ];
  return (
    <Modal open onClose={onClose} title={t("kdsView.flagTitle").replace("{order}", ticket.orderNumber)}>
      <p className="text-fg-subtle mb-3 text-xs">FR-KDS-027</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={ticket.priority === option.value}
            onClick={() => onPick(option.value)}
            className={cx(
              "min-h-16 rounded-xl border-2 px-3 text-lg font-bold",
              option.tone,
              ticket.priority === option.value && "bg-sunken",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Modal>
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
          <p className="text-fg font-mono text-2xl leading-none font-bold">{ticket.orderNumber}</p>
          <p className="text-fg-muted mt-1 text-sm">
            {tx(ORDER_TYPE[ticket.orderType].label)}
            {ticket.tableLabel ? ` · ${ticket.tableLabel}` : ""}
          </p>
        </div>
        <Ban size={32} className="text-bad shrink-0" aria-hidden />
      </header>

      <p className="text-bad mt-3 text-2xl leading-none font-extrabold tracking-wide">{t("kds.orderCancelled")}</p>
      <p className="text-fg mt-1.5 text-base font-medium">{t("kds.stopMaking")}</p>

      {ticket.cancelReason ? (
        <p className="text-fg-muted mt-2 text-sm">
          <span className="text-fg-subtle">{t("kds.cancelReason")}: </span>
          <span className="italic">“{ticket.cancelReason}”</span>
        </p>
      ) : null}

      <ul className="text-fg-muted my-3 flex-1 space-y-1">
        {ticket.lines.map((line) => (
          <li key={line.id} className={cx("flex gap-2 font-semibold line-through", KDS_ITEM_TEXT)}>
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
        className="min-h-12 w-full text-base"
        onClick={() => dispatch({ type: "TICKET_ACK_CANCEL", ticketId: ticket.id })}
      >
        {t("kds.ackCancel")}
      </Button>
    </article>
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
            .filter((ticket) => ticket.orderId === order.id && ticket.state !== "cancelled");
          const pendingStations = tickets.filter((ticket) => ticket.state !== "bumped");
          const ready = pendingStations.length === 0 && order.lines.some((line) => line.state === "ready");
          const elapsed = order.firstFiredAt ? (elapsedSince(order.firstFiredAt, now) ?? 0) : 0;

          return (
            <article
              key={order.id}
              className={cx(
                "rounded-xl border p-3",
                ready ? "border-good bg-good-soft" : "border-line bg-raised",
                PRIORITY_FRAME[state.priorities?.[order.id] ?? "normal"],
              )}
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-fg font-mono text-2xl font-bold">{order.orderNumber}</p>
                  <p className="text-fg-muted text-sm">
                    {tx(ORDER_TYPE[order.orderType].label)}
                    {order.tableLabel ? ` · ${order.tableLabel}` : ""}
                  </p>
                </div>
                <p className="text-fg text-2xl font-bold tabular-nums">{formatElapsed(elapsed)}</p>
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
                  .filter((line) => line.state !== "voided" && line.state !== "pending")
                  .map((line) => (
                    <li key={line.id} className="text-fg flex gap-2 text-lg">
                      <span className="w-7 shrink-0 font-bold tabular-nums">{line.quantity}</span>
                      <span className="min-w-0 flex-1">{tx(line.itemNameSnapshot)}</span>
                      {line.state === "ready" || line.state === "served" ? (
                        <Check size={18} className="text-good shrink-0" aria-hidden />
                      ) : null}
                    </li>
                  ))}
              </ul>

              <div className="mt-3">
                {ready ? (
                  <Button
                    variant="primary"
                    className="min-h-12 w-full text-base"
                    icon={<Check size={16} />}
                    onClick={() => dispatch({ type: "ORDER_SERVE", orderId: order.id })}
                  >
                    {t("kds.serve")}
                  </Button>
                ) : (
                  <p className="text-fg-subtle text-sm">
                    {pendingStations.length > 0
                      ? t("kds.waitingOn").replace(
                          "{stations}",
                          [...new Set(pendingStations.map((ticket) => tx(ticket.stationName)))].join(", "),
                        )
                      : t("kdsView.passServed")}
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
