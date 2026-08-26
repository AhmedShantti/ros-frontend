"use client";

/**
 * Forgot password.
 *
 * The response is identical whether or not the address matches an account.
 * Telling an anonymous caller "no account uses that email" turns this form
 * into a free account-enumeration oracle, so the confirmation is unconditional
 * and deliberately vague.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, Send } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { ServiceError } from "@/lib/console/services";
import { Button, Callout, Card, Input } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/schemas/auth";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const live = DATA_MODE === "http";

  const form = useZodForm(forgotPasswordSchema, { defaultValues: { email: "" } });

  async function onSubmit(values: ForgotPasswordInput) {
    setSubmitting(true);
    setSubmitError(null);

    if (!live) {
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      setSent(true);
      setSubmitting(false);
      return;
    }

    try {
      await api.password.forgot({ email: values.email });
      setSent(true);
    } catch (error) {
      // A 4xx here would itself be an enumeration signal, so the endpoint
      // does not send one. Anything that does arrive is a transport or
      // rate-limit problem, and the user needs to know the mail was not sent.
      setSubmitError(
        error instanceof ServiceError
          ? error.message
          : t("auth.errorNetwork"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <Card className="ros-fade-in">
        <div className="text-good flex items-center gap-2">
          <MailCheck size={18} aria-hidden />
          <h1 className="text-fg text-lg font-semibold">{t("auth.forgotSentTitle")}</h1>
        </div>
        <p className="text-fg-muted mt-2 text-xs leading-relaxed">{t("auth.forgotSentBody")}</p>

        {/* The demo has no mailbox, so it hands over the token itself. Live,
            the token only ever arrives by email — offering a link here would
            be offering one that cannot work. */}
        {live ? null : (
          <Callout tone="muted" className="mt-4">
            {t("auth.forgotDemoNote")}
          </Callout>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {live ? null : (
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                window.location.href = "/reset-password?token=demo";
              }}
            >
              {t("auth.continueToReset")}
            </Button>
          )}
          <Link
            href="/login"
            className="text-fg-muted hover:text-fg inline-flex items-center justify-center gap-1.5 py-1 text-xs transition-colors"
          >
            <ArrowLeft size={12} className="rtl:rotate-180" aria-hidden />
            {t("auth.backToSignIn")}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.forgotTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.forgotLede")}</p>

      <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-5">
        <FormField<ForgotPasswordInput> name="email" label={t("auth.email")} required>
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

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          icon={<Send size={14} />}
          className="w-full"
        >
          {t("auth.forgotSubmit")}
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
