/**
 * Phase 1: asset normalisation (spec sections 14 and 19).
 *
 * For each base template:
 *   1. check the supplied source is byte-for-byte what base-templates.json records
 *   2. resize it to the canonical 2048x2048
 *   3. build a "decorable" mask: where background and halo layers may paint. That is
 *      inside the border, outside every protected text region, and outside the
 *      illustration itself, so those layers read as sitting behind the artwork.
 *
 * The outputs are derived, so they are git-ignored and rebuilt on demand.
 *
 *   npm run prepare-assets            # build anything missing or stale
 *   npm run prepare-assets -- --force # rebuild everything
 *   npm run prepare-assets -- --debug # also write mask visualisations
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import sharp from "sharp";
import {loadConfig} from "../src/config";
import {fromRoot} from "../src/paths";
import {close, dilate, fillHoles} from "../src/morphology";
import {MASK_DIR, PREPARED_MANIFEST, maskPath, matteInfoPath, type MatteInfo} from "../src/assets";
import {MATTE, preparedFingerprint} from "../src/matte";
import type {GeneratorConfig, Rect, RoundRect} from "../src/types";

const PNG_OPTIONS = {compressionLevel: 9, adaptiveFiltering: false, palette: false} as const;

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const DEBUG = args.has("--debug");

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const writeFile = (relativePath: string, data: string | Buffer) => {
  const path = fromRoot(relativePath);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, data);
};

function insideRoundRect(x: number, y: number, rect: RoundRect, inset: number): boolean {
  const left = rect.x + inset;
  const top = rect.y + inset;
  const right = rect.x + rect.w - inset;
  const bottom = rect.y + rect.h - inset;
  if (x < left || x >= right || y < top || y >= bottom) return false;
  const r = Math.max(0, rect.r - inset);
  const cx = x < left + r ? left + r : x >= right - r ? right - r : x;
  const cy = y < top + r ? top + r : y >= bottom - r ? bottom - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function isArtwork(r: number, g: number, b: number): boolean {
  const luma = (299 * r + 587 * g + 114 * b) / 1000;
  if (luma > MATTE.brightLuma) return true;
  const [br, bg, bb] = MATTE.background;
  const distance = Math.max(Math.abs(r - br), Math.abs(g - bg), Math.abs(b - bb));
  const cool = b - r > MATTE.coolDelta || g - r > MATTE.coolDelta;
  return cool && distance > MATTE.coolMinDistance;
}

/** Gaussian blur of a one-channel mask. */
async function blurred(mask: Uint8Array, size: number, sigma: number): Promise<Buffer> {
  // sharp converts a one-channel image to sRGB while blurring, so pull a single band
  // back out explicitly. Without this the three-channel result is read as one channel
  // and the mask comes out scrambled.
  const out = await sharp(Buffer.from(mask), {raw: {width: size, height: size, channels: 1}})
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (out.length !== size * size) throw new Error(`blurred mask has ${out.length} bytes, expected ${size * size}`);
  return out;
}

async function buildMask(
  config: GeneratorConfig,
  template: string,
  rgb: Buffer
): Promise<{mask: Buffer; art: Uint8Array; info: MatteInfo}> {
  const size = config.layout.canvas;
  const box: Rect = config.layout.centralArt;

  // 1. Raw artwork detection, only inside the central art box.
  const raw = new Uint8Array(size * size);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * size + x) * 3;
      if (isArtwork(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)) raw[y * size + x] = 255;
    }
  }

  // 2. Close narrow gaps, fill enclosed ones, then add a small margin.
  const solid = fillHoles(close(raw, size, size, MATTE.closeRadius), size, box);
  const art = dilate(solid, size, size, MATTE.marginRadius);

  // 3. Three soft layers: inside the border, away from the artwork, away from text.
  const protectedRects = Object.values(config.layout.protected);
  const grow = Math.ceil(2.5 * MATTE.textFeatherSigma);
  const border = new Uint8Array(size * size);
  const text = new Uint8Array(size * size);
  let minX = size, minY = size, maxX = -1, maxY = -1, sumX = 0, sumY = 0, artCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (solid[i]) {
        artCount++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (insideRoundRect(x, y, config.layout.border.inner, MATTE.borderInset)) border[i] = 255;
      if (protectedRects.some((r) => x >= r.x - grow && x < r.x + r.w + grow && y >= r.y - grow && y < r.y + r.h + grow)) {
        text[i] = 255;
      }
    }
  }
  if (artCount === 0) throw new Error(`${template}: found no artwork inside centralArt`);

  const [borderSoft, artSoft, textSoft] = await Promise.all([
    blurred(border, size, MATTE.featherSigma),
    blurred(art, size, MATTE.featherSigma),
    blurred(text, size, MATTE.textFeatherSigma)
  ]);

  // decorable = border x (1 - art) x (1 - text). Then force exact zeros over the
  // artwork and the protected boxes themselves, so no rounding in the blur can ever
  // let a layer through there.
  const alpha = Buffer.alloc(size * size);
  let allowed = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (solid[i] || protectedRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      const value = Math.round((borderSoft[i]! * (255 - artSoft[i]!) * (255 - textSoft[i]!)) / (255 * 255));
      alpha[i] = value;
      if (value > 0) allowed++;
    }
  }

  const mask = await sharp({create: {width: size, height: size, channels: 3, background: "#ffffff"}})
    .joinChannel(alpha, {raw: {width: size, height: size, channels: 1}})
    .png(PNG_OPTIONS)
    .toBuffer();

  return {
    mask,
    art: solid,
    info: {
      template,
      art: {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1},
      centroid: {cx: Math.round(sumX / artCount), cy: Math.round(sumY / artCount)},
      decorableFraction: Number((allowed / (size * size)).toFixed(4))
    }
  };
}

