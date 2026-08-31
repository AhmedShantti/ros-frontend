"use client";

/**
 * Sign-in.
 *
 * Two modes, decided by whether `NEXT_PUBLIC_API_URL` is set:
 *
 *  - **Live.** The credentials go to `POST /auth/login`, and the token that
 *    comes back is what every later request carries. An account belonging to
 *    more than one tenant picks one here, because the token is not scoped —
 *    and therefore nothing the console reads works — until it has.
 *
 *  - **Demo.** Nothing leaves the browser: `authenticate()` is a lookup
 *    against the demo account table, and the account picker below is the
 *    main control on the page.
 *
 * Either way the role decides what the navigation renders. Roles holding a
 * privileged permission are routed through MFA first (FR-SEC-024), and roles
 * that work at a terminal land on the terminal rather than on a dashboard
 * they are not allowed to read.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { ROLE_DEFINITIONS } from "@/lib/console/permissions";
import { AuthError, DEMO_ACCOUNTS, DEMO_PASSWORD, authenticate } from "@/lib/console/mock/accounts";
import { roleFromPermissions, setPendingRole, takeReturnTo } from "@/lib/console/auth";
import { useI18n, useSession } from "@/lib/console/providers";
import { DATA_MODE, describeTarget } from "@/lib/api/config";
import {
  permissions as apiPermissions,
  selectTenant,
  signIn as apiSignIn,
  type Membership,
} from "@/lib/api/auth";
import { ServiceError } from "@/lib/console/services";
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
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the account belongs to more than one tenant and must choose. */
  const [choices, setChoices] = useState<Membership[] | null>(null);

  const live = DATA_MODE === "http";

  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "", remember: true },
  });

  function fill(email: string) {
    form.setValue("email", email);
    form.setValue("password", DEMO_PASSWORD);
    setSubmitError(null);
  }

  /** The token is scoped; ask the server what it will actually allow. */
  async function enterConsole() {
    const granted = await apiPermissions().catch(() => [] as string[]);
    // The live path has not run an MFA challenge at this point; the MFA
    // screen is the only thing that can report otherwise.
    signIn(roleFromPermissions(granted), false);
    router.replace(takeReturnTo() ?? "/dashboard");
  }

  async function chooseTenant(tenantId: string) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await selectTenant(tenantId);
      await enterConsole();
    } catch (error) {
      setSubmitError(describeFailure(error, t));
      setSubmitting(false);
    }
  }

  async function onSubmit(values: LoginInput) {
    setSubmitError(null);
    setNotice(null);
    setSubmitting(true);

    if (live) {
      try {
        const result = await apiSignIn(values.email, values.password);

        if (result.mustResetPassword) {
          setNotice(t("auth.mustReset"));
        }

        if (!result.tenantId) {
          // Nothing the console reads works on an unscoped token, so the
          // choice is made here rather than on the first blank screen.
          setChoices(result.memberships);
          setSubmitting(false);
          return;
        }

        await enterConsole();
      } catch (error) {
        setSubmitError(describeFailure(error, t));
        setSubmitting(false);
      }
      return;
    }

    // Demo mode. The delay is deliberate: the pending state should be a state
    // the user sees, not a flicker.
    await new Promise((resolve) => window.setTimeout(resolve, 380));

    try {
      const { account, mfaRequired } = authenticate(values.email, values.password);

      if (mfaRequired) {
        setPendingRole(account.roleKey);
        router.push("/mfa");
        return;
      }

      // Reached only when the account did not require MFA, so it has not
      // been satisfied — it was never asked for.
      signIn(account.roleKey, false);
      router.replace(takeReturnTo() ?? account.home);
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : "bad_password";
      setSubmitError(t(FAILURE_KEY[reason]));
      setSubmitting(false);
    }
  }

  if (choices) {
    return (
      <TenantChoice
        memberships={choices}
        busy={submitting}
        error={submitError}
        onPick={chooseTenant}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="ros-fade-in">
        <h1 className="text-fg text-lg font-semibold">{t("auth.signInTitle")}</h1>
        <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">
          {live ? `${t("auth.liveApi")} ${describeTarget()}` : t("auth.signInLede")}
        </p>

        {notice ? (
          <Callout tone="warn" className="mt-3">
            {notice}
          </Callout>
        ) : null}

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

          <p className="text-fg-subtle border-line border-t pt-4 text-center text-xs">
            {t("signup.noAccount")}{" "}
            <Link href="/signup" className="text-accent font-medium">
              {t("signup.title")}
            </Link>
          </p>
        </Form>
      </Card>

      {live ? null : <DemoAccountPicker onPick={fill} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The server's own wording is the most useful thing on a failed sign-in. */
function describeFailure(error: unknown, t: (key: "auth.errorInvalid" | "auth.errorNetwork") => string): string {
  if (error instanceof ServiceError) {
    if (error.code === "NETWORK_UNREACHABLE") return `${t("auth.errorNetwork")} ${error.detail ?? ""}`.trim();
    if (error.status === 401) return t("auth.errorInvalid");
    return error.message;
  }
  return t("auth.errorNetwork");
}

/**
 * A tenant-less token reads nothing, so an account with several memberships
 * resolves the choice before it reaches a console screen.
 */
function TenantChoice({
  memberships,
  busy,
  error,
  onPick,
}: {
  memberships: Membership[];
  busy: boolean;
  error: string | null;
  onPick: (tenantId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("auth.chooseTenant")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("auth.chooseTenantHint")}</p>

      {error ? (
        <Callout tone="bad" className="mt-3">
          {error}
        </Callout>
      ) : null}

      <ul className="mt-4">
        {memberships.map((membership) => (
          <li key={membership.membershipId}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(membership.tenant.id)}
              className="border-line hover:bg-sunken focus-visible:bg-sunken flex w-full items-center gap-3 border-b px-1 py-3 text-start transition-colors last:border-b-0 disabled:opacity-50"
            >
              <Building2 size={14} className="text-fg-subtle shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-fg block text-xs font-medium">
                  {membership.tenant.legalName}
                </span>
                <span className="text-fg-subtle block truncate text-xs" dir="ltr">
                  {membership.tenant.slug} · {membership.tenant.defaultCurrency}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
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
