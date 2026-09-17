/**
 * The collection fingerprint (Node only).
 *
 * A token's card depends on three things, and the fingerprint covers all of them:
 *   - the configuration and salt (configDigest, which the page can also compute)
 *   - the code that turns those into a card (the portable modules' source)
 *   - the artwork: every layer raster, pixel for pixel, which covers the overlay SVGs,
 *     the templates, their masks and the sharp version that rasterised them
 *
 * `npm run export-web` writes it next to the artwork, so the claim page shows the
 * fingerprint of exactly what it draws with. `npm run collection -- --expect` recomputes
 * it from the checkout, and refuses to generate if anything differs.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import sharp from "sharp";
import {combineDigests, configDigest, type Collection} from "./collection";
import {everyLayer} from "./layers";
import {fromRoot} from "./paths";
import {PORTABLE_MODULES} from "./portable";
import {rasterLayer} from "./renderer";
import type {GeneratorConfig} from "./types";

export interface Fingerprint {
  /** What people compare: 16 hex characters. */
  fingerprint: string;
  configDigest: string;
  sourceDigest: string;
  rasterDigest: string;
}

const readModule = (name: string): string => readFileSync(fromRoot("src", `${name}.ts`), "utf8");

export function sourceDigest(read: (name: string) => string = readModule): string {
  const hash = createHash("sha256");
  for (const name of [...PORTABLE_MODULES].sort()) hash.update(name).update("\0").update(read(name)).update("\0");
  return hash.digest("hex");
}

export async function rasterDigest(config: GeneratorConfig): Promise<string> {
  const hash = createHash("sha256");
  const layers = everyLayer(config).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const layer of layers) {
    const {data, info} = await sharp(await rasterLayer(config, layer)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    hash.update(`${layer.key}\0${info.width}x${info.height}\0`).update(data);
  }
  return hash.digest("hex");
}

export async function collectionFingerprint(config: GeneratorConfig, collection: Collection): Promise<Fingerprint> {
  const digests = {
    configDigest: configDigest(config, collection),
    sourceDigest: sourceDigest(),
    rasterDigest: await rasterDigest(config)
  };
  return {fingerprint: combineDigests([digests.configDigest, digests.sourceDigest, digests.rasterDigest]), ...digests};
}
