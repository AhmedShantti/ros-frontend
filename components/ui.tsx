"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Reveal, useGlow, useTilt } from "./motion";

/** The five working hues. A section picks one and everything inherits it. */
export type Accent = "amber" | "emerald" | "azure" | "violet" | "rose";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

/* ==================================================================
   Bands
   ------------------------------------------------------------------
   Three light surfaces: paper, cream, and the section's own colour
   wash. Structure comes from hue rather than from switching the lights
   off, so nothing on this site is dark.
   ================================================================== */
export function Section({
  children,
  tone = "bone",
  accent = "amber",
  id,
  className,
  ruled = "dot",
}: {
  children: ReactNode;
  tone?: "bone" | "cream" | "wash";
  accent?: Accent;
  id?: string;
  className?: string;
  ruled?: "dot" | "grid" | false;
}) {
  return (
    <section
      id={id}
      data-accent={accent}
      className={cx(
        "text-ink relative overflow-hidden py-20 sm:py-28",
        tone === "wash" ? "bg-a-wash" : tone === "cream" ? "bg-cream" : "bg-bone",
        className,
      )}
      style={id ? { scrollMarginTop: "5.5rem" } : undefined}
    >
      {ruled ? (
        <span
          aria-hidden
          className={cx(
            "pointer-events-none absolute inset-0",
            ruled === "grid" ? "grid-rule" : "dot-rule",
          )}
        />
      ) : null}

      <span
        aria-hidden
        className="edge-lit pointer-events-none absolute inset-x-0 top-0 h-px"
      />

      <Container className="relative">{children}</Container>
    </section>
  );
}

/* ==================================================================
   Type
   ================================================================== */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("spec text-a inline-flex items-center gap-2", className)}>
      <span aria-hidden className="bg-a inline-block h-1.5 w-1.5 rounded-full" />
      {children}
    </p>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  note,
  align = "start",
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: string;
  note?: string;
  align?: "start" | "center";
}) {
  return (
    <header className={cx("max-w-3xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? (
        <Reveal>
          <Eyebrow className="mb-5">{eyebrow}</Eyebrow>
        </Reveal>
      ) : null}

      <Reveal delay={60}>
        <h2 className="font-display text-ink text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-[2.6rem]">
          {title}
        </h2>
      </Reveal>

      {lede ? (
        <Reveal delay={120}>
          <p className="text-grey-600 mt-5 text-base leading-relaxed sm:text-lg">
            {lede}
          </p>
        </Reveal>
      ) : null}

      {note ? (
        <Reveal delay={170}>
          <p className="text-grey-500 mt-4 text-sm leading-relaxed">{note}</p>
        </Reveal>
      ) : null}
    </header>
  );
}

/**
 * The structural device of the site: every claim points at the
 * requirement it came from, so nothing is promised that is not
 * specified. The identifier stays in Latin script in both languages —
 * FR-POS-040 is a key, not a word, and translating it would break the
 * trace back to the document.
 */
export function SpecTag({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <span
      dir="ltr"
      className={cx(
        "spec text-a border-a bg-a-wash inline-flex items-center rounded-md border px-1.5 py-0.5 whitespace-nowrap",
        className,
      )}
    >
      {id}
    </span>
  );
}

/* ==================================================================
   Page hero — every inner page opens with the same lit plate.
   ================================================================== */
export function PageHero({
  eyebrow,
  title,
  lede,
  note,
  accent = "amber",
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  note?: string;
  accent?: Accent;
  children?: ReactNode;
}) {
  return (
    <section
      data-accent={accent}
      className="field bg-bone text-ink relative overflow-hidden"
    >
      <span
        aria-hidden
        className="blob blob-a bg-a -top-40 h-[26rem] w-[38rem]"
        style={{ insetInlineStart: "-8rem" }}
      />
      <span
        aria-hidden
        className="blob blob-b bg-violet -top-24 h-[22rem] w-[30rem] opacity-30"
        style={{ insetInlineEnd: "-6rem" }}
      />
      <span
        aria-hidden
        className="grid-rule pointer-events-none absolute inset-0"
      />

      <Container className="relative py-20 sm:py-28">
        <Reveal>
          <Eyebrow className="mb-5">{eyebrow}</Eyebrow>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="font-display text-ink max-w-4xl text-[2rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance sm:text-[3.4rem]">
            {title}
          </h1>
        </Reveal>

        {lede ? (
          <Reveal delay={120}>
            <p className="text-grey-600 mt-6 max-w-3xl text-base leading-relaxed sm:text-lg">
              {lede}
            </p>
          </Reveal>
        ) : null}

        {note ? (
          <Reveal delay={170}>
            <p className="text-grey-500 mt-4 max-w-3xl text-sm leading-relaxed">
              {note}
            </p>
          </Reveal>
        ) : null}

        {children ? <div className="mt-10">{children}</div> : null}
      </Container>
    </section>
  );
}

/* ==================================================================
   Surfaces
   ================================================================== */

