/**
 * Workforce rules — SRS ch.14. Pure: no storage, no React, no clock unless
 * one is passed in.
 *
 * The schedule builder, the swap approval, the leave form, the till's clock
 * panel and the attendance screen all ask these questions. Holding the
 * answers in one module is what keeps "may this trainee work a ten-hour
 * Friday?" from having a different answer on each screen.
 *
 * Every rule returns message *keys*, not sentences, so the caller renders
 * them in the active language.
 */

import type { EmploymentType, Id, Localised } from "./types";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Hours between two HH:MM times; a shift ending before it starts crossed midnight. */
export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

/** A local wall-clock instant from an ISO date and an HH:MM time. */
export function localInstant(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

export function localDateIso(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Employment types — FR-HRM-002
// ---------------------------------------------------------------------------

/**
 * FR-HRM-002 — what each employment type changes about scheduling and
 * overtime.
 *
 * These are the platform defaults a tenant starts from; the numbers follow
 * the common labour-law shape in the launch markets (48-hour week, 11-hour
 * rest), and the differences between types are the point: a contractor is
 * invoiced rather than paid overtime, a trainee may not be the only person on
 * a shift, a part-time contract caps the week well below a full-time one.
 */
export interface EmploymentRules {
  maxShiftHours: number;
  maxWeeklyHours: number;
  minRestHours: number;
  maxConsecutiveDays: number;
  /** Paid at the overtime multiplier beyond `overtimeAfterWeeklyHours`. */
  overtimeEligible: boolean;
  overtimeAfterWeeklyHours: number;
  /** A trainee must share the shift with someone who is not a trainee. */
  requiresSupervision: boolean;
  /** Share of the full annual leave entitlement, 0 when not eligible. */
  leaveEntitlementFactor: number;
}

export const EMPLOYMENT_RULES: Record<EmploymentType, EmploymentRules> = {
  full_time: {
    maxShiftHours: 12,
    maxWeeklyHours: 48,
    minRestHours: 11,
    maxConsecutiveDays: 6,
    overtimeEligible: true,
    overtimeAfterWeeklyHours: 48,
    requiresSupervision: false,
    leaveEntitlementFactor: 1,
  },
  part_time: {
    maxShiftHours: 8,
    maxWeeklyHours: 30,
    minRestHours: 11,
    maxConsecutiveDays: 5,
    overtimeEligible: true,
    // Hours above the contract but under the statutory week are paid plain.
    overtimeAfterWeeklyHours: 48,
    requiresSupervision: false,
    leaveEntitlementFactor: 0.5,
  },
  casual: {
    maxShiftHours: 10,
    maxWeeklyHours: 40,
    minRestHours: 11,
    maxConsecutiveDays: 6,
    overtimeEligible: true,
    overtimeAfterWeeklyHours: 48,
    requiresSupervision: false,
    leaveEntitlementFactor: 0,
  },
  contractor: {
    maxShiftHours: 12,
    maxWeeklyHours: 60,
    minRestHours: 11,
    maxConsecutiveDays: 6,
    // Invoiced by the hour; there is no overtime premium to approve.
    overtimeEligible: false,
    overtimeAfterWeeklyHours: 60,
    requiresSupervision: false,
    leaveEntitlementFactor: 0,
  },
  trainee: {
    maxShiftHours: 8,
    maxWeeklyHours: 40,
    minRestHours: 12,
    maxConsecutiveDays: 5,
    overtimeEligible: false,
    overtimeAfterWeeklyHours: 40,
    requiresSupervision: true,
    leaveEntitlementFactor: 1,
  },
};

/** FR-HRM-002 — overtime by employment type. Contractors and trainees accrue none. */
export function overtimeHoursFor(type: EmploymentType, weeklyHours: number): {
  regular: number;
  overtime: number;
  /** Hours worked beyond the threshold by someone not eligible for overtime. */
  ineligibleExcess: number;
} {
  const rules = EMPLOYMENT_RULES[type];
  const excess = Math.max(0, weeklyHours - rules.overtimeAfterWeeklyHours);
  return rules.overtimeEligible
    ? { regular: weeklyHours - excess, overtime: excess, ineligibleExcess: 0 }
    : { regular: weeklyHours, overtime: 0, ineligibleExcess: excess };
}

// ---------------------------------------------------------------------------
// Shift validation — FR-HRM-012, shaped by FR-HRM-002
// ---------------------------------------------------------------------------

export interface DraftShiftLike {
  key?: string;
  id?: Id;
  employeeId: Id;
  date: string;
  startTime: string;
  endTime: string;
}

export interface ShiftRuleContext {
  employeeId: Id;
  date: string;
  startTime: string;
  endTime: string;
  /** Every other shift on the roster, for cross-day checks. */
  siblings: DraftShiftLike[];
  /** FR-HRM-002 — omitted means full-time rules. */
  employmentType?: EmploymentType;
  /** Everyone's type, for the trainee-supervision check. */
  typeOf?: (employeeId: Id) => EmploymentType | undefined;
}

export function validateShift(ctx: ShiftRuleContext): string[] {
  const rules = EMPLOYMENT_RULES[ctx.employmentType ?? "full_time"];
  const problems: string[] = [];
  const length = hoursBetween(ctx.startTime, ctx.endTime);

  if (length > rules.maxShiftHours) problems.push("wf.rule.tooLong");
  if (length <= 0) problems.push("wf.rule.zeroLength");

  const mine = ctx.siblings.filter(
    (shift) => shift.employeeId === ctx.employeeId && shift.date !== ctx.date,
  );

  const weekly =
    mine.reduce((sum, shift) => sum + hoursBetween(shift.startTime, shift.endTime), 0) + length;
  if (weekly > rules.maxWeeklyHours) problems.push("wf.rule.weeklyHours");
  // FR-HRM-002 — an ineligible type working past the threshold is not
  // overtime to approve; it is a roster that should not have been built.
  if (!rules.overtimeEligible && weekly > rules.overtimeAfterWeeklyHours) {
    problems.push("wf.rule.noOvertimeForType");
  }

  const days = new Set(mine.map((shift) => shift.date));
  days.add(ctx.date);
  const sorted = [...days].sort();
  let run = 1;
  let longest = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = dayNumber(sorted[i]!) - dayNumber(sorted[i - 1]!);
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  if (longest > rules.maxConsecutiveDays) problems.push("wf.rule.consecutive");

  for (const shift of mine) {
    const gapDays = Math.abs(dayNumber(ctx.date) - dayNumber(shift.date));
    if (gapDays !== 1) continue;
    const earlier = shift.date < ctx.date ? shift : { startTime: ctx.startTime, endTime: ctx.endTime };
    const later = shift.date < ctx.date ? { startTime: ctx.startTime } : shift;
    const [eh, em] = earlier.endTime.split(":").map(Number);
    const [lh, lm] = later.startTime.split(":").map(Number);
    const rest = 24 - (eh! + em! / 60) + (lh! + lm! / 60);
    if (rest < rules.minRestHours) {
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

  if (rules.requiresSupervision && ctx.typeOf) {
    const supervised = ctx.siblings.some(
      (shift) =>
        shift.employeeId !== ctx.employeeId &&
        shift.date === ctx.date &&
        ctx.typeOf!(shift.employeeId) !== "trainee" &&
        !(shift.endTime <= ctx.startTime || shift.startTime >= ctx.endTime),
    );
    if (!supervised) problems.push("wf.rule.traineeUnsupervised");
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Early clock-in — FR-HRM-023
// ---------------------------------------------------------------------------

/**
 * FR-HRM-023 — may this person clock in now for a shift starting then?
 *
 * The window is the configured number of minutes before the scheduled start.
 * Arriving early is fine; being *paid* from the moment of arrival is what the
 * rule prevents, so the answer before the window opens is a refusal that says
 * when it opens rather than a silent adjustment of the time.
 */
export function earlyClockInCheck(
  now: Date,
  shift: { date: string; startTime: string },
  windowMinutes: number,
): { allowed: boolean; opensAt: Date; minutesEarly: number } {
  const start = localInstant(shift.date, shift.startTime);
  const opensAt = new Date(start.getTime() - Math.max(0, windowMinutes) * 60_000);
  const minutesEarly = Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 60_000));
  return { allowed: now.getTime() >= opensAt.getTime(), opensAt, minutesEarly };
}

/** The shift a clock-in at `now` belongs to: today's next or current one. */
export function shiftForClockIn<T extends { date: string; startTime: string; endTime: string }>(
  now: Date,
  shifts: T[],
): T | null {
  const today = localDateIso(now);
  const candidates = shifts
    .filter((shift) => shift.date === today)
    .filter((shift) => {
      const end = localInstant(shift.date, shift.endTime);
      const start = localInstant(shift.date, shift.startTime);
      const realEnd = end <= start ? new Date(end.getTime() + 86_400_000) : end;
      return realEnd.getTime() > now.getTime();
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Breaks — FR-HRM-026
// ---------------------------------------------------------------------------

export type BreakKind = "rest" | "meal";

export interface BreakPolicy {
  /** Rest-break minutes per shift that are paid; rest beyond this is unpaid. */
  paidRestMinutes: number;
  /** Whether a meal break is paid. */
  mealBreakPaid: boolean;
}

export interface BreakSpan {
  kind: BreakKind;
  startedAt: string;
  endedAt: string | null;
}

/**
 * FR-HRM-026 — split a shift's breaks into paid and unpaid minutes.
 *
 * Rest breaks are paid up to the allowance in the order they were taken, and
 * whatever runs past it is unpaid; meal breaks are wholly one or the other by
 * configuration. An open break is counted up to `now`.
 */
export function classifyBreaks(
  breaks: BreakSpan[],
  policy: BreakPolicy,
  now: Date = new Date(),
): { paidMinutes: number; unpaidMinutes: number; open: BreakSpan | null } {
  let paid = 0;
  let unpaid = 0;
  let restAllowance = Math.max(0, policy.paidRestMinutes);
  const ordered = [...breaks].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const entry of ordered) {
    const end = entry.endedAt ? Date.parse(entry.endedAt) : now.getTime();
    const minutes = Math.max(0, Math.round((end - Date.parse(entry.startedAt)) / 60_000));
    if (entry.kind === "meal") {
      if (policy.mealBreakPaid) paid += minutes;
      else unpaid += minutes;
    } else {
      const covered = Math.min(minutes, restAllowance);
      restAllowance -= covered;
      paid += covered;
      unpaid += minutes - covered;
    }
  }
  return { paidMinutes: paid, unpaidMinutes: unpaid, open: ordered.find((b) => !b.endedAt) ?? null };
}

/** Payable hours: time on the clock less unpaid breaks. */
export function payableHours(
  clockIn: string,
  clockOut: string,
  breaks: BreakSpan[],
  policy: BreakPolicy,
): number {
  const worked = Math.max(0, (Date.parse(clockOut) - Date.parse(clockIn)) / 3_600_000);
  const { unpaidMinutes } = classifyBreaks(breaks, policy, new Date(clockOut));
  return Math.max(0, worked - unpaidMinutes / 60);
}

// ---------------------------------------------------------------------------
// Leave — FR-HRM-017
// ---------------------------------------------------------------------------

export interface LeaveType {
  id: Id;
  name: Localised;
  paid: boolean;
  /** Full-time annual entitlement in days; null means no balance is kept. */
  annualDays: number | null;
  carryOverMaxDays: number;
  eligibleTypes: EmploymentType[];
  /** A note (for sick leave, the certificate reference) is required. */
  requiresNote: boolean;
  active: boolean;
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: Id;
  employeeId: Id;
  employeeName: Localised;
  branchId: Id | null;
  typeId: Id;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  note: string;
  status: LeaveStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

export function leaveDays(startDate: string, endDate: string, halfDay: boolean): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const days = dayNumber(endDate) - dayNumber(startDate) + 1;
  return halfDay && days === 1 ? 0.5 : days;
}

export interface LeaveBalance {
  typeId: Id;
  entitlement: number | null;
  carriedOver: number;
  taken: number;
  pending: number;
  remaining: number | null;
}

function takenIn(requests: LeaveRequest[], typeId: Id, year: number, status: LeaveStatus): number {
  return requests
    .filter((r) => r.typeId === typeId && r.status === status && r.startDate.startsWith(String(year)))
    .reduce((sum, r) => sum + r.days, 0);
}

/**
 * FR-HRM-017 — the balance for one leave type in one calendar year.
 *
 * Entitlement is the full-time figure scaled by the employment type
 * (FR-HRM-002) and pro-rated for a hire date inside the year. Last year's
 * unused days carry over up to the type's cap. Pending requests are shown
 * beside the remaining figure rather than taken from it, because a request
 * nobody has decided has not used anything yet.
 */
export function leaveBalance(
  type: LeaveType,
  employee: { employmentType: EmploymentType; hiredOn: string },
  requests: LeaveRequest[],
  year: number,
): LeaveBalance {
  const taken = takenIn(requests, type.id, year, "approved");
  const pending = takenIn(requests, type.id, year, "pending");
  if (type.annualDays === null) {
    return { typeId: type.id, entitlement: null, carriedOver: 0, taken, pending, remaining: null };
  }

  const factor = type.eligibleTypes.includes(employee.employmentType)
    ? EMPLOYMENT_RULES[employee.employmentType].leaveEntitlementFactor
    : 0;

  const entitlementFor = (y: number) => {
    const hireYear = Number(employee.hiredOn.slice(0, 4));
    if (!employee.hiredOn || hireYear > y) return 0;
    let share = 1;
    if (hireYear === y) {
      const startOfYear = dayNumber(`${y}-01-01`);
      const daysInYear = dayNumber(`${y + 1}-01-01`) - startOfYear;
      share = (daysInYear - (dayNumber(employee.hiredOn) - startOfYear)) / daysInYear;
    }
    // Half-day precision, rounded down so pro-rating never grants a day early.
    return Math.floor(type.annualDays! * factor * share * 2) / 2;
  };

  const previousUnused = Math.max(0, entitlementFor(year - 1) - takenIn(requests, type.id, year - 1, "approved"));
  const carriedOver = Math.min(type.carryOverMaxDays, previousUnused);
  const entitlement = entitlementFor(year);
  return {
    typeId: type.id,
    entitlement,
    carriedOver,
    taken,
    pending,
    remaining: entitlement + carriedOver - taken,
  };
}

/** Problems with a leave request as drafted. Keys ending `.block` refuse the submit. */
export function validateLeaveRequest(
  draft: Pick<LeaveRequest, "employeeId" | "typeId" | "startDate" | "endDate" | "halfDay" | "note" | "id">,
  type: LeaveType | undefined,
  employee: { employmentType: EmploymentType; hiredOn: string } | undefined,
  existing: LeaveRequest[],
): string[] {
  const problems: string[] = [];
  if (!type || !employee) return ["wf.leave.rule.incomplete.block"];
  if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
    problems.push("wf.leave.rule.dates.block");
    return problems;
  }
  if (draft.halfDay && draft.startDate !== draft.endDate) problems.push("wf.leave.rule.halfDay.block");
  if (!type.eligibleTypes.includes(employee.employmentType)) problems.push("wf.leave.rule.ineligible.block");
  if (type.requiresNote && !draft.note.trim()) problems.push("wf.leave.rule.note.block");

  const mine = existing.filter(
    (r) => r.employeeId === draft.employeeId && r.id !== draft.id && (r.status === "pending" || r.status === "approved"),
  );
  if (mine.some((r) => !(r.endDate < draft.startDate || r.startDate > draft.endDate))) {
    problems.push("wf.leave.rule.overlap.block");
  }

  const days = leaveDays(draft.startDate, draft.endDate, draft.halfDay);
  if (type.annualDays !== null) {
    const year = Number(draft.startDate.slice(0, 4));
    const balance = leaveBalance(type, employee, mine, year);
    if (balance.remaining !== null && days > balance.remaining - balance.pending) {
      // Paid leave cannot be overdrawn; unpaid types keep a balance only as a cap.
      problems.push(type.paid ? "wf.leave.rule.balance.block" : "wf.leave.rule.balance");
    }
  }
  return problems;
}

export function isBlocking(key: string): boolean {
  return key.endsWith(".block");
}

// ---------------------------------------------------------------------------
// Shift swaps — FR-HRM-016
// ---------------------------------------------------------------------------

export interface SwapShiftSnapshot {
  shiftId: Id;
  employeeId: Id;
  date: string;
  startTime: string;
  endTime: string;
  branchId: Id;
  position: Localised;
}

/**
 * FR-HRM-016 — what goes wrong if this swap is applied.
 *
 * The roster is re-run *as it would be after the swap*, with each person's
 * own employment-type rules, so the manager approves against the week the
 * swap creates rather than the week that exists. Keys ending `.block` stop
 * approval outright; the rest are the ordinary FR-HRM-012 warnings, which a
 * manager may override with the reason on record.
 */
export function validateSwap(input: {
  give: SwapShiftSnapshot;
  take: SwapShiftSnapshot | null;
  toEmployeeId: Id;
  roster: DraftShiftLike[];
  employees: Map<Id, { employmentType: EmploymentType; permittedBranchIds: Id[]; homeBranchId: Id; position: Localised }>;
  approvedLeave: LeaveRequest[];
  today: string;
}): string[] {
  const problems = new Set<string>();
  const from = input.give.employeeId;
  const to = input.toEmployeeId;
  const recipient = input.employees.get(to);
  const giver = input.employees.get(from);

  if (from === to) problems.add("wf.swap.rule.self.block");
  if (!recipient) return [...problems, "wf.swap.rule.unknown.block"];
  if (input.give.date < input.today) problems.add("wf.swap.rule.past.block");
  if (input.take && input.take.date < input.today) problems.add("wf.swap.rule.past.block");

  const permitted = (e: { permittedBranchIds: Id[]; homeBranchId: Id }, branchId: Id) =>
    e.homeBranchId === branchId || e.permittedBranchIds.includes(branchId);
  // FR-HRM-005 — a person can only cover a branch they are assigned to.
  if (!permitted(recipient, input.give.branchId)) problems.add("wf.swap.rule.branch.block");
  if (input.take && giver && !permitted(giver, input.take.branchId)) problems.add("wf.swap.rule.branch.block");
  if (recipient.position.en && input.give.position.en && recipient.position.en !== input.give.position.en) {
    problems.add("wf.swap.rule.position");
  }

  const onLeave = (employeeId: Id, date: string) =>
    input.approvedLeave.some(
      (r) => r.employeeId === employeeId && r.status === "approved" && r.startDate <= date && r.endDate >= date,
    );
  if (onLeave(to, input.give.date)) problems.add("wf.swap.rule.leave.block");
  if (input.take && onLeave(from, input.take.date)) problems.add("wf.swap.rule.leave.block");

  // Re-run the roster as it would stand after the swap.
  const moved = input.roster.map((shift) => {
    const id = shift.id ?? shift.key;
    if (id === input.give.shiftId) return { ...shift, employeeId: to };
    if (input.take && id === input.take.shiftId) return { ...shift, employeeId: from };
    return shift;
  });
  const typeOf = (id: Id) => input.employees.get(id)?.employmentType;
  const check = (shiftId: Id, employeeId: Id) => {
    const shift = moved.find((s) => (s.id ?? s.key) === shiftId);
    if (!shift) return;
    const weekStart = dayNumber(shift.date) - ((new Date(`${shift.date}T00:00:00Z`).getUTCDay() + 6) % 7);
    const siblings = moved.filter(
      (s) => (s.id ?? s.key) !== shiftId && dayNumber(s.date) >= weekStart && dayNumber(s.date) < weekStart + 7,
    );
    for (const key of validateShift({
      employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      siblings,
      employmentType: typeOf(employeeId),
      typeOf,
    })) {
      problems.add(key === "wf.rule.overlap" ? "wf.swap.rule.overlap.block" : key);
    }
  };
  check(input.give.shiftId, to);
  if (input.take) check(input.take.shiftId, from);

  return [...problems];
}
