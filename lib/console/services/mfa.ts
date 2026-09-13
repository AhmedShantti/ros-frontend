"use client";

/**
 * Two-step verification enrolment — FR-SEC-023, FR-SEC-024.
 *
 * The backend has no MFA endpoints in `api/openapi.json`: no enrolment, no
 * challenge, no recovery. The verification page at `/mfa` exists; enrolment
 * did not. So enrolment runs here, end to end and for real — a genuine
 * RFC 6238 secret, a QR code any authenticator scans, a code checked with
 * WebCrypto, recovery codes stored only as SHA-256 hashes — behind the
 * interface the server will take over.
 *
 * Be clear about the one thing this cannot be: a security control. The
 * secret sits in this browser's storage, so it proves the person's
 * authenticator works and lets the console enforce the step in its own UI.
 * Enforcement that matters happens on the server, when the server has it.
 */

import type { IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";
import { hashCode, newRecoveryCodes, verifyTotp } from "../totp";

export interface MfaEnrolment {
  account: string;
  secret: string;
  enrolledAt: IsoDateTime;
  recoveryHashes: string[];
  usedRecoveryHashes: string[];
  /** The last time step accepted, so a code cannot be replayed. */
  lastStep: number | null;
}

const store = localCollection<MfaEnrolment>(
  {
    name: "mfa-enrolments",
    idOf: (row) => row.account,
    factory: (input) => input as MfaEnrolment,
  },
  () => getActiveTenantId(),
);

const key = (account: string) => account.trim().toLowerCase();

async function mustHave(account: string): Promise<MfaEnrolment> {
  const row = await store.get(key(account));
  if (!row) throw new ServiceError("NOT_FOUND", "Two-step verification is not set up for this account.", 404);
  return row;
}

export interface MfaStatus {
  enrolled: boolean;
  enrolledAt: IsoDateTime | null;
  recoveryRemaining: number;
}

export interface MfaService {
  status(account: string): Promise<MfaStatus>;
  /**
   * Finish enrolment: the code must come from the authenticator that
   * scanned `secret`. Returns the recovery codes — shown once, never again.
   */
  confirm(account: string, secret: string, code: string): Promise<string[]>;
  /** A code from the app, or a recovery code (which is then spent). */
  verify(account: string, code: string): Promise<"totp" | "recovery">;
  regenerateRecovery(account: string, code: string): Promise<string[]>;
  remove(account: string, code: string): Promise<void>;
}

export const mfaService: MfaService = {
  async status(account) {
    const row = await store.get(key(account));
    return {
      enrolled: Boolean(row),
      enrolledAt: row?.enrolledAt ?? null,
      recoveryRemaining: row ? row.recoveryHashes.length - row.usedRecoveryHashes.length : 0,
    };
  },

  async confirm(account, secret, code) {
    const step = await verifyTotp(secret, code);
    if (step === null) {
      throw new ServiceError(
        "INVALID_CODE",
        "That code does not match. Check the time on your phone and try the newest code.",
        400,
      );
    }
    const codes = newRecoveryCodes();
    const row: MfaEnrolment = {
      account: key(account),
      secret,
      enrolledAt: nowIso(),
      recoveryHashes: await Promise.all(codes.map(hashCode)),
      usedRecoveryHashes: [],
      lastStep: step,
    };
    const existing = await store.get(row.account);
    if (existing) await store.update(row.account, row);
    else await store.create(row);
    return codes;
  },

  async verify(account, code) {
    const row = await mustHave(account);
    const trimmed = code.trim();

    if (/^\d{6}$/.test(trimmed.replace(/\s/g, ""))) {
      const step = await verifyTotp(row.secret, trimmed);
      if (step === null) throw new ServiceError("INVALID_CODE", "That code does not match.", 400);
      if (row.lastStep !== null && step <= row.lastStep) {
        throw new ServiceError("CODE_REUSED", "That code was already used. Wait for the next one.", 400);
      }
      await store.update(row.account, { lastStep: step });
      return "totp";
    }

    const hash = await hashCode(trimmed);
    if (!row.recoveryHashes.includes(hash)) {
      throw new ServiceError("INVALID_CODE", "That is not one of your recovery codes.", 400);
    }
    if (row.usedRecoveryHashes.includes(hash)) {
      throw new ServiceError("CODE_REUSED", "That recovery code has already been used.", 400);
    }
    await store.update(row.account, { usedRecoveryHashes: [...row.usedRecoveryHashes, hash] });
    return "recovery";
  },

  async regenerateRecovery(account, code) {
    await mfaService.verify(account, code);
    const codes = newRecoveryCodes();
    await store.update(key(account), {
      recoveryHashes: await Promise.all(codes.map(hashCode)),
      usedRecoveryHashes: [],
    });
    return codes;
  },

  async remove(account, code) {
    await mfaService.verify(account, code);
    await store.remove(key(account));
  },
};
