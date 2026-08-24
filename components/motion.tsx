"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n";

/* ------------------------------------------------------------------
   Every animation on this site is gated on one question, asked once
   and cached: does this person want motion? Under a reduce preference
   the helpers hand back finished state immediately rather than
   animating to it, so nothing is ever hidden behind an animation that
   will not run.
   ------------------------------------------------------------------ */

export function usePrefersReducedMotion(): boolean {
  // Start "false" so the server-rendered markup matches the first client
  // render; the effect corrects it before paint of the second render.
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduce;
}

/**
 * Fires once when the element first enters the viewport. Used by every
 * scroll-triggered effect on the site so there is only one observer
 * pattern to reason about.
 */
export function useInView<T extends HTMLElement>(
  options: { threshold?: number; rootMargin?: string } = {},
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  // Threshold stays at 0 deliberately. A ratio-based threshold cannot be
  // met by an element taller than the viewport divided by that ratio — a
  // long table at 0.18 would never reach 18% visibility and would stay
  // hidden forever. The negative bottom margin does the "wait until it is
  // properly on screen" job instead, and it works at any element height.
  const { threshold = 0, rootMargin = "0px 0px -12% 0px" } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver (or a very old browser): show everything.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin]);

  return { ref, inView } as const;
}

type RevealKind = "up" | "left" | "right" | "scale" | "blur";

/**
 * The workhorse. Wraps children in an element that slides and fades in
 * the first time it is scrolled to. `delay` staggers a group; keep the
 * total stagger of any one group under ~400ms or the page feels slow
 * rather than considered.
 */
export function Reveal({
  children,
  as: As = "div",
  kind = "up",
  delay = 0,
  className,
  style,
  id,
}: {
  children: ReactNode;
  as?: ElementType;
  kind?: RevealKind;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <As
      ref={ref}
      id={id}
      data-reveal={kind}
      className={`${inView ? "is-in" : ""}${className ? ` ${className}` : ""}`}
      style={{ ...style, ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </As>
  );
}

/**
 * Counts up to a number when scrolled into view. Formatting goes through
 * Intl with the active locale, so the Arabic build gets Arabic-Indic
 * numerals for free (FR-LOC-005).
 */
export function Counter({
  to,
  duration = 1500,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  to: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const { lang } = useI18n();
  const reduce = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(0);

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [lang, decimals],
  );

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setValue(to);
      return;
    }

    let raf = 0;
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) start = now;
      const p = Math.min((now - start) / duration, 1);
      // Ease-out quint: fast off the mark, settles rather than stops.
      setValue(to * (1 - Math.pow(1 - p, 5)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {fmt.format(value)}
      {suffix}
    </span>
  );
}

/**
 * Tracks the pointer inside a card so the CSS `.glow-card` gradient can
 * follow it. Pointer-only: it never runs on touch, where there is no
 * hover to track.
 */
export function useGlow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return { ref, onPointerMove } as const;
}

/**
 * Pointer-tracked 3D tilt, driven through CSS custom properties so the
 * transform stays on the compositor. Combined with `useGlow` on the same
 * element the light and the tilt agree with each other.
 */
