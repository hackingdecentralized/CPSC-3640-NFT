/**
 * SHA-256 in plain TypeScript (FIPS 180-4).
 *
 * The trait code runs in two places: here in Node, and in students' browsers on the
 * claim page. It must produce identical seeds in both, and it must not depend on a
 * Node built-in, so it carries its own hash. tests/sha256.test.ts checks it against
 * Node's OpenSSL implementation on thousands of inputs.
 *
 * The round constants are computed rather than typed in, using exact integer roots:
 * the first 32 bits of the fractional parts of the cube roots (K) and square roots
 * (H) of the first primes.
 */

const firstPrimes = (count: number): bigint[] => {
  const primes: bigint[] = [];
  for (let n = 2n; primes.length < count; n++) {
    if (primes.every((p) => n % p !== 0n)) primes.push(n);
  }
  return primes;
};

const bitLength = (n: bigint): number => n.toString(2).length;

/** floor(n ** (1/k)) by Newton's method from an overestimate. */
function integerRoot(n: bigint, k: bigint): bigint {
  let x = 1n << BigInt(Math.ceil(bitLength(n) / Number(k)));
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

const low32 = (n: bigint): number => Number(n & 0xffffffffn);
const PRIMES = firstPrimes(64);
const K = Uint32Array.from(PRIMES, (p) => low32(integerRoot(p << 96n, 3n)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => low32(integerRoot(p << 64n, 2n)));

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil((data.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = data.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      w[t] =
        w[t - 16]! +
        (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) +
        w[t - 7]! +
        (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

const encoder = new TextEncoder();

/** SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return Array.from(sha256(encoder.encode(text)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
