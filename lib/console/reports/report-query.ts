/**
 * Natural-language report questions — FR-RPT-047.
 *
 * "Which branch had the worst food cost last week" becomes
 * `food-cost · group by branch · 2026-09-07…2026-09-13 · sort food cost % desc · limit 1`,
 * and that parameter set — not an answer — is what the user sees first. They
 * confirm or correct it, and only then does the report engine run.
 *
 * Deliberately not a language model. It is a deterministic intent parser
 * over the report catalogue: a bilingual lexicon of measures, groupings,
 * periods and rankings, matched against the question, with whatever it did
 * not understand listed back rather than guessed at. The same question
 * always produces the same query, the vocabulary is inspectable, and nothing
 * about a tenant's data leaves the browser.
 */

export type RankIntent = "best" | "worst" | "highest" | "lowest";

export interface QueryReport {
  id: string;
  /** Whether the session may run it. */
  permitted: boolean;
}

export interface QueryBranch {
  id: string;
  names: string[];
}

export interface QueryContext {
  reports: QueryReport[];
  branches: QueryBranch[];
  /** YYYY-MM-DD, the business day the question is asked on. */
  today: string;
  /** 0 = Sunday … 6 = Saturday. Defaults to Monday. */
  weekStart?: number;
}

export type MatchKind = "measure" | "grouping" | "period" | "rank" | "limit" | "branch" | "compare";

export interface QueryMatch {
  kind: MatchKind;
  /** The words in the question that produced this part of the query. */
  text: string;
  value: string;
}

export interface ParsedReportQuery {
  question: string;
  reportId: string | null;
  measure: string | null;
  /** The result column the ranking sorts on. */
  valueKey: string | null;
  groupBy: string | null;
  from: string;
  to: string;
  /** True when no period was named and the default window was used. */
  periodDefaulted: boolean;
  periodKey: string;
  branchId: string | null;
  sort: { key: string; direction: "asc" | "desc" } | null;
  limit: number | null;
  compare: boolean;
  matches: QueryMatch[];
  /** Words that carried meaning the parser could not place. */
  unrecognised: string[];
  confidence: "high" | "medium" | "low";
  /** Set when the measure maps to a report the session may not run. */
  notPermitted: string | null;
}

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

interface Measure {
  key: string;
  report: string;
  valueKey: string;
  /** Whether a larger value is the better outcome — decides "best" and "worst". */
  higherIsBetter: boolean;
  /** Grouping when the question names none. */
  defaultGroup: string | null;
  phrases: string[];
}

/**
 * Longest phrases first within the lexicon is not required: every match
 * consumes its span, and phrases are tried longest-first across the whole
 * lexicon, so "net sales" is taken before "sales" can be.
 */
