"use client";

/**
 * Requesting an account, for any of the seventeen roles.
 *
 * ## Why the role picker is the first thing on the page
 *
 * The role is not a preference collected at the end; it decides what the
 * rest of the form even asks for. A branch manager has to name a branch and
 * an owner does not. A cashier needs a staff code and a PIN — and a waiter
 * does too, while an accountant never touches a terminal and would only be
 * confused by the field. Asking everything of everyone and validating none
 * of it is how a signup form produces accounts that cannot sign in.
 *
 * ## The PIN is not decoration
 *
 * `POST /auth/pin` is the only endpoint that mints a session identifying an
 * *employee*, and opening a cash drawer requires one — a console login will
 * not do, because a tenant membership carries no employee link. So a cashier
 * provisioned without a staff code and PIN can sign in to the console and
 * still be unable to open a till. That is a real failure this product has
 * already hit, and collecting both here is what prevents it.
 *
 * ## What this page does not do
 *
 * It does not create an account. There is no signup endpoint anywhere in
 * `api/openapi.json`, so the submit goes to `submitRegistration()` in
 * `lib/api/registration.ts` — one function, documented with the request
 * shape it should send — and that throws until someone implements it. The
 * form is deliberately honest about this rather than showing a success it
 * did not earn: the notice at the top says so before anything is typed, so
 * nobody fills in nine fields to find out at the end.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  KeyRound,
  Mail,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import {
  ROLE_DEFINITIONS,
  roleRequiresMfa,
  surfacesForRole,
  type RoleKey,
  type Surface,
} from "@/lib/console/permissions";
import { useI18n } from "@/lib/console/providers";
import { ServiceError } from "@/lib/console/services";
import { describeError } from "@/lib/console/actions";
import {
  REGISTRATION_IS_WIRED,
  submitRegistration,
  type RegistrationOutcome,
} from "@/lib/api/registration";
import { signUpSchema, type SignUpValues } from "@/schemas/auth";
import { Form, FormField, useZodForm } from "@/components/console/form";
import { Badge, Button, Callout, Card, Input, Select } from "@/components/console/ui";

/**
 * The roles, grouped so a list of seventeen reads as four short ones.
 *
 * Ordered by where the person actually works rather than by seniority: it is
 * far easier to find yourself in "at a terminal" than to know whether a head
 * chef counts as management here.
 */
const GROUPS: { key: string; labelKey: ConsoleGroupKey; roles: RoleKey[] }[] = [
  {
    key: "leadership",
    labelKey: "signup.groupLeadership",
    roles: ["owner", "operations_director", "brand_manager", "franchisee"],
  },
  {
    key: "branch",
    labelKey: "signup.groupBranch",
    roles: ["branch_manager", "shift_supervisor"],
  },
  {
    key: "terminal",
    labelKey: "signup.groupTerminal",
    roles: ["cashier", "waiter", "kitchen_staff", "head_chef"],
  },
  {
    key: "back_office",
    labelKey: "signup.groupBackOffice",
    roles: [
      "storekeeper",
      "purchasing_officer",
      "central_kitchen_manager",
      "accountant",
      "auditor",
      "hr_officer",
      "platform_admin",
    ],
  },
];

type ConsoleGroupKey =
  | "signup.groupLeadership"
  | "signup.groupBranch"
  | "signup.groupTerminal"
  | "signup.groupBackOffice";

/** The label a scope field needs, which is different for each scope kind. */
const SCOPE_LABEL = {
  tenant: "signup.scopeTenant",
  brand: "signup.scopeBrand",
  branch_set: "signup.scopeBranchSet",
  branch: "signup.scopeBranch",
} as const;

const SURFACE_LABEL: Record<Surface, string> = {
  console: "signup.surfaceConsole",
  pos: "signup.surfacePos",
  kds: "signup.surfaceKds",
};

