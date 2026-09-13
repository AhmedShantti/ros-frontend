/**
 * A small QR code encoder — ISO/IEC 18004, byte mode, error correction M,
 * versions 1–10.
 *
 * It exists for one job: putting an `otpauth://` URI in front of a phone
 * camera during MFA enrolment. A dependency for that would be the only one in
 * the console, and the CDN rule rules out loading one, so — like the XLSX
 * writer in `export.ts` — the encoder is written out. Everything it does
 * follows the standard's structure closely enough to check against it:
 * encode → Reed-Solomon per block → interleave → place → mask by penalty.
 *
 * Returns the module matrix; `qrSvgPath` turns it into one SVG path.
 */

// Level M: data codewords per block (one entry per block) and EC codewords per block.
const BLOCKS: Record<number, { data: number[]; ec: number }> = {
  1: { data: [16], ec: 10 },
  2: { data: [28], ec: 16 },
  3: { data: [44], ec: 26 },
  4: { data: [32, 32], ec: 18 },
  5: { data: [43, 43], ec: 24 },
  6: { data: [27, 27, 27, 27], ec: 16 },
  7: { data: [31, 31, 31, 31], ec: 18 },
  8: { data: [38, 38, 39, 39], ec: 22 },
  9: { data: [36, 36, 36, 37, 37], ec: 22 },
  10: { data: [43, 43, 43, 43, 44], ec: 26 },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ---------------------------------------------------------------------------
// GF(256) and Reed-Solomon
// ---------------------------------------------------------------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index]! ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function capacity(version: number): number {
  return BLOCKS[version]!.data.reduce((sum, length) => sum + length, 0);
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const totalBits = capacity(version) * 8;
  push(0, Math.min(4, totalBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < capacity(version); pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

function interleave(data: number[], version: number): number[] {
  const spec = BLOCKS[version]!;
  const divisor = rsDivisor(spec.ec);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const length of spec.data) {
    const slice = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: slice, ec: rsRemainder(slice, divisor) });
  }
  const out: number[] = [];
  const longest = Math.max(...spec.data);
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]!);
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of blocks) out.push(block.ec[i]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => Array(this.size).fill(false));
  }

  /** x is the column, y the row. */
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFunctionPatterns() {
    const { size } = this;
    for (let i = 0; i < size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);

    const positions = ALIGNMENT[this.version]!;
    const last = positions.length - 1;
    positions.forEach((a, i) => {
      positions.forEach((b, j) => {
        const nearFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!nearFinder) this.drawAlignment(a, b);
      });
    });

    this.drawFormat(0); // reserve; redrawn once the mask is chosen
    this.drawVersion();
  }

  drawFinder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormat(mask: number) {
    const data = (0b00 << 3) | mask; // level M
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const { size } = this;

    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i += 1) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true); // the dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(codewords: number[]) {
    const { size } = this;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (!this.isFunction[y]![x] && index < codewords.length * 8) {
            this.modules[y]![x] = ((codewords[index >>> 3]! >>> (7 - (index & 7))) & 1) === 1;
            index += 1;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (this.isFunction[y]![x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /** The standard's four penalty rules; the lowest-scoring mask wins. */
  penalty(): number {
    const { size, modules } = this;
    let score = 0;

    const runs = (line: boolean[]) => {
      let total = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i += 1) {
        if (i < line.length && line[i] === line[i - 1]) {
          run += 1;
        } else {
          if (run >= 5) total += 3 + (run - 5);
          run = 1;
        }
      }
      return total;
    };
    const finderLike = (line: boolean[]) => {
      let total = 0;
      const pattern = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= line.length; i += 1) {
        if (!pattern.every((value, k) => line[i + k] === value)) continue;
        const before = line.slice(Math.max(0, i - 4), i);
        const after = line.slice(i + 7, i + 11);
        const lightBefore = i - 4 >= 0 && before.every((value) => !value);
        const lightAfter = i + 11 <= line.length && after.every((value) => !value);
        if (lightBefore || lightAfter) total += 40;
      }
      return total;
    };

    for (let i = 0; i < size; i += 1) {
      const row = modules[i]!;
      const column = modules.map((line) => line[i]!);
      score += runs(row) + runs(column) + finderLike(row) + finderLike(column);
    }
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const c = modules[y]![x];
        if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += 3;
      }
    }
    const dark = modules.flat().filter(Boolean).length;
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }
}

/**
 * Encode text as a QR module matrix. Throws when the text is too long for
 * version 10 at level M (213 bytes), which no enrolment URI comes near.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  for (; version <= 10; version += 1) {
    const headerBits = 4 + (version < 10 ? 8 : 16);
    if (headerBits + bytes.length * 8 <= capacity(version) * 8) break;
  }
  if (version > 10) throw new Error("Text too long for this QR encoder.");

  const codewords = interleave(encodeData(bytes, version), version);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = new Matrix(version);
    matrix.drawFunctionPatterns();
    matrix.drawCodewords(codewords);
    matrix.applyMask(mask);
    matrix.drawFormat(mask);
    const score = matrix.penalty();
    if (score < bestScore) {
      bestScore = score;
      best = matrix.modules.map((row) => [...row]);
    }
  }
  return best!;
}

/** One SVG path for the dark modules, with a four-module quiet zone. */
export function qrSvgPath(modules: boolean[][], quiet = 4): { path: string; size: number } {
  let path = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    });
  });
  return { path, size: modules.length + quiet * 2 };
}
