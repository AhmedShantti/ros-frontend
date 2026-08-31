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
import { Badge, Button, Callout, Card, Input } from "@/components/console/ui";

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

  /*
   * Two steps, because the role is not one question among eleven — it
   * decides which of the other ten get asked at all. Picking it first turns
   * a long form into a short choice followed by a shorter form, and lets the
   * choice be made from cards that actually say what each role can do rather
   * than from a dropdown of seventeen job titles.
   */
  const [step, setStep] = useState<1 | 2>(1);

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
          <p className="text-fg-subtle text-[0.68rem] font-medium">
            {t(step === 1 ? "signup.stepRole" : "signup.stepDetails")}
          </p>
          <h1 className="text-fg mt-0.5 text-lg font-semibold">{t("signup.title")}</h1>
          {/* The lede changes with the step: on step one it explains the
              choice, on step two the choice is already made and repeating
              it is noise above a form. */}
          <p className="text-fg-muted mt-1 text-xs leading-relaxed">
            {t(step === 1 ? "signup.ledeRole" : "signup.lede")}
          </p>
        </div>
      </div>

      {/* Said before anything is typed, not after nine fields are filled. */}
      {REGISTRATION_IS_WIRED ? null : (
        <Callout tone="warn" className="mt-4" title={t("signup.notWiredTitle")}>
          {t("signup.notWiredNote")}
        </Callout>
      )}

      {step === 1 ? (
        <RolePicker
          selected={roleKey}
          onPick={(key) => {
            form.setValue("roleKey", key, { shouldValidate: true });
            setStep(2);
          }}
        />
      ) : (
      <Form form={form} onSubmit={onSubmit} submitError={submitError} className="mt-5">
        {/* The choice made on step one, and the way back to change it. */}
        <ChosenRole roleKey={roleKey} onChange={() => setStep(1)} />

        {/* ---------------------------- Person -------------------------- */}
        <Fieldset legend={t("signup.sectionPerson")}>
          <FormField
            name="fullName"
            label={t("signup.fullName")}
            className="sm:col-span-2"
            required
          >
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
            <Callout tone="muted" className="sm:col-span-2">
              {t("signup.scopeTenantWide")}
            </Callout>
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
            <Callout tone="warn" icon={<ShieldAlert size={14} />} className="sm:col-span-2">
              {t("signup.mfaRequired")}
            </Callout>
          ) : null}

          <FormField
            name="acceptedTerms"
            label={t("signup.terms")}
            className="sm:col-span-2"
            required
          >
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
      )}

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
 * Step one: which role, chosen from what each one can actually do.
 *
 * Cards rather than a `<select>`. Seventeen job titles in a dropdown asks
 * someone to already know the answer; a card can carry the one line that
 * distinguishes a shift supervisor from a branch manager, and the badges
 * that say where the role works and how much it holds. Getting this wrong
 * is not a cosmetic mistake — it is either a person who cannot do their job
 * or one who can do far too much.
 *
 * Picking advances immediately. There is no Continue button because the
 * choice *is* the step, and a second click to confirm a single-choice screen
 * is a click for nothing.
 */
function RolePicker({
  selected,
  onPick,
}: {
  selected: RoleKey;
  onPick: (role: RoleKey) => void;
}) {
  const { t, tx } = useI18n();

  return (
    <div className="mt-5 space-y-5">
      {GROUPS.map((group) => (
        <section key={group.key}>
          <h2 className="text-fg-subtle text-[0.68rem] font-semibold tracking-wide uppercase">
            {t(group.labelKey)}
          </h2>

          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {group.roles.map((key) => {
              const role = ROLE_DEFINITIONS[key];
              const isSelected = key === selected;

              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onPick(key)}
                    aria-pressed={isSelected}
                    className={
                      "border-line hover:border-accent focus-visible:border-accent h-full w-full rounded-lg border p-3 text-start transition-colors " +
                      (isSelected ? "border-accent bg-accent-soft" : "bg-raised hover:bg-sunken")
                    }
                  >
                    <span className="text-fg block text-xs font-semibold">
                      {tx(role.name)}
                    </span>
                    <span className="text-fg-muted mt-1 block text-[0.68rem] leading-relaxed">
                      {tx(role.character)}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge tone="muted">{t(SCOPE_LABEL[role.defaultScope])}</Badge>
                      {surfacesForRole(key).map((surface) => (
                        <Badge key={surface} tone="accent">
                          {t(SURFACE_LABEL[surface] as Parameters<typeof t>[0])}
                        </Badge>
                      ))}
                      {roleRequiresMfa(key) ? (
                        <Badge tone="warn">{t("signup.mfaBadge")}</Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Step two's reminder of step one's answer, and the way back to it. */
function ChosenRole({ roleKey, onChange }: { roleKey: RoleKey; onChange: () => void }) {
  const { t, tx } = useI18n();
  const role = ROLE_DEFINITIONS[roleKey];

  return (
    <div className="border-line bg-sunken flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3">
      <span className="min-w-0 flex-1">
        <span className="text-fg-subtle block text-[0.68rem]">{t("signup.role")}</span>
        <span className="text-fg block text-xs font-semibold">{tx(role.name)}</span>
      </span>

      <span className="flex flex-wrap items-center gap-1">
        <Badge tone="muted">{t(SCOPE_LABEL[role.defaultScope])}</Badge>
        <Badge tone={role.permissions.length > 80 ? "warn" : "muted"}>
          <KeyRound size={11} aria-hidden />
          {t("signup.permissionCount").replace("{n}", String(role.permissions.length))}
        </Badge>
      </span>

      <button
        type="button"
        onClick={onChange}
        className="text-accent inline-flex items-center gap-1 text-xs font-medium"
      >
        <ArrowLeft size={12} aria-hidden className="rtl:rotate-180" />
        {t("signup.changeRole")}
      </button>
    </div>
  );
}

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
    <fieldset className="border-line border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{legend}</legend>
      <p className="text-fg text-xs font-semibold">{legend}</p>
      {hint ? (
        <p className="text-fg-subtle mt-1 text-[0.68rem] leading-relaxed">{hint}</p>
      ) : null}

      {/*
        Two at a time once there is room. Stacked, this form is eleven
        controls of scrolling; paired, it is six rows. Anything that needs
        the full width says so with `sm:col-span-2` at its own call site,
        which keeps the decision next to the field it describes.
      */}
      <div className="mt-3 grid gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>
    </fieldset>
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
