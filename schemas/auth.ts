import { z } from "zod";
import { V, digitsOnly, emailField, requiredString } from "./common";

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