export default function SignUpPage() {
  const { t, tx } = useI18n();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RegistrationOutcome | null>(null);

  const form = useZodForm(signUpSchema, {
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      roleKey: "cashier",
      organisation: "",
      scopeName: "",
      employeeCode: "",
      pin: "",
      password: "",
      confirm: "",
      acceptedTerms: false,
    },
  });

  // Watched, because three sections of the form appear and disappear with it.
  const roleKey = (form.watch("roleKey") ?? "cashier") as RoleKey;
  const role = ROLE_DEFINITIONS[roleKey];

  const shape = useMemo(() => {
    const surfaces = surfacesForRole(roleKey);
    return {
      surfaces,
      usesTerminal: surfaces.some((s) => s === "pos" || s === "kds"),
      needsScope: role.defaultScope !== "tenant",
      requiresMfa: roleRequiresMfa(roleKey),
      permissionCount: role.permissions.length,
    };
  }, [roleKey, role]);

  async function onSubmit(values: SignUpValues) {
    setSubmitError(null);
    try {
      const result = await submitRegistration({
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        roleKey: values.roleKey,
        organisation: values.organisation,
        scopeName: shape.needsScope ? (values.scopeName ?? null) : null,
        employeeCode: shape.usesTerminal ? (values.employeeCode ?? null) : null,
        pin: shape.usesTerminal ? (values.pin ?? null) : null,
        password: values.password,
      });
      setOutcome(result);
    } catch (caught) {
      setSubmitError(describeError(caught));
      // The detail names the file to implement; worth having in the console
      // for whoever is wiring the backend.
      if (caught instanceof ServiceError && caught.detail) {
        // eslint-disable-next-line no-console
        console.info(`[TRENDOW] ${caught.detail}`);
      }
    }
  }

  if (outcome) {
    return <SubmittedCard outcome={outcome} />;
  }

  return (
    <Card className="ros-fade-in">
      <div className="flex items-start gap-3">
        <span className="bg-accent-soft text-accent mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <UserPlus size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-fg text-lg font-semibold">{t("signup.title")}</h1>
          <p className="text-fg-muted mt-1 text-xs leading-relaxed">{t("signup.lede")}</p>
        </div>
      </div>

      {/* Said before anything is typed, not after nine fields are filled. */}
      {REGISTRATION_IS_WIRED ? null : (
        <Callout tone="warn" className="mt-4" title={t("signup.notWiredTitle")}>
          {t("signup.notWiredNote")}
        </Callout>
      )}

      <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-5">
        {/* ---------------------------- Role ---------------------------- */}
        <Fieldset legend={t("signup.sectionRole")}>
          <FormField name="roleKey" label={t("signup.role")} required>
            {({ id, ...aria }) => (
              <Select id={id} {...aria} {...form.register("roleKey")}>
                {GROUPS.map((group) => (
                  <optgroup key={group.key} label={t(group.labelKey)}>
                    {group.roles.map((key) => (
                      <option key={key} value={key}>
                        {tx(ROLE_DEFINITIONS[key].name)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </FormField>

          <RoleSummary roleKey={roleKey} />
        </Fieldset>

        {/* ---------------------------- Person -------------------------- */}
        <Fieldset legend={t("signup.sectionPerson")}>
          <FormField name="fullName" label={t("signup.fullName")} required>
            {({ id, ...aria }) => (
              <Input id={id} {...aria} {...form.register("fullName")} autoComplete="name" />
            )}
          </FormField>

          <FormField name="email" label={t("auth.email")} required>
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                {...form.register("email")}
                type="email"
                dir="ltr"
                autoComplete="email"
                inputMode="email"
              />
            )}
          </FormField>

          <FormField name="phone" label={t("signup.phone")} hint={t("signup.phoneHint")}>
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                {...form.register("phone")}
                type="tel"
                dir="ltr"
                autoComplete="tel"
              />
            )}
          </FormField>
        </Fieldset>

        {/* ---------------------------- Where --------------------------- */}
        <Fieldset legend={t("signup.sectionWhere")}>
          <FormField
            name="organisation"
            label={t("signup.organisation")}
            hint={t("signup.organisationHint")}
            required
          >
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                {...form.register("organisation")}
                autoComplete="organization"
              />
            )}
          </FormField>

          {shape.needsScope ? (
            <FormField
              name="scopeName"
              label={t(SCOPE_LABEL[role.defaultScope])}
              hint={t("signup.scopeHint")}
              required
            >
              {({ id, ...aria }) => (
                <Input id={id} {...aria} {...form.register("scopeName")} />
              )}
            </FormField>
          ) : (
            <Callout tone="muted">{t("signup.scopeTenantWide")}</Callout>
          )}
        </Fieldset>

        {/* -------------------------- Terminal -------------------------- */}
        {shape.usesTerminal ? (
          <Fieldset legend={t("signup.sectionTerminal")} hint={t("signup.terminalWhy")}>
            <FormField
              name="employeeCode"
              label={t("shift.employeeCode")}
              hint={t("signup.employeeCodeHint")}
              required
            >
              {({ id, ...aria }) => (
                <Input
                  id={id}
                  {...aria}
                  {...form.register("employeeCode")}
                  dir="ltr"
                  autoComplete="off"
                />
              )}
            </FormField>

            <FormField
              name="pin"
              label={t("shift.pinLabel")}
              hint={t("shift.pinHint")}
              required
            >
              {({ id, ...aria }) => (
                <Input
                  id={id}
                  {...aria}
                  {...form.register("pin")}
                  type="password"
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                />
              )}
            </FormField>
          </Fieldset>
        ) : null}

        {/* ------------------------- Credentials ------------------------ */}
        <Fieldset legend={t("signup.sectionCredentials")}>
          <FormField
            name="password"
            label={t("auth.password")}
            hint={t("signup.passwordHint")}
            required
          >
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                {...form.register("password")}
                type="password"
                dir="ltr"
                autoComplete="new-password"
              />
            )}
          </FormField>

          <FormField name="confirm" label={t("signup.confirmPassword")} required>
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                {...form.register("confirm")}
                type="password"
                dir="ltr"
                autoComplete="new-password"
              />
            )}
          </FormField>

          {shape.requiresMfa ? (
            <Callout tone="warn" icon={<ShieldAlert size={14} />}>
              {t("signup.mfaRequired")}
            </Callout>
          ) : null}

          <FormField name="acceptedTerms" label={t("signup.terms")} required>
            {({ id, ...aria }) => (
              <label className="text-fg-muted flex items-start gap-2.5 text-xs leading-relaxed">
                <input
                  id={id}
                  {...aria}
                  {...form.register("acceptedTerms")}
                  type="checkbox"
                  className="border-line accent-accent mt-0.5 h-3.5 w-3.5 shrink-0 rounded"
                />
                <span>{t("signup.termsNote")}</span>
              </label>
            )}
          </FormField>
        </Fieldset>

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={form.formState.isSubmitting}
          icon={<UserPlus size={14} />}
        >
          {t("signup.submit")}
        </Button>
      </Form>

      <p className="text-fg-subtle mt-5 text-center text-xs">
        {t("signup.haveAccount")}{" "}
        <Link href="/login" className="text-accent font-medium">
          {t("auth.signIn")}
        </Link>
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * A titled group of fields.
 *
 * A real `<fieldset>`/`<legend>`, not a styled div: a screen reader announces
 * the legend with every control inside it, which is the whole reason someone
 * navigating by keyboard knows the PIN belongs to the terminal section and
 * not to the password one.
 */
