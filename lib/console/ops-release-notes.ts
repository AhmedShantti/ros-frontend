/**
 * Release notes — FR-OPS-013.
 *
 * Published per release, in Arabic and English, and shown inside the
 * product (`/operations/release-notes`). Both languages are authored here
 * together, entry by entry, so a release cannot ship with notes in only one
 * of them: the type makes a missing translation a build error.
 *
 * Newest release first. `CURRENT_RELEASE` is what this build is.
 */

import type { Localised } from "./types";

export type ReleaseChangeKind = "new" | "improved" | "fixed" | "security";

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  text: Localised;
  /** Where in the console the change lives, when there is one place to go. */
  href?: string;
  specRefs: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  title: Localised;
  summary: Localised;
  changes: ReleaseChange[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026.09.2",
    date: "2026-09-17",
    title: { en: "Dashboards by role, live operations and fiscal sequencing", ar: "لوحات حسب الدور والعمليات المباشرة وتسلسل المستندات الضريبية" },
    summary: {
      en: "Every role now opens on its own dashboard, which you can rearrange and save. Questions can be asked of the reports in plain language, and fiscal number blocks have a full register.",
      ar: "يفتح كل دور الآن على لوحته الخاصة، ويمكنك إعادة ترتيبها وحفظها. ويمكن طرح الأسئلة على التقارير بلغة عادية، وأصبح لكتل الأرقام الضريبية سجل كامل.",
    },
    changes: [
      { kind: "new", href: "/dashboard", specRefs: ["FR-RPT-030", "FR-RPT-031", "FR-RPT-032"],
        text: { en: "Role-specific default dashboards: an executive view (net sales against target, prime cost, branch ranking, top and bottom items, exceptions, trends) and a branch manager view (today against forecast, hourly curve with last week, food cost trend, reorder, expiry, staff on shift).",
                ar: "لوحات افتراضية حسب الدور: عرض تنفيذي (صافي المبيعات مقابل المستهدف، التكلفة الأولية، ترتيب الفروع، الأصناف الأعلى والأدنى، الاستثناءات، الاتجاهات) وعرض لمدير الفرع (اليوم مقابل التوقعات، منحنى الساعات مع الأسبوع الماضي، اتجاه تكلفة الطعام، إعادة الطلب، الصلاحية، الموظفون في الوردية)." } },
      { kind: "new", href: "/dashboard", specRefs: ["FR-RPT-034", "NFR-USA-009"],
        text: { en: "Customise your dashboard: add, remove and reorder widgets by dragging or entirely from the keyboard, reset to your role's default, and set a tenant default per role.",
                ar: "خصّص لوحتك: أضف الأدوات وأزلها وأعد ترتيبها بالسحب أو بلوحة المفاتيح بالكامل، وأعد التعيين إلى افتراضي دورك، وحدّد افتراضيًا للمستأجر لكل دور." } },
      { kind: "new", href: "/operations/live", specRefs: ["FR-RPT-033"],
        text: { en: "A live operations view that refreshes itself: open orders, table states, kitchen queue and wait, terminals and cash drawers.",
                ar: "عرض مباشر للعمليات يتحدّث تلقائيًا: الطلبات المفتوحة وحالات الطاولات وطابور المطبخ والانتظار والأجهزة وأدراج النقد." } },
      { kind: "new", href: "/reports/ask", specRefs: ["FR-RPT-047"],
        text: { en: "Ask the reports a question in English or Arabic. The question is turned into report parameters you can check and correct before anything runs; nothing leaves your browser.",
                ar: "اسأل التقارير سؤالًا بالعربية أو الإنجليزية. يتحول السؤال إلى معايير تقرير يمكنك مراجعتها وتصحيحها قبل التشغيل، ولا يغادر شيء متصفحك." } },
      { kind: "new", href: "/operations/fiscal-sequence", specRefs: ["FR-OFF-017", "FR-OFF-018"],
        text: { en: "Fiscal sequence strategy per country pack, what each till does offline when its number block runs out, and a register of used, unused and voided numbers with the void report.",
                ar: "استراتيجية التسلسل الضريبي لكل حزمة دولة، وما يفعله كل جهاز دون اتصال عند نفاد كتلة أرقامه، وسجل للأرقام المستخدمة وغير المستخدمة والملغاة مع تقرير الإلغاء." } },
      { kind: "new", href: "/operations/conformance", specRefs: ["FR-OFF-050"],
        text: { en: "A conformance runner for the shared pricing, tax, rounding and discount rules, with the test corpus exportable for the server suite.",
                ar: "مشغّل مطابقة لقواعد التسعير والضريبة والتقريب والخصم المشتركة، مع إمكانية تصدير مجموعة الاختبارات لاستخدامها في اختبارات الخادم." } },
      { kind: "improved", href: "/reports/sales-summary", specRefs: ["FR-RPT-004"],
        text: { en: "Weekly and monthly grouping in sales and food cost reports, and new low-stock and expiry-watch reports.",
                ar: "تجميع أسبوعي وشهري في تقارير المبيعات وتكلفة الطعام، وتقريران جديدان لنقص المخزون ومراقبة الصلاحية." } },
      { kind: "new", href: "/operations/health", specRefs: ["NFR-OBS-007", "NFR-OBS-005"],
        text: { en: "A system health page for support: connection, sync backlog, terminals, integrations, and a redacted client error log you can export.",
                ar: "صفحة لصحة النظام لفريق الدعم: الاتصال وتراكم المزامنة والأجهزة والتكاملات وسجل أخطاء منقّح يمكن تصديره." } },
    ],
  },
  {
    version: "2026.09.1",
    date: "2026-09-10",
    title: { en: "P0 completion", ar: "استكمال أولويات المرحلة الأولى" },
    summary: {
      en: "Settings hierarchy, alerts and scheduled delivery, audit filters, the stock item master, conflict register and session security.",
      ar: "تسلسل الإعدادات، والتنبيهات والتسليم المجدول، ومرشحات التدقيق، وسجل أصناف المخزون، وسجل التعارضات، وأمان الجلسة.",
    },
    changes: [
      { kind: "new", href: "/settings", specRefs: ["FR-PLT-025"],
        text: { en: "Settings resolve tenant → brand → branch → terminal, with locked settings naming the level that locked them.",
                ar: "تُحل الإعدادات من المستأجر ثم العلامة ثم الفرع ثم الجهاز، مع ذكر المستوى الذي قفل الإعداد المقفل." } },
      { kind: "new", href: "/reports/delivery", specRefs: ["FR-RPT-040", "FR-RPT-041"],
        text: { en: "Alert rules with thresholds and rate limits, scheduled report delivery and the morning brief.",
                ar: "قواعد تنبيه بحدود ومعدلات، وتسليم مجدول للتقارير، والملخص الصباحي." } },
      { kind: "new", href: "/operations/conflicts", specRefs: ["FR-OFF-042", "FR-OFF-043"],
        text: { en: "Conflict register with side-by-side resolution, and a clock-skew warning.",
                ar: "سجل التعارضات مع الحل جنبًا إلى جنب، وتحذير من انحراف الساعة." } },
      { kind: "security", href: "/settings", specRefs: ["FR-SEC-023", "FR-SEC-026"],
        text: { en: "Idle timeout with re-authentication, and MFA enrolment with an authenticator app.",
                ar: "مهلة الخمول مع إعادة المصادقة، وتسجيل المصادقة متعددة العوامل عبر تطبيق المصادقة." } },
    ],
  },
];

export const CURRENT_RELEASE = RELEASE_NOTES[0]!.version;

const SEEN_KEY = "ros.releaseNotes.seen";

/** Per-browser convenience: the newest version this viewer has opened. */
export function lastSeenRelease(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markReleaseSeen(version = CURRENT_RELEASE): void {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* storage blocked: the badge simply stays */
  }
}
