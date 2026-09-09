"use client";

/**
 * Workforce write surfaces — SRS ch.14.
 *
 * Four things the read-only screens could show but not do:
 *
 *   - **The schedule builder** (FR-HRM-010 … FR-HRM-014). A week grid, not a
 *     list, because a roster is read across days and down positions and a
 *     flat list makes the gap on Thursday evening invisible.
 *   - **Attendance corrections** (FR-HRM-025). The original stands beside the
 *     new value rather than being replaced, because payroll needs to know
 *     which hours were observed and which were asserted.
 *   - **Overtime approval** (FR-HRM-034). Approved and unapproved overtime
 *     are different facts; rolling them together produces a labour line that
 *     always reconciles and never explains anything.
 *   - **Payroll export** (FR-HRM-035). Inputs to payroll, never net pay —
 *     FR-HRM-036 is explicit that this is not a payroll engine.
 *
 * Rule violations warn; they do not block (FR-HRM-012). Real rosters need
 * exceptions, and a rule that cannot be overridden gets worked around
 * outside the system where nobody can see it.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Plus, Trash2, X } from "lucide-react";

import type {
  AttendanceRecord,
  Employee,
  Id,
  OvertimeRecord,
  ScheduledShift,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatTime, money } from "@/lib/console/format";
import { exportRows } from "@/lib/console/export";
import { useExportLog } from "@/lib/console/export-log";
import { useConfirm } from "@/components/console/confirm";
import { DateRangeField, resolvePreset, type DateRange } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Scheduling rules — FR-HRM-012
// ---------------------------------------------------------------------------

interface RuleContext {
  employeeId: Id;
  date: string;
  startTime: string;
  endTime: string;
  /** Every other shift already on the roster, for cross-day checks. */
  siblings: DraftShift[];
}

export interface DraftShift {
  key: string;
  id?: Id;
  employeeId: Id;
  date: string;
  startTime: string;
  endTime: string;
}

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = (eh! * 60 + em!) - (sh! * 60 + sm!);
  // A shift ending before it starts crossed midnight.
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

const MAX_CONSECUTIVE_DAYS = 6;
const MIN_REST_HOURS = 11;
const MAX_SHIFT_HOURS = 12;
const MAX_WEEKLY_HOURS = 48;

/**
 * Returns message keys rather than sentences, so the caller renders them in
 * the active language — the same convention the Zod schemas use.
 */
export function validateShift(ctx: RuleContext): string[] {
  const problems: string[] = [];
  const length = hoursBetween(ctx.startTime, ctx.endTime);

  if (length > MAX_SHIFT_HOURS) problems.push("wf.rule.tooLong");
  if (length <= 0) problems.push("wf.rule.zeroLength");

  const mine = ctx.siblings.filter(
    (shift) => shift.employeeId === ctx.employeeId && shift.date !== ctx.date,
  );

  const weekly =
    mine.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0) + length;
  if (weekly > MAX_WEEKLY_HOURS) problems.push("wf.rule.weeklyHours");

  // Consecutive days, counting this one.
  const days = new Set(mine.map((shift) => shift.date));
  days.add(ctx.date);
  const sorted = [...days].sort();
  let run = 1;
  let longest = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (Date.parse(sorted[i]!) - Date.parse(sorted[i - 1]!)) / 86_400_000;
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  if (longest > MAX_CONSECUTIVE_DAYS) problems.push("wf.rule.consecutive");

  // Rest between this shift and the adjacent days.
  for (const shift of mine) {
    const gapDays = Math.abs(
      (Date.parse(ctx.date) - Date.parse(shift.date)) / 86_400_000,
    );
    if (gapDays !== 1) continue;
    const earlier = shift.date < ctx.date ? shift : { startTime: ctx.startTime, endTime: ctx.endTime };
    const later = shift.date < ctx.date ? { startTime: ctx.startTime } : shift;
    const [eh, em] = earlier.endTime.split(":").map(Number);
    const [lh, lm] = later.startTime.split(":").map(Number);
    const rest = 24 - (eh! + em! / 60) + (lh! + lm! / 60);
    if (rest < MIN_REST_HOURS) {
      problems.push("wf.rule.rest");
      break;
    }
  }

  const clash = ctx.siblings.some(
    (shift) =>
      shift.employeeId === ctx.employeeId &&
      shift.date === ctx.date &&
      !(shift.endTime <= ctx.startTime || shift.startTime >= ctx.endTime),
  );
  if (clash) problems.push("wf.rule.overlap");

  return problems;
}

