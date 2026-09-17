/**
 * Breached-password check — FR-SEC-025.
 *
 * Two sources, and the result always says which one answered, because "not
 * found in a list of 60 passwords" and "not found in 900 million breached
 * passwords" are very different assurances:
 *
 *   hibp    Have I Been Pwned's range API, using k-anonymity. The password is
 *           hashed with SHA-1 in this browser and only the first five hex
 *           characters of the hash leave it; the service answers with every
 *           suffix sharing that prefix and the match happens here. Padding is
 *           requested so the response size does not hint at the prefix.
 *   local   A short bundled list of the most common breached passwords,
 *           used when the range API cannot be reached (offline, blocked by a
 *           network policy, timed out). Much weaker, and labelled as such.
 *
 * The server must check again at the point the password is set; this is
 * what lets the form refuse early and explain why.
 */

export type BreachSource = "hibp" | "local";

export interface BreachResult {
  breached: boolean;
  source: BreachSource;
  /** Times seen in breaches, when the range API answered. */
  count: number | null;
}

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 4000;

/**
 * The bundled fallback. Lower-cased; compared case-insensitively along with
 * the usual trailing digit/symbol decorations people add to meet a rule.
 */
const COMMON_BREACHED = new Set([
  "123456", "123456789", "12345678", "password", "qwerty123", "qwerty1", "111111", "12345",
  "1234567890", "1234567", "password1", "123123", "abc123", "qwerty", "000000", "iloveyou",
  "dragon", "monkey", "letmein", "sunshine", "princess", "football", "baseball", "welcome",
  "admin", "administrator", "passw0rd", "p@ssw0rd", "p@ssword", "password123", "password1234",
  "qwertyuiop", "1q2w3e4r", "1q2w3e4r5t", "zaq12wsx", "asdfghjkl", "trustno1", "master",
  "superman", "batman", "shadow", "michael", "jennifer", "charlie", "freedom", "whatever",
  "changeme", "welcome1", "welcome123", "letmein123", "summer2024", "winter2024", "spring2025",
  "restaurant", "restaurant1", "cashier123", "manager123", "admin1234", "adminadmin",
  "qwerty12345", "iloveyou1", "123qwe", "1qaz2wsx", "q1w2e3r4", "aa123456", "abcd1234",
  "pakistan123", "bismillah", "egypt123", "cairo123", "riyadh123", "dubai123", "ahmed123",
  "mohamed123", "mohammed123", "allah123", "lovely", "loveyou", "azerty", "secret", "hello123",
]);

function stripDecoration(password: string): string {
  return password.toLowerCase().replace(/[\d!@#$%^&*.?_-]+$/, "");
}

export function localBreachCheck(password: string): BreachResult {
  const lower = password.toLowerCase();
  const breached = COMMON_BREACHED.has(lower) || COMMON_BREACHED.has(stripDecoration(password));
  return { breached, source: "local", count: null };
}

export const LOCAL_LIST_SIZE = COMMON_BREACHED.size;

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Check a candidate password. Never throws: an unreachable range API falls
 * back to the bundled list and says so in `source`.
 */
export async function checkBreached(password: string): Promise<BreachResult> {
  if (!password) return { breached: false, source: "local", count: null };
  if (typeof crypto === "undefined" || !crypto.subtle || typeof fetch === "undefined") {
    return localBreachCheck(password);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const response = await fetch(`${RANGE_API}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
      credentials: "omit",
    });
    if (!response.ok) return localBreachCheck(password);
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [candidate, countText] = line.trim().split(":");
      if (candidate === suffix) {
        const count = Number(countText);
        // Padding rows carry a count of 0 and are not real matches.
        if (count > 0) return { breached: true, source: "hibp", count };
      }
    }
    // The range API is authoritative when it answered; the local list is a
    // subset of it, so there is nothing more to learn by checking both.
    return { breached: false, source: "hibp", count: 0 };
  } catch {
    return localBreachCheck(password);
  } finally {
    clearTimeout(timer);
  }
}