function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-line space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{legend}</legend>
      <div>
        <p className="text-fg text-xs font-semibold">{legend}</p>
        {hint ? (
          <p className="text-fg-subtle mt-1 text-[0.68rem] leading-relaxed">{hint}</p>
        ) : null}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * What the chosen role actually gets — stated before the account is asked
 * for, not discovered afterwards.
 *
 * The permission count is deliberately blunt. "Owner" and "Auditor" both
 * sound harmless in a dropdown; one of them holds every permission in the
 * tenant, and a number next to it is the cheapest way to make that land.
 */
function RoleSummary({ roleKey }: { roleKey: RoleKey }) {
  const { t, tx } = useI18n();
  const role = ROLE_DEFINITIONS[roleKey];
  const surfaces = surfacesForRole(roleKey);

  return (
    <div className="border-line bg-sunken space-y-2.5 rounded-lg border p-3">
      <p className="text-fg-muted text-xs leading-relaxed">{tx(role.character)}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="muted">
          <Building2 size={11} aria-hidden />
          {t(SCOPE_LABEL[role.defaultScope])}
        </Badge>

        {surfaces.map((surface) => (
          <Badge key={surface} tone="accent">
            {t(SURFACE_LABEL[surface] as Parameters<typeof t>[0])}
          </Badge>
        ))}

        <Badge tone={role.permissions.length > 80 ? "warn" : "muted"}>
          <KeyRound size={11} aria-hidden />
          {t("signup.permissionCount").replace("{n}", String(role.permissions.length))}
        </Badge>

        {roleRequiresMfa(roleKey) ? <Badge tone="warn">{t("signup.mfaBadge")}</Badge> : null}
      </div>
    </div>
  );
}

/** The only screen that should ever claim something was submitted. */
function SubmittedCard({ outcome }: { outcome: RegistrationOutcome }) {
  const { t } = useI18n();

  return (
    <Card className="ros-fade-in">
      <div className="flex items-start gap-3">
        <span className="bg-good-soft text-good mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <BadgeCheck size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-fg text-lg font-semibold">
            {t(outcome.status === "created" ? "signup.doneTitle" : "signup.pendingTitle")}
          </h1>
          <p className="text-fg-muted mt-1 text-xs leading-relaxed">
            {t(outcome.status === "created" ? "signup.doneNote" : "signup.pendingNote")}
          </p>
        </div>
      </div>

      <div className="border-line text-fg-muted mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs">
        <Mail size={13} className="text-fg-subtle shrink-0" aria-hidden />
        <span dir="ltr" className="truncate font-mono">
          {outcome.email}
        </span>
      </div>

      <Link
        href="/login"
        className="text-fg-subtle hover:text-fg mt-5 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={13} aria-hidden className="rtl:rotate-180" />
        {t("auth.signIn")}
      </Link>
    </Card>
  );
}
