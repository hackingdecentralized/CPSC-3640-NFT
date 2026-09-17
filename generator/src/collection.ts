/**
 * The live collection's fixed inputs, shared by the claim page and the reveal.
 */
import {sha256Hex} from "./sha256";
import type {GeneratorConfig} from "./types";

export interface Collection {
  /** Public. See config/collection.json. */
  salt: string;
}

export function readCollection(raw: unknown): Collection {
  const salt = (raw as {salt?: unknown} | null)?.salt;
  if (typeof salt !== "string" || salt.length < 8) {
    throw new Error("config/collection.json needs a salt of at least 8 characters");
  }
  return {salt};
}

/** Objects with their keys sorted, so reordering a JSON file does not change a digest. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])]));
}

/**
 * A digest of the configuration that decides which card a token gets and where its
 * layers go: the salt, the weights and rules, the layout, and each template's weight
 * and SHA-256. Display names are left out, since they never change a card, and so is
 * key order, since every draw sorts its keys.
 *
 * The claim page computes this from the configuration it was built with, and checks it
 * against the exported artwork. src/fingerprint.ts combines it with digests of the code
 * and the artwork into the fingerprint the page shows.
 */
export function configDigest(config: GeneratorConfig, collection: Collection): string {
  const templates = Object.fromEntries(
    Object.entries(config.baseTemplates).map(([id, t]) => [id, {weight: t.weight, sha256: t.sha256}])
  );
  const inputs = {
    salt: collection.salt,
    baseTemplates: templates,
    traits: config.traits,
    compatibility: config.compatibility,
    layout: config.layout
  };
  return sha256Hex(JSON.stringify(canonical(inputs)));
}

/** The short fingerprint shown to people: several digests, folded into one. */
export const combineDigests = (digests: readonly string[]): string => sha256Hex(digests.join(":")).slice(0, 16);
