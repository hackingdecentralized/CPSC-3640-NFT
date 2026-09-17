/**
 * Layered rendering (spec sections 4 and 13).
 *
 * src/layers.ts decides what is drawn, where, and in what order. This module turns
 * each layer into pixels with sharp, then composites the stack with src/composite.ts.
 * The claim page composites the very same rasters (see `npm run export-web`) with a
 * browser canvas, which uses the same formulas.
 *
 * "Masked" layers are clipped by the template's decorable mask, so they never touch
 * the course text or the illustration. Every other layer sits in a slot that
 * configuration validation has already proven clear of the text.
 *
 * SVGs are rasterised directly at their output size: they are vector, so nothing is
 * drawn large and then shrunk.
 */
import {existsSync, readFileSync} from "node:fs";
import sharp from "sharp";
import {fromRoot} from "./paths";
import {maskPath} from "./assets";
import {compositeLayer} from "./composite";
import {layerStack, type Layer} from "./layers";
import type {GeneratorConfig, Layout} from "./types";
import type {Plan} from "./traits";

export const PNG_OPTIONS = {compressionLevel: 9, adaptiveFiltering: false, palette: false} as const;

const cache = new Map<string, Promise<Buffer>>();
const cached = (key: string, make: () => Promise<Buffer>): Promise<Buffer> => {
  let hit = cache.get(key);
  if (!hit) {
    hit = make();
    cache.set(key, hit);
  }
  return hit;
};

function requireFile(relativePath: string, hint: string): string {
  const path = fromRoot(relativePath);
  if (!existsSync(path)) throw new Error(`Missing asset ${relativePath}. ${hint}`);
  return path;
}

const intrinsicWidth = (svgPath: string): number => {
  const match = /<svg[^>]*\bwidth="([\d.]+)"/.exec(readFileSync(svgPath, "utf8"));
  if (!match) throw new Error(`${svgPath} has no width attribute`);
  return Number(match[1]);
};

/** A full-canvas SVG rasterised at the output size. */
function canvasLayer(svgRelative: string, layout: Layout): Promise<Buffer> {
  const size = layout.outputSize;
  return cached(`canvas:${svgRelative}:${size}`, async () => {
    const svg = requireFile(svgRelative, "Run `npm run build-overlays`.");
    return sharp(svg, {density: (72 * size) / intrinsicWidth(svg)})
      .resize(size, size, {fit: "fill"})
      .png()
      .toBuffer();
  });
}

/**
 * A full-canvas layer, clipped to where decoration is allowed on this template.
 *
 * Its alpha is squared, which keeps a glow soft where it fades into the mask. The
 * collection was designed with this look: sharp's own screen blend, which rendered
 * the first previews, applies alpha twice. Doing it here, once, keeps that look while
 * letting the compositing itself follow the standard formulas a browser uses.
 */
function maskedLayer(svgRelative: string, template: string, layout: Layout): Promise<Buffer> {
  return cached(`masked:${svgRelative}:${template}:${layout.outputSize}`, async () => {
    const mask = requireFile(maskPath(template), "Run `npm run prepare-assets`.");
    const {data, info} = await sharp(await canvasLayer(svgRelative, layout))
      .ensureAlpha()
      .composite([{input: mask, blend: "dest-in"}])
      .raw()
      .toBuffer({resolveWithObject: true});
    if (info.channels !== 4) throw new Error(`${svgRelative} masked to ${info.channels} channels, expected 4`);
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round((data[i]! * data[i]!) / 255);
    return sharp(data, {raw: {width: info.width, height: info.height, channels: 4}}).png().toBuffer();
  });
}

/** An SVG rasterised at exactly the given size. */
function sizedLayer(svgRelative: string, width: number, height: number): Promise<Buffer> {
  return cached(`slot:${svgRelative}:${width}x${height}`, async () => {
    const svg = requireFile(svgRelative, "Run `npm run build-overlays`.");
    return sharp(svg, {density: (72 * width) / intrinsicWidth(svg)})
      .resize(width, height, {fit: "fill"})
      .png()
      .toBuffer();
  });
}

/** The prepared template artwork, checked to be exactly the output size. */
function baseImage(config: GeneratorConfig, template: string): Promise<Buffer> {
  const asset = config.baseTemplates[template]?.asset;
  if (!asset) throw new Error(`unknown base_template "${template}"`);
  return cached(`base:${asset}:${config.layout.outputSize}`, async () => {
    const image = readFileSync(requireFile(asset, "Run `npm run prepare-assets`."));
    const {width, height} = await sharp(image).metadata();
    if (width !== config.layout.outputSize || height !== config.layout.outputSize) {
      throw new Error(
        `${asset} is ${width}x${height}, expected ${config.layout.outputSize}. Run \`npm run prepare-assets\`.`
      );
    }
    return image;
  });
}

/** One layer's pixels, as a PNG exactly `layer.width` by `layer.height`. */
export function rasterLayer(config: GeneratorConfig, layer: Layer): Promise<Buffer> {
  const {source} = layer;
  switch (source.kind) {
    case "base":
      return baseImage(config, source.template);
    case "canvas":
      return canvasLayer(source.svg, config.layout);
    case "masked":
      return maskedLayer(source.svg, source.template, config.layout);
    case "slot":
      return sizedLayer(source.svg, layer.width, layer.height);
  }
}

export async function renderImage(config: GeneratorConfig, plan: Plan): Promise<Buffer> {
  const [base, ...overlays] = layerStack(config, plan);
  const size = config.layout.outputSize;

  // The card is fully opaque, so it is worked on as RGB.
  const card = await sharp(await rasterLayer(config, base!)).removeAlpha().raw().toBuffer();
  if (card.length !== size * size * 3) throw new Error(`base is ${card.length} bytes, expected ${size * size * 3}`);

  for (const layer of overlays) {
    const pixels = await sharp(await rasterLayer(config, layer)).ensureAlpha().raw().toBuffer();
    compositeLayer(card, size, pixels, layer, layer.blend);
  }

  return sharp(card, {raw: {width: size, height: size, channels: 3}}).png(PNG_OPTIONS).toBuffer();
}
