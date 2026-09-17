"use client";

/**
 * Pieces both kitchen displays share — the simulator's (`/kds` in demo mode)
 * and the one on the real backend (`kds-live.tsx`).
 *
 * Type sizes here are the NFR-USA-006 floor: an item name is 2rem (24 pt) at
 * the 1920×1080 breakpoint, so it reads from two metres on a 21-inch screen.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Crown, Info, RefreshCcw, Zap } from "lucide-react";
import type { Id, KitchenTicket, Localised, TicketLine, TicketTimeline } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { menuItemById } from "@/lib/console/mock/catalogue";
import { formatElapsed } from "@/lib/console/format";
import {
  KDS_SORT_MODES,
  TIMELINE_FIELDS,
  emptyTimeline,
  type AllDayRow,
  type CapacityReading,
  type KdsSortMode,
} from "@/lib/console/live/kds";
import { Modal, cx } from "@/components/console/ui";
import { RecipePrepCardForMenuItem } from "@/components/console/menu-recipe-panels";
import { getTerminalBranchId } from "@/lib/api/session";
import type { ConsoleKey } from "@/locales";

/** NFR-USA-006 — item identity at 24 pt (2rem) on a 1920×1080 display, never below 1.5rem. */
export const KDS_ITEM_TEXT = "text-2xl leading-tight xl:text-[2rem]";
export const KDS_QTY_TEXT = "text-2xl leading-tight xl:text-[2rem]";

// ---------------------------------------------------------------------------
// Item visuals — FR-KDS-031
// ---------------------------------------------------------------------------

export interface ItemVisual {
  image: string | null;
  emoji: string | null;
  colour: string;
}

