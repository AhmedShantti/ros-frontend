/**
 * Seasonality for demand forecasting — SRS FR-INV-070.
 *
 * In MENA markets Ramadan moves demand by multiples, not percentages, and
 * it moves eleven days earlier every Gregorian year. A forecast that learns
 * "March is busy" from last year is wrong this year. So the Islamic periods
 * are computed from the Umm al-Qura calendar through `Intl` — the browser's
 * own implementation, not a table somebody has to remember to extend — and
 * only the *effect* of each period (a demand multiplier) is configuration.
 *
 * Local holidays belong in the country pack. The pack does not carry a
 * holiday list yet, so the fixed-date national holidays for the markets in
 * scope are listed here as defaults, and the tenant can add their own.
 */

import type { CountryCode, IsoDate, Localised } from "./types";

export type SeasonKind = "ramadan" | "eid_al_fitr" | "eid_al_adha" | "holiday" | "custom";

export interface SeasonalEvent {
  id: string;
  kind: SeasonKind;
  name: Localised;
  /** Inclusive. */
  from: IsoDate;
  to: IsoDate;
  /** Demand multiplier while the event is in force: 1 = no effect. */
  multiplier: number;
  /** Where the date came from — computed, country default, or the tenant. */
  source: "hijri" | "country" | "tenant";
}

/** Multipliers per kind when the tenant has not set their own. */
export const DEFAULT_MULTIPLIERS: Record<Exclude<SeasonKind, "custom">, number> = {
  ramadan: 1.6,
  eid_al_fitr: 1.8,
  eid_al_adha: 1.5,
  holiday: 1.2,
};

// ---------------------------------------------------------------------------
// Hijri
// ---------------------------------------------------------------------------

let hijriFormatter: Intl.DateTimeFormat | null | undefined;

function formatter(): Intl.DateTimeFormat | null {
  if (hijriFormatter !== undefined) return hijriFormatter;
  try {
    hijriFormatter = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    // An engine without the calendar silently falls back to Gregorian; a
    // Gregorian month of 9 would then be read as Ramadan. Detect it.
    const probe = hijriFormatter.resolvedOptions().calendar;
    if (!probe.startsWith("islamic")) hijriFormatter = null;
  } catch {
    hijriFormatter = null;
  }
  return hijriFormatter;
}

/** Whether this browser can compute Hijri dates at all. */
export function hijriSupported(): boolean {
  return formatter() !== null;
}

export function hijriOf(date: IsoDate): { year: number; month: number; day: number } | null {
  const f = formatter();
  if (!f) return null;
  const parts = f.formatToParts(new Date(`${date}T12:00:00Z`));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const out = { year: read("year"), month: read("month"), day: read("day") };
  return Number.isFinite(out.month) && Number.isFinite(out.day) ? out : null;
}

function addDays(date: IsoDate, days: number): IsoDate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Ramadan and both Eids overlapping [from, to], found by walking the range
 * a day at a time and grouping consecutive days in the same period. A
 * forecast horizon is weeks, so the walk is short.
 */
export function islamicPeriods(from: IsoDate, to: IsoDate): SeasonalEvent[] {
  if (!hijriSupported()) return [];
  const out: SeasonalEvent[] = [];
  // Widen by a month either side so a period cut by the range keeps its true edges.
  const start = addDays(from, -35);
  const end = addDays(to, 35);
  let current: SeasonalEvent | null = null;

  for (let day = start; day <= end; day = addDays(day, 1)) {
    const hijri = hijriOf(day);
    let kind: SeasonKind | null = null;
    if (hijri?.month === 9) kind = "ramadan";
    else if (hijri?.month === 10 && hijri.day <= 3) kind = "eid_al_fitr";
    else if (hijri?.month === 12 && hijri.day >= 10 && hijri.day <= 13) kind = "eid_al_adha";

    if (kind && current && current.kind === kind) {
      current.to = day;
      continue;
    }
    if (current) out.push(current);
    current = kind
      ? {
          id: `${kind}-${hijri!.year}`,
          kind,
          name: ISLAMIC_NAMES[kind as keyof typeof ISLAMIC_NAMES],
          from: day,
          to: day,
          multiplier: DEFAULT_MULTIPLIERS[kind as keyof typeof ISLAMIC_NAMES],
          source: "hijri",
        }
      : null;
  }
  if (current) out.push(current);
  return out.filter((event) => event.to >= from && event.from <= to);
}

