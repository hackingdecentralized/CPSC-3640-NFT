/**
 * The generation API (spec section 16).
 */
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {loadConfig} from "./config";
import {buildMetadata, imageFileName, metadataFileName, PENDING_CID, type NftMetadata} from "./metadata";
import {fromRoot} from "./paths";
import {renderImage} from "./renderer";
import {deriveSeed, normalizeTokenId, type TokenIdInput} from "./seed";
import {planTraits, type ForcedTraits, type Plan} from "./traits";
import type {GeneratorConfig, Traits} from "./types";

export interface GenerateInput {
  tokenId: TokenIdInput;
  walletAddress: string;
  salt: string;
  forcedTraits?: ForcedTraits;
  /** Directory holding images/ and metadata/. Defaults to output/. */
  outputDir?: string;
  /** Image CID, if already known. Otherwise a placeholder that set-image-cid replaces. */
  imageCid?: string;
}

export interface GenerateOutput {
  tokenId: string;
  seed: string;
  traits: Traits;
  plan: Plan;
  metadata: NftMetadata;
  imagePath: string;
  metadataPath: string;
}

let defaultConfig: GeneratorConfig | undefined;
const configOrDefault = (config?: GeneratorConfig) => config ?? (defaultConfig ??= loadConfig());

/** Choose traits only. No image work, so it is cheap enough for 10,000-token simulations. */
export function planNFT(input: Omit<GenerateInput, "outputDir" | "imageCid">, config?: GeneratorConfig): Plan {
  const seed = deriveSeed(input.tokenId, input.walletAddress, input.salt);
  return planTraits(configOrDefault(config), seed, input.forcedTraits);
}

export async function generateNFT(input: GenerateInput, config?: GeneratorConfig): Promise<GenerateOutput> {
  const cfg = configOrDefault(config);
  const tokenId = normalizeTokenId(input.tokenId);
  const plan = planNFT(input, cfg);
  const metadata = buildMetadata(tokenId, plan.traits, input.imageCid ?? PENDING_CID);
  const image = await renderImage(cfg, plan);

  const outputDir = input.outputDir ?? fromRoot("output");
  const imagePath = join(outputDir, "images", imageFileName(tokenId));
  const metadataPath = join(outputDir, "metadata", metadataFileName(tokenId));
  mkdirSync(join(outputDir, "images"), {recursive: true});
  mkdirSync(join(outputDir, "metadata"), {recursive: true});
  writeFileSync(imagePath, image);
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");

  return {tokenId, seed: plan.seed, traits: plan.traits, plan, metadata, imagePath, metadataPath};
}
