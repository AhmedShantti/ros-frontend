"use client";

/**
 * A small, declarative form drawer.
 *
 * Half a dozen console screens need the same thing: a drawer with three or
 * four fields, a create button, the backend's rejection shown inline, and a
 * reload afterwards. Written per page that is the same eighty lines six
 * times, which is how the error handling drifts between them.
 *
 * Deliberately not a form framework. It handles the field kinds below with
 * required/simple validation; anything with real conditional logic — the
 * transfer receipt, the recipe editor — stays hand-written, because bending
 * a generic component into that shape costs more than it saves.
 *
 * ## Values are strings, except where they cannot be
 *
 * Every field reads and writes `Record<string, string>` so a caller can
 * treat the payload uniformly. The two exceptions are `localised` (which is
 * `{en, ar}` and would lose information as a string) and `toggle` (which is
 * `"true"`/`"false"` — still a string, so the uniform shape survives). A
 * `localised` field's value lives in a parallel map the caller receives
 * alongside the text one.
 */

import { useState, type ReactNode } from "react";

import type { Localised } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useAction } from "@/lib/console/actions";
import {
  Button,
  Callout,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
} from "@/components/console/ui";
import {
  EMPTY_LOCALISED,
  LocalisedField,
  MoneyInput,
  SearchSelect,
  type SearchOption,
} from "@/components/console/fields";

export type FieldKind =
  | "text"
  | "number"
  | "select"
  | "textarea"
  | "date"
  | "time"
  | "toggle"
  | "money"
  | "localised"
  | "search";

export interface RecordField {
  name: string;
  label: string;
  kind?: FieldKind;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  /** `select` only. */
  options?: { value: string; label: string }[];
  /** `search` only — the same shape, with a second line and a filter. */
  searchOptions?: SearchOption[];
  /** `money` only. */
  currency?: string;
  /** Prefilled value. `localised` uses `initialLocalised`. */
  initial?: string;
  initialLocalised?: Localised;
  /** Latin-script values — ids, codes, currencies — read better LTR. */
  ltr?: boolean;
  /** Numeric bounds, checked before submit. */
  min?: number;
  max?: number;
  /** Return a message to block submission; null when the value is fine. */
  validate?: (value: string, all: RecordValues) => string | null;
  /** Hide the field unless this predicate passes — conditional forms. */
  visibleWhen?: (all: RecordValues) => boolean;
}

/** What `onSubmit` receives: flat strings plus the bilingual fields. */
export interface RecordValues {
  [key: string]: string;
}

export interface RecordSubmission {
  values: RecordValues;
  localised: Record<string, Localised>;
}

export interface RecordDrawerProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  fields: RecordField[];
  /** Shown above the fields — what this record is for, or a caveat. */
  note?: ReactNode;
  submitLabel?: string;
  onClose: () => void;
  /**
   * Receives the field values keyed by `name`. Throwing shows the message.
   *
   * The second argument carries the `localised` fields; callers that have
   * none can ignore it entirely, which keeps the common case a one-liner.
   */
  onSubmit: (values: RecordValues, localised: Record<string, Localised>) => Promise<unknown>;
  onDone: () => void;
  /** Extra content rendered under the fields — a preview, a warning. */
  children?: ReactNode;
}

