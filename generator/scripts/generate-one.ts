/**
 * Generate one NFT (spec section 24).
 *
 *   npm run generate -- --token-id 123 --wallet 0xabc...
 *   npm run generate -- --token-id 123 --wallet 0xabc... --badge staff
 *
 * Uses the collection salt from config/collection.json, the same one the claim page
 * uses, so the card matches what that student was shown. --salt overrides it for
 * experiments; the result will then not match the page.
 *
 * Options:
 *   --badge <value>    force a badge, e.g. staff or ta_edition
 *   --base <template>  force a base template
 *   --out <dir>        output directory (default: output/)
 *   --cid <cid>        image CID, if already uploaded
 *   --salt <salt>      experiment with a different salt
 */
import {relative} from "node:path";
import {generateNFT} from "../src/generator";
import {fromRoot} from "../src/paths";
import type {ForcedTraits} from "../src/traits";
import {loadCollection} from "../src/loadConfig";
import {parseArgs, run, stringArg} from "./cli";

run(async () => {
  const args = parseArgs();
  const tokenId = stringArg(args, "token-id");
  const wallet = stringArg(args, "wallet");
  const collectionSalt = loadCollection().salt;
  const salt = stringArg(args, "salt") ?? collectionSalt;

  if (!tokenId || !wallet) {
    throw new Error("usage: npm run generate -- --token-id <id> --wallet <0x...> [--badge <badge>] [--salt <salt>]");
  }
  if (salt !== collectionSalt) {
    console.warn("note: not the collection salt, so this card will not match the claim page.\n");
  }

  const forced: ForcedTraits = {};
  const badge = stringArg(args, "badge");
  const base = stringArg(args, "base");
  if (badge) forced.badge = badge;
  if (base) forced.base_template = base;

  const result = await generateNFT({
    tokenId,
    walletAddress: wallet,
    salt,
    forcedTraits: forced,
    outputDir: stringArg(args, "out"),
    imageCid: stringArg(args, "cid")
  });

  const show = (path: string) => relative(fromRoot(), path) || path;
  console.log(`Generated NFT #${result.tokenId}`);
  console.log(`Base: ${result.traits.base_template}`);
  console.log(`Seed: ${result.seed.slice(0, 16)}...`);
  console.log(`Image: ${show(result.imagePath)}`);
  console.log(`Metadata: ${show(result.metadataPath)}`);
  console.log("\nTraits:");
  for (const attribute of result.metadata.attributes) {
    console.log(`  ${attribute.trait_type.padEnd(14)} ${attribute.value}`);
  }
  if (Object.keys(forced).length > 0) console.log(`\nForced: ${JSON.stringify(forced)}`);
});
