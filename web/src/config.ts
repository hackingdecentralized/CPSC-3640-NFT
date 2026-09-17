/**
 * The one place the chain, the contract and the explorer are configured.
 *
 * Nothing else in the frontend hard-codes a chain id or an address. To point the
 * page at a new deployment you update deployments/<network>.json (written by
 * `node scripts/save-deployment.mjs`) and rebuild - you do not edit the UI code.
 *
 * Build for a different network with:
 *   VITE_NETWORK=anvil npm run dev
 */
import {foundry, sepolia} from "viem/chains";
import type {Chain} from "viem";

import anvilDeployment from "../../deployments/anvil.json";
import sepoliaDeployment from "../../deployments/sepolia.json";

export interface Deployment {
  network: string;
  chainId: number;
  /** `null` until the contract has actually been deployed to this network. */
  contractAddress: string | null;
  /** Block the contract was created in. Bounds the `Claimed` log query. */
  deploymentBlock: number;
  transactionHash: string | null;
  merkleRoot: string | null;
  deployer: string | null;
  /**
   * Whether this contract gives each token a generated card, recorded at deploy time.
   * The page trusts the contract once a wallet is connected; this covers the moment
   * before. Records from before cards existed do not have it, which means no.
   */
  revealable?: boolean | null;
}

export interface NetworkConfig {
  chain: Chain;
  label: string;
  /** Explorer origin, or `null` for local chains that have none. */
  explorer: string | null;
  deployment: Deployment;
  /**
   * How often the page re-reads the claim count.
   *
   * Matched to how fast the chain can actually change. Sepolia produces a block
   * roughly every 12 seconds, so polling faster than that spends the student's RPC
   * quota to learn nothing. Anvil mines on demand, so it can be checked often.
   */
  pollIntervalMs: number;
  /** Where a student gets free test ETH for gas. `null` on chains that need none. */
  faucet: string | null;
}

/** Where a student without a wallet goes first. */
export const WALLET_DOWNLOAD = "https://metamask.io/download/";

const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: {
    chain: sepolia,
    label: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    deployment: sepoliaDeployment as Deployment,
    pollIntervalMs: 12_000,
    faucet: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
  },
  anvil: {
    chain: foundry,
    label: "Local Anvil",
    explorer: null,
    deployment: anvilDeployment as Deployment,
    pollIntervalMs: 2_000,
    // Anvil pre-funds every account, so there is nothing to top up.
    faucet: null
  }
};

const requested = (import.meta.env.VITE_NETWORK as string | undefined) ?? "sepolia";
const selected = NETWORKS[requested];

if (!selected) {
  throw new Error(
    `Unknown VITE_NETWORK "${requested}". Expected one of: ${Object.keys(NETWORKS).join(", ")}`
  );
}

export const NETWORK = selected;
export const CHAIN = selected.chain;
export const CHAIN_ID = selected.chain.id;
export const DEPLOYMENT = selected.deployment;

/** Address of the deployed course NFT, or `null` if this network has no deployment yet. */
export const CONTRACT_ADDRESS = DEPLOYMENT.contractAddress as `0x${string}` | null;

export const COURSE = {
  code: "CPSC 3640 / CPSC 5400",
  title: "Decentralized Payments, Contracts, and Finance for Humans and AI",
  term: "Fall 2026",
  site: "https://cpsc3640.netlify.app/"
} as const;

/** Where the claim page fetches Merkle proofs from. Respects the GitHub Pages base path. */
export const PROOFS_URL = `${import.meta.env.BASE_URL}proofs.json`;

export function explorerTx(hash: string): string | null {
  return NETWORK.explorer ? `${NETWORK.explorer}/tx/${hash}` : null;
}

export function explorerAddress(address: string): string | null {
  return NETWORK.explorer ? `${NETWORK.explorer}/address/${address}` : null;
}
