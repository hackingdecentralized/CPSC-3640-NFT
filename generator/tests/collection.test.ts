import {describe, expect, it} from "vitest";
import {collectionFingerprint, readCollection} from "../src/collection";
import {planNFT} from "../src/generator";
import {loadCollection} from "../src/loadConfig";
import {deriveSeed} from "../src/seed";
import {planToken} from "../src/token";
import {planTraits} from "../src/traits";
import {WALLET_A, WALLET_B, cloneConfig, config} from "./helpers";

const collection = loadCollection();
const fingerprint = collectionFingerprint(config, collection);

describe("collection", () => {
  it("has a usable public salt", () => {
    expect(collection.salt.length).toBeGreaterThanOrEqual(8);
    expect(() => readCollection({salt: "short"})).toThrow();
    expect(() => readCollection({})).toThrow();
    expect(() => readCollection(null)).toThrow();
  });

  it("fingerprints the salt, weights, rules, layout and artwork", () => {
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(collectionFingerprint(config, {salt: `${collection.salt}x`})).not.toBe(fingerprint);

    const weights = cloneConfig();
    weights.traits.halo.none = 19;
    weights.traits.halo.soft_gold = 31;
    expect(collectionFingerprint(weights, collection)).not.toBe(fingerprint);

    const rules = cloneConfig();
    rules.compatibility.preferredMultiplier = 3;
    expect(collectionFingerprint(rules, collection)).not.toBe(fingerprint);

    const layout = cloneConfig();
    layout.layout.slots.badge.cx += 1;
    expect(collectionFingerprint(layout, collection)).not.toBe(fingerprint);

    const artwork = cloneConfig();
    artwork.baseTemplates.tower_clock!.sha256 = "0".repeat(64);
    expect(collectionFingerprint(artwork, collection)).not.toBe(fingerprint);
  });

  it("ignores the order keys are written in, which never changes a card", () => {
    const reordered = cloneConfig();
    reordered.traits.badge = Object.fromEntries(Object.entries(reordered.traits.badge).reverse());
    reordered.baseTemplates = Object.fromEntries(Object.entries(reordered.baseTemplates).reverse());
    expect(Object.keys(reordered.traits.badge)).not.toEqual(Object.keys(config.traits.badge));
    expect(collectionFingerprint(reordered, collection)).toBe(fingerprint);
    expect(planTraits(reordered, "ab".repeat(32))).toEqual(planTraits(config, "ab".repeat(32)));
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
