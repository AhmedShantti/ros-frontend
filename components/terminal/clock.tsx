"use client";

/**
 * Clock in and out at the till — FR-HRM-020, FR-HRM-021, FR-HRM-022.
 *
 * `POST /workforce/attendance/clock-in|out` act on the employee the PIN
 * session belongs to — there is no employee id to pass and no permission to
 * hold, because every employee must be able to clock themselves in. The
 * server stamps the time and raises the flags (late, unscheduled, early,
 * outside the geofence); this panel shows what it said.
 *
 * There is no "am I clocked in?" read, so the last event is remembered on
 * this device per employee. It is a display hint only: the server refuses a
 * second clock-in, and that refusal is shown as it comes.
 *
 * Location (FR-HRM-021) is sent only when the person ticks the box, and the
 * box says what is sent. A till bolted to a counter does not need it; a
 * phone clocking in at the back door is what the geofence is for.
 *
 * Four more things happen here, because this is the one screen every
 * employee passes through at the start and end of a shift:
 *
 *   - **Too early is refused** (FR-HRM-023). The window comes from the
 *     settings cascade (`hr.earlyClockInMinutes`) for this terminal's branch
 *     and is checked against today's rostered shift before the request goes.
 *   - **A photo, when configured, with notice first** (FR-HRM-027).
 *   - **Breaks, paid or unpaid** (FR-HRM-026).
 *   - **The published roster, acknowledged** (FR-HRM-015).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CalendarCheck, Clock3, Coffee, LogIn, LogOut, MapPin, Utensils } from "lucide-react";

import type { Employee, ScheduledShift } from "@/lib/console/types";
import type { ClockEvent } from "@/lib/console/services/types";
import type { BreakRecord, SchedulePublication } from "@/lib/console/services/workforce-hr";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { getTerminalBranchId, getTerminalId } from "@/lib/api/session";
import { formatDateTime, formatDuration, formatTime } from "@/lib/console/format";
import { useWorkforceSettings } from "@/lib/console/workforce-settings";
import {
  classifyBreaks,
  earlyClockInCheck,
  localDateIso,
  shiftForClockIn,
  type BreakKind,
} from "@/lib/console/workforce-rules";
import { Badge, Button, Callout, Modal, Toggle } from "@/components/console/ui";

const KEY = "ros.terminal.clock";

function readLast(employeeKey: string): ClockEvent | null {
  try {
    const raw = window.localStorage.getItem(`${KEY}.${employeeKey}`);
    return raw ? (JSON.parse(raw) as ClockEvent) : null;
  } catch {
    return null;
  }
}

function writeLast(employeeKey: string, event: ClockEvent): void {
  try {
    window.localStorage.setItem(`${KEY}.${employeeKey}`, JSON.stringify(event));
  } catch {
    // Storage blocked: the panel still shows this session's answer.
  }
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function ClockButton({
  employeeKey,
  employeeName,
}: {
  /** Whatever identifies the signed-on person on this device — a code or an id. */
  employeeKey: string;
  employeeName: string;
}) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<ClockEvent | null>(null);

  useEffect(() => {
    setLast(readLast(employeeKey));
  }, [employeeKey, open]);

  const clockedIn = last?.status === "open";

  return (
    <>
      <Button
        size="sm"
        variant={clockedIn ? "ghost" : "secondary"}
        icon={<Clock3 size={13} />}
        onClick={() => setOpen(true)}
        title={clockedIn ? t("clock.inSince").replace("{time}", formatTime(last!.clockInAt, fmt)) : undefined}
      >
        {clockedIn ? t("clock.clockedIn") : t("clock.clockIn")}
      </Button>
      {open ? (
        <ClockPanel
          employeeKey={employeeKey}
          employeeName={employeeName}
          last={last}
          onChange={setLast}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type Step = "main" | "notice" | "camera";

function ClockPanel({
  employeeKey,
  employeeName,
  last,
  onChange,
  onClose,
}: {
  employeeKey: string;
  employeeName: string;
  last: ClockEvent | null;
  onChange: (event: ClockEvent) => void;
  onClose: () => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const [withLocation, setWithLocation] = useState(false);
  const [step, setStep] = useState<Step>("main");
  const clockedIn = last?.status === "open";

  const branchId = getTerminalBranchId();
  const settings = useWorkforceSettings({ branchId, terminalId: getTerminalId() });

  /**
   * Who this is, as an employee record. The till knows a code or an id; the
   * roster and the publications are keyed by id.
   */
  const employee = useAsync<Employee | null>(
    () =>
      services.workforce.employees
        .list({ limit: 500 })
        .then((page) => page.rows.find((row) => row.id === employeeKey || row.code === employeeKey) ?? null)
        .catch(() => null),
    [employeeKey],
  );
  const employeeId = employee.data?.id ?? employeeKey;

  /**
   * FR-HRM-023 — today's roster. `null` means the roster could not be read
   * on this terminal (the live backend exposes no shift list), which is
   * different from "no shift today" and is said so.
   */
  const today = localDateIso(new Date());
  const roster = useAsync<ScheduledShift[] | null>(
    () =>
      services.workforce.shifts
        .list({ limit: 500, filters: { date: today } })
        .then((page) => page.rows)
        .catch(() => null),
    [today],
  );
  const myShift = useMemo(() => {
    if (!roster.data) return null;
    return shiftForClockIn(
      new Date(),
      roster.data.filter((shift) => shift.employeeId === employeeId && (!branchId || shift.branchId === branchId)),
    );
  }, [roster.data, employeeId, branchId]);

  const notice = useAsync(() => services.workforceHr.photos.noticeFor(employeeKey), [employeeKey]);
  const openBreak = useAsync<BreakRecord | null>(() => services.workforceHr.breaks.open(employeeKey), [employeeKey]);
  const todaysBreaks = useAsync<BreakRecord[]>(
    () => services.workforceHr.breaks.all().then((rows) => rows.filter((row) => row.employeeKey === employeeKey && row.date === today)),
    [employeeKey, today, openBreak.data?.id, openBreak.data?.endedAt],
  );
  const publications = useAsync<SchedulePublication[]>(
    () =>
      services.workforceHr.publications
        .all()
        .then((rows) =>
          rows.filter(
            (row) =>
              row.employeeIds.includes(employeeId) &&
              !row.acknowledgements.some((ack) => ack.employeeId === employeeId),
          ),
        ),
    [employeeId],
  );

  const [photo, setPhoto] = useState<{ image: string | null; reason: string | null } | null>(null);

  async function send(direction: "in" | "out", captured: { image: string | null; reason: string | null } | null) {
    await action.run(
      async () => {
        const gps = withLocation ? await currentPosition() : null;
        if (withLocation && !gps) throw new Error(t("clock.noLocation"));
        const input = gps ? { gps } : {};
        const event =
          direction === "in" ? await services.workforce.clockIn(input) : await services.workforce.clockOut(input);
        // FR-HRM-027 — kept only once the clock event itself succeeded, so a
        // refused clock-in never leaves a photo behind with nothing to explain it.
        if (direction === "in" && captured) {
          await services.workforceHr.photos.create({
            employeeKey,
            employeeName,
            direction: "in",
            image: captured.image,
            unavailableReason: captured.reason,
            noticeAcknowledgedAt: notice.data?.acknowledgedAt ?? null,
          });
        }
        return event;
      },
      {
        onSuccess: (event) => {
          writeLast(employeeKey, event);
          onChange(event);
          setStep("main");
          setPhoto(null);
        },
      },
    );
  }

  // FR-HRM-023 — checked here, before anything is sent.
  const early = myShift
    ? earlyClockInCheck(new Date(), myShift, settings.earlyClockInMinutes)
    : null;
  const tooEarly = !clockedIn && early !== null && !early.allowed;

  function startClockIn() {
    if (tooEarly) return;
    if (settings.clockInPhoto) {
      // FR-HRM-027 — explicit notice before the first photo, every employee.
      setStep(notice.data ? "camera" : "notice");
      return;
    }
    void send("in", null);
  }

  async function toggleBreak(kind: BreakKind) {
    await action.run(
      async () => {
        if (openBreak.data) return services.workforceHr.breaks.end(openBreak.data.id);
        return services.workforceHr.breaks.start({ employeeKey, employeeName, kind });
      },
      { onSuccess: () => openBreak.reload() },
    );
  }

  const breakTotals = classifyBreaks(todaysBreaks.data ?? [], settings.breakPolicy);

  const flags = last
    ? ([
        last.lateArrival ? "late" : null,
        last.unscheduled ? "unscheduled" : null,
        last.earlyDeparture ? "early" : null,
        last.outsideGeofence ? "geofence" : null,
        last.missingClockOut ? "missing" : null,
      ].filter(Boolean) as string[])
    : [];

  const worked =
    last && last.clockOutAt
      ? Math.max(0, (Date.parse(last.clockOutAt) - Date.parse(last.clockInAt)) / 1000)
      : null;

  if (step === "notice") {
    return (
      <Modal
        open
        onClose={onClose}
        title={t("clock.photoNoticeTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStep("main")}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={action.pending}
              onClick={() =>
                void action.run(() => services.workforceHr.photos.acknowledgeNotice(employeeKey), {
                  onSuccess: () => {
                    notice.reload();
                    setStep("camera");
                  },
                })
              }
            >
              {t("clock.photoNoticeAccept")}
            </Button>
          </>
        }
      >
        {/* FR-HRM-027 — the notice says what is taken, why, who sees it and how long it is kept. */}
        <div className="space-y-3 text-sm">
          <p className="text-fg">{t("clock.photoNoticeBody")}</p>
          <ul className="text-fg-muted list-disc space-y-1 ps-5 text-xs">
            <li>{t("clock.photoNoticeWhat")}</li>
            <li>{t("clock.photoNoticeWho")}</li>
            <li>{t("clock.photoNoticeRetention")}</li>
          </ul>
        </div>
      </Modal>
    );
  }

  if (step === "camera") {
    return (
      <Modal open onClose={onClose} title={t("clock.photoTitle")}>
        <div className="space-y-3">
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <CameraCapture
            busy={action.pending}
            onCaptured={(image) => {
              setPhoto({ image, reason: null });
              void send("in", { image, reason: null });
            }}
            onFallback={(reason) => {
              setPhoto({ image: null, reason });
              void send("in", { image: null, reason });
            }}
            onCancel={() => setStep("main")}
          />
          {photo && !photo.image ? <p className="text-fg-subtle text-xs">{photo.reason}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("clock.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {clockedIn ? (
            <Button
              variant="danger"
              icon={<LogOut size={14} />}
              loading={action.pending}
              disabled={Boolean(openBreak.data)}
              onClick={() => void send("out", null)}
            >
              {t("clock.clockOut")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={settings.clockInPhoto ? <Camera size={14} /> : <LogIn size={14} />}
              loading={action.pending || roster.loading}
              disabled={tooEarly}
              onClick={startClockIn}
            >
              {t("clock.clockIn")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-fg text-base font-semibold">{employeeName}</p>

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {!clockedIn ? (
          myShift ? (
            <div className="text-fg-muted text-xs">
              {t("clock.todayShift").replace("{start}", myShift.startTime).replace("{end}", myShift.endTime)}
            </div>
          ) : roster.data === null && !roster.loading ? (
            <Callout tone="muted">{t("clock.rosterUnavailable")}</Callout>
          ) : null
        ) : null}

        {tooEarly && early ? (
          <Callout tone="warn" title={t("clock.tooEarlyTitle")}>
            {t("clock.tooEarlyBody")
              .replace("{time}", formatTime(early.opensAt.toISOString(), fmt))
              .replace("{n}", String(settings.earlyClockInMinutes))}
          </Callout>
        ) : null}

        {last ? (
          <div className="border-line bg-sunken/40 rounded-lg border p-3 text-sm">
            <p className="text-fg">
              {clockedIn
                ? t("clock.inSince").replace("{time}", formatDateTime(last.clockInAt, fmt))
                : t("clock.lastShift")
                    .replace("{in}", formatDateTime(last.clockInAt, fmt))
                    .replace("{out}", formatDateTime(last.clockOutAt, fmt))}
            </p>
            {worked !== null ? (
              <p className="text-fg-muted mt-1 text-xs">
                {t("clock.worked").replace("{duration}", formatDuration(worked, fmt))}
              </p>
            ) : null}
            {flags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {flags.map((flag) => (
                  <Badge key={flag} tone="warn">
                    {t(`clock.flag.${flag}` as never)}
                  </Badge>
                ))}
              </div>
            ) : null}
            <p className="text-fg-subtle mt-2 text-[0.68rem]">{t("clock.deviceNote")}</p>
          </div>
        ) : (
          <p className="text-fg-muted text-sm">{t("clock.noRecord")}</p>
        )}

        {/* FR-HRM-026 — breaks while clocked in, split paid / unpaid by policy. */}
        {clockedIn ? (
          <section className="border-line space-y-2 rounded-lg border p-3">
            <h3 className="text-fg text-sm font-semibold">{t("clock.breaks")}</h3>
            {openBreak.data ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn" dot>
                  {t(openBreak.data.kind === "meal" ? "clock.onMealBreak" : "clock.onRestBreak").replace(
                    "{time}",
                    formatTime(openBreak.data.startedAt, fmt),
                  )}
                </Badge>
                <Button size="sm" variant="primary" loading={action.pending} onClick={() => void toggleBreak(openBreak.data!.kind)}>
                  {t("clock.endBreak")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<Coffee size={13} />} loading={action.pending} onClick={() => void toggleBreak("rest")}>
                  {t("clock.startRest")}
                </Button>
                <Button size="sm" icon={<Utensils size={13} />} loading={action.pending} onClick={() => void toggleBreak("meal")}>
                  {t("clock.startMeal")}
                </Button>
              </div>
            )}
            <p className="text-fg-muted text-xs">
              {t("clock.breakTotals")
                .replace("{paid}", String(breakTotals.paidMinutes))
                .replace("{unpaid}", String(breakTotals.unpaidMinutes))}
            </p>
            <p className="text-fg-subtle text-[0.68rem]">
              {t("clock.breakPolicy")
                .replace("{n}", String(settings.breakPolicy.paidRestMinutes))
                .replace("{meal}", settings.breakPolicy.mealBreakPaid ? t("clock.mealPaid") : t("clock.mealUnpaid"))}
            </p>
            {openBreak.data ? <p className="text-fg-subtle text-[0.68rem]">{t("clock.endBreakFirst")}</p> : null}
          </section>
        ) : null}

        {/* FR-HRM-015 — a published roster this person has not yet acknowledged. */}
        {(publications.data ?? []).map((publication) => (
          <section key={publication.id} className="border-accent/40 bg-accent-soft/40 space-y-2 rounded-lg border p-3">
            <p className="text-fg flex items-center gap-2 text-sm font-medium">
              <CalendarCheck size={14} aria-hidden />
              {t("clock.rosterPublished").replace("{week}", publication.weekStart)}
            </p>
            <Button
              size="sm"
              variant="primary"
              loading={action.pending}
              onClick={() =>
                void action.run(
                  () => services.workforceHr.publications.acknowledge(publication.id, employeeId, "terminal", null),
                  { onSuccess: () => publications.reload() },
                )
              }
            >
              {t("clock.acknowledgeRoster")}
            </Button>
          </section>
        ))}

        {!clockedIn && settings.clockInPhoto ? (
          <p className="text-fg-subtle flex items-center gap-1.5 text-xs">
            <Camera size={12} aria-hidden /> {t("clock.photoRequiredHint")}
          </p>
        ) : null}

        <Toggle
          checked={withLocation}
          onChange={setWithLocation}
          label={t("clock.sendLocation")}
          hint={t("clock.sendLocationHint")}
        />
        {withLocation ? (
          <p className="text-fg-subtle flex items-center gap-1.5 text-xs">
            <MapPin size={12} aria-hidden /> {t("clock.locationAsked")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * FR-HRM-027 — the camera, with a way out that is not a dead end.
 *
 * `getUserMedia` fails for ordinary reasons: no camera on the till, the
 * permission refused, an insecure origin. None of those should stop someone
 * starting their shift, so the fallback clocks in without the photo and
 * records *why* there is none, which is what a reviewer needs to see.
 */
function CameraCapture({
  busy,
  onCaptured,
  onFallback,
  onCancel,
}: {
  busy: boolean;
  onCaptured: (dataUrl: string) => void;
  onFallback: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "unavailable">("starting");
  const [reason, setReason] = useState<string>("");
  // The dictionary function is not stable across renders; the camera must
  // not restart every time the panel re-renders.
  const copy = useRef(t);
  copy.current = t;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setReason(copy.current("clock.cameraUnsupported"));
        setState("unavailable");
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setState("live");
      } catch (caught) {
        const name = caught instanceof DOMException ? caught.name : "";
        setReason(name === "NotAllowedError" ? copy.current("clock.cameraDenied") : copy.current("clock.cameraFailed"));
        setState("unavailable");
      }
    }
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  function capture() {
    const element = video.current;
    if (!element) return;
    // Small on purpose: enough to recognise a face, not a portrait archive.
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    if (!context) {
      onFallback(t("clock.cameraFailed"));
      return;
    }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    stop();
    onCaptured(dataUrl);
  }

  return (
    <div className="space-y-3">
      {state !== "unavailable" ? (
        <video
          ref={video}
          muted
          playsInline
          className="bg-sunken border-line aspect-[4/3] w-full rounded-lg border object-cover"
          aria-label={t("clock.photoTitle")}
        />
      ) : (
        <Callout tone="warn" title={t("clock.cameraUnavailableTitle")}>
          {reason}
        </Callout>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {state === "unavailable" ? (
          <Button variant="primary" loading={busy} onClick={() => onFallback(reason)}>
            {t("clock.clockInWithoutPhoto")}
          </Button>
        ) : (
          <Button variant="primary" icon={<Camera size={14} />} loading={busy} disabled={state !== "live"} onClick={capture}>
            {t("clock.captureAndClockIn")}
          </Button>
        )}
      </div>
    </div>
  );
}
