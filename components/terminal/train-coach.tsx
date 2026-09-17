"use client";

/**
 * Coach marks, the training checklist and the training controls —
 * NFR-USA-005 (a new cashier productive after ≤ 30 minutes of training).
 *
 * Three pieces, each doing one job in that half hour:
 *
 *  - `CoachMarks` walks a first-time cashier around the till once, pointing
 *    at the real controls (`[data-coach="…"]`) rather than at screenshots.
 *    It runs on the first visit per device and can be re-opened any time.
 *  - `TrainingChecklist` is the half hour itself: the tasks a cashier has to
 *    be able to do, ticked off from what actually happened in the practice
 *    store, against a clock with the 30-minute target on it.
 *  - `TrainingButton` / `TrainingBanner` switch practice on and off and make
 *    it impossible to forget which mode the till is in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Circle, GraduationCap, HelpCircle, RotateCcw, X } from "lucide-react";
import type { ConsoleKey } from "@/locales";
import { useI18n } from "@/lib/console/providers";
import { useLive, useNow } from "@/lib/console/live/store";
import type { LiveState } from "@/lib/console/live/state";
import { formatElapsed } from "@/lib/console/format";
import { DATA_MODE } from "@/lib/api/config";
import { useConfirm } from "@/components/console/confirm";
import { Button, Callout, Meter, Modal, cx } from "@/components/console/ui";
import { useTraining } from "@/components/terminal/train-provider";

const COACH_DONE_KEY = "ros.coach.done.v1";
const COACH_OPEN_EVENT = "ros:coach-open";
const TARGET_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// Coach marks
// ---------------------------------------------------------------------------

interface CoachStep {
  anchor: string;
  title: ConsoleKey;
  body: ConsoleKey;
}

const STEPS: CoachStep[] = [
  { anchor: "training", title: "train.coach.trainingTitle", body: "train.coach.trainingBody" },
  { anchor: "shift", title: "train.coach.shiftTitle", body: "train.coach.shiftBody" },
  { anchor: "pane", title: "train.coach.paneTitle", body: "train.coach.paneBody" },
  { anchor: "menu", title: "train.coach.menuTitle", body: "train.coach.menuBody" },
  { anchor: "fire", title: "train.coach.fireTitle", body: "train.coach.fireBody" },
  { anchor: "pay", title: "train.coach.payTitle", body: "train.coach.payBody" },
  { anchor: "park", title: "train.coach.parkTitle", body: "train.coach.parkBody" },
];

function readDone(): boolean {
  try {
    return window.localStorage.getItem(COACH_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

function writeDone() {
  try {
    window.localStorage.setItem(COACH_DONE_KEY, "1");
  } catch {
    // Blocked storage: the tour simply offers itself again next visit.
  }
}

/** Opens the tour from anywhere on the terminal. */
export function openCoachMarks() {
  window.dispatchEvent(new Event(COACH_OPEN_EVENT));
}

/** Whether this terminal page runs the simulator till the tour describes. */
function useSimulatorTill(): boolean {
  const pathname = usePathname();
  const { training } = useTraining();
  return pathname === "/pos" && (training || DATA_MODE !== "http");
}

/**
 * Mounted once in the terminal bar. Opens itself on the first visit to the
 * simulator till on this device, and whenever `openCoachMarks()` is called.
 */