const ISLAMIC_NAMES = {
  ramadan: { en: "Ramadan", ar: "رمضان" },
  eid_al_fitr: { en: "Eid al-Fitr", ar: "عيد الفطر" },
  eid_al_adha: { en: "Eid al-Adha", ar: "عيد الأضحى" },
} satisfies Record<string, Localised>;

// ---------------------------------------------------------------------------
// Fixed-date national holidays (country-pack defaults)
// ---------------------------------------------------------------------------

const NATIONAL_HOLIDAYS: Partial<Record<CountryCode, { month: number; day: number; name: Localised }[]>> = {
  EG: [
    { month: 1, day: 7, name: { en: "Coptic Christmas", ar: "عيد الميلاد المجيد" } },
    { month: 1, day: 25, name: { en: "Revolution Day (25 January)", ar: "عيد ثورة 25 يناير" } },
    { month: 4, day: 25, name: { en: "Sinai Liberation Day", ar: "عيد تحرير سيناء" } },
    { month: 5, day: 1, name: { en: "Labour Day", ar: "عيد العمال" } },
    { month: 6, day: 30, name: { en: "June 30 Revolution", ar: "ذكرى ثورة 30 يونيو" } },
    { month: 7, day: 23, name: { en: "Revolution Day (23 July)", ar: "عيد ثورة 23 يوليو" } },
    { month: 10, day: 6, name: { en: "Armed Forces Day", ar: "عيد القوات المسلحة" } },
  ],
  SA: [
    { month: 2, day: 22, name: { en: "Founding Day", ar: "يوم التأسيس" } },
    { month: 9, day: 23, name: { en: "Saudi National Day", ar: "اليوم الوطني السعودي" } },
  ],
  AE: [
    { month: 12, day: 2, name: { en: "UAE National Day", ar: "اليوم الوطني الإماراتي" } },
    { month: 12, day: 3, name: { en: "UAE National Day holiday", ar: "عطلة اليوم الوطني" } },
  ],
};

export function nationalHolidays(country: CountryCode, from: IsoDate, to: IsoDate): SeasonalEvent[] {
  const list = NATIONAL_HOLIDAYS[country] ?? [];
  const out: SeasonalEvent[] = [];
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const holiday of list) {
      const date = `${year}-${String(holiday.month).padStart(2, "0")}-${String(holiday.day).padStart(2, "0")}`;
      if (date < from || date > to) continue;
      out.push({
        id: `holiday-${country}-${date}`,
        kind: "holiday",
        name: holiday.name,
        from: date,
        to: date,
        multiplier: DEFAULT_MULTIPLIERS.holiday,
        source: "country",
      });
    }
  }
  return out;
}

/**
 * Every seasonal event in force over a horizon: computed Islamic periods,
 * country holidays and tenant events, with the tenant's multiplier for a
 * kind replacing the default.
 */
export function seasonalEvents(input: {
  country: CountryCode;
  from: IsoDate;
  to: IsoDate;
  multipliers?: Partial<Record<SeasonKind, number>>;
  custom?: SeasonalEvent[];
}): SeasonalEvent[] {
  const override = (event: SeasonalEvent): SeasonalEvent => {
    const configured = input.multipliers?.[event.kind];
    return event.source !== "tenant" && typeof configured === "number" ? { ...event, multiplier: configured } : event;
  };
  return [
    ...islamicPeriods(input.from, input.to),
    ...nationalHolidays(input.country, input.from, input.to),
    ...(input.custom ?? []).filter((event) => event.to >= input.from && event.from <= input.to),
  ]
    .map(override)
    .sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * The multiplier for one day. Overlapping events do not compound — an Eid
 * that falls on a national holiday is one busy day, not a product of two —
 * so the strongest effect wins.
 */
export function multiplierOn(date: IsoDate, events: SeasonalEvent[]): { multiplier: number; event: SeasonalEvent | null } {
  let best: SeasonalEvent | null = null;
  for (const event of events) {
    if (date < event.from || date > event.to) continue;
    if (!best || Math.abs(event.multiplier - 1) > Math.abs(best.multiplier - 1)) best = event;
  }
  return { multiplier: best?.multiplier ?? 1, event: best };
}

export { addDays as addIsoDays };
