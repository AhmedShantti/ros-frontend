"use client";

/**
 * What the till can honestly say about running without a server.
 *
 * FR-OFF-002 — a change of connectivity mode must not interrupt an order in
 * progress. Nothing in the simulator till reacts to the mode except the sync
 * marking of *completed* sales, so the order on screen is untouched; what was
 * missing was telling the cashier so, without a modal that would steal focus
 * or close the sheet they are in. `ModeChangeNotice` is a polite live region.
 *
 * FR-OFF-003 — 72 hours isolated. The till cannot prove that ahead of time,
 * but it can show the figures that decide it: how long this mode has lasted,
 * how old the oldest unsent write is, how much local storage is used against
 * what is available, and — at the rate sales are queueing — how many hours of
 * capacity are left against the 72-hour target. Where a figure is unknown the
 * panel says "unknown" rather than guessing.
 *
 * Against a live backend the till's order operations are server calls with no
 * local outbox (see `components/terminal/pos-live.tsx`), so the panel says
 * plainly that sales capture there stops with the server.
 */

import { useEffect, useRef, useState } from "react";
import { HardDrive, WifiOff } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { useLive, useNow } from "@/lib/console/live/store";
import { LIVE_STORAGE_KEY } from "@/lib/console/live/state";
import { formatDuration, formatNumber } from "@/lib/console/format";
import { DATA_MODE } from "@/lib/api/config";
import { useConnectivityStore, type ConnectivityState } from "@/store/connectivity";
import { Button, Callout, cx } from "@/components/console/ui";

/** SRS FR-OFF-003. */
const TARGET_HOURS = 72;
/**
 * localStorage has no API to read its limit; 5 MB per origin is the limit in
 * every mainstream browser, so it is the figure used and it is named as such.
 */
const LOCAL_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
/** Used only until this till has at least one order to measure. */
const ASSUMED_BYTES_PER_ORDER = 6_000;

type Mode = "online" | "degraded" | "offline" | "isolated";

function modeOf(state: ConnectivityState): Mode {
  if (state === "degraded" || state === "offline" || state === "isolated") return state;
  // syncing, synced and conflict all mean the server answered.
  return "online";
}

function localStorageBytes(): { total: number; live: number } | null {
  try {
    let total = 0;
    let live = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? "";
      const value = window.localStorage.getItem(key) ?? "";
      // UTF-16: two bytes per code unit.
      const bytes = (key.length + value.length) * 2;
      total += bytes;
      if (key === LIVE_STORAGE_KEY) live = bytes;
    }
    return { total, live };
  } catch {
    return null;
  }
}

export interface IsolationFigures {
  mode: Mode;
  modeSeconds: number | null;
  queued: number;
  oldestQueuedSeconds: number | null;
  local: { used: number; limit: number } | null;
  origin: { used: number; quota: number } | null;
  /** Orders that still fit in local storage, or null when unknown. */
  ordersLeft: number | null;
  /** Hours of capacity left at the current queueing rate, or null when there is no rate yet. */
  hoursLeft: number | null;
  /** Whether elapsed + remaining reaches the 72-hour target; null when unknown. */
  meetsTarget: boolean | null;
}

