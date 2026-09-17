"use client";

/**
 * Release notes — FR-OPS-013.
 *
 * Per release, in Arabic and English, visible in the product. The reader's
 * own language leads; "Both languages" shows the two side by side, which is
 * how a bilingual owner checks that the Arabic says what the English says.
 * Opening the page marks the current release as seen on this browser, which
 * clears the "new" marker on the dashboard.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { formatDate } from "@/lib/console/format";
import {
  CURRENT_RELEASE,
  RELEASE_NOTES,
  markReleaseSeen,
  type ReleaseChangeKind,
} from "@/lib/console/ops-release-notes";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { Badge, SegmentedControl } from "@/components/console/ui";
import type { Tone } from "@/lib/console/labels";

type View = "mine" | "both";

const KIND_TONE: Record<ReleaseChangeKind, Tone> = {
  new: "accent",
  improved: "good",
  fixed: "neutral",
  security: "warn",
};

export default function ReleaseNotesPage() {
  const { t, locale, fmt } = useI18n();
  const [view, setView] = useState<View>("mine");

  useEffect(() => markReleaseSeen(CURRENT_RELEASE), []);

  const other = locale === "en" ? "ar" : "en";

  return (
    <>
      <PageHeader
        title={t("relnotes.title")}
        subtitle={t("relnotes.subtitle")}
        spec="FR-OPS-013"
        meta={
          <span>
            {t("relnotes.running")}: <span className="font-mono">{CURRENT_RELEASE}</span>
          </span>
        }
        actions={
          <SegmentedControl<View>
            label={t("relnotes.language")}
            value={view}
            onChange={setView}
            options={[
              { value: "mine", label: t("relnotes.myLanguage") },
              { value: "both", label: t("relnotes.bothLanguages") },
            ]}
          />
        }
      />

      <PageBody>
        {RELEASE_NOTES.map((release) => (
          <Section
            key={release.version}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{release.version}</span>
                {release.version === CURRENT_RELEASE ? <Badge tone="accent">{t("relnotes.current")}</Badge> : null}
                <span className="text-fg-subtle text-xs font-normal">{formatDate(release.date, fmt)}</span>
              </span>
            }
          >
            <div className={view === "both" ? "grid gap-6 lg:grid-cols-2" : undefined}>
              {(view === "both" ? (["en", "ar"] as const) : ([locale] as const)).map((lang) => (
                <article key={lang} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-3">
                  {view === "both" ? (
                    <p className="text-fg-subtle text-[0.68rem] tracking-wide uppercase">{lang === "ar" ? "العربية" : "English"}</p>
                  ) : null}
                  <h2 className="text-fg text-base font-semibold">{release.title[lang]}</h2>
                  <p className="text-fg-muted text-sm leading-relaxed">{release.summary[lang]}</p>
                  <ul className="space-y-2.5">
                    {release.changes.map((change, index) => (
                      <li key={index} className="flex gap-2.5">
                        <Badge tone={KIND_TONE[change.kind]} className="mt-0.5 shrink-0">
                          {t(`relnotes.kind.${change.kind}` as never)}
                        </Badge>
                        <div className="min-w-0 text-sm">
                          <p className="text-fg leading-relaxed">{change.text[lang]}</p>
                          <p className="text-fg-subtle mt-0.5 flex flex-wrap items-center gap-2 text-[0.68rem]">
                            <span dir="ltr" className="font-mono">
                              {change.specRefs.join(" · ")}
                            </span>
                            {change.href && lang === locale ? (
                              <Link href={change.href} className="text-accent inline-flex items-center gap-1 font-medium">
                                {t("relnotes.open")}
                                <ArrowRight size={11} className="rtl:rotate-180" aria-hidden />
                              </Link>
                            ) : null}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {view === "mine" ? (
              <p className="text-fg-subtle mt-4 text-xs">
                {t("relnotes.alsoIn")}{" "}
                <button type="button" className="text-accent font-medium" onClick={() => setView("both")} lang={other}>
                  {other === "ar" ? "العربية" : "English"}
                </button>
              </p>
            ) : null}
          </Section>
        ))}
      </PageBody>
    </>
  );
}
