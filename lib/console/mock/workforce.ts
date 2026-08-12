/**
 * Workforce fixtures — employees, schedules, attendance, overtime and
 * performance. SRS ch.14.
 *
 * The Employee/User split from §14.1 is preserved: most employees have no
 * login at all, and the accountant and auditor are users who are not
 * employees of any branch.
 */

import type {
  AttendanceFlag,
  AttendanceRecord,
  Employee,
  EmployeeDocument,
  EmployeePerformance,
  EmploymentType,
  Localised,
  Money,
  OvertimeRecord,
  ScheduledShift,
} from "../types";
import { ACTIVE_TENANT_ID, branches } from "./org";
import { chance, createRng, float, gaussian, int, pick, seqId } from "./rng";
import { daysUntil, dateAgo, dateAhead, todayAt } from "./clock";

const rng = createRng(0x77b3);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

const FIRST_NAMES: Localised[] = [
  { en: "Mahmoud", ar: "محمود" }, { en: "Amal", ar: "أمل" }, { en: "Youssef", ar: "يوسف" },
  { en: "Sameh", ar: "سامح" }, { en: "Nadia", ar: "نادية" }, { en: "Karim", ar: "كريم" },
  { en: "Hoda", ar: "هدى" }, { en: "Tarek", ar: "طارق" }, { en: "Mona", ar: "منى" },
  { en: "Ahmed", ar: "أحمد" }, { en: "Salma", ar: "سلمى" }, { en: "Omar", ar: "عمر" },
  { en: "Rania", ar: "رانيا" }, { en: "Bassem", ar: "باسم" }, { en: "Dina", ar: "دينا" },
  { en: "Hassan", ar: "حسن" }, { en: "Mariam", ar: "مريم" }, { en: "Khaled", ar: "خالد" },
  { en: "Nourhan", ar: "نورهان" }, { en: "Ayman", ar: "أيمن" },
];

const LAST_NAMES: Localised[] = [
  { en: "Fathy", ar: "فتحي" }, { en: "Saeed", ar: "سعيد" }, { en: "Rashad", ar: "رشاد" },
  { en: "Naguib", ar: "نجيب" }, { en: "Halim", ar: "حليم" }, { en: "Adel", ar: "عادل" },
  { en: "Mansour", ar: "منصور" }, { en: "Selim", ar: "سليم" }, { en: "Ezzat", ar: "عزت" },
  { en: "Gamal", ar: "جمال" }, { en: "Shaker", ar: "شاكر" }, { en: "Fouad", ar: "فؤاد" },
  { en: "Lotfy", ar: "لطفي" }, { en: "Sobhy", ar: "صبحي" }, { en: "Amer", ar: "عامر" },
  { en: "Wahba", ar: "وهبة" }, { en: "Nour", ar: "نور" }, { en: "Ibrahim", ar: "إبراهيم" },
];

interface PositionSeed {
  en: string;
  ar: string;
  deptEn: string;
  deptAr: string;
  /** Hourly rate in minor units. */
  rate: number;
  weight: number;
}

const POSITIONS: PositionSeed[] = [
  { en: "Cashier", ar: "كاشير", deptEn: "Front of house", deptAr: "الصالة", rate: 3_200, weight: 6 },
  { en: "Waiter", ar: "نادل", deptEn: "Front of house", deptAr: "الصالة", rate: 2_900, weight: 7 },
  { en: "Shift Supervisor", ar: "مشرف وردية", deptEn: "Front of house", deptAr: "الصالة", rate: 5_400, weight: 3 },
  { en: "Branch Manager", ar: "مدير فرع", deptEn: "Management", deptAr: "الإدارة", rate: 9_600, weight: 2 },
  { en: "Line Cook", ar: "طاهٍ", deptEn: "Kitchen", deptAr: "المطبخ", rate: 3_600, weight: 7 },
  { en: "Head Chef", ar: "رئيس طهاة", deptEn: "Kitchen", deptAr: "المطبخ", rate: 8_200, weight: 2 },
  { en: "Shawarma Operator", ar: "مشغّل شاورما", deptEn: "Kitchen", deptAr: "المطبخ", rate: 3_900, weight: 3 },
  { en: "Barista", ar: "باريستا", deptEn: "Kitchen", deptAr: "المطبخ", rate: 3_400, weight: 3 },
  { en: "Storekeeper", ar: "أمين مخزن", deptEn: "Supply", deptAr: "الإمداد", rate: 3_800, weight: 2 },
  { en: "Kitchen Porter", ar: "عامل مطبخ", deptEn: "Kitchen", deptAr: "المطبخ", rate: 2_400, weight: 3 },
  { en: "Delivery Coordinator", ar: "منسق توصيل", deptEn: "Delivery", deptAr: "التوصيل", rate: 3_100, weight: 2 },
];

