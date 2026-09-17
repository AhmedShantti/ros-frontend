"use client";

/**
 * Change your own password — `POST /auth/password/change`.
 *
 * The endpoint proves the current password before accepting a new one, and
 * revokes every *other* session on success. This one survives, so there is
 * no redirect afterwards; the confirmation says what happened elsewhere.
 *
 * FR-SEC-025 — the new password is judged against the tenant's password
 * policy (`services.securitySettings.passwordPolicy`, minimum never below
 * 10) and against the breached-password check before it is sent. The
 * breach check names its source: the k-anonymity range API when it answers,
 * the small bundled list when it cannot be reached. A breached password is
 * refused and the refusal is logged — without the password.
 *
 * Password *history* cannot be checked here: only the server holds the
 * previous hashes. The rule list says the server enforces it.
 *
 * Demo mode has no account store to change anything in, so the form reports
 * that rather than pretending to succeed — but the policy and breach checks
 * can still be tried.
 */

import { useState } from "react";
import { z } from "zod";
import { KeyRound, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { ServiceError, services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useSecurityLog } from "@/lib/console/security-log";
import { checkBreached, type BreachResult } from "@/lib/console/security-breach";
import { DEFAULT_PASSWORD_POLICY, passwordMeetsPolicy, type PasswordPolicy } from "@/lib/console/security-policy";
import { V } from "@/schemas/common";
import { Button, Callout, Card, CardHeader, Input } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { BreachMessage, PasswordChecklist } from "@/components/console/security-password";

function schemaFor(policy: PasswordPolicy, email: string | null) {
  return z
    .object({
      currentPassword: z.string().min(1, V.required),
      password: z
        .string()
        .max(128, V.max(128))
        .refine((value) => passwordMeetsPolicy(value, policy, email), { message: V.passwordWeak }),
      confirm: z.string().min(1, V.required),
    })
    .refine((v) => v.password === v.confirm, { message: V.passwordMismatch, path: ["confirm"] })
    .refine((v) => v.password !== v.currentPassword, { message: V.passwordReused, path: ["password"] });
}
type ChangeInput = z.infer<ReturnType<typeof schemaFor>>;

export function ChangePasswordCard() {
  const { t } = useI18n();
  // A policy that cannot be read falls back to the default, never to "no rules".
  const policy = useAsync(
    () => services.securitySettings.passwordPolicy().then((row) => row.value).catch(() => DEFAULT_PASSWORD_POLICY),
    [],
  );

  return (
    <Card>
      <CardHeader title={t("auth.changePassword")} spec="FR-SEC-025" />
      {policy.data ? <ChangePasswordForm policy={policy.data} /> : null}
    </Card>
  );
}

function ChangePasswordForm({ policy }: { policy: PasswordPolicy }) {
  const { t } = useI18n();
  const { session } = useSession();
  const record = useSecurityLog();
  const email = session?.user.email ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [breach, setBreach] = useState<BreachResult | null>(null);
  const [done, setDone] = useState(false);

  const live = DATA_MODE === "http";

  const form = useZodForm(schemaFor(policy, email), {
    defaultValues: { currentPassword: "", password: "", confirm: "" },
  });
  const candidate = form.watch("password") ?? "";

  async function onSubmit(values: ChangeInput) {
    setSubmitting(true);
    setSubmitError(null);
    setDone(false);

    try {
      // FR-SEC-025 — the breach check runs before anything is sent.
      const result = await checkBreached(values.password);
      setBreach(result);
      if (result.breached) {
        form.setError("password", { message: t("pwd.breachedRefused") });
        await record({
          kind: "password.breach_refused",
          subjectType: "user",
          subjectId: session?.user.id ?? "unknown",
          detail: { source: result.source, flow: "change_password" },
        });
        return;
      }

      if (!live) {
        setSubmitError(t("auth.changePasswordDemo"));
        return;
      }

      await api.password.change({
        currentPassword: values.currentPassword,
        newPassword: values.password,
      });
      setDone(true);
      setBreach(null);
      form.reset();
    } catch (error) {
      // 401 here means the *current* password was wrong, not that the
      // session expired — saying "sign in again" would be a lie.
      const message =
        error instanceof ServiceError
          ? error.status === 401
            ? t("auth.errorCurrentPassword")
            : error.message
          : t("auth.errorNetwork");
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!live ? (
        <Callout tone="muted" className="mt-3">
          {t("auth.changePasswordDemo")}
        </Callout>
      ) : null}

      {done ? (
        <Callout tone="good" className="mt-3">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} aria-hidden />
            {t("auth.passwordChanged")}
          </span>
        </Callout>
      ) : null}

      <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-4">
        <FormField<ChangeInput> name="currentPassword" label={t("auth.currentPassword")} required>
          {({ id, ...aria }) => (
            <Input id={id} type="password" autoComplete="current-password" {...aria} {...form.register("currentPassword")} />
          )}
        </FormField>

        <FormField<ChangeInput> name="password" label={t("auth.newPassword")} required>
          {({ id, ...aria }) => (
            <Input id={id} type="password" autoComplete="new-password" {...aria} {...form.register("password")} />
          )}
        </FormField>

        <div className="space-y-1.5">
          <PasswordChecklist password={candidate} policy={policy} email={email} />
          {policy.historyCount > 0 ? (
            <p className="text-fg-subtle text-xs">{t("pwd.historyServer").replace("{n}", String(policy.historyCount))}</p>
          ) : null}
          {breach ? <BreachMessage result={breach} /> : <p className="text-fg-subtle text-xs">{t("pwd.breachOnSubmit")}</p>}
        </div>

        <FormField<ChangeInput> name="confirm" label={t("auth.confirmPassword")} required>
          {({ id, ...aria }) => (
            <Input id={id} type="password" autoComplete="new-password" {...aria} {...form.register("confirm")} />
          )}
        </FormField>

        <Button type="submit" variant="primary" loading={submitting} icon={<KeyRound size={14} />}>
          {t("auth.changePassword")}
        </Button>
      </Form>
    </>
  );
}
