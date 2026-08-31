/**
 * Client-minted ids, for the endpoints that ask the *device* to assign one.
 *
 * FR-OFF-015: an order, a line, a payment, a cash session and a shift are all
 * created with an id the terminal chose, and that id is preserved exactly.
 * That is what lets an order rung up with no connection keep one identity for
 * its whole life — the same row, whether it syncs in ten seconds or tomorrow.
 *
 * ## Why UUID and not ULID
 *
 * The published document asks for ULIDs. Its own 400 description on
 * `POST /cash-sessions` reads "a non-ULID shiftId/cashSessionId/drawerId",
 * and `OpenCashSessionDto` calls both fields "the ULID the device assigned".
 *
 * The deployed service does not agree with its own documentation. Send a
 * ULID and it answers:
 *
 *   shiftId must match /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 *
 * — a `ValidationPipe` running `@IsUUID()`. Every id in every *response*
 * carries `format: uuid` too, so the database column is a uuid and the
 * ULID wording is stale prose the validator never matched.
 *
 * The runtime is the authority here: it is what actually rejects the
 * request. So these are UUID v4, and the sortability argument the old
 * `ulid.ts` made for keyset paging does not apply — `GET /orders` returns a
 * cursor of the server's own making and never asks the client to sort by id.
 *
 * If the backend is ever corrected to accept ULIDs, this is the one place
 * that has to change.
 */

/** A v4 UUID, lowercase, hyphenated — the shape the API's validators accept. */
export function deviceId(): string {
  const cryptoRef = globalThis.crypto;

  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
  } else {
    // No CSPRNG (a very old browser, or a non-secure context). The id is a
    // client-assigned key, not a secret; uniqueness is all that is asked.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4, variant 10xx — the bits the regex above does not check but a
  // strict `@IsUUID(4)` would.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True for a lowercase-or-upper hyphenated UUID — what the API validates. */
export function isDeviceId(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID.test(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
