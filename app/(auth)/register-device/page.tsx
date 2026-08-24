"use client";

/**
 * Register this device — FR-SEC-030.
 *
 * The sign-in screen has always linked here; the route did not exist, so
 * every click was a 404. The screen was designed — all of its copy is in the
 * dictionary, and `bindTerminal()` has been sitting in the API layer — it was
 * simply never built.
 *
 * The pairing code is the credential. A terminal cannot enrol itself: a
 * manager issues the code in the console, which is what keeps "any device on
 * the network can start taking payments" from being true.
 *
 * Against a live API this binds the terminal and stores the returned tokens.
 * With no API configured it confirms locally, because there is nothing to
 * pair with — and it says so rather than implying a device was registered
 * somewhere.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, MonitorCheck, ScanLine } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { DATA_MODE } from "@/lib/api/config";
import { bindTerminal } from "@/lib/api/auth";
import { ServiceError } from "@/lib/console/services";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  Select,
  Toggle,
} from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { registerDeviceSchema, type RegisterDeviceInput } from "@/schemas/auth";

export default function RegisterDevicePage() {
  const { t } = useI18n();
  const [registered, setRegistered] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = DATA_MODE === "http";

  const form = useZodForm(registerDeviceSchema, {
    defaultValues: {
      pairingCode: "",
      deviceName: "",
      deviceType: "pos",
      printerAttached: true,
    },
  });

  async function onSubmit(values: RegisterDeviceInput) {
    setSubmitting(true);
    setError(null);
    try {
      if (live) {
        // The pairing code *is* the terminal reference the API binds against.
        await bindTerminal(values.pairingCode);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      setRegistered(values.pairingCode);
    } catch (cause) {
      setError(
        cause instanceof ServiceError ? cause.message : t("auth.errorInvalid"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (registered) {
    return (
      <Card className="ros-fade-in">
        <div className="text-good flex items-center gap-2">
          <MonitorCheck size={18} aria-hidden />
          <h1 className="text-fg text-lg font-semibold">
            {t("auth.deviceRegisteredTitle")}
          </h1>
        </div>
        <p className="text-fg-muted mt-2 text-xs leading-relaxed">
          {t("auth.deviceRegisteredBody")}
        </p>

        <div className="mt-4">
          <Field label={t("auth.deviceId")}>
            <Input readOnly value={registered} dir="ltr" />
          </Field>
        </div>

        {live ? null : (
          <Callout tone="muted" className="mt-4">
            {t("auth.deviceDemoNote")}
          </Callout>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full"
            icon={<ScanLine size={14} />}
            onClick={() => {
              window.location.href = "/pos";
            }}
          >
            {t("auth.openPos")}
          </Button>
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
      <h1 className="text-fg text-lg font-semibold">{t("auth.deviceTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">
        {t("auth.deviceLede")}
      </p>

      {error ? (
        <Callout tone="bad" className="mt-4">
          {error}
        </Callout>
      ) : null}

      <Form form={form} onSubmit={onSubmit} className="mt-5">
        <FormField<RegisterDeviceInput>
          name="pairingCode"
          label={t("auth.pairingCode")}
          hint={t("auth.pairingHint")}
          required
        >
          {({ id, ...aria }) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={8}
              {...aria}
              {...form.register("pairingCode")}
            />
          )}
        </FormField>

        <FormField<RegisterDeviceInput>
          name="deviceName"
          label={t("auth.deviceName")}
          hint={t("auth.deviceNameHint")}
          required
        >
          {({ id, ...aria }) => (
            <Input id={id} {...aria} {...form.register("deviceName")} />
          )}
        </FormField>

        <FormField<RegisterDeviceInput> name="deviceType" label={t("auth.deviceType")}>
          {({ id, ...aria }) => (
            <Select id={id} {...aria} {...form.register("deviceType")}>
              <option value="pos">{t("term.pos")}</option>
              <option value="kds">{t("term.kds")}</option>
              <option value="kiosk">{t("auth.deviceKiosk")}</option>
            </Select>
          )}
        </FormField>

        <Toggle
          checked={form.watch("printerAttached")}
          onChange={(next: boolean) => form.setValue("printerAttached", next)}
          label={t("auth.printerAttached")}
        />

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          icon={<KeyRound size={14} />}
          className="w-full"
        >
          {t("auth.registerDevice")}
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
