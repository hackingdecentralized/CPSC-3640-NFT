/**
 * The files `npm run export-web` writes for the claim page, and how the page finds
 * them. Both sides import this, so a renamed file cannot break only one of them.
 */

/** Fetched first. Lists everything else. */
export const WEB_INDEX = "index.json";

export const layerFile = (key: string): string => `${key}.webp`;
export const sampleFile = (template: string): string => `samples/${template}.webp`;

export interface WebIndex {
  /** Changes whenever any exported byte changes. Appended to URLs to bust caches. */
  version: string;
  /** The collection the files were exported for. See collectionFingerprint. */
  fingerprint: string;
  outputSize: number;
  /** Every layer key the page may ask for. */
  layers: string[];
  /** template -> example card thumbnail. */
  samples: Record<string, string>;
}
