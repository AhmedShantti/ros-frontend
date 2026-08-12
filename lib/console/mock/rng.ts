/**
 * Deterministic pseudo-randomness for the mock dataset.
 *
 * The dataset must be byte-identical on the server and on the client, or
 * React hydration mismatches. `Math.random()` and `Date.now()` are therefore
 * banned from every file under `mock/` — this seeded generator and the fixed
 * `NOW` anchor in `dataset.ts` replace them.
 */

/** mulberry32 — small, fast, and stable across engines. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof createRng>;

export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function float(rng: Rng, min: number, max: number, decimals = 2): number {
  const value = rng() * (max - min) + min;
  return Number(value.toFixed(decimals));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** A stable ULID-shaped identifier. Not a real ULID; shaped like one. */
export function id(rng: Rng, prefix: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[Math.floor(rng() * alphabet.length)];
  return `${prefix}_${out}`;
}

/** Sequential identifiers where readability beats realism. */
export function seqId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(4, "0")}`;
}

/** A normal-ish deviate via the central limit theorem — smoother than uniform. */
export function gaussian(rng: Rng, mean: number, stdDev: number): number {
  const sum = rng() + rng() + rng() + rng() + rng() + rng();
  return mean + ((sum - 3) / 3) * stdDev;
}
