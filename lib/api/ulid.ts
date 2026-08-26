/**
 * ULIDs, because several endpoints ask the *device* to assign the id.
 *
 * FR-OFF-015: an order, a line, a payment and a cash session are all created
 * with an id the terminal minted, and that id is preserved exactly. This is
 * what makes an order rung up with no connection keep one identity for its
 * whole life — the same row, whether it syncs in ten seconds or tomorrow.
 *
 * A ULID rather than a UUID because the first 48 bits are the timestamp, so
 * ids sort chronologically. That matters for a keyset cursor over orders:
 * `GET /orders` pages by id, and a v4 UUID would page in random order.
 *
 * Crockford base32, 26 characters: 10 of timestamp, 16 of randomness.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LENGTH = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(now: number): string {
  let out = "";
  for (let index = TIME_LENGTH - 1; index >= 0; index -= 1) {
    const mod = now % ENCODING_LENGTH;
    out = ENCODING[mod] + out;
    now = (now - mod) / ENCODING_LENGTH;
  }
  return out;
}

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
    return bytes;
  }
  // No CSPRNG (very old browser, or a non-secure context). The id is still
  // unique enough to be a client-assigned key; it is not a secret.
  for (let index = 0; index < count; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  let out = "";
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    out += ENCODING[bytes[index]! % ENCODING_LENGTH];
  }
  return out;
}

/**
 * A new ULID. `now` is injectable so a caller that already has the device's
 * clock reading — which the sales endpoints record separately as
 * `originDeviceTime` — can keep the two consistent.
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
