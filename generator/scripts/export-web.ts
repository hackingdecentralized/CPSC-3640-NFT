/**
 * Export what the claim page needs to draw cards in the browser.
 *
 *   npm run export-web                 # writes ../web/public/nft/
 *   npm run export-web -- --out <dir>
 *
 * Every layer raster is exported exactly as the Node renderer composites it, in
 * lossless WebP, so the page draws a student's card from the same pixels the reveal
 * later draws the token image from. Also writes one small example card per template
 * for the page to show before anyone has claimed.
 *
 * Run `npm run prepare-assets` first. The output is derived, so it is not committed.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import sharp from "sharp";
import {collectionFingerprint} from "../src/fingerprint";
import {everyLayer} from "../src/layers";
import {loadCollection, loadConfig} from "../src/loadConfig";
import {fromRoot} from "../src/paths";
import {rasterLayer, renderImage} from "../src/renderer";
import {planToken} from "../src/token";
import type {Plan} from "../src/traits";
import type {GeneratorConfig} from "../src/types";
import {WEB_INDEX, layerFile, sampleFile, type WebIndex} from "../src/webAssets";
import {mapLimit} from "./html";
import {parseArgs, run, stringArg} from "./cli";

const SAMPLE_SIZE = 1024;
const SAMPLE_WALLET = "0x0000000000000000000000000000000000000000";

/**
 * An example card for a template: the first of a fixed series that shows a halo and
 * a badge, so the example has something on it without being the rarest possible card.
 */
function samplePlan(config: GeneratorConfig, template: string): Plan {
  for (let i = 1; i <= 500; i++) {
    const plan = planToken(config, i, SAMPLE_WALLET, "claim-page-sample", {base_template: template});
    if (plan.traits.halo !== "none" && plan.traits.badge !== "standard") return plan;
  }
  throw new Error(`no sample found for ${template}`);
}

run(async () => {
  const args = parseArgs();
  const out = resolve(fromRoot(), stringArg(args, "out") ?? "../web/public/nft");
  const config = loadConfig();
  const collection = loadCollection();

  // Replace the previous export wholesale, so nothing stale survives. Never delete a
  // directory this script did not write.
  if (existsSync(out) && readdirSync(out).length > 0) {
    if (!existsSync(join(out, WEB_INDEX))) throw new Error(`${out} is not empty and is not a previous export; refusing to replace it`);
    rmSync(out, {recursive: true});
  }
  const hash = createHash("sha256");
  const write = (file: string, data: Buffer) => {
    const path = join(out, file);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, data);
    hash.update(file).update(data);
  };

  const started = Date.now();
  const layers = everyLayer(config);
  const sizes = await mapLimit(layers, 4, async (layer) => {
    const data = await sharp(await rasterLayer(config, layer)).webp({lossless: true}).toBuffer();
    const {width, height} = await sharp(data).metadata();
    if (width !== layer.width || height !== layer.height) {
      throw new Error(`${layer.key} is ${width}x${height}, expected ${layer.width}x${layer.height}`);
    }
    return data;
  });
  layers.forEach((layer, i) => write(layerFile(layer.key), sizes[i]!));

  const samples: Record<string, string> = {};
  for (const template of Object.keys(config.baseTemplates)) {
    const image = await renderImage(config, samplePlan(config, template));
    write(sampleFile(template), await sharp(image).resize(SAMPLE_SIZE, SAMPLE_SIZE).webp({quality: 80}).toBuffer());
    samples[template] = sampleFile(template);
  }

  const {fingerprint, configDigest} = await collectionFingerprint(config, collection);
  const index: WebIndex = {
    version: hash.digest("hex").slice(0, 12),
    fingerprint,
    configDigest,
    outputSize: config.layout.outputSize,
    layers: layers.map((layer) => layer.key),
    samples
  };
  writeFileSync(join(out, WEB_INDEX), JSON.stringify(index, null, 2) + "\n");

  const total = sizes.reduce((sum, data) => sum + data.length, 0);
  console.log(
    `Exported ${layers.length} layers (${(total / 1024 / 1024).toFixed(1)} MB) and ${Object.keys(samples).length} samples ` +
      `to ${relative(process.cwd(), out) || out} in ${((Date.now() - started) / 1000).toFixed(1)} s`
  );
  console.log(`Collection fingerprint ${index.fingerprint}, version ${index.version}`);
});
