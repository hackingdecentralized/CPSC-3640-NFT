/**
 * Deterministic PRNG: xoshiro128** (Blackman and Vigna), 32-bit.
 *
 * Chosen because it is small enough to read in full, has a published reference
 * implementation to test against, and behaves identically on every JavaScript
 * engine. Math.random() is never used anywhere in the generator.
 *
 * State is the first 128 bits of a SHA-256 digest, so it is already well mixed.
 */

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
const TWO_32 = 2 ** 32;

export class Rng {
  private readonly s: Uint32Array;

  private constructor(state: ArrayLike<number>) {
    this.s = Uint32Array.from(state);
    // The all-zero state is the one state xoshiro can never leave.
    if (this.s.every((word) => word === 0)) this.s[0] = 0x9e3779b9;
  }

  /** Seed from a hex digest of at least 32 hex characters. */
  static fromSeed(seedHex: string): Rng {
    if (!/^[0-9a-f]{32,}$/i.test(seedHex)) throw new Error(`seed must be hex: "${seedHex}"`);
    const words = [0, 8, 16, 24].map((offset) => Number.parseInt(seedHex.slice(offset, offset + 8), 16));
    return new Rng(words);
  }

  /** Raw state, for testing against the reference implementation. */
  static fromState(state: readonly [number, number, number, number]): Rng {
    return new Rng(state);
  }

  nextUint32(): number {
    const s = this.s as Uint32Array & {0: number; 1: number; 2: number; 3: number};
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform integer in [0, n), without modulo bias. */
  below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new Error(`below(n) needs 1 <= n <= 2^32, got ${n}`);
    if (n === TWO_32) return this.nextUint32();
    const limit = TWO_32 - (TWO_32 % n);
    for (;;) {
      const r = this.nextUint32();
      if (r < limit) return r % n;
    }
  }
}
