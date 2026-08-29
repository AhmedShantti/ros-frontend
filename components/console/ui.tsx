"use client";

/**
 * Console UI primitives.
 *
 * Everything here is direction-agnostic: logical properties only (`ps-*`,
 * `me-*`, `start-*`, `border-s`), so the same markup mirrors correctly under
 * `dir="rtl"` without a single conditional.
 */

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown, Info, X } from "lucide-react";
import type { Tone } from "@/lib/console/labels";
import { useDismissable } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cx(
        "bg-raised border-line rounded-xl border shadow-2xs",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  spec,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  spec?: string;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-fg text-sm font-semibold">{title}</h2>
        {hint ? (
          <p className="text-fg-muted mt-1 max-w-2xl text-xs leading-relaxed">{hint}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {spec ? <SpecTag id={spec} /> : null}
        {action}
      </div>
    </header>
  );
}

/** The requirement tag that links a screen back to the specification. */
export function SpecTag({ id }: { id: string }) {
  return (
    <span className="border-line text-fg-subtle rounded border px-1.5 py-0.5 font-mono text-[0.62rem] tracking-wide whitespace-nowrap uppercase">
      {id}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-sunken text-fg-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/25",
  good: "bg-good-soft text-good border-good/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  bad: "bg-bad-soft text-bad border-bad/25",
  muted: "bg-transparent text-fg-subtle border-line",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cx(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            tone === "good" && "bg-good",
            tone === "warn" && "bg-warn",
            tone === "bad" && "bg-bad",
            tone === "accent" && "bg-accent",
            (tone === "neutral" || tone === "muted") && "bg-fg-subtle",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90 border-transparent",
  secondary: "bg-raised text-fg border-line hover:bg-sunken",
  ghost: "bg-transparent text-fg-muted border-transparent hover:bg-sunken hover:text-fg",
  danger: "bg-bad-soft text-bad border-bad/30 hover:bg-bad hover:text-white",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  loading,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        "text-fg-muted hover:bg-sunken hover:text-fg inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        className,
      )}
    >
      {icon}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-fg flex items-center gap-1 text-xs font-medium">
        {label}
        {required ? <span className="text-bad">*</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="text-bad mt-1 block text-xs">{error}</span>
      ) : hint ? (
        <span className="text-fg-subtle mt-1 block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASS =
  "border-line bg-raised text-fg placeholder:text-fg-subtle focus:border-accent w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL_CLASS, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(CONTROL_CLASS, "resize-y", props.className)} />;
}

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Flattens an `<option>`'s children to plain text.
 *
 * `String(node)` looks like it would do this, but `<option>{a} {b}</option>`
 * is an array of children, not one string, and `Array.prototype.toString`
 * joins with a comma — every multi-expression label rendered with stray
 * commas where a space was written.
 */
function textFrom(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFrom).join("");
  if (isValidElement(node)) return textFrom((node.props as { children?: ReactNode }).children);
  return "";
}

/** Reads the `<option>` children a call site passes, without a real `<select>` in the DOM. */
function optionsFrom(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as OptionHTMLAttributes<HTMLOptionElement>;
    options.push({
      value: String(props.value ?? ""),
      label: textFrom(props.children),
      disabled: props.disabled,
    });
  });
  return options;
}

/**
 * Looks like a `<select>` to every call site (`value` + `onChange(e) =>
 * e.target.value`), but the popup is ours to style — a native listbox can't
 * take a rounded corner, an accent highlight, or a checkmark on any browser.
 */
