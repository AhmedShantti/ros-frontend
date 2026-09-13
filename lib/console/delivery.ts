/**
 * Reports that arrive — SRS §19.5, FR-RPT-040, FR-RPT-041, FR-RPT-045, FR-RPT-046.
 *
 * Three things a manager configures once and then stops thinking about:
 * alert rules, scheduled report deliveries and the morning brief. This file
 * is the pure half — the trigger catalogue, the delivery policy that decides
 * whether a given alert actually reaches a person, and the schedule maths.
 * Persistence is `services.delivery`; the screen is `/reports/delivery`.
 *
 * ## Why the policy is code, not a checkbox (FR-RPT-046)
 *
 * The SRS is blunt that alert fatigue is how alerting fails: forty pings a
 * day and the manager mutes the app, and the one alert that mattered goes
 * unseen. So "rate limit" is not a number stored and forgotten — it is a
 * function here that the rule editor runs against a burst, so whoever sets
 * "3 per hour" sees exactly which of the next forty would be delivered,
 * merged, held or folded into a digest before they save it.
 */

import type { AlertKind, Id, IsoDateTime, Localised, RoleKey, Severity } from "./types";
import type { ExportFormat } from "./export";

// ---------------------------------------------------------------------------
// Alert triggers — FR-RPT-045
// ---------------------------------------------------------------------------

export type AlertTrigger =
  | "cash_variance"
  | "discount_threshold"
  | "void_after_payment"
  | "stock_zero"
  | "expiry"
  | "order_delayed"
  | "sales_below_forecast"
  | "terminal_offline"
  | "sync_backlog"
  | "fiscal_submission_failed";

export type ThresholdKind = "money" | "percent" | "minutes" | "count" | "hour" | "none";

export interface TriggerDefinition {
  trigger: AlertTrigger;
  label: Localised;
  /** The SRS "default trigger" column, in words. */
  when: Localised;
  thresholdKind: ThresholdKind;
  thresholdLabel: Localised | null;
  defaultThreshold: number | null;
  defaultSeverity: Severity;
  spec: string;
}

export const ALERT_TRIGGERS: TriggerDefinition[] = [
  {
    trigger: "cash_variance",
    label: { en: "Cash variance exceeds tolerance", ar: "فرق نقدي يتجاوز الحد" },
    when: { en: "On shift close", ar: "عند إغلاق الوردية" },
    thresholdKind: "money",
    thresholdLabel: { en: "Alert when the variance is above", ar: "التنبيه عندما يتجاوز الفرق" },
    defaultThreshold: 2_000,
    defaultSeverity: "high",
    spec: "FR-RPT-045",
  },
  {
    trigger: "discount_threshold",
    label: { en: "Discount exceeds threshold", ar: "خصم يتجاوز الحد" },
    when: { en: "On application", ar: "عند التطبيق" },
    thresholdKind: "percent",
    thresholdLabel: { en: "Alert when a discount is above", ar: "التنبيه عندما يتجاوز الخصم" },
    defaultThreshold: 20,
    defaultSeverity: "low",
    spec: "FR-RPT-045",
  },
  {
    trigger: "void_after_payment",
    label: { en: "Void after payment", ar: "إلغاء بعد الدفع" },
    when: { en: "Immediately", ar: "فورًا" },
    thresholdKind: "none",
    thresholdLabel: null,
    defaultThreshold: null,
    defaultSeverity: "high",
    spec: "FR-RPT-045",
  },
  {
    trigger: "stock_zero",
    label: { en: "Stock reaches zero", ar: "نفاد المخزون" },
    when: { en: "On depletion", ar: "عند النفاد" },
    thresholdKind: "none",
    thresholdLabel: null,
    defaultThreshold: null,
    defaultSeverity: "high",
    spec: "FR-RPT-045",
  },
  {
    trigger: "expiry",
    label: { en: "Item approaching expiry", ar: "صنف يقترب من انتهاء الصلاحية" },
    when: { en: "Daily at the configured hour", ar: "يوميًا في الساعة المحددة" },
    thresholdKind: "hour",
    thresholdLabel: { en: "Send the daily expiry alert at", ar: "إرسال تنبيه الصلاحية اليومي عند" },
    defaultThreshold: 7,
    defaultSeverity: "medium",
    spec: "FR-RPT-045",
  },
  {
    trigger: "order_delayed",
    label: { en: "Order delayed beyond target", ar: "تأخر الطلب عن المستهدف" },
    when: { en: "On threshold breach", ar: "عند تجاوز الحد" },
    thresholdKind: "minutes",
    thresholdLabel: { en: "Alert when a ticket is late by more than", ar: "التنبيه عندما تتأخر التذكرة أكثر من" },
    defaultThreshold: 5,
    defaultSeverity: "medium",
    spec: "FR-RPT-045",
  },
  {
    trigger: "sales_below_forecast",
    label: { en: "Sales significantly below forecast", ar: "المبيعات أقل بكثير من التوقع" },
    when: { en: "Hourly comparison", ar: "مقارنة كل ساعة" },
    thresholdKind: "percent",
    thresholdLabel: { en: "Alert when an hour is below forecast by", ar: "التنبيه عندما تقل الساعة عن التوقع بنسبة" },
    defaultThreshold: 25,
    defaultSeverity: "medium",
    spec: "FR-RPT-045",
  },
  {
    trigger: "terminal_offline",
    label: { en: "Terminal offline beyond threshold", ar: "جهاز غير متصل لفترة تتجاوز الحد" },
    when: { en: "After 15 minutes", ar: "بعد ١٥ دقيقة" },
    thresholdKind: "minutes",
    thresholdLabel: { en: "Alert after a terminal is silent for", ar: "التنبيه بعد صمت الجهاز لمدة" },
    defaultThreshold: 15,
    defaultSeverity: "medium",
    spec: "FR-RPT-045",
  },
  {
    trigger: "sync_backlog",
    label: { en: "Sync backlog exceeds threshold", ar: "تراكم المزامنة يتجاوز الحد" },
    when: { en: "On breach", ar: "عند التجاوز" },
    thresholdKind: "count",
    thresholdLabel: { en: "Alert when queued operations exceed", ar: "التنبيه عندما تتجاوز العمليات المعلّقة" },
    defaultThreshold: 500,
    defaultSeverity: "medium",
    spec: "FR-RPT-045",
  },
  {
    trigger: "fiscal_submission_failed",
    label: { en: "Failed fiscal submission", ar: "فشل الإرسال الضريبي" },
    when: { en: "On final retry failure", ar: "عند فشل المحاولة الأخيرة" },
    thresholdKind: "none",
    thresholdLabel: null,
    defaultThreshold: null,
    defaultSeverity: "critical",
    spec: "FR-RPT-045",
  },
];

