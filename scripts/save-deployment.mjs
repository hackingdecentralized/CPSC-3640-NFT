#!/usr/bin/env node
/**
 * Record a deployment in `deployments/<network>.json`.
 *
 * Reads Foundry's broadcast artifact, which is the only place that knows the real
 * transaction hash and the block the contract actually landed in. Everything written
 * here is public information: no keys, no RPC URLs.
 *
 * Usage: node scripts/save-deployment.mjs <network> [chainId]
 *        node scripts/save-deployment.mjs sepolia 11155111
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const KNOWN_CHAINS = {sepolia: 11155111, anvil: 31337, localhost: 31337};

const network = process.argv[2];
if (!network) {
  console.error("usage: node scripts/save-deployment.mjs <network> [chainId]");
  process.exit(1);
}
const chainId = Number(process.argv[3] ?? KNOWN_CHAINS[network]);
if (!Number.isInteger(chainId)) {
  console.error(`Unknown network "${network}". Pass the chain id explicitly.`);
  process.exit(1);
}

const broadcastPath = join(ROOT, "broadcast", "Deploy.s.sol", String(chainId), "run-latest.json");
if (!existsSync(broadcastPath)) {
  console.error(`No broadcast artifact at ${broadcastPath.slice(ROOT.length + 1)}`);
  console.error("Run the deploy script with --broadcast first.");
  process.exit(1);
}

const run = JSON.parse(readFileSync(broadcastPath, "utf8"));
const tx = run.transactions.find(
  (t) => t.transactionType === "CREATE" && t.contractName === "CPSC3640NFT"
);
if (!tx) {
  console.error("The broadcast artifact contains no CPSC3640NFT creation transaction.");
  process.exit(1);
}

const receipt = (run.receipts ?? []).find((r) => r.transactionHash === tx.hash);
if (!receipt) {
  console.error(`No receipt for ${tx.hash} in the broadcast artifact.`);
  process.exit(1);
}

// Everything below is read back out of the creation transaction, never out of local
// build artifacts. allowlist/generated/root.json is whatever the generator last
// wrote, which is not necessarily what was deployed: deploying with the allowlist
// off passes a zero root while that file still holds a real one.
const [owner, merkleRoot, claimOpen, allowlistEnabled] = tx.arguments ?? [];

// Whether this contract gives tokens generated cards, so the claim page knows before a
// wallet connects. Read from the compiled contract, but only once the deployed
// creation code has been matched to it: a stale out/ must not decide this.
function revealSupport() {
  const artifactPath = join(ROOT, "out", "CPSC3640NFT.sol", "CPSC3640NFT.json");
  if (!existsSync(artifactPath)) return null;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const code = String(artifact.bytecode?.object ?? "").replace(/^0x/, "").toLowerCase();
  const sent = String(tx.transaction.input ?? tx.transaction.data ?? "").replace(/^0x/, "").toLowerCase();
  if (!code || !sent.startsWith(code)) return null;
  return artifact.abi.some((item) => item.type === "function" && item.name === "revealedCount");
}
const revealable = revealSupport();
if (revealable === null) {
  console.warn("warning: the deployed code does not match out/, so whether it supports cards is not recorded");
}

const record = {
  network,
  chainId,
  contractAddress: tx.contractAddress,
  deploymentBlock: Number(receipt.blockNumber),
  transactionHash: tx.hash,
  deployer: tx.transaction.from,
  owner: owner ?? null,
  merkleRoot: merkleRoot ?? null,
  claimOpen: claimOpen === undefined ? null : claimOpen === "true",
  allowlistEnabled: allowlistEnabled === undefined ? null : allowlistEnabled === "true",
  revealable,
  // Exactly what was passed to the constructor. Explorer verification needs these
  // to match byte for byte, so they are recorded rather than reconstructed later.
  constructorArgs: tx.arguments ?? null,
  deployedAt: new Date().toISOString()
};

mkdirSync(join(ROOT, "deployments"), {recursive: true});
const out = join(ROOT, "deployments", `${network}.json`);
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");

console.log(`Wrote deployments/${network}.json`);
console.log(JSON.stringify(record, null, 2));
