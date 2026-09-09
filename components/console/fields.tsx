"use client";

/**
 * Shared form controls.
 *
 * These exist because the same four or five inputs were being rebuilt per
 * screen with slightly different validation each time — and in the case of
 * bilingual text, not being built at all: every create form in the console
 * used to take one name and write it into both locales, which made an
 * Arabic-first product impossible to actually author in Arabic.
 *
 * Each control here is uncontrolled-friendly (value + onChange), reports its
 * own validation state, and mirrors correctly under RTL because it uses the
 * project's logical-property classes rather than left/right ones.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import type { Currency, Localised, Locale, Quantity, UnitCode } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { minorFromInput, toMajorUnits, unitLabel } from "@/lib/console/format";
import { Badge, Button, Field, Input, Select, cx } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Bilingual text — FR-LOC-006, FR-LOC-007
// ---------------------------------------------------------------------------

export const EMPTY_LOCALISED: Localised = { en: "", ar: "" };

/** True when a localised value has at least one side filled in. */
export function hasLocalisedText(value: Localised | null | undefined): boolean {
  return Boolean(value && (value.en.trim() || value.ar.trim()));
}

/**
 * Which locale actually supplies the displayed string — FR-LOC-007.
 *
 * The console shows the fallback rather than an empty cell or a key, but it
 * has to *say* it is showing a fallback: otherwise a half-translated menu
 * looks finished, and nobody ever goes back to complete it.
 */
export function localisedFallback(
  value: Localised | null | undefined,
  locale: Locale,
): "own" | "fallback" | "missing" {
  if (!value) return "missing";
  if (value[locale]?.trim()) return "own";
  const other: Locale = locale === "en" ? "ar" : "en";
  return value[other]?.trim() ? "fallback" : "missing";
}

/**
 * One label, both languages.
 *
 * Each side carries its own `dir`, because an Arabic input inside an English
 * console still has to lay out right-to-left — and a Latin brand name typed
 * into the Arabic field still has to render in the right visual order
 * (FR-LOC-004, which the browser gets right on its own once `dir` is set).
 *
 * The "copy across" button is there because a great many names genuinely are
 * the same in both languages — "Pepsi", "BBQ" — and forcing the user to type
 * them twice is how people start pasting English into the Arabic field and
 * calling it localised.
 */
export function LocalisedField({
  label,
  value,
  onChange,
  hint,
  required,
  error,
  multiline,
  placeholder,
  maxLength,
}: {
  label: string;
  value: Localised;
  onChange: (next: Localised) => void;
  hint?: string;
  required?: boolean;
  error?: string | null;
  multiline?: boolean;
  placeholder?: Partial<Localised>;
  maxLength?: number;
}) {
  const { t, locale } = useI18n();
  const enId = useId();
  const arId = useId();

  const missingRequired =
    required && !value.en.trim() && !value.ar.trim() ? t("loc.bothEmpty") : null;

  // The active console locale goes first: an Arabic operator should be
  // typing into the top field, not tabbing past English to reach theirs.
  const order: Locale[] = locale === "ar" ? ["ar", "en"] : ["en", "ar"];

  function set(which: Locale, next: string) {
    onChange({ ...value, [which]: next });
  }

  const Control = multiline ? "textarea" : "input";

  return (
    <div className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg flex items-center gap-1 text-xs font-medium">
          {label}
          {required ? <span className="text-bad">*</span> : null}
        </span>
        <button
          type="button"
          onClick={() => {
            const source = value[order[0]!].trim();
            if (source) set(order[1]!, source);
          }}
          disabled={!value[order[0]!].trim()}
          className="text-fg-subtle hover:text-fg text-[0.68rem] underline underline-offset-2 disabled:opacity-40"
        >
          {t("loc.copyAcross")}
        </button>
      </div>

      <div className="mt-1.5 space-y-1.5">
        {order.map((which) => {
          const id = which === "en" ? enId : arId;
          const filled = Boolean(value[which].trim());
          return (
            <div key={which} className="relative">
              <label htmlFor={id} className="sr-only">
                {`${label} — ${which === "en" ? t("loc.english") : t("loc.arabic")}`}
              </label>
              <Control
                id={id}
                dir={which === "ar" ? "rtl" : "ltr"}
                lang={which}
                rows={multiline ? 3 : undefined}
                value={value[which]}
                maxLength={maxLength}
                placeholder={placeholder?.[which]}
                onChange={(event: { target: { value: string } }) =>
                  set(which, event.target.value)
                }
                aria-invalid={Boolean(missingRequired ?? error)}
                className={cx(
                  "border-line bg-raised text-fg placeholder:text-fg-subtle focus:border-accent w-full rounded-lg border py-2 text-sm outline-none transition-colors",
                  which === "ar" ? "ps-3 pe-14" : "ps-3 pe-14",
                )}
              />
              <span
                aria-hidden
                className={cx(
                  "pointer-events-none absolute top-1/2 -translate-y-1/2 end-2 rounded px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wide uppercase",
                  filled ? "bg-sunken text-fg-subtle" : "bg-warn-soft text-warn",
                )}
              >
                {which}
              </span>
            </div>
          );
        })}
      </div>

      {(missingRequired ?? error) ? (
        <span className="text-bad mt-1 block text-xs">{missingRequired ?? error}</span>
      ) : hint ? (
        <span className="text-fg-subtle mt-1 block text-xs">{hint}</span>
      ) : !value.en.trim() || !value.ar.trim() ? (
        <span className="text-warn mt-1 block text-xs">{t("loc.oneSideMissing")}</span>
      ) : null}
    </div>
  );
}