/** Artwork in red, decorable area in green, over a dimmed copy of the base. */
async function debugImage(base: Buffer, art: Uint8Array, mask: Buffer, size: number): Promise<Buffer> {
  const alpha = await sharp(mask).extractChannel(3).raw().toBuffer();
  const tint = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    if (art[i]) tint.set([255, 40, 40, 150], i * 4);
    else if (alpha[i]! > 0) tint.set([40, 220, 90, Math.round(alpha[i]! * 0.35)], i * 4);
  }
  // sharp resizes before it composites, so these have to be two separate pipelines.
  const full = await sharp(base)
    .modulate({brightness: 0.7})
    .composite([{input: tint, raw: {width: size, height: size, channels: 4}}])
    .png()
    .toBuffer();
  return sharp(full).resize(640, 640).png().toBuffer();
}

async function main() {
  const config = loadConfig();
  const size = config.layout.canvas;
  const manifestPath = fromRoot(PREPARED_MANIFEST);
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const fingerprint = preparedFingerprint(config.layout);
  const manifest: Record<string, unknown> = {fingerprint, templates: {}};

  for (const [id, template] of Object.entries(config.baseTemplates)) {
    const sourcePath = fromRoot(template.source);
    const actual = sha256File(sourcePath);
    if (actual !== template.sha256) {
      throw new Error(
        `${id}: ${template.source} has changed.\n  expected ${template.sha256}\n  found    ${actual}\n` +
          "Supplied templates must stay byte-for-byte unchanged. Update sha256 only if the change is intended."
      );
    }

    const upToDate =
      !FORCE &&
      previous.fingerprint === fingerprint &&
      previous.templates?.[id] === actual &&
      existsSync(fromRoot(template.asset)) &&
      existsSync(fromRoot(maskPath(id)));
    if (upToDate && !DEBUG) {
      console.log(`  ${id.padEnd(16)} up to date`);
      (manifest.templates as Record<string, string>)[id] = actual;
      continue;
    }

    const started = Date.now();
    const base = await sharp(sourcePath)
      .removeAlpha()
      .resize(size, size, {kernel: "lanczos3", fit: "fill"})
      .png(PNG_OPTIONS)
      .toBuffer();
    writeFile(template.asset, base);

    const rgb = await sharp(base).removeAlpha().raw().toBuffer();
    const {mask, art, info} = await buildMask(config, id, rgb);
    writeFile(maskPath(id), mask);
    writeFile(matteInfoPath(id), JSON.stringify(info, null, 2) + "\n");

    if (DEBUG) writeFile(`output/asset-sheet/masks/${id}.png`, await debugImage(base, art, mask, size));

    (manifest.templates as Record<string, string>)[id] = actual;
    console.log(
      `  ${id.padEnd(16)} ${size}px, art ${info.art.w}x${info.art.h} at (${info.art.x},${info.art.y}), ` +
        `decorable ${(info.decorableFraction * 100).toFixed(1)}%  (${Date.now() - started} ms)`
    );
  }

  mkdirSync(fromRoot(MASK_DIR), {recursive: true});
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nPrepared assets recorded in ${PREPARED_MANIFEST}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
