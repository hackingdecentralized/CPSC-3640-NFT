/**
 * Point every metadata file at an uploaded image directory (spec section 25).
 *
 *   generate locally -> upload output/images -> receive CID
 *   -> npm run set-image-cid -- --cid <CID> -> upload output/metadata
 *
 * Re-runnable: it rewrites whatever CID is currently there. It never assumes a
 * particular IPFS provider.
 *
 *   npm run set-image-cid -- --cid bafy...
 *   npm run set-image-cid -- --cid bafy... --dir output/collection/sepolia
 *
 * In a directory from `npm run collection`, the CID is also recorded in its
 * collection.json, where `scripts/reveal.sh` checks for it.
 */
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {imageFileName, imageUri, type NftMetadata} from "../src/metadata";
import {fromRoot} from "../src/paths";
import {parseArgs, run, stringArg} from "./cli";
import {COLLECTION_MANIFEST, type CollectionManifest} from "./manifest";

/** CIDv0 (Qm..., base58btc) or CIDv1 in base32 (b...) or base58btc (z...). */
export function isPlausibleCid(cid: string): boolean {
  return (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) ||
    /^b[a-z2-7]{50,}$/.test(cid) ||
    /^z[1-9A-HJ-NP-Za-km-z]{40,}$/.test(cid)
  );
}

run(() => {
  const args = parseArgs();
  const cid = stringArg(args, "cid");
  if (!cid) throw new Error("usage: npm run set-image-cid -- --cid <IMAGE_CID> [--dir output]");
  if (!isPlausibleCid(cid)) throw new Error(`"${cid}" does not look like an IPFS CID`);

  const dir = resolve(fromRoot(), stringArg(args, "dir") ?? "output");
  const metadataDir = join(dir, "metadata");
  if (!existsSync(metadataDir)) throw new Error(`No metadata directory at ${metadataDir}`);

  let updated = 0;
  const missingImages: string[] = [];
  for (const file of readdirSync(metadataDir).filter((f) => /^\d+\.json$/.test(f)).sort()) {
    const tokenId = file.replace(/\.json$/, "");
    const path = join(metadataDir, file);
    const metadata = JSON.parse(readFileSync(path, "utf8")) as NftMetadata;

    const match = /^ipfs:\/\/[^/]+\/(\d+)\.png$/.exec(metadata.image);
    if (!match || match[1] !== tokenId) {
      throw new Error(`${file}: image "${metadata.image}" does not refer to ${imageFileName(tokenId)}`);
    }
    metadata.image = imageUri(cid, tokenId);
    writeFileSync(path, JSON.stringify(metadata, null, 2) + "\n");
    updated++;
    if (!existsSync(join(dir, "images", imageFileName(tokenId)))) missingImages.push(tokenId);
  }

  const manifestPath = join(dir, COLLECTION_MANIFEST);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CollectionManifest;
    if (updated !== manifest.count) throw new Error(`${metadataDir} holds ${updated} metadata files, but the collection has ${manifest.count}`);
    manifest.imageCid = cid;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  console.log(`Set image CID ${cid} on ${updated} metadata file(s) in ${metadataDir}`);
  if (missingImages.length > 0) {
    console.warn(`warning: no local image for token(s) ${missingImages.join(", ")}`);
  }
  console.log("Next: upload the metadata directory, then point the contract's base URI at it.");
});