const MEASURES: Measure[] = [
  { key: "food_cost", report: "food-cost", valueKey: "foodCostPercent", higherIsBetter: false, defaultGroup: "branch",
    phrases: ["food cost", "food costs", "cost of goods", "cogs", "food cost percentage", "تكلفه الطعام", "تكلفه الغذاء", "تكلفه البضاعه", "نسبه تكلفه الطعام"] },
  { key: "aov", report: "sales-summary", valueKey: "aov", higherIsBetter: true, defaultGroup: "day",
    phrases: ["average order value", "average order", "aov", "basket size", "average ticket", "متوسط قيمه الطلب", "متوسط الطلب", "متوسط الفاتوره"] },
  { key: "orders", report: "sales-summary", valueKey: "orders", higherIsBetter: true, defaultGroup: "day",
    phrases: ["orders", "order count", "transactions", "covers", "الطلبات", "طلبات", "عدد الطلبات", "المعاملات"] },
  { key: "discounts", report: "discount-analysis", valueKey: "amount", higherIsBetter: false, defaultGroup: null,
    phrases: ["discounts", "discount", "comps", "comp", "giveaways", "الخصومات", "خصومات", "خصم"] },
  { key: "tender", report: "sales-by-tender", valueKey: "amount", higherIsBetter: true, defaultGroup: null,
    phrases: ["payment method", "payment methods", "tender", "tenders", "cash vs card", "وسيله الدفع", "وسائل الدفع", "طرق الدفع"] },
  { key: "waste", report: "waste-analysis", valueKey: "value", higherIsBetter: false, defaultGroup: "reason",
    phrases: ["waste", "wastage", "spoilage", "الهدر", "هدر", "التالف"] },
  { key: "items", report: "sales-by-item", valueKey: "net", higherIsBetter: true, defaultGroup: null,
    phrases: ["menu items", "items", "item", "dishes", "dish", "products", "sellers", "seller", "selling", "الاصناف", "اصناف", "صنف", "الاطباق", "طبق"] },
  { key: "labour", report: "labour-cost", valueKey: "cost", higherIsBetter: false, defaultGroup: null,
    phrases: ["labour cost", "labor cost", "labour", "labor", "payroll", "wages", "تكلفه العماله", "العماله", "الاجور", "الرواتب"] },
  { key: "overtime", report: "overtime", valueKey: "overtime", higherIsBetter: false, defaultGroup: null,
    phrases: ["overtime", "extra hours", "العمل الاضافي", "ساعات اضافيه"] },
  { key: "lateness", report: "attendance", valueKey: "late", higherIsBetter: false, defaultGroup: null,
    phrases: ["late", "lateness", "attendance", "late arrivals", "التاخير", "تاخير", "الحضور", "متاخر"] },
  { key: "prep_time", report: "prep-time", valueKey: "p90", higherIsBetter: false, defaultGroup: null,
    phrases: ["prep time", "preparation time", "kitchen time", "ticket time", "slowest", "slow", "زمن التحضير", "وقت التحضير", "التحضير"] },
  { key: "stock_value", report: "stock-valuation", valueKey: "value", higherIsBetter: true, defaultGroup: "location",
    phrases: ["stock value", "inventory value", "stock valuation", "valuation", "قيمه المخزون", "تقييم المخزون"] },
  { key: "low_stock", report: "low-stock", valueKey: "onHand", higherIsBetter: true, defaultGroup: null,
    phrases: ["low stock", "reorder", "running out", "out of stock", "نقص المخزون", "اعاده الطلب", "نفاد"] },
  { key: "expiry", report: "expiry-watch", valueKey: "value", higherIsBetter: false, defaultGroup: null,
    phrases: ["expiring", "expiry", "expire", "expires", "best before", "الصلاحيه", "انتهاء الصلاحيه", "تنتهي"] },
  // Last so every more specific measure above wins its words first.
  { key: "net_sales", report: "sales-summary", valueKey: "net", higherIsBetter: true, defaultGroup: "day",
    phrases: ["net sales", "sales", "revenue", "turnover", "takings", "sold", "sell", "صافي المبيعات", "المبيعات", "مبيعات", "مبيعا", "الايرادات", "الايراد", "باع"] },
];

interface Grouping {
  key: string;
  phrases: string[];
}

const GROUPINGS: Grouping[] = [
  { key: "branch", phrases: ["which branch", "which branches", "which store", "branches", "branch", "stores", "store", "sites", "by location", "اي فرع", "الفروع", "فروع", "فرع"] },
  { key: "employee", phrases: ["which employee", "which cashier", "employees", "employee", "cashiers", "cashier", "staff member", "servers", "waiters", "who", "اي موظف", "الموظفين", "موظف", "الكاشير"] },
  { key: "hour", phrases: ["by hour", "per hour", "hourly", "each hour", "time of day", "which hour", "حسب الساعه", "كل ساعه", "اي ساعه"] },
  { key: "day", phrases: ["by day", "per day", "daily", "each day", "which day", "day by day", "حسب اليوم", "يوميا", "يومي", "اي يوم"] },
  { key: "week", phrases: ["by week", "per week", "weekly", "each week", "حسب الاسبوع", "اسبوعيا", "اسبوعي"] },
  { key: "month", phrases: ["by month", "per month", "monthly", "each month", "حسب الشهر", "شهريا", "شهري"] },
  { key: "orderType", phrases: ["order type", "dine in vs takeaway", "by type", "نوع الطلب"] },
  { key: "channel", phrases: ["channel", "channels", "القناه", "القنوات"] },
  { key: "reason", phrases: ["reason", "reasons", "why", "السبب", "الاسباب"] },
  { key: "location", phrases: ["location", "locations", "warehouse", "store room", "الموقع", "المستودع"] },
  { key: "category", phrases: ["category", "categories", "الفئه", "الفئات"] },
];

