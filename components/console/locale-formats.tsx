"use client";

/**
 * FR-LOC-010 — locale-aware formatting of dates, times, numbers and money,
 * with Gregorian / Hijri display where a country pack enables Hijri.
 */

import { useMemo, useState } from "react";

import type { Currency } from "@/lib/console/types";
import { PACK_LANGUAGES, TRANSLATION_PACKS, type PackLanguage } from "@/lib/console/locale-packs";
import { formatDate, formatDateTime, formatForTag, formatMoney, formatNumber, type CalendarDisplay } from "@/lib/console/format";
import { useI18n, usePreferences } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { Badge, Callout, Field, Select } from "@/components/console/ui";

export interface HijriSource {
  branchName: string;
  packLabel: string;
}

export function LocaleFormatsPanel({ hijriSources, loading }: { hijriSources: HijriSource[]; loading: boolean }) {
  const { t, fmt } = useI18n();
  const { calendar, setCalendar } = usePreferences();
  const [currency, setCurrency] = useState<Currency>("SAR");
  const hijriAllowed = hijriSources.length > 0;
  const effective: CalendarDisplay = hijriAllowed ? calendar : "gregory";

  const sample = useMemo(() => {
    const now = new Date();
    return { dateTime: now.toISOString(), date: now.toISOString().slice(0, 10), number: 1234567.891, money: { amount: 123456, currency } };
  }, [currency]);

  type Row = { language: PackLanguage };
  const columns: Column<Row>[] = [
    {
      key: "language",
      header: t("lpk.language"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{TRANSLATION_PACKS[row.language].endonym}</span>
          <span className="text-fg-subtle font-mono text-xs" dir="ltr">
            {TRANSLATION_PACKS[row.language].intlTag}
          </span>
        </span>
      ),
    },
    { key: "date", header: t("lpk.fmt.date"), render: (row) => <span dir={TRANSLATION_PACKS[row.language].dir}>{formatForTag(TRANSLATION_PACKS[row.language].intlTag, { date: sample.date }, effective)}</span> },
    { key: "dateTime", header: t("lpk.fmt.dateTime"), render: (row) => <span dir={TRANSLATION_PACKS[row.language].dir}>{formatForTag(TRANSLATION_PACKS[row.language].intlTag, { dateTime: sample.dateTime }, effective)}</span> },
    { key: "number", header: t("lpk.fmt.number"), numeric: true, render: (row) => <span dir="ltr">{formatForTag(TRANSLATION_PACKS[row.language].intlTag, { number: sample.number })}</span> },
    { key: "money", header: t("lpk.fmt.money"), numeric: true, render: (row) => <span dir="ltr">{formatForTag(TRANSLATION_PACKS[row.language].intlTag, { money: sample.money })}</span> },
  ];

  return (
    <div className="space-y-5">
      <Section title={t("lpk.calendarTitle")} hint={t("lpk.calendarHint")} spec="FR-LOC-010">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56">
            <Field label={t("lpk.calendar")} hint={hijriAllowed ? undefined : loading ? undefined : t("lpk.hijriUnavailable")}>
              <Select value={effective} onChange={(event) => setCalendar(event.target.value as CalendarDisplay)}>
                <option value="gregory">{t("lpk.cal.gregory")}</option>
                <option value="hijri" disabled={!hijriAllowed}>
                  {t("lpk.cal.hijri")}
                </option>
                <option value="both" disabled={!hijriAllowed}>
                  {t("lpk.cal.both")}
                </option>
              </Select>
            </Field>
          </div>
          <div className="min-w-32">
            <Field label={t("lpk.fmt.currency")}>
              <Select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
                {(["EGP", "SAR", "AED"] as Currency[]).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        {hijriAllowed ? (
          <p className="text-fg-subtle mt-2 flex flex-wrap items-center gap-1 text-xs">
            {t("lpk.hijriEnabledBy")}
            {hijriSources.map((source) => (
              <Badge key={`${source.branchName}:${source.packLabel}`} tone="accent">
                {source.branchName} · {source.packLabel}
              </Badge>
            ))}
          </p>
        ) : null}
        {!hijriAllowed && calendar !== "gregory" && !loading ? <Callout tone="warn">{t("lpk.hijriStoredIgnored")}</Callout> : null}

        <div className="border-line mt-4 grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-fg-muted text-xs">{t("lpk.consoleNow")}</p>
            <p className="text-fg">{formatDate(sample.date, { ...fmt, calendar: effective })}</p>
          </div>
          <div>
            <p className="text-fg-muted text-xs">{t("lpk.fmt.dateTime")}</p>
            <p className="text-fg">{formatDateTime(sample.dateTime, { ...fmt, calendar: effective })}</p>
          </div>
          <div>
            <p className="text-fg-muted text-xs">{t("lpk.fmt.money")}</p>
            <p className="text-fg font-mono">
              {formatMoney(sample.money, fmt)} · {formatNumber(sample.number, fmt, 2)}
            </p>
          </div>
        </div>
      </Section>

      <Section title={t("lpk.previewFormats")} hint={t("lpk.previewFormatsHint")} spec="FR-LOC-010">
        <DataTable columns={columns} rows={PACK_LANGUAGES.map((language) => ({ language }))} rowKey={(row) => row.language} caption={t("lpk.previewFormats")} dense />
        <p className="text-fg-subtle mt-2 text-xs">{t(`lpk.cal.${effective}` as ConsoleKey)}</p>
      </Section>
    </div>
  );
}
