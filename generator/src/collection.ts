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
 * A short digest of everything that decides which card a token gets and where its
 * layers go: the salt, the weights and rules, the layout, and (through their
 * SHA-256s) the base artwork. The claim page shows it, and `npm run collection
 * -- --expect` refuses a different one, so students are not shown one card and
 * sent another. Key order is ignored: every draw sorts its keys anyway.
 */
export function collectionFingerprint(config: GeneratorConfig, collection: Collection): string {
  const inputs = {
    salt: collection.salt,
    baseTemplates: config.baseTemplates,
    traits: config.traits,
    compatibility: config.compatibility,
    layout: config.layout
  };
  return sha256Hex(JSON.stringify(canonical(inputs))).slice(0, 16);
}