export function RecordDrawer({
  open,
  title,
  subtitle,
  fields,
  note,
  submitLabel,
  onClose,
  onSubmit,
  onDone,
  children,
}: RecordDrawerProps) {
  const { t } = useI18n();
  const action = useAction();

  const [values, setValues] = useState<RecordValues>(() => seed(fields));
  const [localised, setLocalised] = useState<Record<string, Localised>>(() =>
    seedLocalised(fields),
  );

  // Re-seed when the drawer is reopened against a different record.
  const [seededFor, setSeededFor] = useState(() => signature(fields));
  const current = signature(fields);
  if (open && seededFor !== current) {
    setSeededFor(current);
    setValues(seed(fields));
    setLocalised(seedLocalised(fields));
  }

  if (!open) return null;

  const visible = fields.filter((field) => !field.visibleWhen || field.visibleWhen(values));

  const problems = visible
    .map((field) => problemWith(field, values, localised, t))
    .filter((message): message is string => message !== null);
  const blocked = problems.length > 0;

  async function submit() {
    if (blocked) return;
    await action.run(() => onSubmit(values, localised), { onSuccess: onDone });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={blocked}
            onClick={submit}
          >
            {submitLabel ?? t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {note ? <Callout tone="muted">{note}</Callout> : null}

        {visible.map((field) => {
          const value = values[field.name] ?? "";
          const set = (next: string) =>
            setValues((rows) => ({ ...rows, [field.name]: next }));
          // Only surface a field's own error once it has been touched, so a
          // pristine form is not a wall of red before anyone has typed.
          const touched = value.trim() !== "";
          const error = touched ? problemWith(field, values, localised, t) : null;

          if (field.kind === "localised") {
            return (
              <LocalisedField
                key={field.name}
                label={field.label}
                hint={field.hint}
                required={field.required}
                maxLength={field.maxLength}
                value={localised[field.name] ?? EMPTY_LOCALISED}
                onChange={(next) =>
                  setLocalised((rows) => ({ ...rows, [field.name]: next }))
                }
              />
            );
          }

          if (field.kind === "toggle") {
            return (
              <Toggle
                key={field.name}
                checked={value === "true"}
                onChange={(next) => set(next ? "true" : "false")}
                label={field.label}
                hint={field.hint}
              />
            );
          }

          return (
            <Field
              key={field.name}
              label={field.label}
              hint={field.hint}
              error={error}
              required={field.required}
            >
              {field.kind === "select" ? (
                <Select value={value} onChange={(event) => set(event.target.value)}>
                  {field.required ? null : <option value="">—</option>}
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : field.kind === "search" ? (
                <SearchSelect
                  options={field.searchOptions ?? []}
                  value={value || null}
                  onChange={(next) => set(next ?? "")}
                  placeholder={field.placeholder}
                  aria-label={field.label}
                  allowClear={!field.required}
                />
              ) : field.kind === "textarea" ? (
                <Textarea
                  rows={3}
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                />
              ) : field.kind === "money" ? (
                <MoneyInput
                  value={value === "" ? null : Number(value)}
                  onChange={(minor) => set(minor === null ? "" : String(minor))}
                  currency={(field.currency ?? "EGP") as never}
                  aria-label={field.label}
                />
              ) : (
                <Input
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  type={
                    field.kind === "date" ? "date" : field.kind === "time" ? "time" : undefined
                  }
                  inputMode={field.kind === "number" ? "decimal" : undefined}
                  dir={
                    field.ltr ||
                    field.kind === "number" ||
                    field.kind === "date" ||
                    field.kind === "time"
                      ? "ltr"
                      : undefined
                  }
                />
              )}
            </Field>
          );
        })}

        {children}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function problemWith(
  field: RecordField,
  values: RecordValues,
  localised: Record<string, Localised>,
  t: (key: never) => string,
): string | null {
  if (field.kind === "localised") {
    const value = localised[field.name] ?? EMPTY_LOCALISED;
    if (field.required && !value.en.trim() && !value.ar.trim()) {
      return t("loc.bothEmpty" as never);
    }
    return null;
  }

  const raw = values[field.name] ?? "";
  if (field.kind === "toggle") return null;

  if (field.required && !raw.trim()) return t("form.required" as never);

  if ((field.kind === "number" || field.kind === "money") && raw.trim() !== "") {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return t("form.notANumber" as never);
    if (field.min !== undefined && numeric < field.min) {
      return t("form.tooSmall" as never).replace("{min}", String(field.min));
    }
    if (field.max !== undefined && numeric > field.max) {
      return t("form.tooLarge" as never).replace("{max}", String(field.max));
    }
  }

  return field.validate?.(raw, values) ?? null;
}

function seed(fields: RecordField[]): RecordValues {
  const out: RecordValues = {};
  for (const field of fields) {
    if (field.kind === "localised") continue;
    out[field.name] =
      field.initial ??
      (field.kind === "select"
        ? (field.options?.[0]?.value ?? "")
        : field.kind === "toggle"
          ? "false"
          : "");
  }
  return out;
}

function seedLocalised(fields: RecordField[]): Record<string, Localised> {
  const out: Record<string, Localised> = {};
  for (const field of fields) {
    if (field.kind !== "localised") continue;
    out[field.name] = field.initialLocalised ?? { ...EMPTY_LOCALISED };
  }
  return out;
}

/** Changes when the field set or its defaults change — the cue to re-seed. */
function signature(fields: RecordField[]): string {
  return fields
    .map((field) => {
      const initial =
        field.kind === "localised"
          ? `${field.initialLocalised?.en ?? ""}/${field.initialLocalised?.ar ?? ""}`
          : (field.initial ?? "");
      return `${field.name}:${initial}`;
    })
    .join("|");
}
