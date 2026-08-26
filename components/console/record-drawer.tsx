"use client";

/**
 * A small, declarative form drawer.
 *
 * Half a dozen console screens need the same thing: a drawer with three or
 * four fields, a create button, the backend's rejection shown inline, and a
 * reload afterwards. Written per page that is the same eighty lines six
 * times, which is how the error handling drifts between them.
 *
 * Deliberately not a form framework. It handles text, number and select
 * fields with required/simple validation; anything with real conditional
 * logic — the transfer receipt, the price editor — stays hand-written,
 * because bending a generic component into that shape costs more than it
 * saves.
 */

import { useState, type ReactNode } from "react";

import { useI18n } from "@/lib/console/providers";
import { useAction } from "@/lib/console/actions";
import { Button, Callout, Drawer, Field, Input, Select } from "@/components/console/ui";

export type FieldKind = "text" | "number" | "select";

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
  /** Prefilled value. */
  initial?: string;
  /** Latin-script values — ids, codes, currencies — read better LTR. */
  ltr?: boolean;
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
  /** Receives the field values keyed by `name`. Throwing shows the message. */
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onDone: () => void;
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
}: RecordDrawerProps) {
  const { t } = useI18n();
  const action = useAction();

  const [values, setValues] = useState<Record<string, string>>(() => seed(fields));
  // Re-seed when the drawer is reopened against a different record.
  const [seededFor, setSeededFor] = useState(() => signature(fields));
  const current = signature(fields);
  if (open && seededFor !== current) {
    setSeededFor(current);
    setValues(seed(fields));
  }

  if (!open) return null;

  const missing = fields.some(
    (field) => field.required && !(values[field.name] ?? "").trim(),
  );
  const badNumber = fields.some(
    (field) =>
      field.kind === "number" &&
      (values[field.name] ?? "").trim() !== "" &&
      !Number.isFinite(Number(values[field.name])),
  );

  async function submit() {
    if (missing || badNumber) return;
    await action.run(() => onSubmit(values), { onSuccess: onDone });
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
            disabled={missing || badNumber}
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

        {fields.map((field) => {
          const value = values[field.name] ?? "";
          const set = (next: string) =>
            setValues((rows) => ({ ...rows, [field.name]: next }));

          return (
            <Field
              key={field.name}
              label={field.label}
              hint={field.hint}
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
              ) : (
                <Input
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  inputMode={field.kind === "number" ? "decimal" : undefined}
                  dir={field.ltr || field.kind === "number" ? "ltr" : undefined}
                />
              )}
            </Field>
          );
        })}
      </div>
    </Drawer>
  );
}

function seed(fields: RecordField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    out[field.name] = field.initial ?? (field.kind === "select" ? (field.options?.[0]?.value ?? "") : "");
  }
  return out;
}

/** Changes when the field set or its defaults change — the cue to re-seed. */
function signature(fields: RecordField[]): string {
  return fields.map((field) => `${field.name}:${field.initial ?? ""}`).join("|");
}
