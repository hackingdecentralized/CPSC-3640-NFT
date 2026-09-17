/**
 * The modules in src/ that also run in the browser, on the claim page. They, and
 * everything they import, must stay free of Node built-ins and native packages
 * (tests/portability.test.ts), and their source is part of the collection
 * fingerprint (src/fingerprint.ts).
 */
export const PORTABLE_MODULES = [
  "assets",
  "collection",
  "compatibility",
  "composite",
  "config",
  "layers",
  "metadata",
  "morphology",
  "portable",
  "random",
  "seed",
  "sha256",
  "strokeFont",
  "token",
  "traits",
  "types",
  "weights",
  "webAssets"
] as const;
