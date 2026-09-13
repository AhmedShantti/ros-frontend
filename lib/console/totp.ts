/**
 * Time-based one-time passwords — RFC 6238 over RFC 4226, FR-SEC-023.
 *
 * What an authenticator app computes, computed here with WebCrypto so the
 * enrolment flow can prove the person's app is producing the right codes
 * before it is relied on. SHA-1, six digits, thirty seconds: the parameters
 * every authenticator defaults to, so a scanned code works everywhere.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** A fresh 160-bit secret, as the Base32 an authenticator expects. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one time step. */
export async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function timeStep(at = Date.now(), period = 30): number {
  return Math.floor(at / 1000 / period);
}

export async function totp(secretBase32: string, at = Date.now()): Promise<string> {
  return hotp(base32Decode(secretBase32), timeStep(at));
}

/**
 * Check a typed code, allowing one step either side for clock drift.
 * Returns the step it matched so a caller can refuse a replay of it.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  at = Date.now(),
): Promise<number | null> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const step = timeStep(at);
  for (const candidate of [step, step - 1, step + 1]) {
    if ((await hotp(secret, candidate)) === clean) return candidate;
  }
  return null;
}

/** The URI an authenticator app reads from the QR code. */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${encodeURIComponent(input.issuer)}`;
}

/** Ten single-use recovery codes, grouped for reading aloud: `k7p4-2xqm`. */
export function newRecoveryCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

/** SHA-256 of a recovery code, so the codes themselves are never stored. */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Group a secret in fours for typing by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
