"use client";

/**
 * Sign-in.
 *
 * Nothing leaves the browser. `authenticate()` is a lookup against the demo
 * account table, and the account decides the permission set every screen
 * afterwards renders against — so the account picker below is not a
 * convenience, it is the main control on this page.
 *
 * Roles holding a privileged permission are routed through MFA first
 * (FR-SEC-024), and roles that work at a terminal land on the terminal rather
 * than on a dashboard they are not allowed to read.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { ROLE_DEFINITIONS } from "@/lib/console/permissions";
import { AuthError, DEMO_ACCOUNTS, DEMO_PASSWORD, authenticate } from "@/lib/console/mock/accounts";
import { setPendingRole, takeReturnTo } from "@/lib/console/auth";
import { useI18n, useSession } from "@/lib/console/providers";
import { Badge, Button, Callout, Card, Input } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { loginSchema, type LoginInput } from "@/schemas/auth";

const FAILURE_KEY = {
  unknown_email: "auth.errorUnknownEmail",
  bad_password: "auth.errorBadPassword",
  bad_pin: "auth.errorInvalid",
  locked: "auth.errorLocked",
} as const;

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { signIn } = useSession();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "", remember: true },
  });

  function fill(email: string) {
    form.setValue("email", email);
    form.setValue("password", DEMO_PASSWORD);
    setSubmitError(null);
  }

  async function onSubmit(values: LoginInput) {
    setSubmitError(null);
    setSubmitting(true);

    // Stands in for POST /v1/auth/login. The delay is deliberate: the pending
    // state should be a state the user sees, not a flicker.
    await new Promise((resolve) => window.setTimeout(resolve, 380));

    try {
      const { account, mfaRequired } = authenticate(values.email, values.password);

      if (mfaRequired) {
        setPendingRole(account.roleKey);
        router.push("/mfa");
        return;
      }

      signIn(account.roleKey, true);
      router.replace(takeReturnTo() ?? account.home);
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : "bad_password";
      setSubmitError(t(FAILURE_KEY[reason]));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="ros-fade-in">
        <h1 className="text-fg text-lg font-semibold">{t("auth.signInTitle")}</h1>
        <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.signInLede")}</p>

        <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-5">
          <FormField<LoginInput> name="email" label={t("auth.email")} required>
            {({ id, ...aria }) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                placeholder={t("auth.emailPlaceholder")}
                {...aria}
                {...form.register("email")}
              />
            )}
          </FormField>

          <FormField<LoginInput> name="password" label={t("auth.password")} required>
            {({ id, ...aria }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...aria}
                {...form.register("password")}
              />
            )}
          </FormField>

          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            icon={<LogIn size={14} />}
            className="w-full"
          >
            {submitting ? t("auth.signingIn") : t("auth.signIn")}
          </Button>

          <div className="text-fg-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link href="/forgot-password" className="hover:text-fg transition-colors">
              {t("auth.forgot")}
            </Link>
            <Link
              href="/register-device"
              className="hover:text-fg inline-flex items-center gap-1.5 transition-colors"
            >
              <KeyRound size={12} aria-hidden />
              {t("auth.deviceTitle")}
            </Link>
          </div>
        </Form>
      </Card>

      <DemoAccountPicker onPick={fill} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DemoAccountPicker({ onPick }: { onPick: (email: string) => void }) {
  const { t, tx } = useI18n();

  return (
    <Card className="ros-fade-in">
      <h2 className="text-fg text-sm font-semibold">{t("auth.demoAccounts")}</h2>
      <p className="text-fg-muted mt-1 text-xs leading-relaxed">{t("auth.demoAccountsHint")}</p>

      <p className="text-fg-subtle mt-3 text-xs">
        {t("auth.demoPassword")}:{" "}
        <code className="bg-sunken text-fg rounded px-1.5 py-0.5 font-mono text-xs" dir="ltr">
          {DEMO_PASSWORD}
        </code>
      </p>

      <ul className="mt-3 max-h-80 overflow-y-auto">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.roleKey}>
            <button
              type="button"
              onClick={() => onPick(account.email)}
              className="border-line hover:bg-sunken focus-visible:bg-sunken flex w-full items-center gap-3 border-b px-1 py-2.5 text-start transition-colors last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="text-fg block text-xs font-medium">
                  {tx(ROLE_DEFINITIONS[account.roleKey].name)}
                </span>
                <span className="text-fg-subtle block truncate text-xs" dir="ltr">
                  {account.email}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-1.5">
                {account.requiresMfa ? (
                  <Badge tone="warn">
                    <ShieldCheck size={11} aria-hidden />
                    <span className="sr-only">{t("auth.mfaRequired")}</span>
                  </Badge>
                ) : null}
                <Badge tone="muted">
                  <span className="font-mono" dir="ltr">
                    {account.pin}
                  </span>
                  <span className="sr-only"> {t("auth.pinLabel")}</span>
                </Badge>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Callout tone="muted" className="mt-3">
        {t("auth.pinNote")}
      </Callout>
    </Card>
  );
}
