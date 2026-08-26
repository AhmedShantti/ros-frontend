"use client";

/**
 * Change your own password — `POST /auth/password/change`.
 *
 * The endpoint proves the current password before accepting a new one, and
 * revokes every *other* session on success. This one survives, so there is
 * no redirect afterwards; the confirmation says what happened elsewhere.
 *
 * Demo mode has no account store to change anything in, so the form reports
 * that rather than pretending to succeed.
 */

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { ServiceError } from "@/lib/console/services";
import { useI18n } from "@/lib/console/providers";
import { Button, Callout, Card, CardHeader, Input } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { changePasswordSchema, type ChangePasswordInput } from "@/schemas/auth";

export function ChangePasswordCard() {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const live = DATA_MODE === "http";

  const form = useZodForm(changePasswordSchema, {
    defaultValues: { currentPassword: "", password: "", confirm: "" },
  });

  async function onSubmit(values: ChangePasswordInput) {
    setSubmitting(true);
    setSubmitError(null);
    setDone(false);

    try {
      await api.password.change({
        currentPassword: values.currentPassword,
        newPassword: values.password,
      });
      setDone(true);
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
    <Card>
      <CardHeader title={t("auth.changePassword")} spec="FR-SEC" />

      {!live ? (
        <Callout tone="muted" className="mt-3">
          {t("auth.changePasswordDemo")}
        </Callout>
      ) : (
        <>
          {done ? (
            <Callout tone="good" className="mt-3">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={13} aria-hidden />
                {t("auth.passwordChanged")}
              </span>
            </Callout>
          ) : null}

          <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-4">
            <FormField<ChangePasswordInput>
              name="currentPassword"
              label={t("auth.currentPassword")}
              required
            >
              {({ id, ...aria }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  {...aria}
                  {...form.register("currentPassword")}
                />
              )}
            </FormField>

            <FormField<ChangePasswordInput>
              name="password"
              label={t("auth.newPassword")}
              hint={t("auth.passwordRules")}
              required
            >
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

            <FormField<ChangePasswordInput>
              name="confirm"
              label={t("auth.confirmPassword")}
              required
            >
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
              icon={<KeyRound size={14} />}
            >
              {t("auth.changePassword")}
            </Button>
          </Form>
        </>
      )}
    </Card>
  );
}