const POSITION_POOL = POSITIONS.flatMap((p) => Array.from({ length: p.weight }, () => p));

const DOCUMENT_TYPES: Localised[] = [
  { en: "Food handling certificate", ar: "شهادة تداول الأغذية" },
  { en: "Health certificate", ar: "الشهادة الصحية" },
  { en: "National ID", ar: "بطاقة الرقم القومي" },
  { en: "Work permit", ar: "تصريح العمل" },
];

const EMPLOYMENT_TYPES: EmploymentType[] = [
  "full_time", "full_time", "full_time", "part_time", "part_time", "casual", "trainee", "contractor",
];

export const employees: Employee[] = (() => {
  const out: Employee[] = [];
  for (let i = 1; i <= 46; i += 1) {
    const first = FIRST_NAMES[(i * 3) % FIRST_NAMES.length]!;
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]!;
    const position = POSITION_POOL[(i * 5) % POSITION_POOL.length]!;
    const branch = branches[i % branches.length]!;
    const status: Employee["status"] =
      i % 19 === 0 ? "terminated" : i % 13 === 0 ? "on_leave" : "active";

    const documents: EmployeeDocument[] = DOCUMENT_TYPES.slice(0, int(rng, 2, 4)).map((type, di) => {
      // A handful expire soon, so the compliance alert has something to say.
      const offset = i % 11 === 0 && di === 0 ? int(rng, -6, 20) : int(rng, 40, 900);
      const expiresOn = dateAhead(offset);
      const days = daysUntil(expiresOn);
      return {
        id: `doc_${i}_${di}`,
        type,
        reference: `${type.en.slice(0, 2).toUpperCase()}-${String(30_000 + i * 17 + di)}`,
        expiresOn,
        daysToExpiry: days,
        status: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid",
      };
    });

    out.push({
      id: seqId("emp", i),
      tenantId: ACTIVE_TENANT_ID,
      code: `E${String(1000 + i)}`,
      name: { en: `${first.en} ${last.en}`, ar: `${first.ar} ${last.ar}` },
      position: { en: position.en, ar: position.ar },
      department: { en: position.deptEn, ar: position.deptAr },
      homeBranchId: branch.id,
      homeBranchName: branch.name,
      permittedBranchIds: chance(rng, 0.3)
        ? [branch.id, branches[(i + 1) % branches.length]!.id]
        : [branch.id],
      employmentType: EMPLOYMENT_TYPES[i % EMPLOYMENT_TYPES.length]!,
      status,
      hiredOn: dateAgo(int(rng, 30, 1500)),
      phone: `+2011${String(20_000_000 + i * 431_117).slice(0, 8)}`,
      email: `${first.en.toLowerCase()}.${last.en.toLowerCase()}@levant.example`,
      hourlyRate: EGP(position.rate * (1 + gaussian(rng, 0, 0.08))),
      // §14.1 — most employees have no login credential at all.
      userId: i <= 9 ? seqId("usr", i) : null,
      documents,
    });
  }
  return out;
})();

export const employeeById = new Map(employees.map((e) => [e.id, e]));
export const activeEmployees = employees.filter((e) => e.status === "active");

