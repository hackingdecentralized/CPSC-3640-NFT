import {describe, expect, it} from "vitest";
import {combineDigests, configDigest, readCollection} from "../src/collection";
import {sourceDigest} from "../src/fingerprint";
import {planNFT} from "../src/generator";
import {loadCollection} from "../src/loadConfig";
import {PORTABLE_MODULES} from "../src/portable";
import {deriveSeed} from "../src/seed";
import {planToken} from "../src/token";
import {planTraits} from "../src/traits";
import {WALLET_A, WALLET_B, cloneConfig, config} from "./helpers";

const collection = loadCollection();
const digest = configDigest(config, collection);

describe("collection", () => {
  it("has a usable public salt", () => {
    expect(collection.salt.length).toBeGreaterThanOrEqual(8);
    expect(() => readCollection({salt: "short"})).toThrow();
    expect(() => readCollection({})).toThrow();
    expect(() => readCollection(null)).toThrow();
  });

  it("digests the salt, weights, rules, layout and template files", () => {
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(configDigest(config, {salt: `${collection.salt}x`})).not.toBe(digest);

    const weights = cloneConfig();
    weights.traits.halo.none = 19;
    weights.traits.halo.soft_gold = 31;
    expect(configDigest(weights, collection)).not.toBe(digest);

    const rules = cloneConfig();
    rules.compatibility.preferredMultiplier = 3;
    expect(configDigest(rules, collection)).not.toBe(digest);

    const layout = cloneConfig();
    layout.layout.slots.badge.cx += 1;
    expect(configDigest(layout, collection)).not.toBe(digest);

    const artwork = cloneConfig();
    artwork.baseTemplates.harkness_tower!.sha256 = "0".repeat(64);
    expect(configDigest(artwork, collection)).not.toBe(digest);

    const odds = cloneConfig();
    odds.baseTemplates.harkness_tower!.weight = 18;
    expect(configDigest(odds, collection)).not.toBe(digest);
  });

  it("ignores what never changes a card: key order and display names", () => {
    const reordered = cloneConfig();
    reordered.traits.badge = Object.fromEntries(Object.entries(reordered.traits.badge).reverse());
    reordered.baseTemplates = Object.fromEntries(Object.entries(reordered.baseTemplates).reverse());
    expect(Object.keys(reordered.traits.badge)).not.toEqual(Object.keys(config.traits.badge));
    expect(configDigest(reordered, collection)).toBe(digest);
    expect(planTraits(reordered, "ab".repeat(32))).toEqual(planTraits(config, "ab".repeat(32)));

    const renamed = cloneConfig();
    renamed.baseTemplates.handsome_dan!.label = "Handsome Dan XVIII";
    expect(configDigest(renamed, collection)).toBe(digest);
  });

  it("folds digests into a short fingerprint that depends on every part and its place", () => {
    const parts = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    const folded = combineDigests(parts);
    expect(folded).toMatch(/^[0-9a-f]{16}$/);
    expect(combineDigests([...parts])).toBe(folded);
    expect(combineDigests([parts[0]!, parts[2]!, parts[1]!])).not.toBe(folded);
    expect(combineDigests([parts[0]!, parts[1]!, "d".repeat(64)])).not.toBe(folded);
  });

  it("digests the source of every module the page shares", () => {
    const source = (name: string) => `// ${name}`;
    const base = sourceDigest(source);
    expect(sourceDigest(source)).toBe(base);
    for (const changed of PORTABLE_MODULES) {
      expect(sourceDigest((name) => (name === changed ? `${source(name)} edited` : source(name))), changed).not.toBe(base);
    }
    expect(sourceDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("planToken", () => {
  it("is the seed derivation followed by trait planning", () => {
    for (let id = 1; id <= 50; id++) {
      for (const wallet of [WALLET_A, WALLET_B]) {
        expect(planToken(config, id, wallet, collection.salt)).toEqual(
          planTraits(config, deriveSeed(id, wallet, collection.salt))
        );
      }
    }
  });

  it("gives the same card for a bigint, number or string token id, and any address case", () => {
    const expected = planToken(config, 7, WALLET_A, collection.salt);
    expect(planToken(config, 7n, WALLET_A.toLowerCase(), collection.salt)).toEqual(expected);
    expect(planToken(config, "7", WALLET_A.toUpperCase().replace("0X", "0x"), collection.salt)).toEqual(expected);
  });

  it("is what the generator plans with", () => {
    for (let id = 1; id <= 20; id++) {
      expect(planNFT({tokenId: id, walletAddress: WALLET_B, salt: collection.salt}, config)).toEqual(
        planToken(config, id, WALLET_B, collection.salt)
      );
    }
  });
});