export const TRIGGER_BY_ID = new Map(ALERT_TRIGGERS.map((row) => [row.trigger, row]));

/** Operational alert kinds that map onto a configurable trigger. */
export function triggerOf(kind: AlertKind): AlertTrigger | null {
  return TRIGGER_BY_ID.has(kind as AlertTrigger) ? (kind as AlertTrigger) : null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type DeliveryChannel = "in_app" | "push" | "email" | "sms";

export const DELIVERY_CHANNELS: { id: DeliveryChannel; label: Localised }[] = [
  { id: "in_app", label: { en: "In the console", ar: "داخل لوحة التحكم" } },
  { id: "push", label: { en: "Mobile push", ar: "إشعار الجوال" } },
  { id: "email", label: { en: "Email", ar: "البريد الإلكتروني" } },
  { id: "sms", label: { en: "SMS", ar: "رسالة نصية" } },
];

export interface AlertRule {
  id: Id;
  trigger: AlertTrigger;
  enabled: boolean;
  severity: Severity;
  threshold: number | null;
  channels: DeliveryChannel[];
  recipientRoles: RoleKey[];
  recipientEmails: string[];
  /** Empty means every branch in the tenant. */
  branchIds: Id[];
  /** FR-RPT-046 — at most `max` per recipient per `periodMinutes`, for this type. */
  rateLimit: { max: number; periodMinutes: number };
  /** The same alert (same trigger, same branch) inside this window is merged. */
  dedupeMinutes: number;
  /** Past the limit, fold the rest into one digest rather than dropping them. */
  digestOverflow: boolean;
  /** Non-critical alerts inside these hours wait for the morning. */
  quietHours: { from: string; to: string } | null;
  updatedAt: IsoDateTime;
  updatedBy: string | null;
}

export function defaultRule(trigger: TriggerDefinition, id: Id, now: IsoDateTime): AlertRule {
  const critical = trigger.defaultSeverity === "critical" || trigger.defaultSeverity === "high";
  return {
    id,
    trigger: trigger.trigger,
    enabled: true,
    severity: trigger.defaultSeverity,
    threshold: trigger.defaultThreshold,
    channels: critical ? ["in_app", "push"] : ["in_app"],
    recipientRoles: trigger.trigger === "fiscal_submission_failed" ? ["owner", "accountant"] : ["branch_manager"],
    recipientEmails: [],
    branchIds: [],
    rateLimit: { max: critical ? 6 : 3, periodMinutes: 60 },
    dedupeMinutes: 30,
    digestOverflow: true,
    quietHours: critical ? null : { from: "23:00", to: "07:00" },
    updatedAt: now,
    updatedBy: null,
  };
}

// ---------------------------------------------------------------------------
// The delivery policy — FR-RPT-046
// ---------------------------------------------------------------------------

export interface AlertEvent {
  id: Id;
  trigger: AlertTrigger;
  severity: Severity;
  branchId: Id | null;
  raisedAt: IsoDateTime;
  title: Localised;
}

export type DeliveryOutcome =
  | "delivered"
  | "deduplicated"
  | "digested"
  | "rate_limited"
  | "quiet_hours"
  | "out_of_scope"
  | "disabled"
  | "no_rule";

export interface DeliveryDecision {
  event: AlertEvent;
  outcome: DeliveryOutcome;
  /** For a merged alert, the one it was merged into. */
  mergedInto: Id | null;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function parseClock(value: string): number {
  const [h, m] = value.split(":").map((part) => Number(part));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when `at` falls inside quiet hours, including windows that cross midnight. */
export function inQuietHours(at: Date, quiet: AlertRule["quietHours"]): boolean {
  if (!quiet) return false;
  const now = minutesOfDay(at);
  const from = parseClock(quiet.from);
  const to = parseClock(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Decide, for one recipient, what happens to each alert in a stream.
 *
 * Order matters and is deliberate:
 *
 *   1. No rule, or a disabled one → nothing is sent.
 *   2. Outside the rule's branches → not this recipient's concern.
 *   3. A repeat of something delivered inside the dedupe window → merged into
 *      it. "Terminal 3 offline" four times is one problem.
 *   4. Quiet hours → held until morning, unless the alert is critical. A
 *      failed fiscal submission at 2am still wakes someone; a slow ticket
 *      does not.
 *   5. Over the per-period limit → folded into a digest (or dropped, if the
 *      rule says so). The count is per recipient, per type, per period, which
 *      is exactly the unit FR-RPT-046 names.
 */
export function decideDeliveries(events: AlertEvent[], rules: AlertRule[]): DeliveryDecision[] {
  const byTrigger = new Map(rules.map((rule) => [rule.trigger, rule]));
  const delivered = new Map<AlertTrigger, { at: number; id: Id; branchId: Id | null }[]>();
  const ordered = [...events].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));

  return ordered.map((event) => {
    const rule = byTrigger.get(event.trigger);
    if (!rule) return { event, outcome: "no_rule", mergedInto: null };
    if (!rule.enabled) return { event, outcome: "disabled", mergedInto: null };
    if (rule.branchIds.length > 0 && event.branchId && !rule.branchIds.includes(event.branchId)) {
      return { event, outcome: "out_of_scope", mergedInto: null };
    }

    const at = Date.parse(event.raisedAt);
    const history = delivered.get(event.trigger) ?? [];

    const repeat = [...history]
      .reverse()
      .find(
        (row) => row.branchId === event.branchId && at - row.at <= rule.dedupeMinutes * 60_000,
      );
    if (repeat) return { event, outcome: "deduplicated", mergedInto: repeat.id };

    if (event.severity !== "critical" && inQuietHours(new Date(at), rule.quietHours)) {
      return { event, outcome: "quiet_hours", mergedInto: null };
    }

    const windowStart = at - rule.rateLimit.periodMinutes * 60_000;
    const recent = history.filter((row) => row.at > windowStart).length;
    if (recent >= rule.rateLimit.max) {
      return { event, outcome: rule.digestOverflow ? "digested" : "rate_limited", mergedInto: null };
    }

    history.push({ at, id: event.id, branchId: event.branchId });
    delivered.set(event.trigger, history);
    return { event, outcome: "delivered", mergedInto: null };
  });
}

/**
 * A burst of one alert type, for testing a rule before saving it.
 *
 * `branches` round-robins the events across sites so the dedupe window and
 * the rate limit can be seen doing different jobs: dedupe merges repeats of
 * the *same* problem, the limit caps *different* problems of the same type.
 */
export function syntheticBurst(
  trigger: AlertTrigger,
  count: number,
  spanMinutes: number,
  branches: (Id | null)[],
  start = new Date(),
): AlertEvent[] {
  const definition = TRIGGER_BY_ID.get(trigger)!;
  const step = count > 1 ? (spanMinutes * 60_000) / (count - 1) : 0;
  const pool = branches.length > 0 ? branches : [null];
  return Array.from({ length: count }, (_, index) => ({
    id: `burst-${index + 1}`,
    trigger,
    severity: definition.defaultSeverity,
    branchId: pool[index % pool.length] ?? null,
    raisedAt: new Date(start.getTime() + index * step).toISOString(),
    title: definition.label,
  }));
}

// ---------------------------------------------------------------------------
// Scheduled report delivery — FR-RPT-040
// ---------------------------------------------------------------------------

export type ScheduleFrequency = "daily" | "weekly" | "monthly";
export type SchedulePeriod = "previous_day" | "previous_week" | "previous_month" | "month_to_date";

export interface ReportSchedule {
  id: Id;
  reportId: string;
  name: string;
  frequency: ScheduleFrequency;
  /** "HH:MM" in the tenant's time. */
  time: string;
  /** 0 = Sunday. Weekly only. */
  weekday: number;
  /** 1–28, so every month has one. Monthly only. */
  monthDay: number;
  period: SchedulePeriod;
  format: ExportFormat;
  channels: ("email" | "push")[];
  recipientEmails: string[];
  recipientRoles: RoleKey[];
  /** Empty means the whole tenant. */
  branchIds: Id[];
  active: boolean;
  createdAt: IsoDateTime;
  createdBy: string | null;
  lastSentAt: IsoDateTime | null;
}

/** The next moment a schedule fires, strictly after `from`. */
export function nextRun(schedule: ReportSchedule, from = new Date()): Date {
  const [hours, minutes] = schedule.time.split(":").map((part) => Number(part));
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setHours(hours ?? 0, minutes ?? 0);

  if (schedule.frequency === "daily") {
    if (candidate <= from) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  if (schedule.frequency === "weekly") {
    const ahead = (schedule.weekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + ahead);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  candidate.setDate(schedule.monthDay);
  if (candidate <= from) {
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(schedule.monthDay);
  }
  return candidate;
}

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The date range a delivery covers, as seen from the moment it runs. */
export function periodRange(period: SchedulePeriod, runAt = new Date()): { from: string; to: string } {
  const day = new Date(runAt.getFullYear(), runAt.getMonth(), runAt.getDate());
  const shift = (days: number) => {
    const next = new Date(day);
    next.setDate(next.getDate() + days);
    return next;
  };

  switch (period) {
    case "previous_day":
      return { from: isoDay(shift(-1)), to: isoDay(shift(-1)) };
    case "previous_week": {
      const end = shift(-((day.getDay() + 7) % 7) - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { from: isoDay(start), to: isoDay(end) };
    }
    case "previous_month": {
      const start = new Date(day.getFullYear(), day.getMonth() - 1, 1);
      const end = new Date(day.getFullYear(), day.getMonth(), 0);
      return { from: isoDay(start), to: isoDay(end) };
    }
    default: {
      const start = new Date(day.getFullYear(), day.getMonth(), 1);
      return { from: isoDay(start), to: isoDay(day) };
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a free-text recipient box into addresses, and report the bad ones. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const valid = [...new Set(parts.filter((part) => EMAIL_RE.test(part)).map((part) => part.toLowerCase()))];
  const invalid = parts.filter((part) => !EMAIL_RE.test(part));
  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Morning brief — FR-RPT-041
// ---------------------------------------------------------------------------

export type BriefSection =
  | "sales"
  | "transactions"
  | "average_order"
  | "food_cost"
  | "waste"
  | "best_branch"
  | "worst_branch"
  | "alerts"
  | "live";

export const BRIEF_SECTIONS: { id: BriefSection; label: Localised }[] = [
  { id: "sales", label: { en: "Net sales against the prior day", ar: "صافي المبيعات مقارنة باليوم السابق" } },
  { id: "transactions", label: { en: "Transactions", ar: "عدد المعاملات" } },
  { id: "average_order", label: { en: "Average order value", ar: "متوسط قيمة الطلب" } },
  { id: "food_cost", label: { en: "Food cost percentage", ar: "نسبة تكلفة الطعام" } },
  { id: "waste", label: { en: "Waste percentage", ar: "نسبة الهدر" } },
  { id: "best_branch", label: { en: "Best branch", ar: "أفضل فرع" } },
  { id: "worst_branch", label: { en: "Branch needing attention", ar: "فرع يحتاج انتباهًا" } },
  { id: "alerts", label: { en: "Open alerts by severity", ar: "التنبيهات المفتوحة حسب الخطورة" } },
  { id: "live", label: { en: "Terminals offline and sync backlog", ar: "الأجهزة غير المتصلة وتراكم المزامنة" } },
];

export interface MorningBriefConfig {
  enabled: boolean;
  time: string;
  channels: ("push" | "email")[];
  recipientRoles: RoleKey[];
  recipientEmails: string[];
  sections: BriefSection[];
  branchIds: Id[];
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

export const DEFAULT_BRIEF: MorningBriefConfig = {
  enabled: true,
  time: "07:30",
  channels: ["push"],
  recipientRoles: ["owner", "operations_director"],
  recipientEmails: [],
  sections: ["sales", "transactions", "food_cost", "best_branch", "worst_branch", "alerts"],
  branchIds: [],
  updatedAt: null,
  updatedBy: null,
};

/**
 * Seconds to read a brief, at a phone-scanning 200 words a minute — the
 * yardstick FR-RPT-041 sets at thirty.
 */
export function readingSeconds(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.ceil((words / 200) * 60);
}
