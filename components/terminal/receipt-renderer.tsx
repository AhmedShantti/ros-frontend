"use client";

/**
 * The one receipt renderer — FR-POS-101 / FR-POS-102.
 *
 * Every receipt the app shows goes through here: the POS payment receipt, the
 * receipt drawer, the editor's live preview, and — later — reprint, printing
 * and digital delivery. A caller describes the sale as a language-neutral
 * `ReceiptDocument`, hands over the template (`ReceiptTemplateContent`) and
 * this component decides everything a template controls:
 *
 *  - the language(s) every label prints in (`ar`, `en`, or both in the
 *    stated order) — NEVER the console's UI language;
 *  - the logo, the header lines and the footer lines;
 *  - which details print (brand name, branch, address, order type, table,
 *    guests, cashier), suggested tips and the signature lines;
 *  - the look of the paper: `classic` (a serif restaurant check) or
 *    `thermal` (the monospaced till roll);
 *  - the reading direction, which follows the first printed language.
 *
 * What it deliberately does not own: fiscal content (tax registration,
 * invoice numbers, QR — FR-POS-100). Callers pass that through the `fiscal`,
 * `banner` and `closing` slots and it is printed exactly as given. No option
 * can hide the totals, the tax lines or those slots.
 *
 * Money and dates arrive already formatted: that is display formatting, not
 * language, and it stays with the caller's own formatter.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  columnsFor,
  documentDirection,
  localisedLabel,
  optionsOf,
  printLanguages,
  printedTexts,
  type PaperWidth,
  type ReceiptDocument,
  type ReceiptLanguage,
  type ReceiptMetaKey,
  type ReceiptMetaRow,
  type ReceiptOptions,
  type ReceiptTemplateContent,
} from "@/lib/console/receipt";
import type { Localised } from "@/lib/console/types";
import { cx } from "@/components/console/ui";

export interface ReceiptRendererProps {
  document: ReceiptDocument;
  template: ReceiptTemplateContent;
  /** Caller-owned block above everything (a DUPLICATE banner, say). */
  banner?: ReactNode;
  /** Caller-owned fiscal identity, printed right under the heading. */
  fiscal?: ReactNode;
  /** Caller-owned block after the template's footer (fiscal provider line, QR…). */
  closing?: ReactNode;
  /**
   * Draw the receipt as paper of this width — the editor's preview. Unset
   * for the till, where the receipt fills its container.
   */
  paper?: PaperWidth;
  className?: string;
  /**
   * Caption over the back page on screen (never printed). The renderer is
   * language-neutral and has no dictionary of its own, so the caller names it.
   */
  backCaption?: string;
}

/** `value` in each printed language, each on its own line. */
function Lines({
  value,
  languages,
  className,
  subClassName,
}: {
  value: Localised;
  languages: readonly ReceiptLanguage[];
  className?: string;
  /** Applied to every language after the first. */
  subClassName?: string;
}) {
  return (
    <>
      {printedTexts(value, languages).map((entry, index) => (
        <span
          key={entry.language}
          lang={entry.language}
          dir={entry.dir}
          className={cx("block break-words", className, index > 0 && subClassName)}
        >
          {entry.text}
        </span>
      ))}
    </>
  );
}

/** `value` on ONE line, its languages joined — for a label sitting beside its value. */
function plain(value: string | Localised | null | undefined, languages: readonly ReceiptLanguage[]): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return printedTexts(value, languages)
    .map((entry) => entry.text)
    .join(" / ");
}

/** The details a template may hide, keyed by the meta row they control. */
const HIDEABLE: Partial<Record<ReceiptMetaKey, keyof ReceiptOptions>> = {
  orderType: "showOrderType",
  table: "showTable",
  guests: "showGuests",
  cashier: "showCashier",
};

const shown = (row: ReceiptMetaRow, options: ReceiptOptions): boolean => {
  const option = row.key ? HIDEABLE[row.key] : undefined;
  return option ? Boolean(options[option]) : true;
};