/** Which groupings each report can honour, and how some re-route. */
const REPORT_GROUPINGS: Record<string, string[]> = {
  "sales-summary": ["day", "week", "month", "hour", "branch", "orderType", "channel"],
  "food-cost": ["branch", "day", "week", "month"],
  "waste-analysis": ["reason", "item", "location", "category"],
  "stock-valuation": ["location", "item"],
};

/** A sales question grouped by employee or item is a different catalogue entry. */
const REROUTE: Record<string, Record<string, string>> = {
  "sales-summary": { employee: "sales-by-employee", item: "sales-by-item" },
};

const RANKS: { intent: RankIntent; phrases: string[] }[] = [
  { intent: "worst", phrases: ["worst", "weakest", "poorest", "most problematic", "الاسوا", "اسوا", "الاضعف", "اضعف"] },
  { intent: "best", phrases: ["best", "strongest", "top performing", "best performing", "الافضل", "افضل", "الاقوى", "اقوى"] },
  { intent: "highest", phrases: ["highest", "most", "biggest", "largest", "top", "greatest", "الاعلى", "اعلى", "الاكثر", "اكثر", "اكبر"] },
  { intent: "lowest", phrases: ["lowest", "least", "smallest", "fewest", "bottom", "الادنى", "ادنى", "الاقل", "اقل", "اصغر"] },
];

const COMPARE = ["compared to previous", "compared with previous", "vs previous", "previous period", "compared to", "compared with", "compare", "versus", "vs", "against last", "مقارنه", "مقابل"];

const STOPWORDS = new Set(
  (
    "a an the of in on at for to by and or with what which who whose how show me give list tell did do does had has have " +
    "was were is are be been my our we i it its this that these those from over during per than please report " +
    "ما ماذا ما هو ما هي هل في على من الى عن مع كان كانت لدي لدينا اعرض اظهر اعطني قائمه تقرير هذا هذه ذلك التي الذي كم فيه فيها به بها"
  ).split(" "),
);

/** Reports whose rows already are items, so "dishes" or "items" adds nothing. */
const ITEM_LEVEL_REPORTS = new Set(["sales-by-item", "prep-time", "low-stock", "expiry-watch"]);
const IMPLICIT_ITEM_WORDS = new Set(["item", "items", "dish", "dishes", "products", "product", "صنف", "اصناف", "الاصناف", "طبق", "الاطباق"]);

const MONTHS: { month: number; phrases: string[] }[] = [
  { month: 1, phrases: ["january", "jan", "يناير", "كانون الثاني"] },
  { month: 2, phrases: ["february", "feb", "فبراير", "شباط"] },
  { month: 3, phrases: ["march", "mar", "مارس", "اذار"] },
  { month: 4, phrases: ["april", "apr", "ابريل", "نيسان"] },
  { month: 5, phrases: ["may", "مايو", "ايار"] },
  { month: 6, phrases: ["june", "jun", "يونيو", "حزيران"] },
  { month: 7, phrases: ["july", "jul", "يوليو", "تموز"] },
  { month: 8, phrases: ["august", "aug", "اغسطس"] },
  { month: 9, phrases: ["september", "sept", "sep", "سبتمبر", "ايلول"] },
  { month: 10, phrases: ["october", "oct", "اكتوبر", "تشرين الاول"] },
  { month: 11, phrases: ["november", "nov", "نوفمبر", "تشرين الثاني"] },
  { month: 12, phrases: ["december", "dec", "ديسمبر", "كانون الاول"] },
];