export function useTilt<T extends HTMLElement>(max = 5) {
  const ref = useRef<T | null>(null);
  const reduce = usePrefersReducedMotion();

  const onPointerMove = useCallback(
    (e: React.PointerEvent<T>) => {
      if (reduce || e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--ry", `${px * max * 2}deg`);
      el.style.setProperty("--rx", `${-py * max * 2}deg`);
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    [max, reduce],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  }, []);

  return { ref, onPointerMove, onPointerLeave } as const;
}

/**
 * Scroll-linked vertical drift. `speed` is a fraction of the distance the
 * element has travelled through the viewport — 0.15 is a gentle float,
 * 0.4 is obvious. Reads on rAF and writes a transform, nothing else.
 */
export function useParallax<T extends HTMLElement>(speed = 0.18) {
  const ref = useRef<T | null>(null);
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;

    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      // Distance of the element's centre from the viewport's centre.
      const delta = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${(-delta * speed).toFixed(1)}px, 0)`;
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed, reduce]);

  return ref;
}

/**
 * Rotates through a list of words in place. Used once, in the hero — a
 * second one on the same page would be noise rather than emphasis.
 */
export function WordCycle({
  words,
  interval = 2600,
  className,
}: {
  words: readonly string[];
  interval?: number;
  className?: string;
}) {
  const reduce = usePrefersReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce || words.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [reduce, words.length, interval]);

  return (
    // The live region is polite and the whole phrase is re-announced, so a
    // screen reader hears a sentence rather than a stream of single words.
    <span className={className} aria-live="polite">
      <span key={i} className="word-in">
        {words[i]}
      </span>
    </span>
  );
}

/**
 * A seamless horizontal ribbon. The children are rendered twice and the
 * track is translated by exactly half its width, which is what makes the
 * loop invisible.
 */
export function Marquee({
  children,
  duration = 46,
  gap = "3rem",
  className,
}: {
  children: ReactNode;
  duration?: number;
  gap?: string;
  className?: string;
}) {
  return (
    <div
      className={`marquee-mask overflow-hidden${className ? ` ${className}` : ""}`}
    >
      <div
        className="marquee-track"
        style={
          {
            "--marquee-duration": `${duration}s`,
            "--marquee-gap": gap,
          } as CSSProperties
        }
      >
        <div className="flex shrink-0 items-center" style={{ gap }}>
          {children}
        </div>
        <div className="flex shrink-0 items-center" aria-hidden style={{ gap }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A hairline at the bottom of the header showing progress down the page. */
export function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;

    const measure = () => {
      raf = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? doc.scrollTop / scrollable : 0);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="bg-a pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-[left_center] rtl:origin-[right_center]"
      style={{ transform: `scaleX(${progress})` }}
    />
  );
}

/**
 * A bar that grows to its width the first time it is seen. The reference
 * pages use a lot of these, so it is a component rather than a pattern.
 */
export function GrowBar({
  fraction,
  className,
  trackClassName,
}: {
  fraction: number;
  className?: string;
  trackClassName?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`bg-ink/12 h-1.5 w-full overflow-hidden ${trackClassName ?? ""}`}
    >
      <div
        className={`grow-x h-full ${inView ? "is-in" : ""} ${className ?? ""}`}
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
    </div>
  );
}

/* ==================================================================
   Scroll-driven sections
   ------------------------------------------------------------------
   The three devices the industrial layout is built out of. All three
   are driven by one measurement — how far a tall section has travelled
   past the top of the viewport — so they share a single hook and a
   single rAF-throttled scroll listener each.
   ================================================================== */

/**
 * How far a tall section has been scrolled through, as 0 → 1.
 *
 * 0 is "the section's top has just reached the top of the viewport" and
 * 1 is "its bottom is about to leave". The section has to be taller than
 * the viewport for this to have any range, which is the point: these
 * sections buy their scroll distance with height.
 */
export function useSectionProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;

    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      // The travel available is the section's height minus the one
      // viewport of it that is always on screen. A section that is not
      // taller than the viewport has no travel and reads as 0.
      const travel = r.height - window.innerHeight;
      if (travel <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.min(Math.max(-r.top / travel, 0), 1));
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return { ref, progress } as const;
}

/**
 * The pinned statement stack.
 *
 * A section several viewports tall with a sticky frame inside it. As the
 * page scrolls, one very large statement at a time is pushed through
 * that frame, and a hairline underneath fills to show how much of the
 * stack is left. It is the one place on the site where scrolling is
 * spent on a single sentence rather than on more content, so it carries
 * the claims that have to land rather than the ones that have to inform.
 *
 * Under a reduce-motion preference the CSS un-sticks the frame and every
 * statement is simply on the page in order — no pinning, no fading, and
 * no scroll distance spent on an effect that will not run.
 */
export function PinnedStatements({
  items,
  className,
}: {
  items: readonly string[];
  className?: string;
}) {
  const { ref, progress } = useSectionProgress<HTMLDivElement>();
  const reduce = usePrefersReducedMotion();

  // Each statement owns an equal slice of the travel. Nudging by half a
  // slice centres the first one rather than having it already leaving as
  // the section arrives.
  const active = Math.min(
    Math.floor(progress * items.length),
    items.length - 1,
  );

  return (
    <div
      ref={ref}
      className={className}
      style={{ height: `${items.length * 100}svh` }}
    >
      <div className="pinned">
        {items.map((line, i) => (
          <p
            key={line}
            className="statement font-display display-lg text-ink"
            data-state={
              reduce ? "in" : i === active ? "in" : i < active ? "out" : "next"
            }
            aria-hidden={!reduce && i !== active}
          >
            {line}
          </p>
        ))}

        <div
          aria-hidden
          className="pin-track"
          style={{ ["--p" as string]: progress }}
        />
      </div>
    </div>
  );
}

/**
 * Copy that lights up one word at a time as the section is read.
 *
 * The text starts at a quarter-strength grey and each word crosses to
 * full ink as the scroll reaches it. Used once, on the inverted plate,
 * where a long paragraph of method needs a reason to be read to the end.
 *
 * The words are wrapped in spans for the colour, but the sentence is
 * still one text node's worth of content to a screen reader, so nothing
 * is announced word by word.
 */
export function LitText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLParagraphElement>({
    rootMargin: "0px 0px -40% 0px",
  });
  const reduce = usePrefersReducedMotion();
  const words = useMemo(() => text.split(/\s+/), [text]);

  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <span
          key={`${w}-${i}`}
          className="lit-word"
          data-lit={reduce || inView ? "true" : "false"}
          style={{
            transitionDelay: reduce ? "0ms" : `${Math.min(i * 26, 900)}ms`,
          }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