/** Renders a localised value, marking it when the fallback language is showing. */
export function LocalisedText({
  value,
  className,
}: {
  value: Localised | null | undefined;
  className?: string;
}) {
  const { t, tx, locale } = useI18n();
  const state = localisedFallback(value, locale);

  if (state === "missing") {
    return <span className="text-fg-subtle italic">{t("loc.untranslated")}</span>;
  }

  return (
    <span className={className}>
      {tx(value)}
      {state === "fallback" ? (
        <span
          title={t("loc.fallbackHint")}
          className="text-fg-subtle ms-1.5 rounded border border-current/30 px-1 py-px align-middle font-mono text-[0.55rem] uppercase"
        >
          {locale === "en" ? "ar" : "en"}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Money — ADR-008, minor units never leave the boundary as floats
// ---------------------------------------------------------------------------

/**
 * Money entered in major units, carried in minor ones.
 *
 * The whole system stores minor units as integers precisely so that 0.1 +
 * 0.2 never happens to a price. This control keeps that boundary in one
 * place: the user types "12.50", the caller receives 1250.
 *
 * `null` means "not a number the caller can use" — deliberately distinct
 * from `0`, because an empty box and a genuine zero are different answers
 * and treating them the same is how a blank field becomes a free item.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  disabled,
  min,
  max,
  autoFocus,
  id,
  "aria-label": ariaLabel,
}: {
  /** Minor units, or null when the box is empty or unparseable. */
  value: number | null;
  onChange: (minor: number | null) => void;
  currency: Currency;
  disabled?: boolean;
  min?: number;
  max?: number;
  autoFocus?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() =>
    value === null ? "" : toMajorUnits({ amount: value, currency }).toFixed(2),
  );

  // Re-seed when the caller replaces the value from outside (a reset, a
  // different row) but never while the user is mid-keystroke.
  const lastEmitted = useRef<number | null>(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setText(value === null ? "" : toMajorUnits({ amount: value, currency }).toFixed(2));
  }, [value, currency]);

  const parsed = minorFromInput(text);
  const belowMin = parsed !== null && min !== undefined && parsed < min;
  const aboveMax = parsed !== null && max !== undefined && parsed > max;

  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        dir="ltr"
        autoFocus={autoFocus}
        disabled={disabled}
        value={text}
        aria-invalid={belowMin || aboveMax || (text.trim() !== "" && parsed === null)}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const minor = minorFromInput(next);
          lastEmitted.current = minor;
          onChange(minor);
        }}
        className="pe-14 text-end font-mono tabular-nums"
      />
      <span
        aria-hidden
        className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 font-mono text-xs"
      >
        {currency}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quantity — SRS §7.2, decimal strings with a unit
// ---------------------------------------------------------------------------

const UNIT_OPTIONS: UnitCode[] = [
  "g",
  "kg",
  "ml",
  "l",
  "pc",
  "dozen",
  "case",
  "pack",
  "tray",
];

