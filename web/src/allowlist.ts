/**
 * Loading Merkle proofs for the connected wallet.
 *
 * proofs.json is a convenience, not an authority. It lets the browser build the
 * `proof` argument without rebuilding the tree client-side. Being listed here grants
 * nothing: `CPSC3640NFT.claim` verifies the proof against the on-chain root, and the
 * page separately asks the contract `isEligible` before offering a claim button.
 */
import {PROOFS_URL} from "./config";
import type {Hex} from "viem";

interface ProofsDocument {
  merkleRoot: string;
  leafEncoding: string[];
  generatedAt: string;
  proofs: Record<string, string[]>;
}

let cached: ProofsDocument | null = null;

export async function loadProofs(): Promise<ProofsDocument> {
  if (cached) return cached;

  const response = await fetch(PROOFS_URL, {cache: "no-cache"});
  if (!response.ok) {
    throw new Error(`Could not load the allowlist (HTTP ${response.status})`);
  }

  const document = (await response.json()) as ProofsDocument;
  if (!document || typeof document.proofs !== "object") {
    throw new Error("The allowlist file is malformed");
  }

  cached = document;
  return document;
}

/** The proof for `address`, or `null` if the address is not in the published allowlist. */
export async function proofFor(address: string): Promise<Hex[] | null> {
  const {proofs} = await loadProofs();
  const entry = proofs[address.toLowerCase()];
  return entry ? (entry as Hex[]) : null;
}

/** The root the published proofs were generated against, for comparing with the contract. */
export async function publishedRoot(): Promise<string> {
  return (await loadProofs()).merkleRoot;
}
