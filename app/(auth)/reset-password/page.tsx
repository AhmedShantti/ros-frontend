"use client";

/**
 * Reset password.
 *
 * The rules are listed and tick off as they are met, rather than being
 * revealed one at a time by successive rejections. A strength bar is not
 * offered: it rewards "P@ssw0rd!" and punishes a long passphrase, which is
 * exactly backwards.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Lock, X } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { DEMO_ACCOUNTS } from "@/lib/console/mock/accounts";
import { Button, Card, Input } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { resetPasswordSchema, type ResetPasswordInput } from "@/schemas/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { signIn } = useSession();
  const [submitting, setSubmitting] = useState(false);

  const form = useZodForm(resetPasswordSchema, {
    defaultValues: { password: "", confirm: "" },
  });

  const password = form.watch("password") ?? "";

  const rules = [
    { key: "auth.ruleLength" as const, met: password.length >= 12 },
    { key: "auth.ruleCase" as const, met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { key: "auth.ruleDigit" as const, met: /\d/.test(password) },
  ];

  async function onSubmit(_values: ResetPasswordInput) {
    setSubmitting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    // A real reset returns a fresh session. The demo signs in as the owner,
    // which is the account the reset link in the seeded mailbox belongs to.
    // A password reset is not a second factor.
    signIn(DEMO_ACCOUNTS[0]!.roleKey, false);
    router.replace("/dashboard");
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.resetTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.resetLede")}</p>

      <Form form={form} onSubmit={onSubmit} className="mt-5">
        <FormField<ResetPasswordInput> name="password" label={t("auth.newPassword")} required>
          {({ id, ...aria }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              {...aria}
              {...form.register("password")}
            />
          )}
        </FormField>

        <fieldset className="border-line bg-sunken rounded-lg border px-3 py-2.5">
          <legend className="sr-only">{t("auth.passwordRules")}</legend>
          <p className="text-fg-subtle mb-1.5 text-xs font-medium">{t("auth.passwordRules")}</p>
          <ul className="space-y-1">
            {rules.map((rule) => (
              <li
                key={rule.key}
                className={`flex items-center gap-1.5 text-xs ${
                  rule.met ? "text-good" : "text-fg-subtle"
                }`}
              >
                {/* The icon carries the state as well as the colour — a
                    red/green pair alone fails WCAG 1.4.1. */}
                {rule.met ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <X size={12} aria-hidden />
                )}
                {t(rule.key)}
                <span className="sr-only">{rule.met ? " ✓" : ""}</span>
              </li>
            ))}
          </ul>
        </fieldset>

        <FormField<ResetPasswordInput> name="confirm" label={t("auth.confirmPassword")} required>
          {({ id, ...aria }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              {...aria}
              {...form.register("confirm")}
            />
          )}
        </FormField>

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          icon={<Lock size={14} />}
          className="w-full"
        >
          {t("auth.resetSubmit")}
        </Button>

        <Link
          href="/login"
          className="text-fg-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft size={12} className="rtl:rotate-180" aria-hidden />
          {t("auth.backToSignIn")}
        </Link>
      </Form>
    </Card>
  );
}