/** A logo that cannot load is dropped rather than printed as a broken icon. */
function Logo({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // The URL is the operator's own https link; next/image would need it allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      data-testid="receipt-logo"
      referrerPolicy="no-referrer"
      className={cx("mx-auto mb-2 max-h-20 max-w-full object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Paper carries its own ink. The text inside uses the console's colour
 * tokens, which turn light in the dark theme — light grey on white is
 * unreadable — so a receipt drawn as paper overrides them.
 */
const THERMAL_PAPER_COLOURS = {
  "--color-fg": "#111111",
  "--color-fg-muted": "#444444",
  "--color-fg-subtle": "#6b6b6b",
  "--color-line": "#c9c9c9",
  "--color-bad": "#b42318",
} as const;

const CLASSIC_PAPER_COLOURS = {
  "--color-fg": "#1d1d1b",
  "--color-fg-muted": "#55554f",
  "--color-fg-subtle": "#77776f",
  "--color-line": "#d2d0c8",
  "--color-bad": "#b42318",
} as const;

const CLASSIC_PAPER = "#fbfaf7";
const CLASSIC_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, "Times New Roman", serif';

/** The back page's grid: logos in staggered rows, so the pattern reads as wallpaper. */
const BACK_COLUMNS = 5;
const BACK_ROWS = 9;

/**
 * The back of a double-sided receipt: the logo repeated over the whole page,
 * in rows that alternate half a logo sideways and run off both edges, like
 * wrapping paper. Real images, not a CSS background — browsers leave
 * backgrounds out of a print unless told otherwise, and the point of this page
 * is that it prints. On paper it starts a new sheet (`break-before: page`); a
 * logo that cannot load drops the whole page rather than printing a grid of
 * broken icons.
 */
export function ReceiptBackPage({
  logoUrl,
  paper,
  caption,
  className,
  classic,
  height,
}: {
  logoUrl: string;
  /** Height of the front, so both sides are the same size. */
  height?: number;
  paper?: PaperWidth;
  caption?: string;
  className?: string;
  /** Match the classic paper (off-white, sized in millimetres). */
  classic?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const width = classic
    ? paper
      ? `${paper}mm`
      : undefined
    : paper
      ? `calc(${columnsFor(paper)}ch + 2rem)`
      : undefined;
  const tile = 100 / BACK_COLUMNS;
  return (
    <div className={cx("break-before-page", className)} data-testid="receipt-back-wrap">
      {caption ? <p className="text-fg-subtle mt-3 mb-1 text-center text-xs print:hidden">{caption}</p> : null}
      <div
        data-testid="receipt-back"
        aria-hidden="true"
        className={cx(
          "border-line mx-auto flex flex-col justify-between overflow-hidden rounded-xl border py-2 print:rounded-none print:border-0",
          classic ? "max-w-[24rem]" : null,
          paper || classic ? null : "bg-sunken",
        )}
        style={{
          ...(classic ? { backgroundColor: CLASSIC_PAPER } : paper ? { backgroundColor: "#ffffff" } : {}),
          ...(width ? { width, maxWidth: "100%" } : {}),
          ...(height ? { height: `${height}px` } : {}),
        }}
      >
        {Array.from({ length: BACK_ROWS }, (_, row) => {
          const offset = row % 2 === 1;
          // An offset row starts half a logo in, so it needs one more to reach the far edge.
          const count = offset ? BACK_COLUMNS + 1 : BACK_COLUMNS;
          return (
            <div
              key={row}
              className="flex"
              style={{ marginInlineStart: offset ? `-${tile / 2}%` : undefined, paddingBlock: "0.4rem" }}
            >
              {Array.from({ length: count }, (_, column) => (
                <div
                  key={column}
                  className="flex shrink-0 items-center justify-center p-1"
                  style={{ width: `${tile}%` }}
                >
                  {/* The operator's own https link; see `Logo`. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt=""
                    data-testid="receipt-back-logo"
                    referrerPolicy="no-referrer"
                    className="max-h-12 max-w-full object-contain"
                    onError={row === 0 && column === 0 ? () => setFailed(true) : undefined}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces of the two papers
// ---------------------------------------------------------------------------

/** The "Tip ____ / Total ____ / Signature ____" write-in lines of a card slip. */
function WriteIn({ languages, classic }: { languages: readonly ReceiptLanguage[]; classic: boolean }) {
  const label = localisedLabel;
  const rows: Localised[] = [label("pos.tip"), label("pos.total"), label("rcpt.print.signature")];
  return (
    <div data-testid="receipt-signature" className={cx("mt-3 space-y-3", classic ? "text-[0.8rem]" : "text-xs")}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-3">
          <span className="text-fg-muted min-w-16 shrink-0">
            <Lines value={row} languages={languages} />
          </span>
          <span aria-hidden className="border-fg-subtle h-5 flex-1 border-b" />
        </div>
      ))}
    </div>
  );
}

/** "Suggested gratuity — 18% 28.26 · 20% 31.40". */
function SuggestedTips({
  percents,
  amount,
  languages,
}: {
  percents: readonly number[];
  amount: (percent: number) => string;
  languages: readonly ReceiptLanguage[];
}) {
  return (
    <p data-testid="receipt-tips" className="text-fg-subtle mt-3 text-[0.72rem] leading-relaxed italic">
      <Lines value={localisedLabel("rcpt.print.suggestedTip")} languages={languages} />
      <span dir="ltr" className="block">
        {percents.map((percent) => `${percent}% ${amount(percent)}`).join(" · ")}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export function ReceiptRenderer({
  document: receipt,
  template,
  banner,
  fiscal,
  closing,
  paper,
  className,
  backCaption,
}: ReceiptRendererProps) {
  const languages = printLanguages(template);
  const dir = documentDirection(languages);
  const options = optionsOf(template);
  const frontRef = useRef<HTMLDivElement>(null);
  const [frontHeight, setFrontHeight] = useState<number | undefined>();
  useEffect(() => {
    const el = frontRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFrontHeight(Math.round(el.getBoundingClientRect().height) || undefined);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const classic = options.paperStyle === "classic";
  const showBack = template.backSide === "logo_pattern" && Boolean(template.logoUrl);

  const meta = receipt.meta.filter((row) => shown(row, options));
  const brand = options.showBrandName ? (receipt.heading.brand ?? null) : null;
  const branch = options.showBranchName ? receipt.heading.name : null;
  const address = options.showBranchAddress ? receipt.heading.address : null;
  const tips =
    options.suggestedTips.length > 0 && receipt.tipAmount ? (
      <SuggestedTips percents={options.suggestedTips} amount={receipt.tipAmount} languages={languages} />
    ) : null;
  const writeIn = options.signatureLine ? <WriteIn languages={languages} classic={classic} /> : null;

  const valueOf = (value: string | Localised | null | undefined): ReactNode =>
    value == null || typeof value === "string" ? (
      (value ?? "")
    ) : (
      <Lines value={value} languages={languages} subClassName="text-fg-subtle" />
    );

  const common = {
    "data-testid": "receipt",
    "data-receipt-mode": template.languageMode,
    "data-receipt-languages": languages.join(","),
    "data-receipt-style": options.paperStyle,
    dir,
  } as const;

  const front = classic ? (
    <div
      {...common}
      className={cx(
        "relative mx-auto w-full max-w-[24rem] rounded-sm p-6 text-[0.8rem] shadow-md print:max-w-none print:shadow-none",
        paper === 58 && "p-4",
        className,
      )}
      style={
        {
          ...CLASSIC_PAPER_COLOURS,
          backgroundColor: CLASSIC_PAPER,
          color: "var(--color-fg)",
          fontFamily: CLASSIC_FONT,
          ...(paper ? { width: `${paper}mm`, maxWidth: "100%" } : {}),
        } as CSSProperties
      }
    >
      {banner}
      {template.logoUrl ? <Logo src={template.logoUrl} className="mb-3 max-h-16" /> : null}

      <div className="text-center" data-testid="receipt-heading">
        {brand ? (
          <Lines value={brand} languages={languages} className="text-fg text-[1.55rem] leading-tight font-bold" />
        ) : null}
        {branch ? (
          <Lines
            value={branch}
            languages={languages}
            className={brand ? "text-fg-muted mt-0.5 text-[0.8rem]" : "text-fg text-[1.55rem] leading-tight font-bold"}
          />
        ) : null}
      </div>

      {template.headerLines.length > 0 || address ? (
        <div className="mt-1.5 space-y-0.5 text-center" data-testid="receipt-header">
          {template.headerLines.slice(0, 1).map((line, index) => (
            <p key={`h-${index}`} className="text-fg-muted italic">
              <Lines value={line} languages={languages} />
            </p>
          ))}
          {address ? <p className="text-fg-muted mt-1">{address}</p> : null}
          {template.headerLines.slice(1).map((line, index) => (
            <p key={index} className="text-fg-muted">
              <Lines value={line} languages={languages} />
            </p>
          ))}
        </div>
      ) : null}
      {fiscal ? <div className="text-center">{fiscal}</div> : null}

      <div className="border-fg mt-4 border-t-2" role="separator" />
      <div data-testid="receipt-meta" className="py-1.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {meta
            .filter((row) => row.key !== "reference")
            .map((row, index) => (
              <div key={index} className={cx("min-w-0 break-words", index % 2 === 1 && "text-end")}>
                <span className="text-fg-muted">{plain(row.label, languages)}</span>{" "}
                <span dir="auto" className="text-fg font-medium">
                  {valueOf(row.value)}
                </span>
              </div>
            ))}
        </div>
        {/* The permanent order reference is a long id: a line of its own, small. */}
        {meta
          .filter((row) => row.key === "reference")
          .map((row, index) => (
            <p key={index} className="text-fg-subtle mt-1 text-[0.65rem] break-all">
              {plain(row.label, languages)} <span dir="ltr">{valueOf(row.value)}</span>
            </p>
          ))}
      </div>
      <div className="border-fg-subtle border-t" role="separator" />

      <div data-testid="receipt-items" className="space-y-2.5 py-3">
        {receipt.items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2">
            <span className="text-fg-muted tabular-nums">{item.quantity}</span>
            <span className="text-fg min-w-0">
              <Lines value={item.name} languages={languages} subClassName="text-fg-subtle" />
              {item.modifiers.map((modifier, at) => (
                <span key={at} className="text-fg-subtle block text-[0.72rem] italic">
                  <Lines
                    value={{
                      en: `${modifier.sign} ${modifier.name.en}${modifier.amount ? ` ${modifier.amount}` : ""}`,
                      ar: `${modifier.sign} ${modifier.name.ar}${modifier.amount ? ` ${modifier.amount}` : ""}`,
                    }}
                    languages={languages}
                  />
                </span>
              ))}
              {item.quantity > 1 && item.unitPrice ? (
                <span dir="ltr" className="text-fg-subtle block text-[0.72rem] italic">
                  @ {item.unitPrice}
                </span>
              ) : null}
            </span>
            <span dir="auto" className="text-fg text-end tabular-nums">
              {item.total}
            </span>
          </div>
        ))}
      </div>

      <div className="border-fg-subtle border-t" role="separator" />
      <div data-testid="receipt-totals" className="pt-2">
        {receipt.totals.map((row, index) =>
          row.emphasis ? (
            <div key={index} className="border-fg mt-2 flex items-baseline justify-between gap-3 border-t-2 pt-2">
              <span className="text-fg text-[1.4rem] leading-none font-bold">
                <Lines value={row.label} languages={languages} subClassName="text-fg-subtle text-[0.8rem] font-normal" />
              </span>
              <span dir="auto" className="text-fg text-[1.4rem] leading-none font-bold tabular-nums">
                {row.value}
              </span>
            </div>
          ) : (
            <div
              key={index}
              className={cx(
                "flex items-start justify-between gap-3 py-px",
                row.sub && "text-fg-subtle ps-3 text-[0.72rem]",
              )}
            >
              <span className={cx("min-w-0", !row.sub && "text-fg")}>
                <Lines value={row.label} languages={languages} subClassName="text-fg-subtle" />
              </span>
              <span dir="auto" className={cx("shrink-0 tabular-nums", row.negative && "text-bad")}>
                {row.value}
              </span>
            </div>
          ),
        )}
      </div>

      {tips}
      {writeIn}

      {receipt.payments.length > 0 ? (
        <div data-testid="receipt-payments" className="text-fg-muted mt-3 space-y-0.5">
          {receipt.payments.map((row, index) => (
            <div key={index} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <Lines value={row.label} languages={languages} subClassName="text-fg-subtle" />
              </span>
              <span dir="auto" className="text-fg shrink-0 tabular-nums">
                {valueOf(row.value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {template.footerLines.length > 0 ? (
        <div className="mt-5 space-y-0.5 text-center" data-testid="receipt-footer">
          {template.footerLines.map((line, index) => (
            <p key={index} className={index === 0 ? "text-fg text-[1.05rem] italic" : "text-fg-subtle text-[0.72rem]"}>
              <Lines value={line} languages={languages} />
            </p>
          ))}
        </div>
      ) : null}

      {closing}

      {receipt.notice ? (
        <p className="text-fg-subtle mt-3 text-center text-[0.65rem]" data-testid="receipt-notice">
          <Lines value={receipt.notice} languages={languages} />
        </p>
      ) : null}

      {/* The torn edge — decoration only, never printed. */}
      <div
        aria-hidden
        data-testid="receipt-tear"
        className="border-line -mx-6 mt-5 -mb-6 h-3 border-t-2 border-dotted print:hidden"
        style={{ backgroundColor: "#f1efe9" }}
      />
    </div>
  ) : (
    <div
      {...common}
      className={cx(
        "border-line relative rounded-xl border p-4 font-mono text-xs",
        paper ? "mx-auto bg-white text-black shadow-md" : "bg-sunken",
        className,
      )}
      style={
        paper
          ? ({
              ...THERMAL_PAPER_COLOURS,
              width: `calc(${columnsFor(paper)}ch + 2rem)`,
              maxWidth: "100%",
            } as CSSProperties)
          : undefined
      }
    >
      {banner}
      {template.logoUrl ? <Logo src={template.logoUrl} /> : null}

      <div className="text-center" data-testid="receipt-heading">
        {brand ? <Lines value={brand} languages={languages} className="text-fg text-sm font-bold" /> : null}
        {branch ? (
          <Lines
            value={branch}
            languages={languages}
            className={brand ? "text-fg-muted" : "text-fg text-sm font-bold"}
          />
        ) : null}
        {address ? <p className="text-fg-muted">{address}</p> : null}
        {fiscal}
      </div>

      {template.headerLines.length > 0 ? (
        <div className="mt-2 space-y-0.5 text-center" data-testid="receipt-header">
          {template.headerLines.map((line, index) => (
            <p key={index} className="text-fg-muted">
              <Lines value={line} languages={languages} />
            </p>
          ))}
        </div>
      ) : null}

      <div className="border-line my-2 border-t border-dashed" role="separator" />
      <div data-testid="receipt-meta">
        {meta.map((row, index) => (
          <ThermalRow key={index} label={row.label} value={valueOf(row.value)} languages={languages} />
        ))}
      </div>

      <div className="border-line my-2 border-t border-dashed" role="separator" />
      <div data-testid="receipt-items">
        {receipt.items.map((item, index) => (
          <div key={index} className="mb-1">
            <div className="flex items-start justify-between gap-3">
              <span className="text-fg min-w-0">
                <span className="tabular-nums">{item.quantity} × </span>
                <Lines
                  value={item.name}
                  languages={languages}
                  className="inline"
                  subClassName="!block text-fg-subtle"
                />
              </span>
              <span dir="auto" className="text-fg shrink-0 tabular-nums">
                {item.total}
              </span>
            </div>
            {item.modifiers.map((modifier, at) => (
              <div key={at} className="text-fg-subtle flex justify-between gap-3 ps-3">
                <span className="min-w-0">
                  <Lines
                    value={{
                      en: `${modifier.sign} ${modifier.name.en}`,
                      ar: `${modifier.sign} ${modifier.name.ar}`,
                    }}
                    languages={languages}
                  />
                </span>
                {modifier.amount ? (
                  <span dir="auto" className="shrink-0 tabular-nums">
                    {modifier.amount}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="border-line my-2 border-t border-dashed" role="separator" />
      <div data-testid="receipt-totals">
        {receipt.totals.map((row, index) => (
          <ThermalRow
            key={index}
            label={row.label}
            value={row.value}
            languages={languages}
            strong={row.emphasis}
            sub={row.sub}
            negative={row.negative}
          />
        ))}
      </div>

      {tips}
      {writeIn}

      {receipt.payments.length > 0 ? (
        <>
          <div className="border-line my-2 border-t border-dashed" role="separator" />
          <div>
            {receipt.payments.map((row, index) => (
              <ThermalRow key={index} label={row.label} value={valueOf(row.value)} languages={languages} />
            ))}
          </div>
        </>
      ) : null}

      {template.footerLines.length > 0 ? (
        <>
          <div className="border-line my-2 border-t border-dashed" role="separator" />
          <div className="space-y-0.5 text-center" data-testid="receipt-footer">
            {template.footerLines.map((line, index) => (
              <p key={index} className="text-fg-subtle leading-relaxed">
                <Lines value={line} languages={languages} />
              </p>
            ))}
          </div>
        </>
      ) : null}

      {closing}

      {receipt.notice ? (
        <p className="text-fg-subtle mt-3 text-center text-[0.65rem]" data-testid="receipt-notice">
          <Lines value={receipt.notice} languages={languages} />
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <div ref={frontRef}>{front}</div>
      {showBack ? (
        <ReceiptBackPage
          logoUrl={template.logoUrl!}
          paper={paper}
          caption={backCaption}
          classic={classic}
          height={frontHeight}
        />
      ) : null}
    </>
  );
}

/** A label on the left and its value on the right — the till roll's row. */
function ThermalRow({
  label,
  value,
  languages,
  strong,
  sub,
  negative,
}: {
  label: Localised;
  value: ReactNode;
  languages: readonly ReceiptLanguage[];
  strong?: boolean;
  sub?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-3",
        strong && "text-fg mt-1 border-t pt-1 text-sm font-bold",
        sub && "text-fg-subtle ps-3 text-[0.7rem]",
      )}
    >
      <span className={cx("min-w-0", !strong && !sub && "text-fg-muted")}>
        <Lines value={label} languages={languages} subClassName="text-fg-subtle" />
      </span>
      <span
        dir="auto"
        className={cx("min-w-0 shrink-0 text-end tabular-nums", !strong && !sub && "text-fg", negative && "text-bad")}
      >
        {value}
      </span>
    </div>
  );
}
