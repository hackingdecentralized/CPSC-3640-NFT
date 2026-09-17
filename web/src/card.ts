/**
 * Each student's card, drawn in their own browser.
 *
 * The traits come from the generator's own code, given the same configuration and
 * the same public collection salt as the reveal, so the card shown here is the card
 * the token is generated with later. The pixels come from the layer rasters that
 * `npm run export-web` wrote with the generator's renderer. This module only stacks
 * them, in the order and at the positions generator/src/layers.ts gives.
 */
import type {Address} from "viem";

import baseTemplates from "../../generator/config/base-templates.json";
import collectionFile from "../../generator/config/collection.json";
import compatibility from "../../generator/config/compatibility.json";
import layout from "../../generator/config/layout.json";
import traits from "../../generator/config/traits.json";
import {collectionFingerprint, readCollection} from "../../generator/src/collection";
import {allowedDistribution} from "../../generator/src/compatibility";
import {buildConfig} from "../../generator/src/config";
import {layerStack} from "../../generator/src/layers";
import {ATTRIBUTES, buildMetadata} from "../../generator/src/metadata";
import {planToken} from "../../generator/src/token";
import {SINGLE_GROUPS, type SingleGroup, type Traits} from "../../generator/src/types";
import {WEB_INDEX, layerFile, type WebIndex} from "../../generator/src/webAssets";

const CONFIG = buildConfig({baseTemplates, traits, compatibility, layout});
const COLLECTION = readCollection(collectionFile);

/** Shown at the foot of the page. `npm run collection -- --expect` checks it. */
export const FINGERPRINT = collectionFingerprint(CONFIG, COLLECTION);

const ASSETS = `${import.meta.env.BASE_URL}nft/`;

export interface Design {
  label: string;
  /** Percent of all cards. */
  odds: number;
  sample: string;
}

export interface Trait {
  /** The metadata trait_type, so the page and marketplaces use the same names. */
  label: string;
  value: string;
  /** Percent chance of this value on this card's design, where one draw decides it. */
  odds?: number;
}

export interface Card {
  tokenId: bigint;
  claimer: Address;
  name: string;
  traits: Trait[];
  /** Object URL of the finished PNG. */
  image: string;
  fileName: string;
}

let assets: Promise<WebIndex> | undefined;

/** The exported artwork index, checked against the collection this page was built for. */
export function loadAssets(): Promise<WebIndex> {
  if (!assets) {
    assets = (async () => {
      const response = await fetch(`${ASSETS}${WEB_INDEX}`, {cache: "no-cache"});
      // A dev server answers a missing file with its HTML page, so check the type too.
      const isJson = response.headers.get("content-type")?.includes("json");
      if (!response.ok || !isJson) {
        throw new Error("the card artwork was not published with this page (run `npm run export-web` in generator/)");
      }
      const index = (await response.json()) as WebIndex;
      if (index.fingerprint !== FINGERPRINT) {
        throw new Error(`card artwork is for collection ${index.fingerprint}, this page is ${FINGERPRINT}. Re-export and rebuild.`);
      }
      return index;
    })();
    // Let a later call try again rather than caching the failure.
    assets.catch(() => (assets = undefined));
  }
  return assets;
}

const assetUrl = (index: WebIndex, file: string): string => `${ASSETS}${file}?v=${index.version}`;

/** The six designs, with an example card each and how often each comes up. */
export function designs(index: WebIndex): Design[] {
  return Object.entries(CONFIG.baseTemplates).map(([id, template]) => {
    const sample = index.samples[id];
    if (!sample) throw new Error(`no sample card for ${id}`);
    return {label: template.label, odds: template.weight, sample: assetUrl(index, sample)};
  });
}

const drawn = new Map<string, Promise<Card>>();

/** The card for a token, drawn once per page load. */
export function drawCard(tokenId: bigint, claimer: Address): Promise<Card> {
  const key = `${tokenId}:${claimer.toLowerCase()}`;
  let card = drawn.get(key);
  if (!card) {
    card = render(tokenId, claimer);
    drawn.set(key, card);
    card.catch(() => drawn.delete(key));
  }
  return card;
}

async function picture(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    throw new Error(`could not load ${src}`);
  }
  return image;
}

async function render(tokenId: bigint, claimer: Address): Promise<Card> {
  const index = await loadAssets();
  const plan = planToken(CONFIG, tokenId, claimer, COLLECTION.salt);
  const layers = layerStack(CONFIG, plan);
  const pictures = await Promise.all(layers.map((layer) => picture(assetUrl(index, layerFile(layer.key)))));

  const canvas = document.createElement("canvas");
  canvas.width = CONFIG.layout.outputSize;
  canvas.height = CONFIG.layout.outputSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser cannot draw on a canvas");
  // Every raster is already exactly its layer's size, so nothing should be resampled.
  context.imageSmoothingEnabled = false;
  layers.forEach((layer, i) => {
    context.globalCompositeOperation = layer.blend === "screen" ? "screen" : "source-over";
    context.drawImage(pictures[i]!, layer.left, layer.top, layer.width, layer.height);
  });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("could not encode the card"))), "image/png")
  );

  return {
    tokenId,
    claimer,
    name: buildMetadata(tokenId.toString(), plan.traits).name,
    traits: describe(plan.traits),
    image: URL.createObjectURL(blob),
    fileName: `cpsc3640-course-nft-${tokenId}.png`
  };
}

const ACRONYMS: Record<string, string> = {ai: "AI", eth: "ETH", ta: "TA", y: "Y"};

/** "tiny_eth_gem" -> "Tiny ETH gem" */
function words(value: string): string {
  return value
    .split("_")
    .map((word, i) => ACRONYMS[word] ?? (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

const percent = (fraction: number): number => Number((fraction * 100).toFixed(1));

/** The metadata attributes, in their order, with readable values and their odds. */
function describe(chosen: Traits): Trait[] {
  const template = chosen.base_template;
  return ATTRIBUTES.map(([key, label]) => {
    if (key === "base_template") {
      const design = CONFIG.baseTemplates[template]!;
      return {label, value: design.label, odds: design.weight};
    }
    if (key === "micro_icons") {
      return {label, value: chosen.micro_icons.length === 0 ? "None" : chosen.micro_icons.map(words).join(", ")};
    }
    const group = key as SingleGroup;
    const value = chosen[group];
    const odds = SINGLE_GROUPS.includes(group) ? allowedDistribution(CONFIG, group, template).get(value) : undefined;
    return {label, value: words(value), odds: odds === undefined ? undefined : percent(odds)};
  });
}
