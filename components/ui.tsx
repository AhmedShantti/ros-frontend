"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Reveal, useGlow, useTilt } from "./motion";

/**
 * The accent names survive as an API so that every `accent="violet"`
 * already written across nine pages keeps compiling. They all resolve to
 * the same orange in globals.css — this design has one colour, and the
 * separation that five hues used to provide now comes from inverting a
 * band and from the weight of the display face instead.
 */
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
    <div className={cx("mx-auto w-full max-w-6xl px-6 sm:px-10", className)}>
      {children}
    </div>
  );
}

/**
 * The mark. A small orange arrow that sits in front of every label on
 * the site — eyebrows, list bullets, the wordmark. It is the only piece
 * of ornament in the system, which is what lets it be used everywhere
 * without the page becoming decorated.
 */
export function Arrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 10"
      aria-hidden
      className={cx("h-2 w-4 shrink-0 rtl:-scale-x-100", className)}
      fill="none"
    >
      <path d="M0 8.4 19 1.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.4 0.2 19.4 1 18.2 7.6Z" fill="currentColor" />
    </svg>
  );
}

/* ==================================================================
   Bands
   ------------------------------------------------------------------
   Three grounds, and the rhythm of the page is the order they come in.

     bone   the ordinary dark ground
     wash   a deeper dark, for a band that should sit back
     cream  the inverted plate — near-white, dark type

   `cream` is the one that does the work. A page of unbroken dark goes
   flat no matter how good the type is, and flipping one band per page
   is what stops that happening. Everything inside a `cream` band
   re-reads its colours from `[data-tone="light"]`, so the same card,
   the same table and the same button render on both grounds without a
   single component knowing which one it is standing on.
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
  /** Kept for call-site compatibility; the industrial system has no
   *  background texture, so this now only chooses whether the band
   *  gets a top rule. `false` removes it. */
  ruled?: "dot" | "grid" | false;
}) {
  const light = tone === "cream";

  return (
    <section
      id={id}
      data-accent={accent}
      data-tone={light ? "light" : undefined}
      className={cx(
        "relative py-24 sm:py-32",
        light ? "bg-cream text-ink" : tone === "wash" ? "bg-void" : "bg-bone",
        className,
      )}
      style={id ? { scrollMarginTop: "5rem" } : undefined}
    >
      {ruled ? (
        <span
          aria-hidden
          className="bg-ink/12 pointer-events-none absolute inset-x-0 top-0 h-px"
        />
      ) : null}

      <Container className="relative">{children}</Container>
    </section>
  );
}

/* ==================================================================
   Type
   ================================================================== */

/** The mono label above a heading. Caps, widely tracked, arrow in front. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("spec text-a inline-flex items-center gap-2.5", className)}>
      <Arrow />
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
    <header
      className={cx(
        "max-w-3xl",
        align === "center" && "mx-auto flex flex-col items-center text-center",
      )}
    >
      {eyebrow ? (
        <Reveal>
          <Eyebrow className="mb-6">{eyebrow}</Eyebrow>
        </Reveal>
      ) : null}

      <Reveal delay={60}>
        <h2 className="font-display display-md text-ink text-balance">
          {title}
        </h2>
      </Reveal>

      {lede ? (
        <Reveal delay={120}>
          <p className="text-grey-600 mt-6 max-w-2xl text-base leading-relaxed">
            {lede}
          </p>
        </Reveal>
      ) : null}

      {note ? (
        <Reveal delay={170}>
          <p className="text-grey-500 mt-4 max-w-2xl text-sm leading-relaxed">
            {note}
          </p>
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
        "spec text-a border-a inline-flex items-center border px-2 py-0.5 whitespace-nowrap",
        className,
      )}
    >
      {id}
    </span>
  );
}

/* ==================================================================
   Page hero
   ------------------------------------------------------------------
   Every inner page opens the same way: the label, then the title at
   the size the display face was drawn for, then the argument. No
   ornament above the fold — the type is the ornament.
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
      className="bg-bone text-ink relative overflow-hidden"
    >
      <Container className="relative pt-28 pb-20 sm:pt-36 sm:pb-28">
        <Reveal>
          <Eyebrow className="mb-7">{eyebrow}</Eyebrow>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="font-display display-lg text-ink max-w-[16ch] text-balance">
            {title}
          </h1>
        </Reveal>

        {lede ? (
          <Reveal delay={120}>
            <p className="text-grey-600 mt-8 max-w-2xl text-base leading-relaxed sm:text-lg">
              {lede}
            </p>
          </Reveal>
        ) : null}

        {note ? (
          <Reveal delay={170}>
            <p className="text-grey-500 mt-4 max-w-2xl text-sm leading-relaxed">
              {note}
            </p>
          </Reveal>
        ) : null}

        {children ? <div className="mt-12">{children}</div> : null}
      </Container>

      <span
        aria-hidden
        className="bg-ink/12 pointer-events-none absolute inset-x-0 bottom-0 h-px"
      />
    </section>
  );
}

/* ==================================================================
   Surfaces
   ================================================================== */

