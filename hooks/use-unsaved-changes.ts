"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UnsavedChangesGuard {
  dirty: boolean;
  /** Wire to `onClick` of anything that navigates away from a dirty form. */
  attempt: (proceed: () => void) => void;
  /** True while the confirmation dialog should be open. */
  prompting: boolean;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

/**
 * Guards a dirty form against navigation.
 *
 * Two halves. `beforeunload` covers closing the tab and typing a new URL —
 * the browser owns that dialog and its wording. In-app navigation is caught
 * by routing every link through `attempt()`, which defers the navigation
 * until the user answers our own dialog. There is no router-level
 * `blockNavigation` in the App Router, so the call site has to opt in.
 */
export function useUnsavedChanges(dirty: boolean): UnsavedChangesGuard {
  const [prompting, setPrompting] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what actually triggers the prompt in Chrome;
      // preventDefault alone is honoured only by Firefox.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const attempt = useCallback(
    (proceed: () => void) => {
      if (!dirty) {
        proceed();
        return;
      }
      pending.current = proceed;
      setPrompting(true);
    },
    [dirty],
  );

  const confirmDiscard = useCallback(() => {
    const proceed = pending.current;
    pending.current = null;
    setPrompting(false);
    proceed?.();
  }, []);

  const cancelDiscard = useCallback(() => {
    pending.current = null;
    setPrompting(false);
  }, []);

  return { dirty, attempt, prompting, confirmDiscard, cancelDiscard };
}
