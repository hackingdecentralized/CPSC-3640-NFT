/**
 * Generate the collection: one card for every token claimed so far.
 *
 *   npm run collection -- --network sepolia
 *   npm run collection -- --network anvil
 *   npm run collection -- --network sepolia --expect <fingerprint>
 *
 * Reads the contract recorded in ../deployments/<network>.json at one block: how many
 * tokens exist and who claimed each. Each card is then generated from its token id,
 * its claimer and the collection salt, which is exactly how the claim page drew it.
 *
 * Writes output/collection/<network>/:
 *   images/<id>.png      upload this directory to IPFS first
 *   metadata/<id>.json   then `npm run set-image-cid`, then upload this directory
 *   collection.json      what was generated, and from which chain state
 *
 * Then, from the repository root: scripts/reveal.sh <network> publish <METADATA_CID>
 *
 * --expect takes the fingerprint shown at the foot of the claim page. If it differs,
 * the page and this checkout disagree about the collection, and nothing is written.
 *
 * On Sepolia the chain is read at the latest finalized block, about 15 minutes back,
 * so a reorganisation cannot reorder the claims a collection was drawn from. Claims
 * newer than that wait for the next run. --block latest|safe|finalized|<number>
 * overrides it; a local chain is read at latest, since it never finalizes.
 *
 * RPC: SEPOLIA_RPC_URL from the environment, generator/.env or the repository's .env.
 * Anvil uses http://127.0.0.1:8545 unless ANVIL_RPC_URL is set.
 */
import {createHash} from "node:crypto";
import {existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, relative, resolve} from "node:path";
import {zeroAddress, type BlockTag} from "viem";
import {collectionFingerprint} from "../src/fingerprint";
import {generateNFT} from "../src/generator";
import {loadCollection, loadConfig} from "../src/loadConfig";
import {fromRoot} from "../src/paths";
import {NFT_ABI, connect} from "./chain";
import {COLLECTION_MANIFEST, type CollectionManifest} from "./manifest";
import {mapLimit} from "./html";
import {parseArgs, run, stringArg} from "./cli";

function parseBlockTag(value: string): BlockTag {
  if (value === "latest" || value === "safe" || value === "finalized") return value;
  throw new Error(`--block must be latest, safe, finalized or a block number, not "${value}"`);
}

run(async () => {
  const args = parseArgs();
  const network = stringArg(args, "network");
  if (!network) throw new Error("usage: npm run collection -- --network <sepolia|anvil> [--expect <fingerprint>]");

  const config = loadConfig();
  const collection = loadCollection();
  const {fingerprint} = await collectionFingerprint(config, collection);
  const expected = stringArg(args, "expect");
  if (expected && expected !== fingerprint) {
    throw new Error(
      `This checkout's collection fingerprint is ${fingerprint}, but ${expected} was expected.\n` +
        "The claim page was built from a different configuration, salt, code or artwork, so these cards would not\n" +
        "match what students were shown. Check out the commit the page was published from."
    );
  }

  const {client, deployment} = await connect(network);
  const address = deployment.contractAddress;
  const blockArg = stringArg(args, "block") ?? (network === "sepolia" ? "finalized" : "latest");
  const block = /^\d+$/.test(blockArg)
    ? await client.getBlock({blockNumber: BigInt(blockArg)})
    : await client.getBlock({blockTag: parseBlockTag(blockArg)});
  const blockNumber = block.number;
  if (blockNumber === null) throw new Error(`block "${blockArg}" is still pending; pick a mined block`);
  const read = {address, abi: NFT_ABI, blockNumber} as const;

  const revealedCount = await client.readContract({...read, functionName: "revealedCount"}).catch(() => {
    throw new Error(
      `${address} has no revealedCount(): it was deployed before reveal support existed, so it can never\n` +
        `show generated cards. Deploy the current contract with scripts/deploy.sh ${network}.`
    );
  });
  const [totalMinted, claimOpen, frozen] = await Promise.all([
    client.readContract({...read, functionName: "totalMinted"}),
    client.readContract({...read, functionName: "claimOpen"}),
    client.readContract({...read, functionName: "metadataFrozen"})
  ]);
  if (frozen) throw new Error("The collection is frozen. Its metadata can never change, so there is nothing to generate.");
  const count = Number(totalMinted);
  const newest = Number(await client.readContract({address, abi: NFT_ABI, functionName: "totalMinted"}));
  if (count === 0) {
    throw new Error(
      newest > 0
        ? `No claim is ${blockArg} yet at block ${blockNumber}; the ${newest} claim(s) so far are too recent. Try again shortly.`
        : "Nobody has claimed a token yet."
    );
  }

  console.log(`${network} ${address} at ${blockArg} block ${blockNumber}: ${count} claimed, ${revealedCount} revealed`);
  console.log(`Collection fingerprint ${fingerprint}\n`);

  const ids = Array.from({length: count}, (_, i) => i + 1);
  const claimers = await mapLimit(ids, 8, (id) =>
    client.readContract({...read, functionName: "claimerOf", args: [BigInt(id)]})
  );
  claimers.forEach((claimer, i) => {
    if (claimer === zeroAddress) throw new Error(`token ${i + 1} has no recorded claimer`);
  });

  // Replace the previous run wholesale, but never a directory this script did not write.
  const dir = resolve(fromRoot(), stringArg(args, "out") ?? join("output", "collection", network));
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    if (!existsSync(join(dir, COLLECTION_MANIFEST))) throw new Error(`${dir} is not empty and is not a previous collection; refusing to replace it`);
    rmSync(dir, {recursive: true});
  }

  const started = Date.now();
  const tokens = await mapLimit(ids, 3, async (id, i) => {
    const claimer = claimers[i]!;
    const result = await generateNFT({tokenId: id, walletAddress: claimer, salt: collection.salt, outputDir: dir}, config);
    process.stdout.write(`  #${result.tokenId.padEnd(5)} ${claimer}  ${result.traits.base_template}\n`);
    const imageSha256 = createHash("sha256").update(readFileSync(result.imagePath)).digest("hex");
    return {tokenId: result.tokenId, claimer, seed: result.seed, imageSha256};
  });

  const manifest: CollectionManifest = {
    network,
    chainId: deployment.chainId,
    contract: address,
    blockNumber: Number(blockNumber),
    blockTag: blockArg,
    count,
    fingerprint,
    salt: collection.salt,
    imageCid: null,
    generatedAt: new Date().toISOString(),
    tokens
  };
  writeFileSync(join(dir, COLLECTION_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");

  const shown = relative(fromRoot(), dir);
  console.log(`\nGenerated ${count} card(s) in ${((Date.now() - started) / 1000).toFixed(1)} s into generator/${shown}/`);
  if (newest > count) {
    console.log(
      `\n${newest - count} newer claim(s) are not ${blockArg} yet, so they are not included. They keep the\n` +
        "placeholder until the next run."
    );
  }
  if (claimOpen) {
    console.log(
      "\nClaiming is still open. Tokens claimed after this block keep the placeholder until you run this again.\n" +
        `For the final reveal, close claiming first: scripts/reveal.sh ${network} close`
    );
  }
  console.log(`
Next:
  1. Upload generator/${shown}/images as one directory to IPFS. Note its CID.
  2. npm run set-image-cid -- --dir ${shown} --cid <IMAGE_CID>
  3. Upload generator/${shown}/metadata as one directory. Note its CID.
  4. From the repository root: scripts/reveal.sh ${network} publish <METADATA_CID>`);
});
