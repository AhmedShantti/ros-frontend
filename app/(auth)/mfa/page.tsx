"use client";

/**
 * Second factor.
 *
 * Reached only by roles that hold a privileged permission — FR-SEC-024 makes
 * MFA mandatory for those, not optional. Any six digits are accepted here;
 * the point is the shape of the flow, not the arithmetic.
 */

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ROLE_DEFINITIONS, type RoleKey } from "@/lib/console/permissions";
import { clearPendingRole, readPendingRole } from "@/lib/console/auth";
import { useI18n, useSession } from "@/lib/console/providers";
import { Badge, Button, Callout, Card } from "@/components/console/ui";

const LENGTH = 6;

export default function MfaPage() {
  const router = useRouter();
  const { t, tx } = useI18n();
  const { signIn } = useSession();

  const [role, setRole] = useState<RoleKey | null>(null);
  const [digits, setDigits] = useState<string[]>(() => Array<string>(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // Arriving here without having chosen a role means the flow was skipped.
  useEffect(() => {
    const pending = readPendingRole();
    if (!pending) {
      router.replace("/login");
      return;
    }
    setRole(pending);
    inputs.current[0]?.focus();
  }, [router]);

  function setDigitAt(index: number, value: string) {
    setDigits((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function onDigitChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, "").slice(-1);
    setDigitAt(index, value);
    if (value && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      setDigitAt(index - 1, "");
      inputs.current[index - 1]?.focus();
    }
    // The boxes read left-to-right in both directions — they are one number.
    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    const next = Array<string>(LENGTH).fill("");
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i]!;
    setDigits(next);
    inputs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (digits.some((digit) => digit === "")) {
      setError(t("auth.mfaError"));
      return;
    }

    setError(null);
    setVerifying(true);
    window.setTimeout(() => {
      signIn(role ?? "owner", true);
      clearPendingRole();
      router.replace("/dashboard");
    }, 480);
  }

  return (
    <Card className="ros-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-fg text-lg font-semibold">{t("auth.mfaTitle")}</h1>
          <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.mfaLede")}</p>
        </div>
        {role ? <Badge tone="accent">{tx(ROLE_DEFINITIONS[role].name)}</Badge> : null}
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <fieldset>
          <legend className="text-fg text-xs font-medium">{t("auth.mfaCode")}</legend>
          <div className="mt-2 flex justify-between gap-2" dir="ltr">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                value={digit}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                aria-label={`${t("auth.mfaCode")} ${index + 1}`}
                maxLength={1}
                onChange={(event) => onDigitChange(index, event.target.value)}
                onKeyDown={(event) => onKeyDown(index, event)}
                onPaste={onPaste}
                className="border-line bg-raised text-fg focus:border-accent h-12 w-full rounded-lg border text-center font-mono text-lg outline-none transition-colors"
              />
            ))}
          </div>
          <p className="text-fg-subtle mt-2 text-xs">{t("auth.mfaHint")}</p>
        </fieldset>

        {error ? <Callout tone="bad">{error}</Callout> : null}

        <Button
          type="submit"
          variant="primary"
          loading={verifying}
          icon={<ShieldCheck size={14} />}
          className="w-full"
        >
          {verifying ? t("auth.mfaVerifying") : t("auth.mfaVerify")}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDigits(Array<string>(LENGTH).fill(""))}
            className="text-fg-muted hover:text-fg text-xs transition-colors"
          >
            {t("auth.mfaResend")}
          </button>
          <button
            type="button"
            onClick={() => {
              clearPendingRole();
              router.replace("/login");
            }}
            className="text-fg-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
          >
            <ArrowLeft size={12} className="rtl:rotate-180" />
            {t("auth.mfaBack")}
          </button>
        </div>
      </form>
    </Card>
  );
}