/**
 * A card: a square, a hairline, and a surface one step off the ground.
 *
 * The rounding, the drop shadow and the soft glow the light system used
 * are all gone. What is left to signal "this is a distinct object" is
 * the hairline, and what is left to signal "this one is under your
 * cursor" is an orange rule drawn across its top edge.
 */
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
  const tilted = useTilt<HTMLDivElement>(3);
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
        "glow-card border-ink/12 hover:border-a h-full border p-6",
        bar && "card-bar",
        tilt && "tilt",
        className,
      )}
    >
      {children}
    </div>
  );

  return href ? (
    <Link href={href} className="group block h-full">
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
    <dl className="border-ink/12 divide-ink/10 divide-y border-t">
      {rows.map(([k, v], i) => (
        <Reveal
          key={`${k}-${i}`}
          delay={stagger ? Math.min(i * 45, 260) : 0}
          className="hover:bg-ink/4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-4 transition-colors"
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
    <div className="border-ink/12 -mx-6 overflow-x-auto border sm:mx-0">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="sr-only">
          {firstColLabel ?? head.join(", ")}
        </caption>
        <thead>
          <tr className="border-ink/20 bg-ink/5 border-b">
            <th
              scope="col"
              className="spec text-a px-4 py-3.5 text-start font-normal"
            >
              {firstColLabel ?? ""}
            </th>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="font-display text-ink px-4 py-3.5 text-start text-sm"
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
              className="border-ink/10 hover:bg-ink/4 border-b transition-colors last:border-0"
            >
              <th
                scope="row"
                className={cx(
                  "text-ink px-4 text-start align-top font-medium",
                  compact ? "py-3" : "py-4",
                )}
              >
                {row[0]}
              </th>
              {row.slice(1).map((cellValue, ci) => (
                <td
                  key={ci}
                  className={cx(
                    "text-grey-600 px-4 align-top",
                    compact ? "py-3" : "py-4",
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
    <details open={defaultOpen} className="border-ink/12 group border-t">
      <summary className="hover:text-a font-display flex items-center gap-3.5 py-4 text-base transition-colors">
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
      <div className="disclosure-body pb-7">{children}</div>
    </details>
  );
}

/* ==================================================================
   Controls
   ================================================================== */

/**
 * Every button on the site.
 *
 * Four crosshair brackets at the corners and nothing else — no fill and
 * no full outline at rest. On hover the brackets grow to the size of the
 * button and close into a complete rectangle, and the label takes the
 * accent. It reads as instrumentation rather than as a control, which is
 * the register the rest of the site is in.
 *
 * The brackets are symmetric, so nothing here needs mirroring in Arabic.
 *
 * It renders a link or a real `<button>` depending on whether it is
 * given an `href`, so the contact form's submit and the pricing plans
 * use the same component as everything else rather than three
 * hand-maintained copies of the same class string.
 */
export function Button({
  href,
  children,
  variant = "primary",
  className,
  type,
  disabled,
  onClick,
}: {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {(["tl", "tr", "bl", "br"] as const).map((corner) => (
        <span key={corner} aria-hidden data-corner={corner} className="btn-corner" />
      ))}
      <span className="relative">{children}</span>
    </>
  );

  const shared = cx(
    "btn font-display ui-btn transition-colors duration-300",
    className,
  );

  if (href) {
    return (
      <Link href={href} data-variant={variant} className={shared}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type ?? "button"}
      disabled={disabled}
      onClick={onClick}
      data-variant={variant}
      className={cx(shared, "disabled:opacity-60")}
    >
      {inner}
    </button>
  );
}

/** A small square used for capability chips and needs lists. */
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
      className="border-ink/15 text-grey-600 hover:border-a hover:text-a inline-flex items-center border px-3 py-1.5 text-xs leading-relaxed transition-colors"
    >
      {children}
    </span>
  );
}

/** The numbered label that opens each item in a list of many. */
export function Ordinal({ n }: { n: number }) {
  return (
    <span className="spec text-a tabular-nums">
      {String(n).padStart(2, "0")}
    </span>
  );
}

/** Bulleted point. The arrow replaces the dot, and survives RTL. */
export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="text-grey-600 flex gap-3 text-sm leading-relaxed">
      <span className="text-a mt-[0.5em] shrink-0">
        <Arrow />
      </span>
      <span className="flex-1">{children}</span>
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
          className="border-ink/15 text-grey-600 hover:border-a hover:text-a hover:bg-ink/4 border px-3.5 py-2 text-xs transition-colors"
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
      className="border-ink/12 bg-ink/5 text-grey-600 overflow-x-auto border px-4 py-3.5 font-mono text-xs leading-relaxed"
    >
      {children}
    </pre>
  );
}

/* ==================================================================
   Hero backdrop
   ------------------------------------------------------------------
   The design this site is modelled on runs a full-bleed photograph
   behind its hero, under a heavy scrim. There is no photography in
   this repository — no `public/` directory and no image assets — so
   the backdrop is generated instead: a wide industrial rule grid, a
   diagonal hatch over it, and a vignette that drops the edges away so
   the type has somewhere quiet to sit.

   It is deliberately a single component with an `src` prop rather than
   a pile of decorative spans in the page. The day there is a photo to
   use, `<Backdrop src="/hero.jpg" />` is the whole change, and every
   hero on the site picks it up at once.
   ================================================================== */
export function Backdrop({
  src,
  alt = "",
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden={src ? undefined : true}
      className={cx("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          {/* The rule grid: wide, faint, and cropped by the vignette. */}
          <span
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(243,242,242,.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(243,242,242,.055) 1px, transparent 1px)",
              backgroundSize: "88px 88px",
            }}
          />
          {/* A fine diagonal hatch, at an angle the grid never sits at. */}
          <span
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage:
                "repeating-linear-gradient(112deg, rgba(243,242,242,.04) 0 1px, transparent 1px 11px)",
            }}
          />
          {/* One slow wash of the accent, low enough to read as light
              rather than as colour. */}
          <span
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 78% 8%, rgba(255,105,51,.12), transparent 58%)",
            }}
          />
        </>
      )}

      {/* The scrim. Everything above is background; this is what makes
          the type legible on top of it, photograph or not. */}
      <span
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(19,18,17,.72) 0%, rgba(19,18,17,.55) 45%, rgba(27,26,24,.96) 100%)",
        }}
      />
    </div>
  );
}