// ---------------------------------------------------------------------------
// Normalisation and matching
// ---------------------------------------------------------------------------

/** Lower case, Arabic letter variants folded, Arabic-Indic digits to ASCII, punctuation to spaces. */
export function normaliseQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[?؟!.,،;:"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Cursor {
  text: string;
  /** Per word: consumed or not. */
  words: string[];
  used: boolean[];
}

/**
 * Finds a phrase as whole words, optionally tolerating the Arabic definite
 * article on the first word, and consumes it. Returns the matched words.
 */
function take(cursor: Cursor, phrase: string): string | null {
  const parts = normaliseQuestion(phrase).split(" ");
  outer: for (let i = 0; i + parts.length <= cursor.words.length; i += 1) {
    for (let j = 0; j < parts.length; j += 1) {
      const word = cursor.words[i + j]!;
      const part = parts[j]!;
      const ok =
        !cursor.used[i + j] &&
        (word === part || (j === 0 && /[ء-ي]/.test(part) && (word === `ال${part}` || word === `بال${part}` || word === `في${part}`)));
      if (!ok) continue outer;
    }
    for (let j = 0; j < parts.length; j += 1) cursor.used[i + j] = true;
    return cursor.words.slice(i, i + parts.length).join(" ");
  }
  return null;
}

function byLength<T extends { phrase: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length || b.phrase.length - a.phrase.length);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

function startOfWeek(day: string, weekStart: number): string {
  const date = parseDay(day);
  const offset = (date.getUTCDay() - weekStart + 7) % 7;
  return addDays(day, -offset);
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: iso(from), to: iso(to) };
}

interface PeriodHit {
  key: string;
  from: string;
  to: string;
  text: string;
}

