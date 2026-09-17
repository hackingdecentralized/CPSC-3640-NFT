/**
 * The layer stack (spec section 4): what a card is drawn from, in what order, where,
 * and with which blend.
 *
 * Both renderers read this. The Node renderer rasterises each layer with sharp and
 * composites the stack into the token image (src/composite.ts). The claim page loads
 * the same rasters, exported by `npm run export-web`, and composites the same stack
 * on a canvas with the same formulas. Neither decides placement or order for itself,
 * so the two cannot drift apart.
 *
 * Positions and sizes are in output pixels, already scaled from the design space.
 */
import {overlayPath} from "./assets";
import {drawsLayer} from "./compatibility";
import {outputScale, scaleSlot} from "./config";
import type {Plan} from "./traits";
import {NO_LAYER, ROLE_GROUPS, type GeneratorConfig, type RoleGroup, type Slot, type Traits} from "./types";

export type Blend = "over" | "screen";

export type LayerSource =
  /** The prepared template artwork. */
  | {kind: "base"; template: string}
  /** A full-card SVG. */
  | {kind: "canvas"; svg: string}
  /** A full-card SVG, clipped to where the template allows decoration, alpha squared. */
  | {kind: "masked"; svg: string; template: string}
  /** An SVG rasterised at exactly its slot's size. */
  | {kind: "slot"; svg: string};

export interface Layer {
  /** Names the raster. Two layers with the same key are pixel-identical. */
  key: string;
  source: LayerSource;
  blend: Blend;
  left: number;
  top: number;
  width: number;
  height: number;
}

const svgKey = (svg: string): string => svg.replace(/^assets\/overlays\//, "").replace(/\.svg$/, "");

function fullCard(config: GeneratorConfig, key: string, source: LayerSource, blend: Blend): Layer {
  const size = config.layout.outputSize;
  return {key, source, blend, left: 0, top: 0, width: size, height: size};
}

function inSlot(config: GeneratorConfig, svg: string, slot: Slot): Layer {
  const rect = scaleSlot(slot, outputScale(config.layout));
  return {
    key: `${svgKey(svg)}-${rect.w}x${rect.h}`,
    source: {kind: "slot", svg},
    blend: "over",
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h
  };
}

function masked(config: GeneratorConfig, svg: string, template: string): Layer {
  return fullCard(config, `masked/${template}/${svgKey(svg)}`, {kind: "masked", svg, template}, "screen");
}

export const baseLayer = (config: GeneratorConfig, template: string): Layer =>
  fullCard(config, `base/${template}`, {kind: "base", template}, "over");

export const backgroundLayer = (config: GeneratorConfig, template: string, value: string): Layer =>
  masked(config, overlayPath.background(value), template);

export const haloLayer = (config: GeneratorConfig, template: string, value: string): Layer =>
  masked(config, overlayPath.halo(value), template);

export function borderLayer(config: GeneratorConfig, value: string): Layer {
  const svg = overlayPath.border(value);
  return fullCard(config, svgKey(svg), {kind: "canvas", svg}, "over");
}

export function microIconLayer(config: GeneratorConfig, value: string, slotName: string): Layer {
  const slot = config.layout.slots.micro[slotName];
  if (!slot) throw new Error(`unknown micro icon slot "${slotName}"`);
  return inSlot(config, overlayPath.micro(value), slot);
}

export const roleIconLayer = (config: GeneratorConfig, group: RoleGroup, value: string): Layer =>
  inSlot(config, overlayPath.role(group, value), config.layout.slots.role[group]);

export const badgeLayer = (config: GeneratorConfig, value: string): Layer =>
  inSlot(config, overlayPath.badge(value), config.layout.slots.badge);

export const easterEggLayer = (config: GeneratorConfig, value: string): Layer =>
  inSlot(config, overlayPath.easterEgg(value), config.layout.slots.easter_egg);

/** Bottom to top. The first layer is always the opaque base. */
export function layerStack(config: GeneratorConfig, plan: Plan): Layer[] {
  const {traits, microIconsDrawOrder, microIconSlots} = plan;
  const template = traits.base_template;
  if (!config.baseTemplates[template]) throw new Error(`unknown base_template "${template}"`);

  const layers = [baseLayer(config, template), backgroundLayer(config, template, traits.background_style)];
  if (drawsLayer("border_style", traits.border_style)) layers.push(borderLayer(config, traits.border_style));
  if (drawsLayer("halo", traits.halo)) layers.push(haloLayer(config, template, traits.halo));
  microIconsDrawOrder.forEach((icon, i) => layers.push(microIconLayer(config, icon, microIconSlots[i]!)));
  for (const group of ROLE_GROUPS) layers.push(roleIconLayer(config, group, traits[group]));
  if (drawsLayer("badge", traits.badge)) layers.push(badgeLayer(config, traits.badge));
  if (drawsLayer("easter_egg", traits.easter_egg)) layers.push(easterEggLayer(config, traits.easter_egg));
  return layers;
}

/** Every value of a group that produces a layer. */
const drawn = (config: GeneratorConfig, group: keyof Traits & keyof GeneratorConfig["traits"]): string[] =>
  Object.keys(config.traits[group]).filter((value) => NO_LAYER[group] !== value);

/**
 * Every distinct raster any card can use, once each. What `npm run export-web` writes
 * for the claim page.
 */
export function everyLayer(config: GeneratorConfig): Layer[] {
  const layers: Layer[] = [];
  for (const template of Object.keys(config.baseTemplates)) {
    layers.push(baseLayer(config, template));
    for (const value of drawn(config, "background_style")) layers.push(backgroundLayer(config, template, value));
    for (const value of drawn(config, "halo")) layers.push(haloLayer(config, template, value));
  }
  for (const value of drawn(config, "border_style")) layers.push(borderLayer(config, value));
  for (const slotName of Object.keys(config.layout.slots.micro)) {
    for (const value of drawn(config, "micro_icons")) layers.push(microIconLayer(config, value, slotName));
  }
  for (const group of ROLE_GROUPS) {
    for (const value of drawn(config, group)) layers.push(roleIconLayer(config, group, value));
  }
  for (const value of drawn(config, "badge")) layers.push(badgeLayer(config, value));
  for (const value of drawn(config, "easter_egg")) layers.push(easterEggLayer(config, value));

  const unique = new Map<string, Layer>();
  for (const layer of layers) if (!unique.has(layer.key)) unique.set(layer.key, layer);
  return [...unique.values()];
}
