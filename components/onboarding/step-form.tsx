"use client";

/**
 * Validation plumbing shared by every wizard step.
 *
 * Each step owns a Zod schema from `schemas/onboarding.ts` and a slice of the
 * draft in `store/onboarding.ts`. What they all need on top is the same:
 * hold local edits, validate on submit, map Zod issues back onto fields, and
 * render the message in the active language — because the schemas emit
 * message *keys* (`validation.required`), never sentences.
 *
 * Deliberately not react-hook-form. The wizard's steps are small and several
 * of them are list editors rather than flat forms, so a resolver-driven form
 * library would be fighting the shape half the time.
 */

import { useCallback, useState } from "react";
import type { z } from "zod";

import { translateIssue } from "@/schemas/messages";
import { useI18n } from "@/lib/console/providers";

export type FieldErrors = Record<string, string>;

export interface StepForm<T> {
  values: T;
  errors: FieldErrors;
  /** Merge a patch and clear the errors on the fields it touched. */
  set: (patch: Partial<T>) => void;
  /** Validate; on success hand the parsed value to `onValid`. */
  submit: (onValid: (parsed: unknown) => void) => boolean;
  /** Message for one field path, e.g. `name.ar` or `categories`. */
  errorFor: (path: string) => string | undefined;
  reset: (next: T) => void;
}

export function useStepForm<T extends object>(
  schema: z.ZodType,
  initial: T,
): StepForm<T> {
  const { t } = useI18n();
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = useCallback((patch: Partial<T>) => {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      // Clearing on edit rather than re-validating on every keystroke: a
      // field that shouts while you are still typing the third character of
      // a phone number trains people to ignore it.
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[key];
        for (const path of Object.keys(next)) {
          if (path.startsWith(`${key}.`)) delete next[path];
        }
      }
      return next;
    });
  }, []);

  const submit = useCallback(
    (onValid: (parsed: unknown) => void) => {
      const result = schema.safeParse(values);
      if (result.success) {
        setErrors({});
        onValid(result.data);
        return true;
      }

      const collected: FieldErrors = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        // First issue per path wins; a field with three failures should say
        // one thing, not stack them.
        if (!collected[path]) collected[path] = translateIssue(issue.message, t);
      }
      setErrors(collected);
      return false;
    },
    [schema, values, t],
  );

  const errorFor = useCallback((path: string) => errors[path], [errors]);

  const reset = useCallback((next: T) => {
    setValues(next);
    setErrors({});
  }, []);

  return { values, errors, set, submit, errorFor, reset };
}

/**
 * Localised-name errors arrive on `name.en` / `name.ar`, but the bilingual
 * control is one field. Collapse them so it shows one message.
 */
export function localisedError(
  errorFor: (path: string) => string | undefined,
  base: string,
): string | null {
  return errorFor(base) ?? errorFor(`${base}.en`) ?? errorFor(`${base}.ar`) ?? null;
}
