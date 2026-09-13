"use client";

/**
 * Idle timeout — FR-SEC-026.
 *
 * "Sessions SHALL expire after a configurable idle period: default … 60
 * minutes on dashboard." The period comes from the settings cascade
 * (`sec.consoleIdleMinutes`), so a tenant that wants 15 sets it once.
 *
 * What happens at the end is a lock, not a sign-out. The page stays mounted
 * underneath a screen that asks for the password again (and the second step,
 * when the person has one), so a half-finished purchase order survives a
 * lunch break. The password is checked for real against `POST /auth/login`
 * in a live deployment; a failed or abandoned unlock ends in a proper sign-
 * out after a further grace period.
 *
 * Activity in any tab counts for all of them: a manager working in the audit
 * log in one tab should not come back to a lock screen on the dashboard in
 * another. That is what the shared storage key is for.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { DATA_MODE } from "@/lib/api/config";
import { reauthenticate } from "@/lib/api/auth";
import { SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import { Button, Callout, Field, Input } from "@/components/console/ui";

const ACTIVITY_KEY = "ros.console.lastActivity";
const WARN_SECONDS = 60;
/** After the lock, how long before the session is ended outright. */
const HARD_LIMIT_MINUTES = 30;

function now(): number {
  return Date.now();
}

function readShared(): number {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    return raw ? Number(raw) : now();
  } catch {
    return now();
  }
}

function writeShared(at: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Single-tab behaviour is still correct without storage.
  }
}

/**
 * Tracks the last moment anyone touched any tab, and reports where the
 * session stands against `minutes`.
 */
export function useIdle(minutes: number, paused: boolean) {
  const last = useRef<number>(0);
  const [phase, setPhase] = useState<"active" | "warning" | "locked">("active");
  const [secondsLeft, setSecondsLeft] = useState(WARN_SECONDS);

  const touch = useCallback(() => {
    const at = now();
    // Throttled: a mouse move per frame would thrash storage.
    if (at - last.current < 5_000) return;
    last.current = at;
    writeShared(at);
  }, []);

  useEffect(() => {
    last.current = readShared();
    if (now() - last.current > minutes * 60_000) {
      // A stale timestamp from an old visit is not this visit's idleness.
      last.current = now();
      writeShared(last.current);
    }
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY && event.newValue) last.current = Number(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.removeEventListener("storage", onStorage);
    };
  }, [minutes, touch]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      const shared = readShared();
      if (shared > last.current) last.current = shared;
      const idleMs = now() - last.current;
      const limitMs = minutes * 60_000;
      if (idleMs >= limitMs) {
        setPhase("locked");
      } else if (idleMs >= limitMs - WARN_SECONDS * 1000) {
        setPhase((current) => (current === "locked" ? current : "warning"));
        setSecondsLeft(Math.max(0, Math.ceil((limitMs - idleMs) / 1000)));
      } else {
        setPhase((current) => (current === "locked" ? current : "active"));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [minutes, paused]);

  const stayActive = useCallback(() => {
    last.current = now();
    writeShared(last.current);
    setPhase("active");
  }, []);

  return { phase, secondsLeft, stayActive };
}

function useConsoleIdleMinutes(): number {
  const { tenant } = useSession();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);
  const resolved = resolveSetting(SETTING_BY_KEY.get("sec.consoleIdleMinutes")!, overrides.data ?? [], {
    countryCode: tenant.countryCode,
    tenantId: tenant.id,
    brandId: null,
    branchId: null,
    terminalId: null,
  });
  return Math.max(2, Number(resolved.value) || 60);
}

export function ConsoleIdleLock() {
  const minutes = useConsoleIdleMinutes();
  const [unlocking, setUnlocking] = useState(false);
  const { phase, secondsLeft, stayActive } = useIdle(minutes, unlocking);

  if (phase === "active") return null;
  if (phase === "warning") return <IdleWarning secondsLeft={secondsLeft} onStay={stayActive} />;
  return (
    <LockScreen
      minutes={minutes}
      onUnlocking={setUnlocking}
      onUnlocked={() => {
        setUnlocking(false);
        stayActive();
      }}
    />
  );
}

function IdleWarning({ secondsLeft, onStay }: { secondsLeft: number; onStay: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-x-0 bottom-6 z-100 flex justify-center px-4">
      <div className="bg-fg text-surface flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl">
        <Lock size={16} aria-hidden />
        <p className="text-sm">{t("idle.warning").replace("{n}", String(secondsLeft))}</p>
        <Button size="sm" variant="primary" onClick={onStay} data-autofocus>
          {t("idle.stay")}
        </Button>
      </div>
    </div>
  );
}

function LockScreen({
  minutes,
  onUnlocking,
  onUnlocked,
}: {
  minutes: number;
  onUnlocking: (busy: boolean) => void;
  onUnlocked: () => void;
}) {
  const { t } = useI18n();
  const { session, signOut } = useSession();
  const action = useAction();
  const email = session?.user.email ?? "";
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [lockedAt] = useState(() => now());

  const mfa = useAsync(() => (email ? services.mfa.status(email) : Promise.resolve(null)), [email]);
  const needsCode = mfa.data?.enrolled ?? false;

  // An abandoned lock ends the session for real.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (now() - lockedAt > HARD_LIMIT_MINUTES * 60_000) signOut();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [lockedAt, signOut]);

  // The page underneath must not scroll or take focus.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function unlock() {
    onUnlocking(true);
    await action.run(
      async () => {
        if (DATA_MODE === "http") {
          await reauthenticate(email, password);
        } else if (!password.trim()) {
          throw new Error(t("idle.passwordRequired"));
        }
        if (needsCode) await services.mfa.verify(email, code);
      },
      {
        onSuccess: () => {
          setPassword("");
          setCode("");
          onUnlocked();
        },
      },
    );
    onUnlocking(false);
  }

  return (
    <div className="bg-surface/95 fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="idle-lock-title" className="bg-raised border-line w-full max-w-sm rounded-2xl border p-6 shadow-2xl">
        <div className="bg-accent-soft text-accent mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Lock size={20} aria-hidden />
        </div>
        <h2 id="idle-lock-title" className="text-fg text-center text-lg font-semibold">
          {t("idle.lockedTitle")}
        </h2>
        <p className="text-fg-muted mt-1 text-center text-sm">
          {t("idle.lockedBody").replace("{n}", String(minutes))}
        </p>

        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <Field label={t("auth.email")}>
            <Input value={email} readOnly dir="ltr" />
          </Field>
          <Field label={t("auth.password")} hint={DATA_MODE === "http" ? undefined : t("idle.demoPassword")}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-autofocus
            />
          </Field>
          {needsCode ? (
            <Field label={t("mfa.code")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="font-mono tracking-widest"
              />
            </Field>
          ) : null}
          <Button type="submit" variant="primary" className="w-full" loading={action.pending} disabled={!password}>
            {t("idle.unlock")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
            {t("idle.signOutInstead")}
          </Button>
        </form>
      </div>
    </div>
  );
}
