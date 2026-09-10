#!/usr/bin/env tsx
/**
 * Build the Merkle allowlist for CPSC3640NFT.
 *
 * The tree is built with OpenZeppelin's StandardMerkleTree over a single `address`
 * field. That fixes two things the contract must agree on exactly:
 *
 *   leaf   = keccak256(bytes.concat(keccak256(abi.encode(address))))
 *   parent = keccak256(sorted(left, right))
 *
 * `CPSC3640NFT._leaf` computes the first line, and OpenZeppelin's `MerkleProof`
 * computes the second. Change the encoding on either side and every proof breaks,
 * which is why the Foundry tests verify proofs produced by THIS script rather than
 * rebuilding the tree in Solidity.
 *
 * Usage:
 *   npm run merkle              # reads allowlist/addresses.json, falls back to the example
 *   npm run merkle -- --example # force the example roster (used for the test fixture)
 */
import {StandardMerkleTree} from "@openzeppelin/merkle-tree";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL = join(ROOT, "allowlist", "addresses.json");
const EXAMPLE = join(ROOT, "allowlist", "addresses.example.json");
const OUT_DIR = join(ROOT, "allowlist", "generated");
const WEB_PROOFS = join(ROOT, "web", "public", "proofs.json");

const forceExample = process.argv.includes("--example");

function loadAddresses(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as {addresses?: unknown}).addresses;

  if (!Array.isArray(list)) {
    throw new Error(`${path} must be a JSON array of addresses, or {"addresses": [...]}`);
  }

  const seen = new Map<string, string>();
  for (const entry of list) {
    if (typeof entry !== "string") {
      throw new Error(`${path}: every entry must be a string, got ${typeof entry}`);
    }
    const address = entry.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`${path}: "${address}" is not a 20-byte hex Ethereum address`);
    }
    const key = address.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${path}: "${address}" appears more than once`);
    }
    seen.set(key, address);
  }

  if (seen.size === 0) throw new Error(`${path} contains no addresses`);
  // Sort for determinism: the same roster always yields the same root, whatever
  // order it was typed in.
  return [...seen.keys()].sort();
}

const source = !forceExample && existsSync(REAL) ? REAL : EXAMPLE;
if (source === EXAMPLE && !forceExample) {
  console.warn("! allowlist/addresses.json not found - using addresses.example.json");
  console.warn("! Anvil test accounts only. Do not deploy this root to a public network.\n");
}

const addresses = loadAddresses(source);
const tree = StandardMerkleTree.of(
  addresses.map((a) => [a]),
  ["address"]
);

const proofs: Record<string, string[]> = {};
for (const [index, value] of tree.entries()) {
  proofs[(value[0] as string).toLowerCase()] = tree.getProof(index);
}

const generatedAt = new Date().toISOString();

mkdirSync(OUT_DIR, {recursive: true});
mkdirSync(dirname(WEB_PROOFS), {recursive: true});

// root.json: what you pass to the deploy script or to setMerkleRoot().
writeFileSync(
  join(OUT_DIR, "root.json"),
  JSON.stringify(
    {
      merkleRoot: tree.root,
      leafEncoding: ["address"],
      addressCount: addresses.length,
      source: source.slice(ROOT.length + 1),
      generatedAt
    },
    null,
    2
  ) + "\n"
);

// proofs.json: what the claim page loads to build a proof for the connected wallet.
// Keys are lowercased so the page can look up without checksum handling.
const proofsDoc =
  JSON.stringify({merkleRoot: tree.root, leafEncoding: ["address"], generatedAt, proofs}, null, 2) +
  "\n";
writeFileSync(join(OUT_DIR, "proofs.json"), proofsDoc);
writeFileSync(WEB_PROOFS, proofsDoc);

// A committed fixture built from the example roster, so `forge test` can verify
// against proofs from this generator on a fresh clone.
if (forceExample) {
  writeFileSync(
    join(OUT_DIR, "example-tree.json"),
    JSON.stringify(
      {
        merkleRoot: tree.root,
        entries: addresses.map((address) => ({address, proof: proofs[address]}))
      },
      null,
      2
    ) + "\n"
  );
}

console.log(`Roster:      ${source.slice(ROOT.length + 1)} (${addresses.length} addresses)`);
console.log(`Merkle root: ${tree.root}`);
console.log(`Wrote:       allowlist/generated/root.json`);
console.log(`             allowlist/generated/proofs.json`);
console.log(`             web/public/proofs.json`);
if (forceExample) console.log(`             allowlist/generated/example-tree.json`);