function readPeriod(cursor: Cursor, today: string, weekStart: number): PeriodHit | null {
  const year = parseDay(today).getUTCFullYear();
  const month = parseDay(today).getUTCMonth() + 1;

  // "last 14 days", "past 3 weeks", "آخر 7 أيام"
  const numbered = /(?:^| )((?:last|past|previous|اخر|الماضيه|خلال) (\d{1,3}) (days?|weeks?|months?|يوم|ايام|اسبوع|اسابيع|شهر|اشهر))(?: |$)/.exec(
    cursor.words.map((word, index) => (cursor.used[index] ? "_" : word)).join(" "),
  );
  if (numbered) {
    const n = Math.max(1, Number(numbered[2]));
    const unit = numbered[3]!;
    const text = take(cursor, numbered[1]!);
    if (text) {
      if (/^(day|days|يوم|ايام)$/.test(unit)) return { key: `last_${n}_days`, from: addDays(today, -(n - 1)), to: today, text };
      if (/^(week|weeks|اسبوع|اسابيع)$/.test(unit)) return { key: `last_${n}_weeks`, from: addDays(today, -(n * 7 - 1)), to: today, text };
      const start = new Date(Date.UTC(year, month - 1 - n, parseDay(today).getUTCDate() + 1));
      return { key: `last_${n}_months`, from: iso(start), to: today, text };
    }
  }

  const fixed: { key: string; phrases: string[]; range: () => { from: string; to: string } }[] = [
    { key: "yesterday", phrases: ["yesterday", "امس", "البارحه"], range: () => ({ from: addDays(today, -1), to: addDays(today, -1) }) },
    { key: "today", phrases: ["today", "so far today", "اليوم", "حتي الان"], range: () => ({ from: today, to: today }) },
    { key: "last_week", phrases: ["last week", "previous week", "past week", "الاسبوع الماضي", "الاسبوع السابق"], range: () => {
      const start = addDays(startOfWeek(today, weekStart), -7);
      return { from: start, to: addDays(start, 6) };
    } },
    { key: "this_week", phrases: ["this week", "week to date", "هذا الاسبوع"], range: () => ({ from: startOfWeek(today, weekStart), to: today }) },
    { key: "last_month", phrases: ["last month", "previous month", "past month", "الشهر الماضي", "الشهر السابق"], range: () =>
      month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1) },
    { key: "this_month", phrases: ["this month", "month to date", "mtd", "هذا الشهر"], range: () => ({ from: monthRange(year, month).from, to: today }) },
    { key: "last_year", phrases: ["last year", "previous year", "العام الماضي", "السنه الماضيه"], range: () => ({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }) },
    { key: "this_year", phrases: ["this year", "year to date", "ytd", "هذا العام", "هذه السنه"], range: () => ({ from: `${year}-01-01`, to: today }) },
  ];
  const candidates = byLength(fixed.flatMap((entry) => entry.phrases.map((phrase) => ({ phrase, entry }))));
  for (const { phrase, entry } of candidates) {
    const text = take(cursor, phrase);
    if (text) return { key: entry.key, ...entry.range(), text };
  }

  // "in March", "مارس" — the most recent such month that has started.
  const monthCandidates = byLength(MONTHS.flatMap((entry) => entry.phrases.map((phrase) => ({ phrase, entry }))));
  for (const { phrase, entry } of monthCandidates) {
    // Three-letter English abbreviations are too ambiguous ("mar", "may") unless preceded by "in".
    const guarded = /^[a-z]{3,4}$/.test(phrase) ? `in ${phrase}` : phrase;
    const text = take(cursor, guarded);
    if (text) {
      const y = entry.month > month ? year - 1 : year;
      const range = monthRange(y, entry.month);
      return { key: `month_${y}_${entry.month}`, from: range.from, to: range.to > today ? today : range.to, text };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export const DEFAULT_WINDOW_DAYS = 7;

export function parseReportQuestion(question: string, context: QueryContext): ParsedReportQuery {
  const weekStart = context.weekStart ?? 1;
  const normalised = normaliseQuestion(question);
  const words = normalised ? normalised.split(" ") : [];
  const cursor: Cursor = { text: normalised, words, used: words.map(() => false) };
  const matches: QueryMatch[] = [];

  // Period first: "last week" must not lose "week" to the weekly grouping.
  const period = readPeriod(cursor, context.today, weekStart);
  if (period) matches.push({ kind: "period", text: period.text, value: period.key });

  // Branches by name, before the lexicon can take a word of the name.
  let branchId: string | null = null;
  const branchCandidates = byLength(
    context.branches.flatMap((branch) =>
      branch.names.filter((name) => name.trim().length > 1).map((phrase) => ({ phrase, branch })),
    ),
  );
  for (const { phrase, branch } of branchCandidates) {
    const text = take(cursor, phrase);
    if (text) {
      branchId = branch.id;
      matches.push({ kind: "branch", text, value: branch.id });
      break;
    }
  }

  // "top 5", "أعلى 3", "5 best"
  let limit: number | null = null;
  for (let i = 0; i < cursor.words.length; i += 1) {
    if (cursor.used[i] || !/^\d{1,3}$/.test(cursor.words[i]!)) continue;
    const n = Number(cursor.words[i]);
    if (n < 1 || n > 500) continue;
    cursor.used[i] = true;
    limit = n;
    matches.push({ kind: "limit", text: cursor.words[i]!, value: String(n) });
    break;
  }

  let rank: RankIntent | null = null;
  const rankCandidates = byLength(RANKS.flatMap((entry) => entry.phrases.map((phrase) => ({ phrase, entry }))));
  for (const { phrase, entry } of rankCandidates) {
    const text = take(cursor, phrase);
    if (text) {
      rank = entry.intent;
      matches.push({ kind: "rank", text, value: entry.intent });
      break;
    }
  }

  let compare = false;
  for (const phrase of COMPARE) {
    const text = take(cursor, phrase);
    if (text) {
      compare = true;
      matches.push({ kind: "compare", text, value: "previous_period" });
      break;
    }
  }

  let measure: Measure | null = null;
  const measureCandidates = byLength(MEASURES.flatMap((entry) => entry.phrases.map((phrase) => ({ phrase, entry }))));
  for (const { phrase, entry } of measureCandidates) {
    const text = take(cursor, phrase);
    if (text) {
      measure = entry;
      matches.push({ kind: "measure", text, value: entry.key });
      break;
    }
  }
  // "best selling items", "items by sales": the other words of the same
  // measure, and a sales or order count naming what to rank items by.
  let rankBy: "net" | "orders" | null = null;
  if (measure) {
    for (const { phrase, entry } of measureCandidates) {
      if (entry.key === measure.key) {
        while (take(cursor, phrase)) {
          /* consume repeats */
        }
      } else if (entry.key === "net_sales" || entry.key === "orders") {
        const text = take(cursor, phrase);
        if (text) {
          rankBy = entry.key === "orders" ? "orders" : "net";
          matches.push({ kind: "measure", text, value: entry.key });
        }
      }
    }
  }

  let grouping: string | null = null;
  let singular = false;
  const groupingCandidates = byLength(GROUPINGS.flatMap((entry) => entry.phrases.map((phrase) => ({ phrase, entry }))));
  for (const { phrase, entry } of groupingCandidates) {
    const text = take(cursor, phrase);
    if (text) {
      grouping = entry.key;
      singular = /^(which|اي) /.test(phrase) || !/s$/.test(phrase.split(" ").pop() ?? "");
      matches.push({ kind: "grouping", text, value: entry.key });
      break;
    }
  }

  // -- Resolve the report ---------------------------------------------------

  let reportId = measure?.report ?? (grouping === "employee" ? "sales-by-employee" : "sales-summary");
  let valueKey = measure?.valueKey ?? "net";
  const higherIsBetter = measure?.higherIsBetter ?? true;

  if (grouping && REROUTE[reportId]?.[grouping]) {
    reportId = REROUTE[reportId]![grouping]!;
  }
  if (rankBy && reportId === "sales-summary") valueKey = rankBy;

  const allowedGroupings = REPORT_GROUPINGS[reportId] ?? [];
  let groupBy: string | null = null;
  if (grouping && allowedGroupings.includes(grouping)) groupBy = grouping;
  else if (allowedGroupings.length > 0) groupBy = measure?.defaultGroup && allowedGroupings.includes(measure.defaultGroup) ? measure.defaultGroup : allowedGroupings[0]!;

  // A grouping the report cannot honour is reported, not silently dropped.
  const unrecognised: string[] = [];
  if (grouping && groupBy !== grouping && !(REROUTE[measure?.report ?? "sales-summary"]?.[grouping])) {
    const hit = matches.find((match) => match.kind === "grouping");
    if (hit) unrecognised.push(hit.text);
  }

  // A ranking against a measure that has no such column (sales-by-employee's
  // net is fine; the tender report has "amount") falls back to the report's
  // own chart column in the page, which knows the result shape.
  const byOrders = measure?.key === "orders" || rankBy === "orders";
  if (reportId === "sales-by-employee") valueKey = byOrders ? "orders" : valueKey === "aov" ? "aov" : "net";
  if (reportId === "sales-by-item") valueKey = byOrders ? "units" : "net";

  let sort: ParsedReportQuery["sort"] = null;
  if (rank) {
    const direction: "asc" | "desc" =
      rank === "highest" ? "desc" : rank === "lowest" ? "asc" : rank === "best" ? (higherIsBetter ? "desc" : "asc") : higherIsBetter ? "asc" : "desc";
    sort = { key: valueKey, direction };
    if (limit === null && singular) limit = 1;
  } else if (limit !== null) {
    sort = { key: valueKey, direction: "desc" };
  }

  const itemLevel = ITEM_LEVEL_REPORTS.has(reportId);
  for (let i = 0; i < cursor.words.length; i += 1) {
    const word = cursor.words[i]!;
    if (cursor.used[i] || STOPWORDS.has(word) || word.length < 2) continue;
    if (itemLevel && IMPLICIT_ITEM_WORDS.has(word)) continue;
    unrecognised.push(word);
  }

  const from = period?.from ?? addDays(context.today, -(DEFAULT_WINDOW_DAYS - 1));
  const to = period?.to ?? context.today;

  const report = context.reports.find((entry) => entry.id === reportId);
  const notPermitted = report && !report.permitted ? reportId : null;
  const known = Boolean(report);

  const confidence: ParsedReportQuery["confidence"] =
    !known || !measure ? "low" : period && unrecognised.length === 0 ? "high" : "medium";

  return {
    question,
    reportId: known ? reportId : null,
    measure: measure?.key ?? null,
    valueKey,
    groupBy,
    from,
    to,
    periodDefaulted: !period,
    periodKey: period?.key ?? `last_${DEFAULT_WINDOW_DAYS}_days`,
    branchId,
    sort,
    limit,
    compare,
    matches,
    unrecognised,
    confidence,
    notPermitted,
  };
}

/**
 * The generated query, as one line the user can read and check — the
 * "shown to the user for verification" half of FR-RPT-047.
 */
export function describeQuery(query: Pick<ParsedReportQuery, "reportId" | "groupBy" | "from" | "to" | "branchId" | "sort" | "limit" | "compare">): string {
  const parts = [`report=${query.reportId ?? "?"}`];
  if (query.groupBy) parts.push(`group_by=${query.groupBy}`);
  parts.push(`period=${query.from}..${query.to}`);
  if (query.branchId) parts.push(`branch=${query.branchId}`);
  if (query.sort) parts.push(`sort=${query.sort.key} ${query.sort.direction}`);
  if (query.limit !== null) parts.push(`limit=${query.limit}`);
  if (query.compare) parts.push("compare=previous_period");
  return parts.join(" · ");
}

/** Applies the ranking to engine rows. Pure; the engine result is not mutated. */
export function rankRows<T extends { values: Record<string, number | string> }>(
  rows: readonly T[],
  sort: ParsedReportQuery["sort"],
  limit: number | null,
): T[] {
  let out = [...rows];
  if (sort) {
    out.sort((a, b) => {
      const av = Number(a.values[sort.key]);
      const bv = Number(b.values[sort.key]);
      const left = Number.isFinite(av) ? av : 0;
      const right = Number.isFinite(bv) ? bv : 0;
      return sort.direction === "asc" ? left - right : right - left;
    });
  }
  if (limit !== null) out = out.slice(0, limit);
  return out;
}

/** Example questions, shown as one-tap suggestions. */
export const EXAMPLE_QUESTIONS: { en: string; ar: string }[] = [
  { en: "Which branch had the worst food cost last week?", ar: "أي فرع كانت تكلفة الطعام فيه الأسوأ الأسبوع الماضي؟" },
  { en: "Top 5 items by sales this month", ar: "أعلى 5 أصناف مبيعًا هذا الشهر" },
  { en: "Net sales by day for the last 14 days", ar: "صافي المبيعات يوميًا خلال آخر 14 يوم" },
  { en: "Which employee sold the most yesterday?", ar: "أي موظف باع الأكثر أمس؟" },
  { en: "Waste by reason last month", ar: "الهدر حسب السبب الشهر الماضي" },
  { en: "What is expiring?", ar: "ما الذي تنتهي صلاحيته؟" },
];
