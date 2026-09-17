"use client";

/**
 * Breaks and clock-in photos on the attendance screen — FR-HRM-026, FR-HRM-027.
 *
 * Breaks are taken at the till's clock panel and split into paid and unpaid
 * here with the same policy the till used (`classifyBreaks`, the
 * `hr.paidRestMinutes` / `hr.mealBreakPaid` settings for the branch in scope),
 * so the minutes a person saw on the till are the minutes payroll sees.
 *
 * Photos are evidence for a specific question — did the person on the
 * record clock in? — so they are shown small, beside the name and time, to
 * people who can correct attendance, and they are removed after the
 * retention period rather than kept as an archive of faces.
 */

import { useMemo, useState } from "react";
import { CameraOff, Trash2 } from "lucide-react";

import type { BreakRecord, ClockPhoto } from "@/lib/console/services/workforce-hr";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatTime } from "@/lib/console/format";
import { useWorkforceSettings } from "@/lib/console/workforce-settings";
import { classifyBreaks } from "@/lib/console/workforce-rules";
import { useConfirm } from "@/components/console/confirm";
import { DateRangeField, resolvePreset, type DateRange } from "@/components/console/fields";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout } from "@/components/console/ui";

interface BreakDay {
  key: string;
  employeeKey: string;
  employeeName: string;
  date: string;
  breaks: BreakRecord[];
  paidMinutes: number;
  unpaidMinutes: number;
  open: boolean;
}

export function BreaksPanel() {
  const { t, fmt } = useI18n();
  const { scope } = useSession();
  const settings = useWorkforceSettings({ branchId: scope.branchId ?? null });
  const [period, setPeriod] = useState<DateRange>(() => resolvePreset("last7"));
  const state = useAsync(() => services.workforceHr.breaks.all(), []);

  const days = useMemo<BreakDay[]>(() => {
    const groups = new Map<string, BreakRecord[]>();
    for (const row of state.data ?? []) {
      if (row.date < period.from || row.date > period.to) continue;
      const key = `${row.employeeKey}::${row.date}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()]
      .map(([key, breaks]) => {
        // FR-HRM-026 — the same split the till showed.
        const split = classifyBreaks(breaks, settings.breakPolicy);
        return {
          key,
          employeeKey: breaks[0]!.employeeKey,
          employeeName: breaks[0]!.employeeName,
          date: breaks[0]!.date,
          breaks: [...breaks].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
          paidMinutes: split.paidMinutes,
          unpaidMinutes: split.unpaidMinutes,
          open: split.open !== null,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
  }, [state.data, period, settings.breakPolicy]);

  return (
    <div className="space-y-3">
      <Callout tone="muted" title={t("wf.breaks.policyTitle")}>
        {t("clock.breakPolicy")
          .replace("{n}", String(settings.breakPolicy.paidRestMinutes))
          .replace("{meal}", settings.breakPolicy.mealBreakPaid ? t("clock.mealPaid") : t("clock.mealUnpaid"))}{" "}
        {t("wf.breaks.policyWhere")}
      </Callout>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeField value={period} onChange={setPeriod} />
        <ExportButton
          filename={`breaks-${period.from}-${period.to}`}
          title={t("wf.breaks.title")}
          permission="hr.payroll.export"
          rows={days}
          columns={[
            { key: "date", header: t("common.date"), value: (row) => row.date },
            { key: "employee", header: t("wf.employee"), value: (row) => row.employeeName },
            { key: "paid", header: t("wf.breaks.paidMinutes"), value: (row) => row.paidMinutes },
            { key: "unpaid", header: t("wf.breaks.unpaidMinutes"), value: (row) => row.unpaidMinutes },
          ]}
        />
      </div>
      <AsyncPanel state={state} isEmpty={() => days.length === 0} empty={<Callout tone="muted">{t("wf.breaks.none")}</Callout>}>
        {() => (
          <ul className="divide-line border-line divide-y rounded-lg border">
            {days.map((day) => (
              <li key={day.key} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-fg font-medium">
                    {day.employeeName} · {formatDate(day.date, fmt)}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone="good">{t("wf.breaks.paidBadge").replace("{n}", String(day.paidMinutes))}</Badge>
                    <Badge tone={day.unpaidMinutes > 0 ? "warn" : "muted"}>
                      {t("wf.breaks.unpaidBadge").replace("{n}", String(day.unpaidMinutes))}
                    </Badge>
                    {day.open ? <Badge tone="accent" dot>{t("wf.breaks.running")}</Badge> : null}
                  </span>
                </div>
                <p className="text-fg-muted mt-1 text-xs">
                  {day.breaks
                    .map(
                      (entry) =>
                        `${t(entry.kind === "meal" ? "wf.breaks.meal" : "wf.breaks.rest")} ${formatTime(entry.startedAt, fmt)}–${
                          entry.endedAt ? formatTime(entry.endedAt, fmt) : "…"
                        }`,
                    )
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>
    </div>
  );
}

export function ClockPhotosPanel() {
  const { t, fmt } = useI18n();
  const canReview = usePermission("hr.attendance.correct");
  const confirm = useConfirm();
  const action = useAction();
  const state = useAsync<ClockPhoto[]>(
    () => services.workforceHr.photos.all().then((rows) => [...rows].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))),
    [],
  );

  if (!canReview) return <Callout tone="muted">{t("wf.photos.restricted")}</Callout>;

  async function remove(photo: ClockPhoto) {
    const ok = await confirm({
      title: t("wf.photos.removeTitle"),
      body: t("wf.photos.removeBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.workforceHr.photos.remove(photo.id), { onSuccess: state.reload });
  }

  return (
    <div className="space-y-3">
      <Callout tone="muted" title={t("wf.photos.policyTitle")}>
        {t("wf.photos.policyBody")}
      </Callout>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <AsyncPanel state={state} isEmpty={(rows) => rows.length === 0} empty={<Callout tone="muted">{t("wf.photos.none")}</Callout>}>
        {(rows) => (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map((photo) => (
              <li key={photo.id} className="border-line rounded-lg border p-2">
                {photo.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local data URL; nothing to optimise.
                  <img
                    src={photo.image}
                    alt={t("wf.photos.alt").replace("{name}", photo.employeeName)}
                    className="aspect-[4/3] w-full rounded object-cover"
                  />
                ) : (
                  <div className="bg-sunken text-fg-subtle flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded p-2 text-center text-xs">
                    <CameraOff size={18} aria-hidden />
                    {photo.unavailableReason ?? t("wf.photos.noImage")}
                  </div>
                )}
                <p className="text-fg mt-2 truncate text-sm font-medium">{photo.employeeName}</p>
                <p className="text-fg-muted text-xs">{formatDateTime(photo.capturedAt, fmt)}</p>
                <p className="text-fg-subtle text-[0.68rem]">
                  {photo.noticeAcknowledgedAt
                    ? t("wf.photos.noticeAt").replace("{when}", formatDateTime(photo.noticeAcknowledgedAt, fmt))
                    : t("wf.photos.noNotice")}
                </p>
                <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} className="mt-1" onClick={() => void remove(photo)}>
                  {t("common.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>
    </div>
  );
}