export function CoachHost() {
  const simulator = useSimulatorTill();
  const { ready } = useLive();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (simulator && ready && !readDone()) setOpen(true);
  }, [simulator, ready]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(COACH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COACH_OPEN_EVENT, onOpen);
  }, []);

  if (!open) return null;
  return (
    <CoachMarks
      onClose={() => {
        writeDone();
        setOpen(false);
      }}
    />
  );
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function CoachMarks({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  const nextRef = useRef<HTMLButtonElement | null>(null);

  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  // The target can appear, move or scroll while the tour is open (a sheet
  // opens, the order pane grows), so its box is re-measured on a short timer
  // as well as on resize and scroll.
  useEffect(() => {
    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const element = document.querySelector<HTMLElement>(`[data-coach="${step.anchor}"]`);
      const rect = element?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        setBox(null);
        return;
      }
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const element = document.querySelector<HTMLElement>(`[data-coach="${step.anchor}"]`);
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const timer = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.anchor]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  const next = useCallback(() => {
    if (last) onClose();
    else setIndex((i) => i + 1);
  }, [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The console root sets `dir` on its subtree, so ask the dialog itself.
      const rtl = nextRef.current ? getComputedStyle(nextRef.current).direction === "rtl" : false;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
        event.preventDefault();
        next();
      } else if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  const cardWidth = Math.min(340, viewport.w - 32);
  const cardHeight = 230;
  let cardTop: number;
  let cardLeft: number;
  if (box) {
    const below = box.top + box.height + 12;
    cardTop = below + cardHeight < viewport.h ? below : Math.max(16, box.top - cardHeight - 12);
    cardLeft = Math.min(Math.max(16, box.left + box.width / 2 - cardWidth / 2), viewport.w - cardWidth - 16);
  } else {
    cardTop = Math.max(16, viewport.h / 2 - cardHeight / 2);
    cardLeft = Math.max(16, viewport.w / 2 - cardWidth / 2);
  }

  return (
    <div className="fixed inset-0 z-[120]">
      {/* Blocks the till behind the tour; the tour is not something to click through by accident. */}
      <div aria-hidden className={cx("absolute inset-0", box ? "" : "bg-black/55")} />
      {box ? (
        <div
          aria-hidden
          className="ring-accent pointer-events-none absolute rounded-xl ring-4 transition-all duration-200"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-title"
        aria-describedby="coach-body"
        className="bg-raised border-line absolute rounded-2xl border p-4 shadow-2xl"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-fg-subtle text-xs tabular-nums">
            {t("train.coach.step").replace("{n}", String(index + 1)).replace("{total}", String(STEPS.length))}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("train.coach.skip")}
            className="text-fg-muted hover:bg-sunken -me-2 -mt-2 grid h-12 w-12 place-items-center rounded-lg"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <h2 id="coach-title" className="text-fg -mt-2 text-base font-semibold">
          {t(step.title)}
        </h2>
        <p id="coach-body" className="text-fg-muted mt-1.5 text-sm leading-relaxed">
          {t(step.body)}
        </p>
        {!box ? <p className="text-fg-subtle mt-2 text-xs">{t("train.coach.notOnScreen")}</p> : null}
        <div className="mt-4 flex items-center gap-2">
          <Button className="min-h-12" onClick={onClose}>
            {t("train.coach.skip")}
          </Button>
          <div className="flex-1" />
          <Button className="min-h-12 min-w-12" disabled={index === 0} onClick={back}>
            {t("train.coach.back")}
          </Button>
          <button
            ref={nextRef}
            type="button"
            onClick={next}
            className="bg-accent text-accent-fg border-accent inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border px-3.5 text-sm font-medium"
          >
            {last ? t("train.coach.done") : t("train.coach.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

interface Task {
  key: ConsoleKey;
  done: boolean;
}

/** What the practice store says the cashier has actually done. */
export function trainingTasks(state: LiveState): Task[] {
  const orders = state.orderIds.map((id) => state.orders[id]).filter((o): o is NonNullable<typeof o> => Boolean(o));
  return [
    { key: "train.task.shift", done: state.session !== null || state.closedSessions.length > 0 },
    { key: "train.task.seat", done: orders.some((o) => o.orderType === "dine_in" && o.tableId !== null) },
    {
      key: "train.task.threeItems",
      done: orders.some(
        (o) => o.lines.filter((l) => l.state !== "voided").reduce((sum, l) => sum + l.quantity, 0) >= 3,
      ),
    },
    { key: "train.task.fire", done: orders.some((o) => o.firstFiredAt !== null) },
    { key: "train.task.pay", done: orders.some((o) => o.payments.length > 0) },
    {
      key: "train.task.void",
      done:
        orders.some((o) => o.lines.some((l) => l.state === "voided")) ||
        state.audit.some((entry) => entry.action.startsWith("order.line.voided")),
    },
    {
      key: "train.task.splitMerge",
      done: orders.some(
        (o) => o.splitFromOrderId !== null || o.state === "merged" || (o.linkedTableIds ?? []).length > 0,
      ),
    },
  ];
}

export function TrainingChecklist() {
  const { t } = useI18n();
  const { state } = useLive();
  const { startedAt, finishedAt, markFinished } = useTraining();
  const now = useNow(1000);

  const tasks = useMemo(() => trainingTasks(state), [state]);
  const doneCount = tasks.filter((task) => task.done).length;
  const allDone = doneCount === tasks.length;

  useEffect(() => {
    if (allDone) markFinished();
  }, [allDone, markFinished]);

  const end = finishedAt ?? now;
  const elapsed = startedAt && end ? Math.max(0, Math.floor((end - startedAt) / 1000)) : 0;
  const over = elapsed > TARGET_SECONDS;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-fg text-sm font-medium">
            {t("train.checklist.progress")
              .replace("{done}", String(doneCount))
              .replace("{total}", String(tasks.length))}
          </span>
          <span className={cx("text-lg font-bold tabular-nums", over ? "text-warn" : "text-fg")}>
            {formatElapsed(elapsed)} <span className="text-fg-subtle text-xs font-normal">/ 30:00</span>
          </span>
        </div>
        <Meter value={(doneCount / tasks.length) * 100} tone={allDone ? "good" : "accent"} className="mt-1.5" />
      </div>

      <ul className="space-y-1.5">
        {tasks.map((task) => (
          <li
            key={task.key}
            className={cx(
              "flex min-h-12 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
              task.done ? "border-good/40 bg-good-soft text-fg" : "border-line text-fg-muted",
            )}
          >
            {task.done ? (
              <CheckCircle2 size={18} className="text-good shrink-0" aria-hidden />
            ) : (
              <Circle size={18} className="text-fg-subtle shrink-0" aria-hidden />
            )}
            <span className="flex-1">{t(task.key)}</span>
            <span className="sr-only">{task.done ? t("train.checklist.done") : t("train.checklist.todo")}</span>
          </li>
        ))}
      </ul>

      {allDone ? (
        <Callout tone={over ? "warn" : "good"}>
          {(over ? t("train.checklist.finishedOver") : t("train.checklist.finished")).replace(
            "{time}",
            formatElapsed(elapsed),
          )}
        </Callout>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function TrainingButton() {
  const { t } = useI18n();
  const { training } = useTraining();
  const simulator = useSimulatorTill();
  const [open, setOpen] = useState(false);

  return (
    <>
      {simulator ? (
        <button
          type="button"
          onClick={openCoachMarks}
          aria-label={t("train.coach.open")}
          title={t("train.coach.open")}
          className="border-line bg-raised text-fg-muted hover:bg-sunken hover:text-fg inline-flex h-12 w-12 items-center justify-center rounded-lg border sm:h-8 sm:w-8"
        >
          <HelpCircle size={15} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        data-coach="training"
        onClick={() => setOpen(true)}
        aria-pressed={training}
        className={cx(
          "inline-flex min-h-12 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold sm:min-h-8",
          training
            ? "border-warn bg-warn text-white"
            : "border-line bg-raised text-fg-muted hover:bg-sunken hover:text-fg",
        )}
      >
        <GraduationCap size={14} aria-hidden />
        {training ? t("train.active") : t("train.title")}
      </button>
      {open ? <TrainingSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TrainingSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { training, enter, leave, restart } = useTraining();

  async function onLeave() {
    const ok = await confirm({
      title: t("train.leaveTitle"),
      body: t("train.leaveBody"),
      tone: "warn",
      confirmLabel: t("train.leave"),
    });
    if (!ok) return;
    leave();
    onClose();
  }

  async function onRestart() {
    const ok = await confirm({
      title: t("train.resetTitle"),
      body: t("train.resetBody"),
      tone: "danger",
      confirmLabel: t("train.reset"),
    });
    if (ok) restart();
  }

  return (
    <Modal open onClose={onClose} title={t("train.title")}>
      {training ? (
        <div className="space-y-4">
          <Callout tone="warn">{t("train.bannerBody")}</Callout>
          <TrainingChecklist />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="min-h-12"
              icon={<HelpCircle size={15} />}
              onClick={() => {
                onClose();
                openCoachMarks();
              }}
            >
              {t("train.coach.open")}
            </Button>
            <Button className="min-h-12" icon={<RotateCcw size={15} />} onClick={onRestart}>
              {t("train.reset")}
            </Button>
            <Button className="min-h-12 sm:col-span-2" variant="danger" onClick={onLeave}>
              {t("train.leave")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-fg text-sm leading-relaxed">{t("train.intro")}</p>
          <ul className="text-fg-muted list-disc space-y-1 ps-5 text-sm">
            <li>{t("train.introSandbox")}</li>
            <li>{t("train.introNoServer")}</li>
            <li>{t("train.introTarget")}</li>
          </ul>
          <Button
            variant="primary"
            className="min-h-12 w-full"
            icon={<GraduationCap size={16} />}
            onClick={() => {
              enter();
              onClose();
              // The tour is the first thing a trainee needs; it opens once the till remounts.
              window.setTimeout(openCoachMarks, 300);
            }}
          >
            {t("train.start")}
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Unmissable while practice is on — on the till and on the kitchen display. */
export function TrainingBanner() {
  const { t } = useI18n();
  const { training } = useTraining();
  if (!training) return null;
  return (
    <div
      role="status"
      className="bg-warn flex shrink-0 items-center gap-2 border-b border-black/10 px-3 py-1.5 text-xs font-semibold text-white"
    >
      <GraduationCap size={15} aria-hidden />
      <span className="tracking-wide uppercase">{t("train.active")}</span>
      <span className="font-normal opacity-95">{t("train.bannerBody")}</span>
    </div>
  );
}
