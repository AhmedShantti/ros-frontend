/**
 * This device's identity, as far as the API is concerned.
 *
 * `POST /auth/terminals/{id}/fingerprints` is how a terminal records the
 * physical devices allowed to act as it (FR-SEC-030). The endpoint is
 * idempotent on the same fingerprint, so re-registering costs nothing and
 * re-binding the same tablet does not multiply rows.
 *
 * The value is deliberately *not* a browser fingerprint in the tracking
 * sense — no canvas hashing, no font probing, nothing that would identify
 * the person rather than the till. It is a random opaque id minted once and
 * kept in `localStorage`, which is exactly as stable as the installation is:
 * clearing site data re-enrols the device, which is the correct outcome.
 */

const KEY_FINGERPRINT = "ros.api.deviceFingerprint";

function randomId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

/** Mints one on first call and returns the same value thereafter. */
export function deviceFingerprint(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(KEY_FINGERPRINT);
    if (existing) return existing;
    const minted = randomId();
    window.localStorage.setItem(KEY_FINGERPRINT, minted);
    return minted;
  } catch {
    // Private mode: a per-session value still lets the call succeed, it
    // simply will not be recognised as the same device next time.
    return randomId();
  }
}

/** Coarse platform label — `os` on the fingerprint DTO, capped at 32 chars. */
export function deviceOs(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const match =
    /(Windows NT [\d.]+|Mac OS X [\d_]+|Android [\d.]+|iPhone OS [\d_]+|iPad|CrOS|Linux)/.exec(ua);
  return (match?.[1] ?? "unknown").replace(/_/g, ".").slice(0, 32);
}

/** `appVersion` on the fingerprint DTO, capped at 32 chars. */
export function appVersion(): string {
  return (process.env.NEXT_PUBLIC_APP_VERSION ?? "console-1.0.0").slice(0, 32);
}