/** A panel that lifts, lights up and tilts fractionally under the cursor. */
export function GlowCard({
  children,
  className,
  href,
  style,
  id,
  accent,
  bar = true,
  tilt = false,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
  style?: CSSProperties;
  id?: string;
  accent?: Accent;
  bar?: boolean;
  tilt?: boolean;
}) {
  const glow = useGlow<HTMLDivElement>();
  const tilted = useTilt<HTMLDivElement>(4);
  const h = tilt ? tilted : glow;

  const body = (
    <div
      ref={h.ref}
      id={id}
      data-accent={accent}
      onPointerMove={h.onPointerMove}
      onPointerLeave={tilt ? tilted.onPointerLeave : undefined}
      style={style}
      className={cx(
        "glow-card border-ink/8 bg-paper hover:border-a hover:shadow-md shadow-2xs h-full overflow-hidden rounded-2xl border p-6",
        bar && "card-bar",
        tilt && "tilt",
        className,
      )}
    >
      {children}
    </div>
  );

  return href ? (
    <Link href={href} className="group block h-full rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ==================================================================
   Data
   ================================================================== */

/** Two-column fact list. The value column is mono so figures line up. */
export function FactRows({
  rows,
  stagger = true,
}: {
  rows: readonly (readonly string[])[];
  stagger?: boolean;
}) {
  return (
    <dl className="border-ink/10 divide-ink/8 divide-y border-t">
      {rows.map(([k, v], i) => (
        <Reveal
          key={`${k}-${i}`}
          delay={stagger ? Math.min(i * 45, 260) : 0}
          className="hover:bg-a-wash/60 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-3.5 transition-colors"
        >
          <dt className="text-grey-600 text-sm leading-relaxed">{k}</dt>
          <dd className="text-a font-mono text-sm tabular-nums">{v}</dd>
        </Reveal>
      ))}
    </dl>
  );
}

/** A responsive matrix. Wide tables scroll inside their own container. */
export function DataTable({
  head,
  rows,
  firstColLabel,
  renderCell,
  compact = false,
}: {
  head: readonly string[];
  rows: readonly (readonly string[])[];
  firstColLabel?: string;
  renderCell?: (value: string) => ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="border-ink/10 bg-paper -mx-5 overflow-x-auto rounded-xl border px-0 sm:mx-0">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="sr-only">
          {firstColLabel ?? head.join(", ")}
        </caption>
        <thead>
          <tr className="border-ink/15 bg-a-wash border-b">
            <th
              scope="col"
              className="spec text-a px-4 py-3 text-start font-normal"
            >
              {firstColLabel ?? ""}
            </th>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="font-display text-ink px-4 py-3 text-start text-sm font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={`${row[0]}-${ri}`}
              className="border-ink/8 hover:bg-a-wash/50 border-b transition-colors last:border-0"
            >
              <th
                scope="row"
                className={cx(
                  "text-ink px-4 text-start align-top font-medium",
                  compact ? "py-2.5" : "py-3.5",
                )}
              >
                {row[0]}
              </th>
              {row.slice(1).map((cellValue, ci) => (
                <td
                  key={ci}
                  className={cx(
                    "text-grey-600 px-4 align-top",
                    compact ? "py-2.5" : "py-3.5",
                  )}
                >
                  {renderCell ? renderCell(cellValue) : cellValue}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A collapsible reference block. The module pages carry a lot of detail
 * from the specification that would drown the page if it were always
 * open, so it lives behind a disclosure that animates as it expands.
 */
export function Disclosure({
  label,
  count,
  children,
  defaultOpen = false,
}: {
  label: string;
  count?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="border-ink/10 group border-t">
      <summary className="hover:text-a flex items-center gap-3 py-3.5 text-sm font-medium transition-colors">
        <span
          aria-hidden
          className="chev text-a inline-block text-xs rtl:-scale-x-100"
        >
          ▸
        </span>
        <span className="flex-1 text-start">{label}</span>
        {count ? (
          <span className="spec text-grey-400 tabular-nums">{count}</span>
        ) : null}
      </summary>
      <div className="disclosure-body pb-6">{children}</div>
    </details>
  );
}

/* ==================================================================
   Controls
   ================================================================== */
export function Button({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const skin =
    variant === "primary"
      ? "bg-ink text-bone hover:bg-a-deep shadow-md"
      : "border-ink/20 text-ink hover:border-a hover:text-a border";

  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5",
        skin,
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A small pill used for capability chips and needs lists. */
export function Chip({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: Accent;
}) {
  return (
    <span
      data-accent={accent}
      className="border-ink/12 text-grey-600 hover:border-a hover:bg-a-wash hover:text-a inline-flex items-center rounded-full border px-3 py-1 text-xs leading-relaxed transition-colors"
    >
      {children}
    </span>
  );
}

/** The numbered rule that opens each item in a list of many. */
export function Ordinal({ n }: { n: number }) {
  return (
    <span className="spec text-a bg-a-wash inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 tabular-nums">
      {String(n).padStart(2, "0")}
    </span>
  );
}

/** Bulleted point with an accent marker that survives RTL. */
export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="text-grey-600 relative ps-5 text-sm leading-relaxed">
      <span
        aria-hidden
        className="bg-a absolute top-[0.6rem] h-1.5 w-1.5 rounded-full"
        style={{ insetInlineStart: 0 }}
      />
      {children}
    </li>
  );
}

/**
 * A jump list for the long reference pages. Seventeen modules or nine
 * chapters need a way in that is not "scroll and hope".
 */
export function JumpList({
  items,
}: {
  items: readonly { id: string; label: string }[];
}) {
  return (
    <nav className="flex flex-wrap gap-2">
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className="border-ink/12 text-grey-600 hover:border-a hover:bg-a-wash hover:text-a rounded-full border px-3 py-1.5 text-xs transition-colors"
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** A formula or code fragment quoted from the specification. */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <pre
      dir="ltr"
      className="border-ink/10 bg-cream text-grey-700 overflow-x-auto rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed"
    >
      {children}
    </pre>
  );
}