export function useIsolationFigures(): IsolationFigures {
  const now = useNow(15_000);
  const { state: live } = useLive();
  const connectivity = useConnectivityStore((s) => s.state);
  const stateSince = useConnectivityStore((s) => s.stateSince);
  const queue = useConnectivityStore((s) => s.queue);
  const [origin, setOrigin] = useState<{ used: number; quota: number } | null>(null);
  const [local, setLocal] = useState<{ total: number; live: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      setLocal(localStorageBytes());
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (!cancelled && estimate && typeof estimate.quota === "number") {
          setOrigin({ used: estimate.usage ?? 0, quota: estimate.quota });
        }
      } catch {
        // Not offered by this browser: stays unknown.
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const mode = modeOf(connectivity);
  const modeSeconds = stateSince && now ? Math.max(0, Math.floor((now - stateSince) / 1000)) : null;
  const orders = queue.filter((q) => q.kind === "order");
  const oldest = queue.reduce<number | null>((min, q) => (min === null || q.createdAt < min ? q.createdAt : min), null);
  const oldestQueuedSeconds = oldest && now ? Math.max(0, Math.floor((now - oldest) / 1000)) : null;

  let ordersLeft: number | null = null;
  let hoursLeft: number | null = null;
  let meetsTarget: boolean | null = null;
  if (local) {
    const count = live.orderIds.length;
    const perOrder = count > 0 && local.live > 0 ? local.live / count : ASSUMED_BYTES_PER_ORDER;
    ordersLeft = Math.max(0, Math.floor((LOCAL_STORAGE_LIMIT_BYTES - local.total) / perOrder));
    if (orders.length > 0 && oldestQueuedSeconds !== null) {
      // At least an hour of history, so two sales a minute apart are not read as a rush.
      const hours = Math.max(1, oldestQueuedSeconds / 3600);
      const perHour = orders.length / hours;
      hoursLeft = ordersLeft / perHour;
      meetsTarget = oldestQueuedSeconds / 3600 + hoursLeft >= TARGET_HOURS;
    }
  }

  return {
    mode,
    modeSeconds,
    queued: queue.length,
    oldestQueuedSeconds,
    local: local ? { used: local.total, limit: LOCAL_STORAGE_LIMIT_BYTES } : null,
    origin,
    ordersLeft,
    hoursLeft,
    meetsTarget,
  };
}

function mb(bytes: number, fmt: Parameters<typeof formatNumber>[1]): string {
  return `${formatNumber(bytes / (1024 * 1024), fmt, 1)} MB`;
}

/** FR-OFF-003 — the figures, in the sync modal. */
export function IsolationPanel() {
  const { t, fmt } = useI18n();
  const { training } = useLive();
  const figures = useIsolationFigures();
  const unknown = t("offline.unknown");
  const liveTill = DATA_MODE === "http" && !training;

  const rows: [string, string][] = [
    [
      t("offline.modeFor").replace("{mode}", t(`sync.${figures.mode}` as const)),
      figures.modeSeconds === null ? unknown : formatDuration(figures.modeSeconds, fmt),
    ],
    [t("offline.queued"), formatNumber(figures.queued, fmt)],
    [
      t("offline.oldestQueued"),
      figures.oldestQueuedSeconds === null ? "—" : formatDuration(figures.oldestQueuedSeconds, fmt),
    ],
    [
      t("offline.localStore"),
      figures.local
        ? t("offline.usedOf").replace("{used}", mb(figures.local.used, fmt)).replace("{limit}", mb(figures.local.limit, fmt))
        : unknown,
    ],
    [
      t("offline.originStore"),
      figures.origin
        ? t("offline.usedOf").replace("{used}", mb(figures.origin.used, fmt)).replace("{limit}", mb(figures.origin.quota, fmt))
        : unknown,
    ],
    [t("offline.ordersLeft"), figures.ordersLeft === null ? unknown : formatNumber(figures.ordersLeft, fmt)],
    [
      t("offline.hoursLeft"),
      figures.hoursLeft === null ? t("offline.noRateYet") : formatNumber(Math.floor(figures.hoursLeft), fmt),
    ],
  ];

  return (
    <section className="border-line mt-4 rounded-lg border p-3" aria-labelledby="isolation-title">
      <h3 id="isolation-title" className="text-fg flex items-center gap-1.5 text-sm font-semibold">
        <HardDrive size={14} aria-hidden /> {t("offline.title")}
      </h3>
      <p className="text-fg-subtle mt-0.5 text-xs leading-relaxed">{t("offline.lede")}</p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg text-end font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {figures.meetsTarget === true ? (
        <Callout tone="good" className="mt-3">{t("offline.meetsTarget")}</Callout>
      ) : figures.meetsTarget === false ? (
        <Callout tone="warn" className="mt-3">{t("offline.missesTarget")}</Callout>
      ) : null}
      {liveTill ? (
        <Callout tone="warn" className="mt-3">{t("offline.liveTillNote")}</Callout>
      ) : (
        <p className="text-fg-subtle mt-3 text-xs leading-relaxed">{t("offline.simulatorNote")}</p>
      )}
    </section>
  );
}

/** FR-OFF-003 — a slim line under the bar while there is no server. */
export function IsolationBanner({ onDetails }: { onDetails: () => void }) {
  const { t, fmt } = useI18n();
  const { training } = useLive();
  const figures = useIsolationFigures();
  if (figures.mode !== "offline" && figures.mode !== "isolated") return null;
  const liveTill = DATA_MODE === "http" && !training;

  const parts = [
    figures.modeSeconds === null ? null : formatDuration(figures.modeSeconds, fmt),
    t("offline.bannerQueued").replace("{n}", formatNumber(figures.queued, fmt)),
    figures.oldestQueuedSeconds === null
      ? null
      : t("offline.bannerOldest").replace("{age}", formatDuration(figures.oldestQueuedSeconds, fmt)),
    figures.local
      ? t("offline.bannerStore").replace("{pct}", formatNumber((figures.local.used / figures.local.limit) * 100, fmt, 0))
      : null,
  ].filter(Boolean);

  return (
    <div
      className={cx(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1 text-xs",
        liveTill ? "border-bad/40 bg-bad-soft text-bad" : "border-warn/40 bg-warn-soft text-warn",
      )}
    >
      <WifiOff size={13} aria-hidden />
      <span className="font-semibold">{t(`sync.${figures.mode}` as const)}</span>
      <span className="text-fg-muted">{parts.join(" · ")}</span>
      {liveTill ? <span className="font-medium">{t("offline.liveTillShort")}</span> : null}
      <div className="flex-1" />
      <Button size="sm" variant="ghost" className="min-h-12 sm:min-h-0" onClick={onDetails}>
        {t("offline.details")}
      </Button>
    </div>
  );
}

/**
 * FR-OFF-002 — says, without interrupting, that a change of mode left the
 * order alone. A polite live region: it never takes focus, never opens over
 * a sheet, and goes away on its own.
 */
export function ModeChangeNotice() {
  const { t } = useI18n();
  const { activeOrder, training } = useLive();
  const connectivity = useConnectivityStore((s) => s.state);
  const hydrated = useConnectivityStore((s) => s.hydrated);
  const mode = modeOf(connectivity);
  const previous = useRef<Mode | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const liveTill = DATA_MODE === "http" && !training;
  const inProgress =
    activeOrder !== null && !["completed", "cancelled", "refunded", "partially_refunded", "merged"].includes(activeOrder.state);

  useEffect(() => {
    if (!hydrated) return;
    const before = previous.current;
    previous.current = mode;
    // The first reading after mount is detection, not a transition.
    if (before === null || before === mode) return;
    const label = t(`sync.${mode}` as const);
    if (liveTill) {
      setMessage(t("offline.changedLive").replace("{mode}", label));
    } else if (inProgress) {
      setMessage(t("offline.changedSafe").replace("{mode}", label));
    } else {
      setMessage(null);
      return;
    }
    const timer = window.setTimeout(() => setMessage(null), 8_000);
    return () => window.clearTimeout(timer);
    // `inProgress` is read at the moment of the change, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hydrated]);

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {message ? (
        <div className="border-accent/40 bg-accent-soft text-fg flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          {message}
        </div>
      ) : null}
    </div>
  );
}