/**
 * A number and the unit it is counted in.
 *
 * Quantities are decimal *strings* everywhere in the domain (a float kilogram
 * is how 0.3 kg of saffron becomes 0.30000000000000004 in a variance report),
 * so this never parses to a number on the way out.
 */
export function QuantityInput({
  value,
  onChange,
  units = UNIT_OPTIONS,
  disabled,
  allowFractional = true,
  "aria-label": ariaLabel,
}: {
  value: Quantity;
  onChange: (next: Quantity) => void;
  units?: UnitCode[];
  disabled?: boolean;
  /** FR-POS-014 — weighed items accept decimals; counted ones do not. */
  allowFractional?: boolean;
  "aria-label"?: string;
}) {
  const { locale } = useI18n();
  const invalid = value.value.trim() !== "" && !/^\d*\.?\d*$/.test(value.value.trim());

  return (
    <div className="flex gap-1.5">
      <Input
        aria-label={ariaLabel}
        inputMode={allowFractional ? "decimal" : "numeric"}
        dir="ltr"
        disabled={disabled}
        value={value.value}
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== "" && !/^\d*\.?\d*$/.test(next)) return;
          if (!allowFractional && next.includes(".")) return;
          onChange({ ...value, value: next });
        }}
        className="flex-1 text-end font-mono tabular-nums"
      />
      <Select
        aria-label={ariaLabel ? `${ariaLabel} unit` : undefined}
        disabled={disabled}
        value={value.unit}
        onChange={(event) => onChange({ ...value, unit: event.target.value as UnitCode })}
        className="w-28 shrink-0"
      >
        {units.map((unit) => (
          <option key={unit} value={unit}>
            {unitLabel(unit, locale)}
          </option>
        ))}
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Percentage
// ---------------------------------------------------------------------------

export function PercentInput({
  value,
  onChange,
  max = 100,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: number;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const numeric = Number(value);
  const invalid =
    value.trim() !== "" && (!Number.isFinite(numeric) || numeric < 0 || numeric > max);

  return (
    <div className="relative">
      <Input
        aria-label={ariaLabel}
        inputMode="decimal"
        dir="ltr"
        disabled={disabled}
        value={value}
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== "" && !/^\d*\.?\d*$/.test(next)) return;
          onChange(next);
        }}
        className="pe-9 text-end font-mono tabular-nums"
      />
      <span
        aria-hidden
        className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 text-xs"
      >
        %
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date range — every report needs one
// ---------------------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "custom";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Resolve a preset against a reference date, so tests can pin "today". */
export function resolvePreset(preset: DateRangePreset, now = new Date()): DateRange {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const shift = (days: number) => {
    const next = new Date(today);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };

  switch (preset) {
    case "today":
      return { from: isoDay(today), to: isoDay(today) };
    case "yesterday":
      return { from: isoDay(shift(-1)), to: isoDay(shift(-1)) };
    case "last7":
      return { from: isoDay(shift(-6)), to: isoDay(today) };
    case "last30":
      return { from: isoDay(shift(-29)), to: isoDay(today) };
    case "thisMonth": {
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      return { from: isoDay(start), to: isoDay(today) };
    }
    case "lastMonth": {
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
      return { from: isoDay(start), to: isoDay(end) };
    }
    default:
      return { from: isoDay(shift(-29)), to: isoDay(today) };
  }
}

