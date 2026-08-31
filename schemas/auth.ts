import { z } from "zod";
import { ROLE_DEFINITIONS, ROLE_KEYS, surfacesForRole } from "@/lib/console/permissions";
import { V, digitsOnly, emailField, optionalPhone, requiredString } from "./common";

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, V.required),
  remember: z.boolean().default(true),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailField,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Length and character-class rules only. No dictionary check and no strength
 * meter theatre: a 12-character requirement with a visible rule list beats a
 * green bar the user games with "Password1!".
 */
const strongPassword = z
  .string()
  .min(12, V.min(12))
  .max(128, V.max(128))
  .regex(/[a-z]/, V.passwordWeak)
  .regex(/[A-Z]/, V.passwordWeak)
  .regex(/\d/, V.passwordWeak);

/**
 * Requesting an account — every role, one form.
 *
 * What varies by role is not cosmetic, so the schema knows about it rather
 * than leaving the page to guess:
 *
 *  - **Scope.** An owner is asked for an organisation and nothing else; a
 *    cashier has to say which branch, because a role granted tenant-wide by
 *    accident is a permissions incident, not a typo. The role's own
 *    `defaultScope` decides which.
 *  - **A staff code and PIN**, but only for the roles that actually stand at
 *    a terminal. `POST /auth/pin` is the only way to obtain a session that
 *    identifies an employee, and it takes a code and a PIN — so a cashier
 *    who is provisioned without them can sign in to the console and still be
 *    unable to open a drawer. Collecting them here is what stops that.
 *
 * The password rules are the same `strongPassword` the reset screen uses.
 * One rule for one product; two would only mean the weaker one wins.
 */
export const signUpSchema = z
  .object({
    fullName: requiredString(80),
    email: emailField,
    phone: optionalPhone,
    roleKey: z.enum(ROLE_KEYS),
    organisation: requiredString(120),
    /** The brand, branch or branch group the role is scoped to, by name. */
    scopeName: z.string().trim().max(120, V.max(120)).optional(),
    /** POS and KDS sign-on. Blank for roles that never touch a terminal. */
    employeeCode: z.string().trim().max(32, V.max(32)).optional(),
    pin: z.string().trim().optional(),
    password: strongPassword,
    confirm: z.string().min(1, V.required),
    // A boolean rather than `z.literal(true)`: the literal makes the *input*
    // type `true`, so the unticked default the form starts from would not
    // typecheck. The refinement below is what actually requires the tick.
    acceptedTerms: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.acceptedTerms) {
      ctx.addIssue({ code: "custom", message: V.required, path: ["acceptedTerms"] });
    }

    if (value.password !== value.confirm) {
      ctx.addIssue({ code: "custom", message: V.passwordMismatch, path: ["confirm"] });
    }

    // A role scoped narrower than the tenant has to say to what.
    if (ROLE_DEFINITIONS[value.roleKey].defaultScope !== "tenant" && !value.scopeName) {
      ctx.addIssue({ code: "custom", message: V.required, path: ["scopeName"] });
    }

    if (surfacesForRole(value.roleKey).some((s) => s === "pos" || s === "kds")) {
      if (!value.employeeCode) {
        ctx.addIssue({ code: "custom", message: V.required, path: ["employeeCode"] });
      }
      // FR-SEC-020, and `PinLoginDto.pin`: four to eight digits.
      if (!value.pin || !/^\d{4,8}$/.test(value.pin)) {
        ctx.addIssue({ code: "custom", message: V.pinLength, path: ["pin"] });
      }
    }
  });
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    confirm: z.string().min(1, V.required),
  })
  .refine((v) => v.password === v.confirm, {
    message: V.passwordMismatch,
    path: ["confirm"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * FR-SEC — changing your own password proves the current one first, which is
 * what stops an unattended session being used to lock its owner out.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, V.required),
    password: strongPassword,
    confirm: z.string().min(1, V.required),
  })
  .refine((v) => v.password === v.confirm, {
    message: V.passwordMismatch,
    path: ["confirm"],
  })
  .refine((v) => v.password !== v.currentPassword, {
    message: V.passwordReused,
    path: ["password"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const mfaSchema = z.object({
  code: digitsOnly(6),
});
export type MfaInput = z.infer<typeof mfaSchema>;

export const pinSchema = z.object({
  pin: digitsOnly(4),
});
export type PinInput = z.infer<typeof pinSchema>;

/**
 * FR-SEC-030 — a terminal is registered against a branch before it may take
 * a payment, and the pairing code is issued in the console, not typed by the
 * person standing at the till.
 */
export const deviceRegistrationSchema = z.object({
  deviceName: requiredString(60),
  pairingCode: digitsOnly(8),
  branchId: z.string().min(1, V.required),
  deviceType: z.enum(["pos", "kds", "kiosk", "handheld"]),
  printerAttached: z.boolean().default(false),
});
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;

export const scopeSelectionSchema = z.object({
  tenantId: z.string().min(1, V.required),
  brandId: z.string().nullable(),
  branchId: z.string().nullable(),
});
export type ScopeSelectionInput = z.infer<typeof scopeSelectionSchema>;

/**
 * FR-SEC-030 — pairing a terminal to a branch.
 *
 * The pairing code is the credential here: it is issued in the console by
 * someone who already has the right to add a terminal, which is what stops a
 * device registering itself.
 */
export const registerDeviceSchema = z.object({
  pairingCode: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "Enter the eight-digit pairing code."),
  deviceName: z.string().trim().min(2).max(48),
  deviceType: z.enum(["pos", "kds", "kiosk"]),
  printerAttached: z.boolean(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