export const expiringDocuments = employees
  .flatMap((e) => e.documents.map((d) => ({ employee: e, document: d })))
  .filter((x) => x.document.status !== "valid")
  .sort((a, b) => a.document.daysToExpiry - b.document.daysToExpiry);

// ---------------------------------------------------------------------------
// Schedules — SRS §14.3
// ---------------------------------------------------------------------------

const SHIFT_PATTERNS = [
  { start: "08:00", end: "16:00", hours: 8 },
  { start: "10:00", end: "18:00", hours: 8 },
  { start: "12:00", end: "20:00", hours: 8 },
  { start: "16:00", end: "24:00", hours: 8 },
  { start: "14:00", end: "23:00", hours: 9 },
  { start: "09:00", end: "14:00", hours: 5 },
];

const RULE_VIOLATIONS = [
  "Less than 11 hours rest since the previous shift",
  "Seventh consecutive working day",
  "Exceeds 48 scheduled hours this week",
  "Food handling certificate expires before this shift",
];

export const scheduledShifts: ScheduledShift[] = (() => {
  const out: ScheduledShift[] = [];
  let n = 0;
  // A fortnight either side of the anchor.
  for (let dayOffset = -6; dayOffset <= 7; dayOffset += 1) {
    const date = dayOffset <= 0 ? dateAgo(-dayOffset) : dateAhead(dayOffset);
    for (const employee of activeEmployees) {
      // Roughly a five-day week.
      if (!chance(rng, 0.68)) continue;
      n += 1;
      const pattern = pick(rng, SHIFT_PATTERNS);
      const violations = chance(rng, 0.07) ? [pick(rng, RULE_VIOLATIONS)] : [];
      out.push({
        id: seqId("shf", n),
        employeeId: employee.id,
        employeeName: employee.name,
        position: employee.position,
        branchId: employee.homeBranchId,
        date,
        startTime: pattern.start,
        endTime: pattern.end,
        hours: pattern.hours,
        status:
          dayOffset < 0 ? "completed" : dayOffset === 0 ? "acknowledged" : chance(rng, 0.7) ? "published" : "draft",
        projectedCost: EGP(pattern.hours * employee.hourlyRate.amount),
        violations,
      });
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Attendance — SRS §14.4
// ---------------------------------------------------------------------------

const ATTENDANCE_METHODS: AttendanceRecord["method"][] = [
  "pin", "pin", "pin", "mobile", "mobile", "biometric", "manual",
];

export const attendanceRecords: AttendanceRecord[] = (() => {
  const out: AttendanceRecord[] = [];
  let n = 0;

  for (const shift of scheduledShifts) {
    if (shift.status !== "completed" && shift.status !== "acknowledged") continue;
    n += 1;
    const employee = employeeById.get(shift.employeeId)!;
    const branch = branches.find((b) => b.id === shift.branchId)!;

    const startHour = Number(shift.startTime.slice(0, 2));
    const lateMinutes = chance(rng, 0.18) ? int(rng, 6, 42) : int(rng, -8, 4);
    const missingOut = chance(rng, 0.05);
    const earlyOut = chance(rng, 0.09) ? int(rng, 8, 50) : 0;

    const flags: AttendanceFlag[] = [];
    if (lateMinutes > 5) flags.push("late_arrival");
    if (earlyOut > 0) flags.push("early_departure");
    if (missingOut) flags.push("missing_clock_out", "auto_closed");
    if (chance(rng, 0.03)) flags.push("outside_geofence");
    if (chance(rng, 0.02)) flags.push("no_scheduled_shift");

    const worked = shift.hours - earlyOut / 60 + Math.max(0, -lateMinutes) / 60;
    const overtime = chance(rng, 0.16) ? float(rng, 0.5, 3.2, 1) : 0;
    const regular = Math.max(0, Math.round((worked - overtime) * 10) / 10);

    out.push({
      id: seqId("att", n),
      employeeId: employee.id,
      employeeName: employee.name,
      branchId: branch.id,
      branchName: branch.name,
      date: shift.date,
      scheduledStart: shift.startTime,
      scheduledEnd: shift.endTime,
      clockIn: todayAt(startHour, Math.max(0, lateMinutes)),
      clockOut: missingOut ? null : todayAt(Number(shift.endTime.slice(0, 2)) % 24, 60 - earlyOut),
      method: pick(rng, ATTENDANCE_METHODS),
      regularHours: regular,
      overtimeHours: overtime,
      breakMinutes: pick(rng, [0, 15, 30, 30, 45]),
      flags,
      corrected: chance(rng, 0.08),
      cost: EGP(
        regular * employee.hourlyRate.amount + overtime * employee.hourlyRate.amount * 1.35,
      ),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
})();

// ---------------------------------------------------------------------------
// Overtime — SRS FR-HRM-033/034
// ---------------------------------------------------------------------------

export const overtimeRecords: OvertimeRecord[] = (() => {
  const byEmployee = new Map<string, number>();
  for (const record of attendanceRecords) {
    if (record.overtimeHours <= 0) continue;
    byEmployee.set(
      record.employeeId,
      (byEmployee.get(record.employeeId) ?? 0) + record.overtimeHours,
    );
  }

  return [...byEmployee.entries()]
    .map(([employeeId, hours], i) => {
      const employee = employeeById.get(employeeId)!;
      const branch = branches.find((b) => b.id === employee.homeBranchId)!;
      const rounded = Math.round(hours * 10) / 10;
      // EG country pack: 1.35× — SRS §22.2.
      const multiplier = 1.35;
      return {
        id: seqId("ovt", i + 1),
        employeeId,
        employeeName: employee.name,
        branchName: branch.name,
        weekStarting: dateAgo(((i % 3) + 1) * 7),
        regularHours: 48,
        overtimeHours: rounded,
        multiplier,
        cost: EGP(rounded * employee.hourlyRate.amount * multiplier),
        approval:
          rounded > 6
            ? pick(rng, ["pending", "pending", "approved", "rejected"] as const)
            : "approved",
        approvedBy: chance(rng, 0.6) ? { en: "Amal Saeed", ar: "أمل سعيد" } : null,
      } satisfies OvertimeRecord;
    })
    .sort((a, b) => b.overtimeHours - a.overtimeHours);
})();

export const unapprovedOvertime = overtimeRecords.filter((o) => o.approval === "pending");

// ---------------------------------------------------------------------------
// Performance — SRS FR-HRM-030
// ---------------------------------------------------------------------------

const CUSTOMER_FACING = new Set(["Cashier", "Waiter", "Shift Supervisor", "Barista"]);

export const employeePerformance: EmployeePerformance[] = activeEmployees
  .filter((e) => CUSTOMER_FACING.has(e.position.en))
  .map((employee) => {
    const branch = branches.find((b) => b.id === employee.homeBranchId)!;
    const orderCount = int(rng, 180, 940);
    const aov = int(rng, 9_000, 26_000);
    const netSales = orderCount * aov;
    const hours = float(rng, 90, 190, 1);
    const voidCount = int(rng, 0, 34);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      position: employee.position,
      branchName: branch.name,
      netSales: EGP(netSales),
      orderCount,
      averageOrderValue: EGP(aov),
      itemsPerOrder: float(rng, 1.8, 4.6, 1),
      upsellRate: float(rng, 4, 38, 1),
      averageServiceSeconds: int(rng, 95, 420),
      voidCount,
      voidValue: EGP(voidCount * int(rng, 3_000, 14_000)),
      discountValue: EGP(int(rng, 0, 190_000)),
      cashVariance: EGP(int(rng, -9_000, 4_000)),
      hoursWorked: hours,
      salesPerLabourHour: EGP(netSales / hours),
    } satisfies EmployeePerformance;
  })
  .sort((a, b) => b.netSales.amount - a.netSales.amount);

/** Names available to other fixtures that need a plausible operator. */
export const staffNames = employees.map((e) => e.name);