export function DateRangeField({
  value,
  onChange,
  label,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const [preset, setPreset] = useState<DateRangePreset>("last30");

  const presets: { id: DateRangePreset; label: string }[] = [
    { id: "today", label: t("range.today") },
    { id: "yesterday", label: t("range.yesterday") },
    { id: "last7", label: t("range.last7") },
    { id: "last30", label: t("range.last30") },
    { id: "thisMonth", label: t("range.thisMonth") },
    { id: "lastMonth", label: t("range.lastMonth") },
  ];

  const invalid = Boolean(value.from && value.to && value.from > value.to);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setPreset(entry.id);
              onChange(resolvePreset(entry.id));
            }}
            className={cx(
              "rounded-lg border px-2.5 py-1 text-xs transition-colors",
              preset === entry.id
                ? "border-accent bg-accent-soft text-accent font-medium"
                : "border-line bg-raised text-fg-muted hover:text-fg",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Field label={label ? `${label} — ${t("range.from")}` : t("range.from")}>
          <Input
            type="date"
            dir="ltr"
            value={value.from}
            max={value.to || undefined}
            aria-invalid={invalid}
            onChange={(event) => {
              setPreset("custom");
              onChange({ ...value, from: event.target.value });
            }}
          />
        </Field>
        <Field label={t("range.to")}>
          <Input
            type="date"
            dir="ltr"
            value={value.to}
            min={value.from || undefined}
            aria-invalid={invalid}
            onChange={(event) => {
              setPreset("custom");
              onChange({ ...value, to: event.target.value });
            }}
          />
        </Field>
      </div>

      {invalid ? <p className="text-bad text-xs">{t("range.invalid")}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable select — item pickers, supplier pickers, customer pickers
// ---------------------------------------------------------------------------

export interface SearchOption {
  value: string;
  label: string;
  /** Secondary line — a code, a category, a branch. */
  hint?: string;
  disabled?: boolean;
}

/**
 * A `<select>` stops being usable somewhere around forty options, and a
 * restaurant's stock list is three thousand. This is the picker every line
 * editor in the app reaches for: type to narrow, arrow to move, Enter to
 * take, Escape to back out.
 *
 * It is a listbox rather than a native select because the options carry a
 * second line (SKU, category, on-hand) and because the filter has to run
 * over both lines — neither of which a native control does.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
  "aria-label": ariaLabel,
  allowClear,
}: {
  options: SearchOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
  "aria-label"?: string;
  allowClear?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return options.slice(0, 200);
    return options
      .filter(
        (option) =>
          option.label.toLowerCase().includes(needle) ||
          (option.hint ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 200);
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setTerm("");
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => setActive(0), [term, open]);

  function take(option: SearchOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setTerm("");
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((current) => !current)}
          className={cx(
            "border-line bg-raised text-fg focus:border-accent flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm outline-none transition-colors disabled:opacity-50",
          )}
        >
          <span className={cx("min-w-0 truncate", !selected && "text-fg-subtle")}>
            {selected ? selected.label : (placeholder ?? t("common.select"))}
          </span>
          <ChevronDown size={14} className="text-fg-subtle shrink-0" aria-hidden />
        </button>

        {allowClear && selected ? (
          <Button
            variant="ghost"
            aria-label={t("common.clear")}
            icon={<X size={14} />}
            onClick={() => onChange(null)}
          />
        ) : null}
      </div>

      {open ? (
        <div className="border-line bg-raised absolute z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-xl">
          <div className="border-line relative border-b p-2">
            <Search
              size={14}
              aria-hidden
              className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-4"
            />
            <Input
              data-autofocus
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("common.search")}
              aria-label={t("common.search")}
              className="ps-9"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((i) => Math.min(matches.length - 1, i + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const option = matches[active];
                  if (option) take(option);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  setTerm("");
                }
              }}
            />
          </div>

          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <li className="text-fg-subtle px-3 py-4 text-center text-xs">
                {emptyLabel ?? t("common.noResults")}
              </li>
            ) : (
              matches.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => take(option)}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm",
                      index === active && "bg-accent-soft",
                      option.disabled && "opacity-40",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="text-fg block truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="text-fg-subtle block truncate text-xs">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    {option.value === value ? (
                      <Check size={14} className="text-accent shrink-0" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state with an escape hatch
// ---------------------------------------------------------------------------

/**
 * "Nothing here yet" plus the thing to do about it.
 *
 * An empty collection that offers no way to fill it is a dead end, and dead
 * ends are where users conclude a feature is broken rather than unused.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="border-line flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      {icon ? <span className="text-fg-subtle">{icon}</span> : null}
      <div>
        <p className="text-fg text-sm font-medium">{title}</p>
        {body ? (
          <p className="text-fg-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">{body}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Small labelled chip used to mark a locked / inherited / overridden value. */
export function OriginBadge({
  origin,
  source,
}: {
  origin: "own" | "inherited" | "locked";
  source?: string;
}) {
  const { t } = useI18n();
  const label =
    origin === "own"
      ? t("settings.originOwn")
      : origin === "locked"
        ? t("settings.originLocked")
        : t("settings.originInherited");

  return (
    <Badge tone={origin === "locked" ? "warn" : origin === "own" ? "accent" : "muted"}>
      {source ? `${label} · ${source}` : label}
    </Badge>
  );
}
