"use client";

import { useI18n } from "@/lib/i18n";
import {
  Bullet,
  GlowCard,
  JumpList,
  Ordinal,
  PageHero,
  Section,
  SectionHead,
  SpecTag,
  type Accent,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

/** One hue per group, so the three bands of the page are told apart at a
 *  glance rather than by reading their headings. */
const GROUP_ACCENT: Accent[] = ["amber", "emerald", "azure"];
const GROUP_TONE = ["bone", "cream", "wash"] as const;

export default function ModulesPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow={t.modules.eyebrow}
        title={t.modules.title}
        lede={t.modules.lede}
        note={t.modules.pageLede}
        accent="amber"
      >
        <JumpList
          items={t.modules.items.map((m) => ({ id: m.id, label: m.name }))}
        />
      </PageHero>

      {t.modules.groups.map((group, gi) => {
        const items = t.modules.items.filter((m) => m.group === group.id);
        // Keep the global numbering continuous across the three groups.
        const offset = t.modules.items.findIndex((m) => m.group === group.id);
        const accent = GROUP_ACCENT[gi] ?? "amber";

        return (
          <Section key={group.id} accent={accent} tone={GROUP_TONE[gi] ?? "bone"}>
            <SectionHead
              eyebrow={`${String(gi + 1).padStart(2, "0")} — ${group.name}`}
              title={group.name}
              lede={group.note}
            />

            <div className="mt-14 grid gap-6 md:grid-cols-2">
              {items.map((m, i) => (
                <Reveal key={m.id} delay={Math.min(i * 60, 280)}>
                  <GlowCard id={m.id} accent={accent} className="scroll-mt-24 p-7">
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <Ordinal n={offset + i + 1} />
                      <SpecTag id={m.spec} />
                    </div>

                    <h3 className="font-display text-ink text-xl leading-snug font-semibold">
                      {m.name}
                    </h3>

                    <p className="text-a mt-2.5 text-sm leading-relaxed">
                      {m.line}
                    </p>

                    <ul className="mt-6 space-y-3">
                      {m.points.map((p) => (
                        <Bullet key={p}>{p}</Bullet>
                      ))}
                    </ul>
                  </GlowCard>
                </Reveal>
              ))}
            </div>
          </Section>
        );
      })}

      <CtaBand />
    </>
  );
}
