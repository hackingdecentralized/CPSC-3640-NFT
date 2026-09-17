import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {Rng} from "../src/random";
import {deriveSeed, normalizeTokenId, normalizeWallet, subSeed} from "../src/seed";
import {planTraits} from "../src/traits";
import {SALT_X, WALLET_A, WALLET_B, config} from "./helpers";

describe("determinism", () => {
  it("same inputs give the same seed and the same traits", () => {
    const a = planTraits(config, deriveSeed(42, WALLET_A, SALT_X));
    const b = planTraits(config, deriveSeed(42, WALLET_A, SALT_X));
    expect(b).toEqual(a);
  });

  it("is stable across repeated runs of a large batch", () => {
    const run = () =>
      Array.from({length: 200}, (_, i) => planTraits(config, deriveSeed(i, WALLET_B, SALT_X)).traits);
    expect(run()).toEqual(run());
  });

  it("follows the documented formula exactly", () => {
    // Computed independently of deriveSeed, straight from spec section 5.
    const expected = createHash("sha256")
      .update(`42:${WALLET_A.toLowerCase()}:${SALT_X}`, "utf8")
      .digest("hex");
    expect(deriveSeed(42, WALLET_A, SALT_X)).toBe(expected);
  });
});

describe("seed sensitivity", () => {
  const base = deriveSeed(42, WALLET_A, SALT_X);

  it("changes when the token id changes", () => {
    expect(deriveSeed(43, WALLET_A, SALT_X)).not.toBe(base);
  });

  it("changes when the wallet changes", () => {
    expect(deriveSeed(42, WALLET_B, SALT_X)).not.toBe(base);
  });

  it("changes when the salt changes", () => {
    expect(deriveSeed(42, WALLET_A, `${SALT_X}!`)).not.toBe(base);
  });

  it("does not let fields bleed into each other through the separator", () => {
    expect(deriveSeed(1, WALLET_A, "2:x")).not.toBe(deriveSeed(12, WALLET_A, "x"));
  });
});

describe("input normalisation", () => {
  it("treats every spelling of a token id alike", () => {
    const expected = deriveSeed(42, WALLET_A, SALT_X);
    for (const id of ["42", "0042", " 42 ", 42n]) {
      expect(deriveSeed(id, WALLET_A, SALT_X)).toBe(expected);
    }
    expect(normalizeTokenId("000")).toBe("0");
  });

  it("ignores address checksum casing", () => {
    expect(deriveSeed(7, WALLET_A.toUpperCase().replace("0X", "0x"), SALT_X)).toBe(
      deriveSeed(7, WALLET_A.toLowerCase(), SALT_X)
    );
    expect(normalizeWallet(WALLET_A)).toBe(WALLET_A.toLowerCase());
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => normalizeTokenId(-1)).toThrow();
    expect(() => normalizeTokenId("1.5")).toThrow();
    expect(() => normalizeTokenId(2 ** 60)).toThrow();
    expect(() => normalizeWallet("0x123")).toThrow();
    expect(() => deriveSeed(1, WALLET_A, "")).toThrow();
  });
});

describe("PRNG", () => {
  it("matches the xoshiro128** reference output", () => {
    // Reference C implementation, state {1, 2, 3, 4}.
    const rng = Rng.fromState([1, 2, 3, 4]);
    expect(Array.from({length: 5}, () => rng.nextUint32())).toEqual([
      11520, 0, 5927040, 70819200, 2031721883
    ]);
  });

  it("never uses Math.random", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random was called");
    };
    try {
      planTraits(config, deriveSeed(1, WALLET_A, SALT_X));
    } finally {
      Math.random = original;
    }
  });

  it("below(n) stays in range and reaches every value", () => {
    const rng = Rng.fromSeed(subSeed("00".repeat(32), "range"));
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.below(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it("gives independent streams to different labels", () => {
    const seed = deriveSeed(1, WALLET_A, SALT_X);
    expect(subSeed(seed, "badge")).not.toBe(subSeed(seed, "halo"));
  });
});

describe("stream independence", () => {
  it("forcing one trait leaves every other trait untouched", () => {
    for (let id = 1; id <= 50; id++) {
      const seed = deriveSeed(id, WALLET_A, SALT_X);
      const free = planTraits(config, seed);
      const forced = planTraits(config, seed, {badge: "staff"});
      expect(forced.traits.badge).toBe("staff");
      expect({...forced.traits, badge: free.traits.badge}).toEqual(free.traits);
      expect(forced.microIconSlots).toEqual(free.microIconSlots);
    }
  });
});
