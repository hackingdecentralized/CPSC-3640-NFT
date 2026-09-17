/**
 * ERC-721 metadata (spec section 18).
 *
 * Attributes come from the same Traits object the renderer draws, in a fixed order
 * with fixed trait_type names, so metadata can never disagree with the image.
 */
import type {Traits} from "./types";

/** Stands in for the image CID until `npm run set-image-cid` replaces it. */
export const PENDING_CID = "IMAGE_CID_PENDING";

export const EXTERNAL_URL = "https://cpsc3640.netlify.app/";

export const DESCRIPTION =
  "Course NFT for CPSC 3640 / CPSC 5400: Decentralized Payments, Contracts, and Finance, Fall 2026.";

/** trait key -> trait_type. Never rename these between tokens. */
export const ATTRIBUTES: ReadonlyArray<readonly [keyof Traits, string]> = [
  ["base_template", "Base Template"],
  ["background_style", "Background"],
  ["border_style", "Border"],
  ["halo", "Halo"],
  ["badge", "Badge"],
  ["human_icon", "Human Icon"],
  ["contract_icon", "Contract Icon"],
  ["ai_icon", "AI Icon"],
  ["micro_icons", "Micro Icons"],
  ["easter_egg", "Easter Egg"]
];

export interface Attribute {
  trait_type: string;
  value: string;
}

export interface NftMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Attribute[];
}

export const imageFileName = (tokenId: string): string => `${tokenId}.png`;
export const metadataFileName = (tokenId: string): string => `${tokenId}.json`;

export const imageUri = (cid: string, tokenId: string): string => `ipfs://${cid}/${imageFileName(tokenId)}`;

/** "book+node", or "none" when there are no micro icons. Always alphabetical. */
export const microIconsValue = (icons: readonly string[]): string =>
  icons.length === 0 ? "none" : [...icons].sort().join("+");

export function buildMetadata(tokenId: string, traits: Traits, cid: string = PENDING_CID): NftMetadata {
  return {
    name: `CPSC 3640 / CPSC 5400 Course NFT #${tokenId.padStart(4, "0")}`,
    description: DESCRIPTION,
    image: imageUri(cid, tokenId),
    external_url: EXTERNAL_URL,
    attributes: ATTRIBUTES.map(([key, trait_type]) => ({
      trait_type,
      value: key === "micro_icons" ? microIconsValue(traits.micro_icons) : (traits[key] as string)
    }))
  };
}

/** The inverse of buildMetadata's attributes, used to prove the two agree. */
export function traitsFromMetadata(metadata: NftMetadata): Traits {
  const byType = new Map(metadata.attributes.map((a) => [a.trait_type, a.value]));
  const read = (type: string): string => {
    const value = byType.get(type);
    if (value === undefined) throw new Error(`metadata has no "${type}" attribute`);
    return value;
  };
  const traits = {} as Record<keyof Traits, unknown>;
  for (const [key, type] of ATTRIBUTES) {
    const value = read(type);
    traits[key] = key === "micro_icons" ? (value === "none" ? [] : value.split("+")) : value;
  }
  return traits as unknown as Traits;
}
