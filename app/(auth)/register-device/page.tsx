"use client";

/**
 * Register this device — FR-SEC-030.
 *
 * The pairing code is the credential. A terminal cannot enrol itself: a
 * manager issues the code in the console, which is what keeps "any device on
 * the network can start taking payments" from being true.
 *
 * ## Live and demo differ here, and they have to
 *
 * The demo screen asks for an eight-digit pairing code. The backend has no
 * such concept — there is no pairing-code endpoint, and nothing accepts one.
 * What it has is:
 *
 *   GET  /auth/terminals                        the tenant's registered tills
 *   POST /auth/terminals                        register a new one on a branch
 *   POST /auth/terminal                         bind *this session* to one
 *   POST /auth/terminals/{id}/fingerprints      enrol this device against it
 *
 * So live, the code field is replaced by the thing it stood in for: a list
 * of real terminals to bind to, and a form to add one. Both are authorised
 * server-side, which is the same guarantee the pairing code was there to
 * provide — a device still cannot enrol itself without a session that may.
 *
 * Demo mode keeps the original screen, because with no backend there is
 * nothing to list and the code is the only thing it can meaningfully ask for.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, MonitorCheck, Plus, ScanLine } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { DATA_MODE } from "@/lib/api/config";
import { isSignedIn } from "@/lib/api/session";
import {
  bindTerminalFromThisDevice,
  listTerminals,
  registerTerminal,
  type TerminalRow,
} from "@/lib/api/auth";
import { setReturnTo } from "@/lib/console/auth";
import { ServiceError } from "@/lib/console/services";
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Toggle,
} from "@/components/console/ui";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { registerDeviceSchema, type RegisterDeviceInput } from "@/schemas/auth";

export default function RegisterDevicePage() {
  const live = DATA_MODE === "http";
  return live ? <LiveDeviceBinding /> : <DemoDevicePairing />;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function LiveDeviceBinding() {
  const { t, tx } = useI18n();
  const router = useRouter();
  const { availableBranches, org } = useSession();

  const [terminals, setTerminals] = useState<TerminalRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bound, setBound] = useState<TerminalRow | null>(null);
  const [adding, setAdding] = useState(false);

  /*
   * Binding a terminal is an authenticated call; there is nothing useful to
   * show someone who is not signed in but a way to sign in.
   *
   * The token is in `localStorage`, which the server render cannot see, so
   * this cannot be read during render: the server always decided "signed
   * out" and rendered the sign-in prompt, the client decided "signed in" and
   * rendered the terminal list, and React threw the tree away as a
   * hydration mismatch. Nothing is decided until after mount.
   */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(isSignedIn()), []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    listTerminals()
      .then((rows) => {
        if (!cancelled) setTerminals(rows);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setTerminals([]);
        setLoadError(
          cause instanceof ServiceError ? cause.message : t("auth.errorNetwork"),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, t]);

  async function bind(terminal: TerminalRow) {
    setBusyId(terminal.id);
    setError(null);
    try {
      await bindTerminalFromThisDevice(terminal.id);
      setBound(terminal);
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : t("auth.errorNetwork"));
    } finally {
      setBusyId(null);
    }
  }

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

  if (bound) {
    return <RegisteredConfirmation identifier={bound.name} detail={bound.id} live />;
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.deviceTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.deviceLedeLive")}</p>

      {error ? (
        <Callout tone="bad" className="mt-4">
          {error}
        </Callout>
      ) : null}
      {loadError ? (
        <Callout tone="bad" className="mt-4">
          {loadError}
        </Callout>
      ) : null}

      {terminals === null ? (
        <div className="text-fg-subtle mt-5 flex items-center gap-2 text-xs">
          <Spinner size={14} />
          {t("state.loading")}
        </div>
      ) : (
        <>
          {terminals.length === 0 ? (
            <Callout tone="muted" className="mt-4">
              {t("auth.deviceNoTerminals")}
            </Callout>
          ) : (
            <ul className="mt-4">
              {terminals.map((terminal) => {
                const usable = terminal.status === "active";
                return (
                  <li key={terminal.id}>
                    <button
                      type="button"
                      disabled={!usable || busyId !== null}
                      onClick={() => bind(terminal)}
                      className="border-line hover:bg-sunken focus-visible:bg-sunken flex w-full items-center gap-3 border-b px-1 py-3 text-start transition-colors last:border-b-0 disabled:opacity-50"
                    >
                      <MonitorCheck size={14} className="text-fg-subtle shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="text-fg block text-xs font-medium">{terminal.name}</span>
                        <span className="text-fg-subtle block truncate text-xs" dir="ltr">
                          {terminal.terminalType} · {terminal.id}
                        </span>
                      </span>
                      <span className="shrink-0">
                        {busyId === terminal.id ? (
                          <Spinner size={13} />
                        ) : (
                          <Badge tone={usable ? "good" : "muted"}>{terminal.status}</Badge>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {adding ? (
            <NewTerminalForm
              branches={availableBranches.map((branch) => ({
                id: branch.id,
                label: `${tx(branch.name)} · ${branch.code}`,
              }))}
              busy={org.loading}
              onCancel={() => setAdding(false)}
              onCreated={async (terminal) => {
                setTerminals((rows) => [...(rows ?? []), terminal]);
                setAdding(false);
                await bind(terminal);
              }}
            />
          ) : (
            <Button
              variant="secondary"
              className="mt-4 w-full"
              icon={<Plus size={14} />}
              onClick={() => setAdding(true)}
            >
              {t("auth.deviceRegisterNew")}
            </Button>
          )}
        </>
      )}

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

/** `POST /auth/terminals` — a new till on a branch. */
function NewTerminalForm({
  branches,
  busy,
  onCancel,
  onCreated,
}: {
  branches: { id: string; label: string }[];
  busy: boolean;
  onCancel: () => void;
  onCreated: (terminal: TerminalRow) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [terminalType, setTerminalType] = useState<"pos" | "kds" | "kiosk">("pos");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branches, branchId]);

  async function submit() {
    if (!name.trim() || !branchId) return;
    setSubmitting(true);
    setError(null);
    try {
      onCreated(await registerTerminal({ branchId, name: name.trim(), terminalType }));
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : t("auth.errorNetwork"));
      setSubmitting(false);
    }
  }

  return (
    <div className="border-line mt-4 space-y-4 rounded-lg border p-3">
      {error ? <Callout tone="bad">{error}</Callout> : null}

      <Field label={t("auth.deviceName")} hint={t("auth.deviceNameHint")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
      </Field>

      <Field label={t("term.branch")} required>
        <Select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          disabled={busy || branches.length === 0}
        >
          {branches.length === 0 ? <option value="">—</option> : null}
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("auth.deviceType")}>
        <Select
          value={terminalType}
          onChange={(e) => setTerminalType(e.target.value as "pos" | "kds" | "kiosk")}
        >
          <option value="pos">{t("term.pos")}</option>
          <option value="kds">{t("term.kds")}</option>
          <option value="kiosk">{t("auth.deviceKiosk")}</option>
        </Select>
      </Field>

      <div className="flex gap-2">
        <Button
          variant="primary"
          loading={submitting}
          disabled={!name.trim() || !branchId}
          icon={<KeyRound size={14} />}
          onClick={submit}
        >
          {t("auth.registerDevice")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
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
}: {
  identifier: string;
  detail: string;
  live: boolean;
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
        <Field label={t("auth.deviceName")}>
          <Input readOnly value={identifier} dir="ltr" />
        </Field>
        <Field label={t("auth.deviceId")}>
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
