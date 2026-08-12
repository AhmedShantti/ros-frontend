"use client";

/**
 * React Hook Form bound to the console's field primitives.
 *
 * Three jobs:
 *   1. `useZodForm` wires a Zod schema to RHF and keeps the inferred types.
 *   2. `FormField` renders label, control, hint and error as one accessible
 *      unit — `aria-describedby`, `aria-invalid` and the label's `for` are
 *      derived from one id rather than repeated at every call site.
 *   3. Message keys coming out of the schema are translated here, so no page
 *      ever sees `validation.minLength:3`.
 *
 * Errors are announced with `role="alert"`, and the submit handler focuses
 * the first invalid control — a keyboard user must not have to hunt for what
 * failed (WCAG 2.1 AA §3.3.1).
 */

import { useCallback, useId, type ReactNode } from "react";
import {
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { z } from "zod";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { translateIssue } from "@/schemas/messages";
import { cx } from "./ui";

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/**
 * `z.input` is what the fields hold, `z.output` is what the submit handler
 * receives. They differ wherever a schema coerces or transforms — the money
 * fields take a string and hand back minor units — so both are threaded
 * through rather than collapsed into one.
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>, "resolver"> & {
    defaultValues?: DefaultValues<z.input<TSchema>>;
  },
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    resolver: standardSchemaResolver(schema),
    // Validate on blur, then keep validating as they type once a field has
    // already failed. Validating on every keystroke from the start shouts at
    // someone halfway through typing their email.
    mode: "onTouched",
    reValidateMode: "onChange",
    ...options,
  });
}

export interface FormProps<TFieldValues extends FieldValues, TTransformed = TFieldValues> {
  form: UseFormReturn<TFieldValues, unknown, TTransformed>;
  onSubmit: SubmitHandler<TTransformed>;
  children: ReactNode;
  className?: string;
  /** Rendered above the fields when the submit itself failed. */
  submitError?: string | null;
  id?: string;
}

export function Form<TFieldValues extends FieldValues, TTransformed = TFieldValues>({
  form,
  onSubmit,
  children,
  className,
  submitError,
  id,
}: FormProps<TFieldValues, TTransformed>) {
  return (
    <FormProvider {...form}>
      <form
        id={id}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cx("space-y-4", className)}
      >
        {submitError ? (
          <div
            role="alert"
            className="border-bad/40 bg-bad/10 text-bad flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
          >
            <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
            <span className="leading-relaxed">{submitError}</span>
          </div>
        ) : null}
        {children}
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export interface FormFieldRenderArgs {
  id: string;
  name: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
}

export interface FormFieldProps<TFieldValues extends FieldValues> {
  name: FieldPath<TFieldValues>;
  label: string;
  hint?: string;
  required?: boolean;
  /** Renders the control. Spread the supplied props onto the input. */
  children: (args: FormFieldRenderArgs) => ReactNode;
  className?: string;
}

export function FormField<TFieldValues extends FieldValues>({
  name,
  label,
  hint,
  required,
  children,
  className,
}: FormFieldProps<TFieldValues>) {
  const { t } = useI18n();
  const {
    formState: { errors },
  } = useFormContext<TFieldValues>();
  const reactId = useId();

  const id = `${reactId}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;

  // Nested paths — `name.ar`, `categories.0.name.en` — need walking, because
  // RHF nests the error object the same way the values are nested.
  const error = name
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], errors) as
    | { message?: string }
    | undefined;

  const message = error?.message ? translateIssue(error.message, t) : null;
  const describedBy = [hintId, message ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="text-fg block text-xs font-medium">
        {label}
        {required ? (
          <span className="text-bad ms-1" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> ({t("form.required")})</span> : null}
      </label>

      {children({
        id,
        name,
        "aria-invalid": Boolean(message),
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}

      {hint ? (
        <p id={hintId} className="text-fg-subtle text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}

      {message ? (
        <p
          id={errorId}
          role="alert"
          className="text-bad flex items-center gap-1.5 text-xs leading-relaxed"
        >
          <AlertCircle size={12} className="shrink-0" aria-hidden />
          {message}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * Reports how many fields are invalid, for the summary line above a long
 * form. Screen readers get the count; sighted users get it too, because
 * scrolling a 20-field form hunting for red text is nobody's idea of a good
 * afternoon.
 */
export function useErrorSummary<TFieldValues extends FieldValues, TTransformed = TFieldValues>(
  form: UseFormReturn<TFieldValues, unknown, TTransformed>,
): { count: number; announce: string | null } {
  const { t } = useI18n();
  const count = countErrors(form.formState.errors);
  return {
    count,
    announce: count === 0 ? null : t("form.errorCount").replace("{n}", String(count)),
  };
}

function countErrors(errors: unknown): number {
  if (!errors || typeof errors !== "object") return 0;
  const record = errors as Record<string, unknown>;
  if (typeof record.message === "string") return 1;
  return Object.values(record).reduce<number>((sum, value) => sum + countErrors(value), 0);
}

/** Focuses the first control that failed, after a rejected submit. */
export function useFocusFirstError() {
  return useCallback((formEl: HTMLFormElement | null) => {
    const first = formEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  }, []);
}
