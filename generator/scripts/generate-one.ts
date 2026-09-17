/**
 * Generate one NFT (spec section 24).
 *
 *   npm run generate -- --token-id 123 --wallet 0xabc... --salt "fall-2026-secret"
 *   npm run generate -- --token-id 123 --wallet 0xabc... --badge staff
 *
 * Prefer NFT_SALT in generator/.env over --salt: a salt typed on the command line
 * ends up in shell history.
 *
 * Options:
 *   --badge <value>    force a badge, e.g. staff or ta_edition
 *   --base <template>  force a base template
 *   --out <dir>        output directory (default: output/)
 *   --cid <cid>        image CID, if already uploaded
 */
import {relative} from "node:path";
import {generateNFT} from "../src/generator";
import {fromRoot} from "../src/paths";
import type {ForcedTraits} from "../src/traits";
import {PUBLIC_PREVIEW_SALT, loadDotEnv, parseArgs, run, stringArg} from "./cli";

run(async () => {
  loadDotEnv();
  const args = parseArgs();
  const tokenId = stringArg(args, "token-id");
  const wallet = stringArg(args, "wallet");
  const salt = stringArg(args, "salt") ?? process.env.NFT_SALT;

  if (!tokenId || !wallet) {
    throw new Error("usage: npm run generate -- --token-id <id> --wallet <0x...> [--salt <salt>] [--badge <badge>]");
  }
  if (!salt) throw new Error("No salt. Pass --salt, or set NFT_SALT in generator/.env.");
  if (salt === PUBLIC_PREVIEW_SALT) {
    console.warn("warning: this is the public preview salt. Anyone can predict these traits.\n");
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
