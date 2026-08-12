"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SpecTag, cx, type Accent } from "./ui";
import { usePrefersReducedMotion } from "./motion";

/** Perforated bottom edge, the way a real docket tears off the printer. */
const ZIGZAG =
  "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 13px 100% repeat-x";

/**
 * Each of the nine effects wears the hue of the module it lands in, so
 * the cascade reads as nine different parts of the business lighting up
 * rather than one list scrolling past.
 */
const HUES: Accent[] = [
  "amber",
  "rose",
  "emerald",
  "amber",
  "emerald",
  "azure",
  "violet",
  "violet",
  "rose",
];

/**
 * The signature element of the site: one docket on one side, and the nine
 * records the same sale produced everywhere else on the other. This is
 * SRS §1.2 made visible — the one argument the product rests on.
 */
export function SaleCascade() {
  const { t } = useI18n();
  const total = t.hero.effects.length;
  const reduce = usePrefersReducedMotion();

  const [revealed, setRevealed] = useState(0);
  const [runId, setRunId] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (reduce) {
      setRevealed(total + 1);
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;

    const run = () => {
      setRevealed(0);
      timer = setInterval(() => {
        setRevealed((n) => {
          if (n >= total + 1) {
            if (timer) clearInterval(timer);
            return n;
          }
          return n + 1;
        });
      }, 300);
    };

    // A replay press runs immediately; the first run waits for the scroll.
    if (runId > 0) {
      run();
      return () => {
        if (timer) clearInterval(timer);
      };
    }

    const el = rootRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started.current) {
          started.current = true;
          run();
        }
      },
      { threshold: 0.15 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [runId, total, reduce]);

  const d = t.hero.docket;
  const done = revealed > total;

  return (
    <div
      ref={rootRef}
      className="grid gap-10 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-14"
    >
      {/* The docket */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="relative mx-auto max-w-[320px]">
          <div
            className="bg-paper text-ink px-6 pt-6 pb-8 shadow-xl"
            style={{ mask: ZIGZAG, WebkitMask: ZIGZAG }}
          >
            <div className="text-center">
              <p className="font-display text-lg font-semibold">{d.title}</p>
              <p className="spec text-grey-500 mt-1.5" dir="ltr">
                {d.order}
              </p>
              <p className="text-grey-500 mt-1 text-xs">{d.type}</p>
            </div>

            <div className="border-ink/20 my-4 border-t border-dashed" />

            <ul className="space-y-2 text-sm">
              {d.lines.map((line) => (
                <li key={line.name} className="flex items-baseline gap-2">
                  <span className="flex-1">{line.name}</span>
                  <span className="text-grey-500 font-mono text-xs">
                    {line.qty}
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {line.price}
                  </span>
                </li>
              ))}
            </ul>

            <div className="border-ink/20 my-4 border-t border-dashed" />

            <div className="flex items-end justify-between">
              <span className="spec text-grey-500">{d.totalLabel}</span>
              <span className="font-display flex items-baseline gap-1 text-3xl font-semibold">
                {d.total}
                <span className="text-grey-500 text-xs font-normal">
                  {d.currency}
                </span>
              </span>
            </div>

            <p className="text-grey-500 mt-5 text-center text-[0.7rem]">
              {d.cashier}
            </p>
          </div>

          <span
            className="border-rose-deep text-rose-deep bg-rose-wash absolute -top-3 rotate-[-9deg] rounded border-2 px-2 py-1 text-[0.62rem] font-bold tracking-wider"
            style={{ insetInlineEnd: "-0.75rem" }}
          >
            {d.offline}
          </span>
        </div>
      </div>

      {/* The nine effects */}
      <div>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-ink text-xl font-semibold sm:text-2xl">
              {t.hero.effectsTitle}
            </h2>
            <p className="text-grey-500 mt-1.5 text-sm">{t.hero.effectsHint}</p>
          </div>
          <button
            type="button"
            onClick={() => setRunId((n) => n + 1)}
            className="border-ink/15 text-grey-600 hover:border-amber hover:text-amber-deep rounded-full border px-3.5 py-1.5 text-xs transition-colors"
          >
            {t.ui.replay}
          </button>
        </div>

        <ol className="border-ink/10 relative border-s ps-6">
          {/* The travelling light that marks how far the cascade has run. */}
          <span
            aria-hidden
            className="from-amber via-rose to-violet absolute top-0 w-px bg-linear-to-b transition-[height] duration-500 ease-out"
            style={{
              insetInlineStart: "-1px",
              height: `${Math.min(revealed / (total + 1), 1) * 100}%`,
            }}
          />

          {t.hero.effects.map((e, i) => {
            const on = revealed > i;
            return (
              <li
                key={e.module}
                data-accent={HUES[i] ?? "amber"}
                className={cx(
                  "relative py-3.5 transition-all duration-500",
                  on ? "opacity-100" : "opacity-25",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "absolute top-[1.45rem] h-2.5 w-2.5 rounded-full transition-all duration-500",
                    on ? "bg-a scale-100" : "bg-ink/15 scale-75",
                  )}
                  style={{ insetInlineStart: "-1.32rem" }}
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="spec text-a">{e.module}</span>
                  <SpecTag id={e.spec} />
                </div>
                <p className="text-grey-600 mt-1.5 text-sm leading-relaxed sm:text-base">
                  {e.text}
                </p>
              </li>
            );
          })}
        </ol>

        <div
          data-accent="amber"
          className={cx(
            "border-a bg-a-wash mt-7 rounded-xl border p-5 transition-all duration-700",
            done ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="spec text-a">{t.hero.alert.label}</span>
            <SpecTag id={t.hero.alert.spec} />
          </div>
          <p className="text-ink mt-1.5 text-base">{t.hero.alert.text}</p>
        </div>
      </div>
    </div>
  );
}
