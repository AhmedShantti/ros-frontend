"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import {
  GlowCard,
  JumpList,
  PageHero,
  Section,
  SpecTag,
  type Accent,
} from "@/components/ui";
import { Reveal, useInView } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

const HUES: Accent[] = ["amber", "emerald", "azure", "violet", "rose"];
const TONES = ["bone", "cream", "wash", "bone", "cream"] as const;

/** A numbered flow whose rail draws itself as the steps arrive. */
function Steps({ steps }: { steps: readonly string[] }) {
  const { ref, inView } = useInView<HTMLOListElement>();

  return (
    <ol ref={ref} className="border-ink/10 relative border-s ps-7">
      <span
        aria-hidden
        className={`bg-a absolute top-0 h-full w-px opacity-40 ${
          inView ? "draw-down is-in" : ""
        }`}
        style={{ insetInlineStart: "-1px" }}
      />
      {steps.map((s, i) => (
        <Reveal
          key={s}
          as="li"
          delay={Math.min(i * 45, 380)}
          className="relative pb-5 last:pb-0"
        >
          <span
            aria-hidden
            className="bg-a-wash text-a border-a spec absolute top-0 flex h-6 w-6 items-center justify-center rounded-full border tabular-nums"
            style={{ insetInlineStart: "-2.5rem" }}
          >
            {i + 1}
          </span>
          <p className="text-grey-600 text-sm leading-relaxed">{s}</p>
        </Reveal>
      ))}
    </ol>
  );
}

export default function FlowsPage() {
  const { t } = useI18n();
  const f = t.flows;

  return (
    <>
      <PageHero
        eyebrow={f.eyebrow}
        title={f.title}
        lede={f.lede}
        note={f.pageLede}
        accent="emerald"
      >
        <JumpList
          items={f.items.map((i) => ({ id: i.id, label: i.code }))}
        />
      </PageHero>

      {f.items.map((uc, i) => {
        const accent = HUES[i % HUES.length];
        return (
          <Section
            key={uc.id}
            id={uc.id}
            accent={accent}
            tone={TONES[i % TONES.length]}
          >
            <Reveal>
              <div className="flex flex-wrap items-center gap-3">
                <SpecTag id={uc.code} />
                <SpecTag id={uc.chapter} />
              </div>
              <h2 className="font-display text-ink mt-5 text-[1.6rem] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[2.3rem]">
                {uc.name}
              </h2>
            </Reveal>

            {/* Actor, preconditions, trigger */}
            <Reveal delay={80}>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {[
                  { k: f.labels.actor, v: uc.actor },
                  { k: f.labels.pre, v: uc.pre },
                  { k: f.labels.trigger, v: uc.trigger },
                ].map((c) => (
                  <div
                    key={c.k}
                    className="bg-paper border-ink/10 rounded-xl border p-4"
                  >
                    <p className="spec text-a">{c.k}</p>
                    <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                      {c.v}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>

            <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-14">
              <div>
                <Reveal>
                  <h3 className="spec text-a mb-6">{f.labels.main}</h3>
                </Reveal>
                <Steps steps={uc.steps} />
              </div>

              <div className="space-y-5">
                <Reveal delay={100} kind="right">
                  <GlowCard accent="rose" className="p-6">
                    <p className="spec text-a">
                      {uc.id === "uc-cst-01"
                        ? f.labels.outcomes
                        : f.labels.alt}
                    </p>
                    <ul className="mt-4 space-y-3">
                      {uc.alts.map((a) => (
                        <li
                          key={a}
                          className="text-grey-600 border-a border-s-2 ps-3 text-sm leading-relaxed"
                        >
                          {a}
                        </li>
                      ))}
                    </ul>
                  </GlowCard>
                </Reveal>

                <Reveal delay={150} kind="right">
                  <div className="border-ink/12 rounded-xl border border-dashed p-5">
                    <p className="text-grey-600 text-sm leading-relaxed italic">
                      {uc.note}
                    </p>
                  </div>
                </Reveal>

                <Reveal delay={200} kind="right">
                  <GlowCard accent="emerald" className="p-6">
                    <p className="spec text-a">{f.labels.post}</p>
                    <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                      {uc.post}
                    </p>
                  </GlowCard>
                </Reveal>
              </div>
            </div>
          </Section>
        );
      })}

      {/* The seventh use case lives on the platform page */}
      <Section accent="azure" tone="wash">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-ink text-2xl font-semibold sm:text-3xl">
              {f.outageTitle}
            </h2>
            <p className="text-grey-600 mt-4 text-base leading-relaxed">
              {f.outageText}
            </p>
            <Link
              href="/platform"
              className="text-a link-line mt-6 inline-block text-sm font-medium"
            >
              {f.outageCta}
            </Link>
          </div>
        </Reveal>
      </Section>

      <CtaBand />
    </>
  );
}