export function Select({
  children,
  value,
  onChange,
  disabled,
  className,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const options = useMemo(() => optionsFrom(children), [children]);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ref = useDismissable(open, () => setOpen(false));
  const selected = options.find((o) => o.value === value) ?? null;

  const commit = (next: string) => {
    setOpen(false);
    buttonRef.current?.focus();
    onChange?.({ target: { value: next } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const step = (delta: 1 | -1) => {
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[Math.min(enabled.length - 1, Math.max(0, at + delta))] ?? enabled[0];
    commit(next.value);
  };

  return (
    <div ref={ref} className="relative">
      <button
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            open ? step(1) : setOpen(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            open ? step(-1) : setOpen(true);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cx(
          CONTROL_CLASS,
          "flex items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cx("truncate", !selected && "text-fg-subtle")}>{selected?.label}</span>
        <ChevronDown
          aria-hidden
          size={14}
          className={cx(
            "text-fg-subtle shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <ul
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={id && selected ? `${id}-${selected.value}` : undefined}
          onClick={(e) => e.stopPropagation()}
          className="bg-raised border-line ros-fade-in absolute start-0 top-[calc(100%+6px)] z-50 max-h-60 w-full min-w-max overflow-auto rounded-lg border p-1 shadow-lg"
        >
          {options.map((o) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={id ? `${id}-${o.value}` : undefined}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled}
                onClick={(e) => {
                  // `Select` is almost always used inside `Field`, which wraps
                  // it in a <label>. A <button> is a labelable element, so an
                  // unstopped click bubbling up through the label gets
                  // re-forwarded to the trigger button as a second synthetic
                  // click — which reopens the very dropdown this click just
                  // closed. Stopping it here is what makes a choice stick.
                  e.stopPropagation();
                  if (!o.disabled) commit(o.value);
                }}
                className={cx(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  o.disabled
                    ? "text-fg-subtle cursor-not-allowed opacity-50"
                    : isSelected
                      ? "bg-accent text-white"
                      : "text-fg hover:bg-sunken",
                )}
              >
                <span className="truncate">{o.label}</span>
                {isSelected ? <Check size={14} aria-hidden className="shrink-0" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-fg block text-sm">
          {label}
        </label>
        {hint ? <p className="text-fg-subtle mt-0.5 text-xs leading-relaxed">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[inset-inline-start]",
            checked ? "start-[1.125rem]" : "start-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** A segmented radio group — compact alternative to a select for 2–4 options. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    // `max-w-full` plus a scroll lets a group with many options (the report
    // categories are seven) stay on a 390px phone instead of pushing the page
    // sideways; `shrink-0` keeps the labels from being squeezed into ellipses.
    <div
      role="radiogroup"
      aria-label={label}
      className="border-line bg-sunken inline-flex max-w-full overflow-x-auto rounded-lg border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-raised text-fg shadow-sm"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-line -mb-px flex gap-1 overflow-x-auto border-b"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "border-accent text-fg font-medium"
                : "text-fg-muted hover:text-fg border-transparent",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className="bg-sunken text-fg-muted rounded-full px-1.5 py-0.5 text-[0.65rem]">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const ref = useDismissable(open, onClose);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={cx(
          "bg-raised border-line ros-fade-in max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border shadow-2xl sm:rounded-2xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <header className="border-line bg-raised sticky top-0 flex items-start justify-between gap-4 border-b px-5 py-4">
          <h2 id={headingId} className="text-fg text-base font-semibold">
            {title}
          </h2>
          <IconButton label={t("common.close")} icon={<X size={16} />} onClick={onClose} />
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="border-line bg-raised sticky bottom-0 flex justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Right-hand (or left-hand, in RTL) detail panel. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useDismissable(open, onClose);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex justify-end bg-black/45">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-raised border-line ros-fade-in flex h-full w-full max-w-xl flex-col border-s shadow-2xl"
      >
        <header className="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-fg text-base font-semibold">
              {title}
            </h2>
            {subtitle ? <div className="text-fg-muted mt-0.5 text-xs">{subtitle}</div> : null}
          </div>
          <IconButton label={t("common.close")} icon={<X size={16} />} onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="border-line flex justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu (dropdown)
// ---------------------------------------------------------------------------

interface MenuContextValue {
  close: () => void;
}
const MenuContext = createContext<MenuContextValue>({ close: () => {} });

export function Menu({
  trigger,
  children,
  align = "end",
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cx(
            "bg-raised border-line ros-fade-in absolute top-full z-50 mt-1 max-h-80 min-w-52 overflow-y-auto rounded-xl border p-1 shadow-xl",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          <MenuContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </MenuContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  selected,
  icon,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        close();
      }}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition-colors disabled:opacity-50",
        selected ? "bg-accent-soft text-accent" : "text-fg hover:bg-sunken",
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <Check size={14} className="shrink-0" /> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-fg-subtle px-2.5 pt-2 pb-1 text-[0.68rem] font-semibold tracking-wide uppercase">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="bg-line my-1 h-px" role="separator" />;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Callout({
  children,
  tone = "neutral",
  icon,
  title,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex gap-2.5 rounded-lg border px-3.5 py-3 text-xs leading-relaxed",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">{icon ?? <Info size={14} />}</span>
      <div className="min-w-0">
        {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Ephemeral confirmation, anchored bottom-centre. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="ros-fade-in fixed bottom-6 left-1/2 z-100 -translate-x-1/2"
    >
      <div className="bg-fg text-surface flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-xl">
        <Check size={14} />
        {message}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("ros-skeleton rounded", className)} aria-hidden />;
}

/** A short, tappable definition — used on metric labels and column heads. */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-fg-subtle hover:text-fg-muted inline-flex"
      >
        <Info size={12} />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="bg-fg text-surface absolute bottom-full z-50 mb-1.5 w-56 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed shadow-xl start-0"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Label/value pair used across every detail panel. */
export function DescRow({
  label,
  children,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="border-line flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b py-2 last:border-0">
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className={cx("text-fg text-sm", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

export function DescList({ children }: { children: ReactNode }) {
  return <dl className="text-sm">{children}</dl>;
}

/** Horizontal bar used for shares, gauges and mini distributions. */
export function Meter({
  value,
  tone = "accent",
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("bg-sunken h-1.5 w-full overflow-hidden rounded-full", className)}>
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-300",
          tone === "good" && "bg-good",
          tone === "warn" && "bg-warn",
          tone === "bad" && "bg-bad",
          tone === "accent" && "bg-accent",
          (tone === "neutral" || tone === "muted") && "bg-fg-subtle",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