/** A stable colour for an item with no picture, so the same dish always looks the same. */
function hashColour(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 55% 42%)`;
}

/**
 * Pictures for icon-and-image mode: the menu profile's uploaded photo, else
 * the catalogue's emoji, else a coloured initial that is at least the same
 * shape and colour every time the dish appears.
 */
export function useItemVisuals(): (menuItemId: Id | null | undefined, name: Localised) => ItemVisual {
  const profiles = useAsync(() => services.menuProfiles.all().catch(() => []), []);
  const images = useMemo(() => {
    const map = new Map<Id, string>();
    for (const profile of profiles.data ?? []) if (profile.image) map.set(profile.itemId, profile.image);
    return map;
  }, [profiles.data]);

  return (menuItemId, name) => {
    const item = menuItemId ? menuItemById.get(menuItemId) : undefined;
    return {
      image: (menuItemId ? images.get(menuItemId) : undefined) ?? item?.imageUrl ?? null,
      emoji: item?.imageEmoji ?? null,
      colour: item?.colour ?? hashColour(name.en),
    };
  };
}

export function ItemPicture({
  visual,
  name,
  size = 72,
}: {
  visual: ItemVisual;
  name: string;
  size?: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-black/10 text-white"
      style={{ width: size, height: size, background: visual.colour }}
      aria-hidden
    >
      {visual.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL thumbnail; nothing to optimise.
        <img src={visual.image} alt="" className="h-full w-full object-cover" />
      ) : visual.emoji ? (
        <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>{visual.emoji}</span>
      ) : (
        <span className="font-extrabold" style={{ fontSize: size * 0.45 }}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Priority — FR-KDS-027
// ---------------------------------------------------------------------------

/**
 * Each flag differs in colour, border pattern, icon and word, so the three
 * are distinguishable by someone who cannot tell red from amber.
 */
export const PRIORITY_FRAME: Record<KitchenTicket["priority"], string> = {
  normal: "",
  rush: "border-s-[10px] border-s-bad",
  vip: "ring-4 ring-accent ring-offset-2 ring-offset-surface",
  remake: "border-4 border-dashed border-warn",
};

export function PriorityBand({ ticket }: { ticket: KitchenTicket }) {
  const { t } = useI18n();
  if (ticket.priority === "normal") return null;
  const look = {
    rush: { icon: <Zap size={18} aria-hidden />, label: t("kdsView.rush"), tone: "bg-bad text-white" },
    vip: { icon: <Crown size={18} aria-hidden />, label: t("kdsView.vip"), tone: "bg-accent text-accent-fg" },
    remake: {
      icon: <RefreshCcw size={18} aria-hidden />,
      label:
        (ticket.remakeCount ?? 0) > 1
          ? t("kdsView.remakeCount").replace("{n}", String(ticket.remakeCount))
          : t("kdsView.remake"),
      tone: "bg-warn text-white",
    },
  }[ticket.priority];
  return (
    <div
      className={cx(
        "-mx-3 -mt-3 mb-2 flex items-center gap-2 rounded-t-[0.6rem] px-3 py-1.5 text-sm font-extrabold tracking-wider uppercase",
        look.tone,
      )}
    >
      {look.icon}
      {look.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort picker — FR-KDS-023
// ---------------------------------------------------------------------------

export const SORT_LABEL: Record<KdsSortMode, ConsoleKey> = {
  fifo: "kdsView.sortFifo",
  target: "kdsView.sortTarget",
  priority: "kdsView.sortPriority",
  course: "kdsView.sortCourse",
};

export function SortPicker({
  value,
  onChange,
  note,
}: {
  value: KdsSortMode;
  onChange: (next: KdsSortMode) => void;
  note?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label={t("kds.sortBy")} className="border-line bg-sunken inline-flex rounded-lg border p-0.5">
        {KDS_SORT_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            onClick={() => onChange(mode)}
            className={cx(
              "min-h-11 shrink-0 rounded-md px-3 text-sm font-medium",
              value === mode ? "bg-raised text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {t(SORT_LABEL[mode])}
          </button>
        ))}
      </div>
      {note ? <span className="text-fg-subtle hidden text-xs xl:inline">{note}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity — FR-KDS-045
// ---------------------------------------------------------------------------

export function CapacityBanner({ reading, stationName }: { reading: CapacityReading; stationName: string }) {
  const { t } = useI18n();
  if (!reading.over) return null;
  return (
    <div
      role="alert"
      className="border-bad bg-bad-soft text-bad flex shrink-0 items-center gap-3 border-b px-4 py-2 text-base font-semibold"
    >
      <AlertTriangle size={22} aria-hidden />
      {t("kdsView.capacityOver")
        .replace("{station}", stationName)
        .replace("{queued}", String(reading.queuedItems))
        .replace("{capacity}", String(reading.capacity15))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-day counts — FR-KDS-030
// ---------------------------------------------------------------------------

export function AllDayList({
  rows,
  iconMode,
  visuals,
}: {
  rows: AllDayRow[];
  iconMode: boolean;
  visuals: ReturnType<typeof useItemVisuals>;
}) {
  const { tx } = useI18n();
  if (rows.length === 0) return <p className="text-fg-subtle text-sm">—</p>;
  return (
    <ul className="space-y-1.5">
      {rows.slice(0, 12).map((row) => (
        <li
          key={row.key}
          className="border-line flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            {iconMode ? <ItemPicture visual={visuals(row.menuItemId, row.name)} name={tx(row.name)} size={36} /> : null}
            <span className="text-fg min-w-0 truncate text-base font-medium">{tx(row.name)}</span>
          </span>
          <span className="text-fg text-2xl font-extrabold tabular-nums">{row.total}</span>
        </li>
      ))}
    </ul>
  );
}

/** The whole screen given over to counts — what a grill cook reads at the start of a rush. */
export function AllDayBoard({
  rows,
  iconMode,
  visuals,
}: {
  rows: AllDayRow[];
  iconMode: boolean;
  visuals: ReturnType<typeof useItemVisuals>;
}) {
  const { t, tx } = useI18n();
  if (rows.length === 0) {
    return <div className="text-fg-subtle grid flex-1 place-items-center p-8 text-lg">{t("kds.noTickets")}</div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="text-fg-subtle mb-3 text-sm">{t("kds.allDayNote")}</p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map((row) => (
          <li key={row.key} className="border-line bg-raised flex items-center gap-4 rounded-xl border p-4">
            {iconMode ? <ItemPicture visual={visuals(row.menuItemId, row.name)} name={tx(row.name)} size={88} /> : null}
            <div className="min-w-0 flex-1">
              <p className={cx("text-fg font-bold", KDS_ITEM_TEXT)}>{tx(row.name)}</p>
              <p className="text-fg-muted mt-1 text-sm tabular-nums">
                {t("kdsView.allDayNow").replace("{n}", String(row.now))}
                {row.later > 0 ? ` · ${t("kdsView.allDayLater").replace("{n}", String(row.later))}` : ""}
              </p>
            </div>
            <span className="text-fg text-6xl font-extrabold tabular-nums">{row.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline — FR-KDS-040
// ---------------------------------------------------------------------------

const TIMELINE_LABEL: Record<(typeof TIMELINE_FIELDS)[number], ConsoleKey> = {
  createdAt: "kdsView.tlCreated",
  routedAt: "kdsView.tlRouted",
  firstViewedAt: "kdsView.tlViewed",
  startedAt: "kdsView.tlStarted",
  readyAt: "kdsView.tlReady",
  bumpedAt: "kdsView.tlBumped",
  servedAt: "kdsView.tlServed",
};

function useClock() {
  const { locale } = useI18n();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return (iso: string | null) => {
      if (!iso) return null;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? null : format.format(date);
    };
  }, [locale]);
}

function between(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? formatElapsed(seconds) : null;
}

/**
 * Every recorded moment for a ticket and each of its lines.
 *
 * `unrecorded` names the moments this source never records, so a blank cell
 * reads as "not provided" rather than as "has not happened yet".
 */
export function TimelineSheet({
  ticket,
  amendments = [],
  unrecorded = [],
  onClose,
}: {
  ticket: KitchenTicket;
  amendments?: KitchenTicket[];
  unrecorded?: (typeof TIMELINE_FIELDS)[number][];
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const clock = useClock();
  const lines: TicketLine[] = [...ticket.lines, ...amendments.flatMap((a) => a.lines)];
  const tl = ticket.timeline ?? emptyTimeline();
  // FR-MNU-049 — the cook opens the recipe's prep card from the ticket.
  const withRecipe = lines.filter((line) => line.menuItemId);
  const [prepFor, setPrepFor] = useState<Id | null>(null);

  const cell = (timeline: TicketTimeline | undefined, field: (typeof TIMELINE_FIELDS)[number]) => {
    const value = clock((timeline ?? emptyTimeline())[field]);
    if (value) return <span className="text-fg tabular-nums">{value}</span>;
    if (unrecorded.includes(field)) return <span className="text-fg-subtle text-xs">{t("kdsView.tlNotRecorded")}</span>;
    return <span className="text-fg-subtle">—</span>;
  };

  return (
    <Modal open onClose={onClose} title={t("kdsView.timelineTitle").replace("{order}", ticket.orderNumber)} wide>
      <p className="text-fg-subtle mb-3 text-xs">
        {tx(ticket.stationName)} · FR-KDS-040
      </p>

      <dl className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <Summary label={t("kds.pickup")} value={between(tl.routedAt, tl.startedAt)} />
        <Summary label={t("kds.cookTime")} value={between(tl.startedAt, tl.readyAt)} />
        <Summary label={t("kdsView.tlToServe")} value={between(tl.readyAt, tl.servedAt)} />
      </dl>

      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-fg-muted text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("kdsView.tlMoment")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("kdsView.tlTicket")}
              </th>
              {lines.map((line) => (
                <th key={line.id} scope="col" className="px-3 py-2 text-start font-medium">
                  {line.quantity} × {tx(line.name)}
                  {line.addedAt ? <span className="text-accent ms-1">+</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {TIMELINE_FIELDS.map((field) => (
              <tr key={field}>
                <th scope="row" className="text-fg-muted px-3 py-2 text-start font-medium whitespace-nowrap">
                  {t(TIMELINE_LABEL[field])}
                </th>
                <td className="px-3 py-2 whitespace-nowrap">{cell(ticket.timeline, field)}</td>
                {lines.map((line) => (
                  <td key={line.id} className="px-3 py-2 whitespace-nowrap">
                    {cell(line.timeline, field)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="text-fg-muted px-3 py-2 text-start font-medium whitespace-nowrap">
                {t("kdsView.tlRecalled")}
              </th>
              <td className="px-3 py-2">
                {tl.recalledAt.length === 0 ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  tl.recalledAt.map((at) => (
                    <span key={at} className="text-fg block tabular-nums">
                      {clock(at)}
                    </span>
                  ))
                )}
              </td>
              {lines.map((line) => (
                <td key={line.id} className="px-3 py-2">
                  {(line.timeline?.recalledAt ?? []).length === 0 ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    line.timeline!.recalledAt.map((at) => (
                      <span key={at} className="text-fg block tabular-nums">
                        {clock(at)}
                      </span>
                    ))
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {withRecipe.length > 0 ? (
        <section className="mt-4 space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("mnr.prep.title")}</h3>
          <div className="flex flex-wrap gap-2">
            {withRecipe.map((line) => (
              <button
                key={line.id}
                type="button"
                aria-pressed={prepFor === line.menuItemId}
                onClick={() => setPrepFor(prepFor === line.menuItemId ? null : line.menuItemId!)}
                className={cx(
                  "min-h-12 rounded-lg border px-3 text-sm",
                  prepFor === line.menuItemId ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-fg-muted",
                )}
              >
                {tx(line.name)}
              </button>
            ))}
          </div>
          {prepFor ? <RecipePrepCardForMenuItem menuItemId={prepFor} branchId={getTerminalBranchId()} /> : null}
        </section>
      ) : null}
    </Modal>
  );
}

function Summary({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-line rounded-lg border px-3 py-2">
      <dt className="text-fg-subtle text-xs">{label}</dt>
      <dd className="text-fg text-lg font-bold tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

export function TimelineButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("kdsView.timelineOpen")}
      title={t("kdsView.timelineOpen")}
      className="text-fg-muted hover:text-fg hover:bg-fg/5 grid h-12 w-12 shrink-0 place-items-center rounded-lg"
    >
      <Info size={20} aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bump item — FR-KDS-024 with FR-KDS-026's deliberate interaction
// ---------------------------------------------------------------------------

/**
 * Tap once to arm, tap again within three seconds to mark the item ready.
 *
 * A single-tap line was the one bump on the display that ignored FR-KDS-026:
 * the ticket needed a hold, while any one item on it could be cleared by a
 * splash. Double-tap is the SRS's own alternative to a long press.
 */
export function useArmedTap(windowMs = 3000) {
  const [armed, setArmed] = useState<Id | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), windowMs);
    return () => window.clearTimeout(timer);
  }, [armed, windowMs]);
  return {
    armed,
    tap(id: Id, fire: () => void) {
      if (armed === id) {
        setArmed(null);
        fire();
      } else {
        setArmed(id);
      }
    },
  };
}

export function ArmedHint({ show }: { show: boolean }): ReactNode {
  const { t } = useI18n();
  if (!show) return null;
  return (
    <span className="bg-accent text-accent-fg mt-1 inline-block rounded-md px-2 py-0.5 text-sm font-bold">
      {t("kdsView.tapAgain")}
    </span>
  );
}
