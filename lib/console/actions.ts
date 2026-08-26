"use client";

/**
 * Running a write against the service layer.
 *
 * Every mutating control in the console needs the same four things: a
 * pending state so the button can't be double-clicked, the backend's own
 * wording when it refuses, a confirmation when it doesn't, and a reload of
 * whatever list the change affected. Written out per call site that is
 * fifteen lines of try/catch each time, and the error handling drifts.
 *
 * The backend's message is preferred over anything invented here. A
 * `ValidationPipe` rejection says "name must be shorter than 120
 * characters"; replacing that with "Could not save" throws away the only
 * sentence on the screen that tells the user what to do.
 */

import { useCallback, useState } from "react";
import { ServiceError } from "./services";

export interface ActionState {
  /** True while the action is in flight. */
  pending: boolean;
  /** The backend's refusal, or null. */
  error: string | null;
  clearError: () => void;
  /**
   * Runs `work`. Returns its value on success and `undefined` on failure —
   * so a caller can close a drawer only when the write actually landed.
   */
  run: <T>(
    work: () => Promise<T>,
    options?: { onSuccess?: (result: T) => void; success?: string },
  ) => Promise<T | undefined>;
}

/**
 * `notify` is the page's toast setter. It is optional: a form that renders
 * the error inline does not also want it flashing past in a toast.
 */
export function useAction(notify?: (message: string) => void): ActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T,>(
      work: () => Promise<T>,
      options: { onSuccess?: (result: T) => void; success?: string } = {},
    ): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      try {
        const result = await work();
        options.onSuccess?.(result);
        if (options.success) notify?.(options.success);
        return result;
      } catch (caught) {
        const message = describeError(caught);
        setError(message);
        notify?.(message);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [notify],
  );

  return { pending, error, clearError, run };
}

/**
 * The most useful sentence available about a failure.
 *
 * `NO_BACKEND` and `NOT_IMPLEMENTED` carry their explanation in `detail`,
 * because the message alone ("The backend does not offer that yet.") does
 * not say what to do about it.
 */
export function describeError(caught: unknown): string {
  if (caught instanceof ServiceError) {
    if (caught.code === "NETWORK_UNREACHABLE") {
      return `${caught.message} ${caught.detail ?? ""}`.trim();
    }
    if (caught.code === "NO_BACKEND" || caught.code === "NOT_IMPLEMENTED") {
      return caught.detail ? `${caught.message} ${caught.detail}` : caught.message;
    }
    return caught.message;
  }
  if (caught instanceof Error) return caught.message;
  return "That did not go through.";
}
