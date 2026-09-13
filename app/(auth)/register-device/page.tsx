"use client";

/**
 * Set this device's branch — FR-SEC-030.
 *
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — this used to register/bind a ROS
 * Terminal (`POST /auth/terminals`, `POST /auth/terminal`, a device
 * fingerprint enrolment). POS and KDS are branch/employee application
 * sessions now, not registered Terminal/device ones: `POST /auth/pin` takes
 * `branchId` + `sessionType` directly, with no terminal to bind first. So
 * there is no network call on the "set up" step at all any more — a manager
 * picks one of the branches their OWN console session can see
 * (`useSession()`'s `availableBranches`, the same authorized list the
 * console's own branch switcher offers) and it is saved locally, once, as
 * this device's `deviceBranchId` (`lib/api/session.ts`). `/pos`/`/kds` read
 * it from there afterwards to know which branch a PIN sign-on is for.
 *
 * ## Live and demo differ here, and they have to
 *
 * Demo mode has no backend and no real branch list to authorise against, so
 * it keeps its own self-contained pairing-code screen — a simulated device
 * setup for a simulated POS, matching `components/terminal/pos-*.tsx`'s own
 * demo/live split elsewhere.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, KeyRound, MonitorCheck, ScanLine } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { DATA_MODE } from "@/lib/api/config";
import { isSignedIn, setDeviceBranchId } from "@/lib/api/session";
import { setReturnTo } from "@/lib/console/auth";
import { ServiceError } from "@/lib/console/services";
import { Button, Callout, Card, Field, Input, Select, Spinner, Toggle } from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { registerDeviceSchema, type RegisterDeviceInput } from "@/schemas/auth";

export default function RegisterDevicePage() {
  const live = DATA_MODE === "http";
  return live ? <LiveBranchSetup /> : <DemoDevicePairing />;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function LiveBranchSetup() {
  const { t, tx } = useI18n();
  const router = useRouter();
  const { branch, availableBranches, org } = useSession();

  /*
   * Picking a branch for this device only means anything for someone signed
   * in to the console; there is nothing useful to show someone who is not
   * but a way to sign in.
   *
   * The token is in `localStorage`, which the server render cannot see, so
   * this cannot be read during render: the server always decided "signed
   * out" and rendered the sign-in prompt, the client decided "signed in" and
   * rendered the branch list, and React threw the tree away as a hydration
   * mismatch. Nothing is decided until after mount.
   */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(isSignedIn()), []);

  const [branchId, setBranchId] = useState("");
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);

  // Defaults to whichever branch the console's OWN switcher is already
  // showing, when it has a real one selected — "already has an active
  // branch" from the console flows straight into this. Never overwrites a
  // choice the manager already made on this screen.
  useEffect(() => {
    setBranchId((current) => {
      if (current && availableBranches.some((b) => b.id === current)) return current;
      return branch?.id ?? availableBranches[0]?.id ?? "";
    });
  }, [branch, availableBranches]);

  if (signedIn === null) {
    return (
      <Card className="ros-fade-in">
        <div className="text-fg-subtle flex items-center gap-2 text-xs">
          <Spinner size={14} />
          {t("state.loading")}
        </div>
      </Card>
    );
  }

  if (!signedIn) {
    return (
      <Card className="ros-fade-in">
        <h1 className="text-fg text-lg font-semibold">{t("auth.deviceTitle")}</h1>
        <Callout tone="warn" className="mt-3">
          {t("auth.deviceNeedsSession")}
        </Callout>
        <Button
          variant="primary"
          className="mt-4 w-full"
          onClick={() => {
            setReturnTo("/register-device");
            router.push("/login");
          }}
        >
          {t("auth.signIn")}
        </Button>
      </Card>
    );
  }

  if (saved) {
    return (
      <RegisteredConfirmation
        identifier={saved.name}
        detail={saved.id}
        nameLabel={t("term.branch")}
        idLabel={t("auth.deviceBranchId")}
        live
      />
    );
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.deviceTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.deviceLedeLive")}</p>

      {org.error ? (
        <Callout tone="bad" className="mt-4">
          {org.error.message}
        </Callout>
      ) : null}

      {org.loading && availableBranches.length === 0 ? (
        <div className="text-fg-subtle mt-5 flex items-center gap-2 text-xs">
          <Spinner size={14} />
          {t("state.loading")}
        </div>
      ) : availableBranches.length === 0 ? (
        <Callout tone="muted" className="mt-4">
          {t("auth.deviceNoBranches")}
        </Callout>
      ) : (
        <div className="mt-4">
          <Field label={t("term.branch")} required>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {availableBranches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)} · {row.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!branchId}
        icon={<Check size={14} />}
        onClick={() => {
          const chosen = availableBranches.find((row) => row.id === branchId);
          if (!chosen) return;
          // A local write only — there is no bind call to make any more.
          setDeviceBranchId(chosen.id);
          setSaved({ id: chosen.id, name: tx(chosen.name) });
        }}
      >
        {t("auth.registerDevice")}
      </Button>

      <Link
        href="/login"
        className="text-fg-muted hover:text-fg mt-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} className="rtl:rotate-180" aria-hidden />
        {t("auth.backToSignIn")}
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

function DemoDevicePairing() {
  const { t } = useI18n();
  const [registered, setRegistered] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      setRegistered(values.pairingCode);
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : t("auth.errorInvalid"));
    } finally {
      setSubmitting(false);
    }
  }

  if (registered) {
    return <RegisteredConfirmation identifier={registered} detail={registered} live={false} />;
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.deviceTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.deviceLede")}</p>

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
          {({ id, ...aria }) => <Input id={id} {...aria} {...form.register("deviceName")} />}
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

// ---------------------------------------------------------------------------

function RegisteredConfirmation({
  identifier,
  detail,
  live,
  nameLabel,
  idLabel,
}: {
  identifier: string;
  detail: string;
  live: boolean;
  /** Defaults to the demo screen's "device" wording; live passes branch labels. */
  nameLabel?: string;
  idLabel?: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="ros-fade-in">
      <div className="text-good flex items-center gap-2">
        <MonitorCheck size={18} aria-hidden />
        <h1 className="text-fg text-lg font-semibold">{t("auth.deviceRegisteredTitle")}</h1>
      </div>
      <p className="text-fg-muted mt-2 text-xs leading-relaxed">
        {t("auth.deviceRegisteredBody")}
      </p>

      <div className="mt-4 space-y-3">
        <Field label={nameLabel ?? t("auth.deviceName")}>
          <Input readOnly value={identifier} dir="ltr" />
        </Field>
        <Field label={idLabel ?? t("auth.deviceId")}>
          <Input readOnly value={detail} dir="ltr" />
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
