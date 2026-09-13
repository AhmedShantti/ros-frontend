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
 */

import { useEffect, useState } from "react";
import { Clock3, LogIn, LogOut, MapPin } from "lucide-react";

import type { ClockEvent } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime, formatDuration, formatTime } from "@/lib/console/format";
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
  const clockedIn = last?.status === "open";

  async function punch(direction: "in" | "out") {
    await action.run(
      async () => {
        const gps = withLocation ? await currentPosition() : null;
        if (withLocation && !gps) throw new Error(t("clock.noLocation"));
        const input = gps ? { gps } : {};
        return direction === "in"
          ? services.workforce.clockIn(input)
          : services.workforce.clockOut(input);
      },
      {
        onSuccess: (event) => {
          writeLast(employeeKey, event);
          onChange(event);
        },
      },
    );
  }

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
            <Button variant="danger" icon={<LogOut size={14} />} loading={action.pending} onClick={() => void punch("out")}>
              {t("clock.clockOut")}
            </Button>
          ) : (
            <Button variant="primary" icon={<LogIn size={14} />} loading={action.pending} onClick={() => void punch("in")}>
              {t("clock.clockIn")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-fg text-base font-semibold">{employeeName}</p>

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

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
