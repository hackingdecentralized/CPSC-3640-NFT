/** What `npm run collection` records next to the cards it generates. */
import type {Address} from "viem";

export const COLLECTION_MANIFEST = "collection.json";

export interface CollectionManifest {
  network: string;
  chainId: number;
  contract: Address;
  /** Chain state was read at this block. */
  blockNumber: number;
  /** How that block was chosen: finalized, safe, latest, or a number given by hand. */
  blockTag: string;
  /** Tokens 1..count are in this collection. What `setBaseURI` must be given. */
  count: number;
  fingerprint: string;
  salt: string;
  /** Set by `npm run set-image-cid` once the images are uploaded. */
  imageCid: string | null;
  generatedAt: string;
  tokens: Array<{tokenId: string; claimer: Address; seed: string; imageSha256: string}>;
}