// ---------------------------------------------------------------------------
// Schedule builder — FR-HRM-010, FR-HRM-011, FR-HRM-013
// ---------------------------------------------------------------------------

function weekDates(startIso: string): string[] {
  const start = Date.parse(startIso);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Monday-based start of the week containing `iso`. */
function weekStartOf(iso: string): string {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.parse(iso) - day * 86_400_000).toISOString().slice(0, 10);
}

const SHIFT_TEMPLATES = [
  { key: "opening", start: "07:00", end: "15:00" },
  { key: "mid", start: "11:00", end: "19:00" },
  { key: "closing", start: "15:00", end: "23:00" },
  { key: "split", start: "12:00", end: "16:00" },
];

export function ScheduleBuilder({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const action = useAction();
  const confirm = useConfirm();
  const branches = useBranches(scope);

  const employees = useAsync(
    () =>
      services.workforce.employees
        .list({ limit: 200 })
        .then((page) => page.rows.filter((row) => row.status === "active"))
        .catch(() => [] as Employee[]),
    [open],
  );

  const [branchId, setBranchId] = useState<Id>("");
  const [weekStart, setWeekStart] = useState(() =>
    weekStartOf(new Date().toISOString().slice(0, 10)),
  );
  const [shifts, setShifts] = useState<DraftShift[]>([]);
  const [editing, setEditing] = useState<DraftShift | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(scope.branchId ?? branches[0]?.id ?? "");
    setShifts([]);
  }, [open, scope.branchId, branches.length]);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const roster = employees.data ?? [];

  const rateOf = (employeeId: Id) =>
    roster.find((row) => row.id === employeeId)?.hourlyRate.amount ?? 0;

  const projected = shifts.reduce(
    (sum, shift) =>
      sum + Math.round(hoursBetween(shift.startTime, shift.endTime) * rateOf(shift.employeeId)),
    0,
  );
  const totalHours = shifts.reduce(
    (sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime),
    0,
  );

  const violationsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const shift of shifts) {
      map.set(
        shift.key,
        validateShift({
          employeeId: shift.employeeId,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          siblings: shifts.filter((other) => other.key !== shift.key),
        }),
      );
    }
    return map;
  }, [shifts]);

  const allViolations = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of violationsByKey.values()) {
      for (const key of list) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()];
  }, [violationsByKey]);

  function addShift(employeeId: Id, date: string, template = SHIFT_TEMPLATES[0]!) {
    setShifts((current) => [
      ...current,
      {
        key: `s_${current.length}_${Date.now().toString(36)}`,
        employeeId,
        date,
        startTime: template.start,
        endTime: template.end,
      },
    ]);
  }

  /** FR-HRM-011 — a roster is mostly last week's roster. */
  function copyPreviousWeek() {
    const previous = new Date(Date.parse(weekStart) - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    setWeekStart(previous);
    // The grid itself is the copy source: shifting the week forward again
    // keeps whatever is on screen, which is what "copy last week" means.
    window.setTimeout(() => {
      setWeekStart(weekStart);
      setShifts((current) =>
        current.map((shift) => ({
          ...shift,
          key: `${shift.key}_c`,
          date: new Date(Date.parse(shift.date) + 7 * 86_400_000).toISOString().slice(0, 10),
        })),
      );
    }, 0);
  }

  async function publish() {
    if (shifts.length === 0) return;

    if (allViolations.length > 0) {
      const ok = await confirm({
        title: t("wf.publishWithViolations"),
        body: t("wf.publishWithViolationsBody").replace(
          "{n}",
          String(allViolations.reduce((sum, [, count]) => sum + count, 0)),
        ),
        confirmLabel: t("wf.publishAnyway"),
        tone: "warn",
      });
      if (!ok) return;
    }

    await action.run(
      async () => {
        for (const shift of shifts) {
          const employee = roster.find((row) => row.id === shift.employeeId);
          const hours = hoursBetween(shift.startTime, shift.endTime);
          await services.workforce.shifts.create({
            employeeId: shift.employeeId,
            employeeName: employee?.name,
            position: employee?.position,
            branchId,
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            hours,
            status: "published",
            projectedCost: money(
              Math.round(hours * (employee?.hourlyRate.amount ?? 0)),
              "EGP",
            ),
            violations: (violationsByKey.get(shift.key) ?? []).map((key) => t(key as never)),
          });
        }
      },
      { onSuccess: () => onSaved(t("wf.schedulePublished")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.buildSchedule")}
      subtitle="FR-HRM-010"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={shifts.length === 0 || !branchId}
            onClick={() => void publish()}
          >
            {t("wf.publish")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.branch")} required>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">—</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("wf.weekStarting")}>
            <Input
              type="date"
              dir="ltr"
              value={weekStart}
              onChange={(event) => setWeekStart(weekStartOf(event.target.value))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={copyPreviousWeek}>
            {t("wf.shiftForward")}
          </Button>
          {shifts.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setShifts([])}>
              {t("wf.clearGrid")}
            </Button>
          ) : null}
        </div>

        {/* -- The grid --------------------------------------------------- */}
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] text-xs">
            <caption className="sr-only">{t("wf.buildSchedule")}</caption>
            <thead>
              <tr className="border-line bg-sunken border-b">
                <th scope="col" className="text-fg-muted px-2 py-2 text-start font-medium">
                  {t("wf.employee")}
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className="text-fg-muted px-1 py-2 text-center font-medium"
                  >
                    <span className="block">{t(`common.weekday.${new Date(day).getUTCDay()}` as never)}</span>
                    <span className="text-fg-subtle block font-mono text-[0.6rem]">
                      {day.slice(8)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-fg-subtle px-3 py-6 text-center">
                    {t("wf.noEmployees")}
                  </td>
                </tr>
              ) : (
                roster.map((employee) => (
                  <tr key={employee.id}>
                    <th scope="row" className="px-2 py-2 text-start font-normal">
                      <span className="text-fg block truncate">{tx(employee.name)}</span>
                      <span className="text-fg-subtle block truncate text-[0.65rem]">
                        {tx(employee.position)}
                      </span>
                    </th>
                    {days.map((day) => {
                      const cell = shifts.filter(
                        (shift) => shift.employeeId === employee.id && shift.date === day,
                      );
                      return (
                        <td key={day} className="px-1 py-1 align-top">
                          <div className="flex flex-col gap-1">
                            {cell.map((shift) => {
                              const violations = violationsByKey.get(shift.key) ?? [];
                              return (
                                <button
                                  key={shift.key}
                                  type="button"
                                  onClick={() => setEditing(shift)}
                                  className={cx(
                                    "w-full rounded border px-1 py-1 font-mono text-[0.6rem] tabular-nums transition-colors",
                                    violations.length > 0
                                      ? "border-warn bg-warn-soft text-warn"
                                      : "border-accent/40 bg-accent-soft text-accent",
                                  )}
                                >
                                  {shift.startTime}–{shift.endTime}
                                  {violations.length > 0 ? (
                                    <AlertTriangle
                                      size={9}
                                      className="ms-0.5 inline"
                                      aria-hidden
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              aria-label={t("wf.addShiftFor")
                                .replace("{name}", tx(employee.name))
                                .replace("{day}", day)}
                              onClick={() => addShift(employee.id, day)}
                              className="border-line text-fg-subtle hover:border-accent hover:text-accent w-full rounded border border-dashed py-1"
                            >
                              <Plus size={10} className="mx-auto" aria-hidden />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* -- Cost and violations ---------------------------------------- */}
        <DescList>
          <DescRow label={t("wf.shiftsPlanned")} mono>
            {formatNumber(shifts.length, fmt)}
          </DescRow>
          <DescRow label={t("wf.totalHours")} mono>
            {formatNumber(totalHours, fmt, 1)}
          </DescRow>
          <DescRow label={t("wf.projectedCost")} mono>
            {formatMoney(money(projected, "EGP"), fmt)}
          </DescRow>
        </DescList>

        {allViolations.length > 0 ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("wf.violations")}>
            <ul className="mt-1 space-y-0.5">
              {allViolations.map(([key, count]) => (
                <li key={key}>
                  • {t(key as never)} ({count})
                </li>
              ))}
            </ul>
            <p className="mt-1.5">{t("wf.violationsNote")}</p>
          </Callout>
        ) : null}

        {editing ? (
          <ShiftEditor
            shift={editing}
            onClose={() => setEditing(null)}
            onChange={(next) => {
              setShifts((current) =>
                current.map((shift) => (shift.key === next.key ? next : shift)),
              );
              setEditing(null);
            }}
            onRemove={() => {
              setShifts((current) => current.filter((shift) => shift.key !== editing.key));
              setEditing(null);
            }}
          />
        ) : null}
      </div>
    </Drawer>
  );
}

function ShiftEditor({
  shift,
  onClose,
  onChange,
  onRemove,
}: {
  shift: DraftShift;
  onClose: () => void;
  onChange: (next: DraftShift) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(shift);

  return (
    <div className="border-line bg-sunken/50 space-y-3 rounded-lg border p-3">
      <p className="text-fg text-xs font-semibold">{t("wf.editShift")}</p>

      <div className="flex flex-wrap gap-1.5">
        {SHIFT_TEMPLATES.map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => setDraft({ ...draft, startTime: template.start, endTime: template.end })}
            className="border-line bg-raised text-fg-muted hover:text-fg rounded-lg border px-2.5 py-1 text-xs"
          >
            {t(`wf.template.${template.key}` as never)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("wf.startTime")}>
          <Input
            type="time"
            dir="ltr"
            value={draft.startTime}
            onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
          />
        </Field>
        <Field label={t("wf.endTime")}>
          <Input
            type="time"
            dir="ltr"
            value={draft.endTime}
            onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => onChange(draft)}>
          {t("common.save")}
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={onRemove}>
          {t("common.delete")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance correction — FR-HRM-025
// ---------------------------------------------------------------------------

export function AttendanceCorrectionDrawer({
  record,
  onClose,
  onSaved,
}: {
  record: AttendanceRecord | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();

  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!record) return;
    setClockIn(record.clockIn ? record.clockIn.slice(11, 16) : "");
    setClockOut(record.clockOut ? record.clockOut.slice(11, 16) : "");
    setBreakMinutes(String(record.breakMinutes));
    setReason("");
  }, [record?.id]);

  if (!record) return null;

  const changed =
    clockIn !== (record.clockIn?.slice(11, 16) ?? "") ||
    clockOut !== (record.clockOut?.slice(11, 16) ?? "") ||
    breakMinutes !== String(record.breakMinutes);

  const valid = changed && reason.trim().length >= 6 && Boolean(clockIn);

  async function submit() {
    if (!record || !valid) return;
    const day = record.date;
    const hours =
      clockIn && clockOut
        ? Math.max(0, hoursBetween(clockIn, clockOut) - Number(breakMinutes || 0) / 60)
        : record.regularHours;

    await action.run(
      () =>
        services.workforce.attendance.update(record.id, {
          clockIn: clockIn ? `${day}T${clockIn}:00.000Z` : null,
          clockOut: clockOut ? `${day}T${clockOut}:00.000Z` : null,
          breakMinutes: Number(breakMinutes || 0),
          regularHours: Math.min(hours, 8),
          overtimeHours: Math.max(0, hours - 8),
          method: "manual",
          corrected: true,
          flags: record.flags.filter((flag) => flag !== "missing_clock_out"),
        }),
      { onSuccess: () => onSaved(t("wf.correctionSaved")) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("wf.correctAttendance")} · ${tx(record.employeeName)}`}
      subtitle="FR-HRM-025"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("wf.recordCorrection")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="warn" title={t("wf.correctionWhyTitle")}>
          {t("wf.correctionWhyBody")}
        </Callout>

        {/*
          The original beside the new value, not replaced by it. Payroll has
          to be able to tell an observed hour from an asserted one.
        */}
        <DescList>
          <DescRow label={t("common.date")}>{formatDate(record.date, fmt)}</DescRow>
          <DescRow label={t("wf.recordedIn")}>
            <span className={cx(changed && "text-fg-subtle line-through")}>
              {record.clockIn ? formatTime(record.clockIn, fmt) : t("wf.noClockIn")}
            </span>
          </DescRow>
          <DescRow label={t("wf.recordedOut")}>
            <span className={cx(changed && "text-fg-subtle line-through")}>
              {record.clockOut ? formatTime(record.clockOut, fmt) : t("wf.noClockOut")}
            </span>
          </DescRow>
          <DescRow label={t("wf.method")}>
            <Badge tone={record.method === "manual" ? "warn" : "muted"}>
              {t(`wf.method.${record.method}` as never)}
            </Badge>
          </DescRow>
        </DescList>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("wf.correctedIn")} required>
            <Input
              type="time"
              dir="ltr"
              value={clockIn}
              onChange={(event) => setClockIn(event.target.value)}
            />
          </Field>
          <Field label={t("wf.correctedOut")}>
            <Input
              type="time"
              dir="ltr"
              value={clockOut}
              onChange={(event) => setClockOut(event.target.value)}
            />
          </Field>
          <Field label={t("wf.breakMinutes")} hint={t("wf.breakMinutesHint")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
              className="text-end font-mono tabular-nums"
            />
          </Field>
        </div>

        <Field
          label={t("wf.correctionReason")}
          hint={t("wf.correctionReasonHint")}
          required
          error={
            reason.length > 0 && reason.trim().length < 6 ? t("wf.reasonTooShort") : undefined
          }
        >
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Overtime decision — FR-HRM-034
// ---------------------------------------------------------------------------

export function OvertimeDecisionDrawer({
  record,
  onClose,
  onDecided,
}: {
  record: OvertimeRecord | null;
  onClose: () => void;
  onDecided: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [comment, setComment] = useState("");

  useEffect(() => setComment(""), [record?.id]);

  if (!record) return null;

  async function decide(approval: "approved" | "rejected") {
    if (!record) return;
    if (approval === "rejected" && !comment.trim()) return;
    await action.run(
      () => services.workforce.overtime.update(record.id, { approval }),
      {
        onSuccess: () =>
          onDecided(approval === "approved" ? t("wf.overtimeApproved") : t("wf.overtimeRejected")),
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("wf.overtimeDecision")} · ${tx(record.employeeName)}`}
      subtitle="FR-HRM-034"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            icon={<Check size={13} />}
            loading={action.pending}
            onClick={() => void decide("approved")}
          >
            {t("common.approve")}
          </Button>
          <Button
            variant="danger"
            icon={<X size={13} />}
            loading={action.pending}
            disabled={!comment.trim()}
            onClick={() => void decide("rejected")}
          >
            {t("common.reject")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted">{t("wf.overtimeNote")}</Callout>

        <DescList>
          <DescRow label={t("wf.weekStarting")}>{formatDate(record.weekStarting, fmt)}</DescRow>
          <DescRow label={t("wf.regularHours")} mono>
            {formatNumber(record.regularHours, fmt, 1)}
          </DescRow>
          <DescRow label={t("wf.overtimeHours")} mono>
            <span className="text-warn font-semibold">
              {formatNumber(record.overtimeHours, fmt, 1)}
            </span>
          </DescRow>
          <DescRow label={t("wf.multiplier")} mono>
            ×{formatNumber(record.multiplier, fmt, 2)}
          </DescRow>
          <DescRow label={t("wf.overtimeCost")} mono>
            {formatMoney(record.cost, fmt)}
          </DescRow>
        </DescList>

        <Field
          label={t("shift.comment")}
          hint={t("wf.rejectionNeedsComment")}
          required={false}
        >
          <Textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Payroll export — FR-HRM-035, FR-HRM-036
// ---------------------------------------------------------------------------

const PAYROLL_COLUMNS = [
  "employeeCode",
  "employeeName",
  "branch",
  "regularHours",
  "overtimeHours",
  "unapprovedOvertimeHours",
  "absenceDays",
  "cost",
] as const;

export function PayrollExportDrawer({
  open,
  onClose,
  onExported,
}: {
  open: boolean;
  onClose: () => void;
  onExported: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const log = useExportLog();
  const branches = useBranches(scope);

  const [range, setRange] = useState<DateRange>(() => resolvePreset("lastMonth"));
  const [branchId, setBranchId] = useState<Id | "">("");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [columns, setColumns] = useState<string[]>([...PAYROLL_COLUMNS]);

  const attendance = useAsync(
    () =>
      open
        ? services.workforce.attendance.list({ limit: 500 }).then((page) => page.rows)
        : Promise.resolve([] as AttendanceRecord[]),
    [open],
  );
  const overtime = useAsync(
    () =>
      open
        ? services.workforce.overtime.list({ limit: 500 }).then((page) => page.rows)
        : Promise.resolve([] as OvertimeRecord[]),
    [open],
  );
  const employees = useAsync(
    () =>
      open
        ? services.workforce.employees.list({ limit: 300 }).then((page) => page.rows)
        : Promise.resolve([] as Employee[]),
    [open],
  );

  /** One row per employee, aggregated over the period. */
  const rows = useMemo(() => {
    const inRange = (attendance.data ?? []).filter(
      (record) =>
        record.date >= range.from &&
        record.date <= range.to &&
        (!branchId || record.branchId === branchId),
    );

    const byEmployee = new Map<Id, { regular: number; overtime: number; cost: number; days: Set<string> }>();
    for (const record of inRange) {
      const entry =
        byEmployee.get(record.employeeId) ??
        { regular: 0, overtime: 0, cost: 0, days: new Set<string>() };
      entry.regular += record.regularHours;
      entry.overtime += record.overtimeHours;
      entry.cost += record.cost.amount;
      entry.days.add(record.date);
      byEmployee.set(record.employeeId, entry);
    }

    const unapproved = new Map<Id, number>();
    for (const record of overtime.data ?? []) {
      if (record.approval === "approved") continue;
      unapproved.set(
        record.employeeId,
        (unapproved.get(record.employeeId) ?? 0) + record.overtimeHours,
      );
    }

    return [...byEmployee.entries()].map(([employeeId, entry]) => {
      const employee = (employees.data ?? []).find((row) => row.id === employeeId);
      return {
        employeeId,
        employeeCode: employee?.code ?? employeeId,
        employeeName: employee ? tx(employee.name) : employeeId,
        branch: employee ? tx(employee.homeBranchName) : "",
        regularHours: entry.regular,
        overtimeHours: entry.overtime,
        unapprovedOvertimeHours: unapproved.get(employeeId) ?? 0,
        absenceDays: 0,
        cost: entry.cost / 100,
      };
    });
  }, [attendance.data, overtime.data, employees.data, range, branchId, tx]);

  function run() {
    const selected = PAYROLL_COLUMNS.filter((column) => columns.includes(column));
    const outcome = exportRows(format, {
      filename: `payroll-${range.from}-to-${range.to}`,
      title: t("wf.payrollExport"),
      subtitle: `${range.from} → ${range.to}`,
      columns: selected.map((column) => ({
        key: column,
        header: t(`wf.col.${column}` as never),
        value: (row: (typeof rows)[number]) => row[column as keyof typeof row] as string | number,
      })),
      rows,
    });

    log.record({
      title: t("wf.payrollExport"),
      format,
      rowCount: outcome.rowCount,
      filters: `${range.from}..${range.to}${branchId ? ` · ${branchId}` : ""}`,
      requestedBy: null,
    });

    onExported(t("wf.payrollExported").replace("{n}", String(outcome.rowCount)));
    onClose();
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.payrollExport")}
      subtitle="FR-HRM-035"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" disabled={rows.length === 0} onClick={run}>
            {t("wf.generate")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted" title={t("wf.payrollScopeTitle")}>
          {t("wf.payrollScopeBody")}
        </Callout>

        <DateRangeField value={range} onChange={setRange} label={t("common.period")} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("wf.format")}>
            <Select
              value={format}
              onChange={(event) => setFormat(event.target.value as "csv" | "xlsx")}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </Select>
          </Field>
        </div>

        <Field label={t("wf.columns")} hint={t("wf.columnsHint")}>
          <div className="flex flex-wrap gap-1.5">
            {PAYROLL_COLUMNS.map((column) => {
              const on = columns.includes(column);
              return (
                <button
                  key={column}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setColumns((current) =>
                      on ? current.filter((entry) => entry !== column) : [...current, column],
                    )
                  }
                  className={cx(
                    "rounded-lg border px-2.5 py-1.5 text-xs",
                    on
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {t(`wf.col.${column}` as never)}
                </button>
              );
            })}
          </div>
        </Field>

        <DescList>
          <DescRow label={t("wf.rowsToExport")} mono>
            {formatNumber(rows.length, fmt)}
          </DescRow>
          <DescRow label={t("wf.totalHours")} mono>
            {formatNumber(
              rows.reduce((sum, row) => sum + row.regularHours + row.overtimeHours, 0),
              fmt,
              1,
            )}
          </DescRow>
        </DescList>

        {rows.length === 0 ? <Callout tone="warn">{t("wf.noPayrollRows")}</Callout> : null}
      </div>
    </Drawer>
  );
}
