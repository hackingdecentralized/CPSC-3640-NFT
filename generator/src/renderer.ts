/**
 * Layered rendering (spec sections 4 and 13).
 *
 *   base template
 *   + background overlay   screen blend, masked to open background
 *   + border overlay
 *   + central halo         screen blend, masked to open background
 *   + micro icons          at their chosen slots
 *   + role icons           under HUMAN / BLOCKCHAIN CONTRACT / AI
 *   + badge
 *   + easter egg
 *
 * "Masked" means clipped by the template's decorable mask, so those layers never
 * touch the course text or the illustration. Every other layer sits in a slot that
 * configuration validation has already proven clear of the text.
 *
 * Coordinates are written in the 2048px design space. Everything is rasterised
 * directly at layout.outputSize: SVGs are vector, so nothing is drawn large and
 * then shrunk.
 */
import {existsSync, readFileSync} from "node:fs";
import sharp, {type OverlayOptions} from "sharp";
import {fromRoot} from "./paths";
import {maskPath, overlayPath} from "./assets";
import {drawsLayer} from "./compatibility";
import {outputScale, scaleSlot} from "./config";
import {ROLE_GROUPS, type GeneratorConfig, type Layout, type Slot} from "./types";
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

/** A full-canvas layer, clipped to where decoration is allowed on this template. */
function maskedLayer(svgRelative: string, template: string, layout: Layout): Promise<Buffer> {
  return cached(`masked:${svgRelative}:${template}:${layout.outputSize}`, async () => {
    const mask = requireFile(maskPath(template), "Run `npm run prepare-assets`.");
    return sharp(await canvasLayer(svgRelative, layout))
      .ensureAlpha()
      .composite([{input: mask, blend: "dest-in"}])
      .png()
      .toBuffer();
  });
}

/** An SVG rasterised at exactly its slot's output size, and where it goes. */
async function slotLayer(svgRelative: string, slot: Slot, layout: Layout): Promise<OverlayOptions> {
  const rect = scaleSlot(slot, outputScale(layout));
  const input = await cached(`slot:${svgRelative}:${rect.w}x${rect.h}`, async () => {
    const svg = requireFile(svgRelative, "Run `npm run build-overlays`.");
    return sharp(svg, {density: (72 * rect.w) / intrinsicWidth(svg)})
      .resize(rect.w, rect.h, {fit: "fill"})
      .png()
      .toBuffer();
  });
  return {input, top: rect.y, left: rect.x};
}

export async function renderImage(config: GeneratorConfig, plan: Plan): Promise<Buffer> {
  const {traits, microIconsDrawOrder, microIconSlots} = plan;
  const {layout} = config;
  const template = config.baseTemplates[traits.base_template];
  if (!template) throw new Error(`unknown base_template "${traits.base_template}"`);
  const basePath = requireFile(template.asset, "Run `npm run prepare-assets`.");

  const layers: OverlayOptions[] = [];

  layers.push({
    input: await maskedLayer(overlayPath.background(traits.background_style), traits.base_template, layout),
    blend: "screen"
  });

  if (drawsLayer("border_style", traits.border_style)) {
    layers.push({input: await canvasLayer(overlayPath.border(traits.border_style), layout)});
  }

  if (drawsLayer("halo", traits.halo)) {
    layers.push({input: await maskedLayer(overlayPath.halo(traits.halo), traits.base_template, layout), blend: "screen"});
  }

  for (let i = 0; i < microIconsDrawOrder.length; i++) {
    const slot = layout.slots.micro[microIconSlots[i]!];
    if (!slot) throw new Error(`unknown micro icon slot "${microIconSlots[i]}"`);
    layers.push(await slotLayer(overlayPath.micro(microIconsDrawOrder[i]!), slot, layout));
  }

  for (const group of ROLE_GROUPS) {
    layers.push(await slotLayer(overlayPath.role(group, traits[group]), layout.slots.role[group], layout));
  }

  if (drawsLayer("badge", traits.badge)) {
    layers.push(await slotLayer(overlayPath.badge(traits.badge), layout.slots.badge, layout));
  }

  if (drawsLayer("easter_egg", traits.easter_egg)) {
    layers.push(await slotLayer(overlayPath.easterEgg(traits.easter_egg), layout.slots.easter_egg, layout));
  }

  const base = sharp(basePath);
  const {width, height} = await base.metadata();
  if (width !== layout.outputSize || height !== layout.outputSize) {
    throw new Error(
      `${template.asset} is ${width}x${height}, expected ${layout.outputSize}. Run \`npm run prepare-assets\`.`
    );
  }
  // The card is fully opaque, so the alpha channel carries nothing. sharp applies
  // composite late in its pipeline, so drop the channel in a second pass.
  const composed = await base.composite(layers).png().toBuffer();
  return sharp(composed).removeAlpha().png(PNG_OPTIONS).toBuffer();
}
