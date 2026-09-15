"use client";

/**
 * POS-SESSION-RESILIENCE-P1 — the scoped recovery UI for a
 * `STALE_AUTHORIZATION_SNAPSHOT` 403 (`lib/api/client.ts`'s own docblock
 * traces the backend condition this responds to).
 *
 * Mounted exactly once, in `(terminal)/layout.tsx`, so it is present for
 * both `/pos` and `/kds` regardless of which screen triggered the stale
 * snapshot. It registers itself with `client.ts` as the ONE handler a
 * stale-snapshot 403 may call — `client.ts` has no UI of its own and MUST
 * NOT decide what re-authentication looks like, only WHEN to ask for it,
 * and only ever calls this handler at most once per "episode" (its own
 * `recoverFromStaleSnapshot` dedup), so several requests failing around the
 * same moment share ONE dialog, not several.
 *
 * Never a full sign-out: `reauthenticateWithPin` only replaces the stored
 * session on a CONFIRMED successful PIN, so a wrong PIN — or simply
 * cancelling — leaves the till's order/cash-session/drawer state exactly as
 * it was, on screen, the whole time this dialog is open.
 */

import { useEffect, useRef, useState } from "react";
import { reauthenticateWithPin } from "@/lib/api/auth";
import { setStaleSnapshotReauthHandler } from "@/lib/api/client";
import { ServiceError } from "@/lib/console/services/types";
import { useI18n } from "@/lib/console/providers";
import { Button, Callout, Field, Input, Modal } from "@/components/console/ui";

export function PosReauthPrompt() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Not React state: resolving it is how `client.ts`'s waiting caller(s)
  // learn the outcome, and doing that through a re-render would race a
  // `finish()` called from an event handler against React's own batching.
  const resolveRef = useRef<((recovered: boolean) => void) | null>(null);

  useEffect(() => {
    setStaleSnapshotReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRef.current = resolve;
          setPin("");
          setError(null);
          setPending(false);
          setOpen(true);
        }),
    );
    // Unregistering on unmount is what makes a stale snapshot outside the
    // terminal tree (there is no other mount point today, but the contract
    // holds regardless) surface as an ordinary, unrecoverable error instead
    // of hanging on a handler nobody will ever call back.
    return () => setStaleSnapshotReauthHandler(null);
  }, []);

  function finish(recovered: boolean) {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(recovered);
  }

  async function submit() {
    const value = pin.trim();
    if (!value || pending) return;
    setPending(true);
    setError(null);
    try {
      await reauthenticateWithPin(value);
      // Success is reported to client.ts, which retries the ONE original
      // request itself — nothing else to do here but close.
      finish(true);
    } catch (caught) {
      // A failed attempt never resolves the promise — the operator can
      // retype the PIN (a typo is the common case) or press Cancel, which
      // is the only thing that reports failure back to the waiting
      // request(s). This is a human retrying, not an automatic loop: no
      // stale-snapshot recovery is re-triggered by this failure.
      setPending(false);
      setPin("");
      setError(
        caught instanceof ServiceError
          ? caught.message
          : t("common.actionFailed"),
      );
    }
  }

  if (!open) return null;

  return (
    <Modal
      open
      onClose={() => finish(false)}
      title={t("pos.reauthTitle")}
      footer={
        <>
          <Button onClick={() => finish(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!pin.trim()}
            onClick={submit}
          >
            {t("pos.reauthSubmit")}
          </Button>
        </>
      }
    >
      <p className="text-fg-muted text-sm">{t("pos.reauthNote")}</p>

      {error ? (
        <Callout tone="bad" className="mt-3">
          {error}
        </Callout>
      ) : null}

      <Field label={t("shift.pinLabel")} required>
        <Input
          type="password"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </Field>
    </Modal>
  );
}
