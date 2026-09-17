/** Reading the deployed course NFT. Used by the collection script. */
import {existsSync, readFileSync} from "node:fs";
import {createPublicClient, http, isAddress, parseAbi, type Address, type PublicClient} from "viem";
import {fromRoot} from "../src/paths";
import {loadDotEnv} from "./cli";

/** The reads the reveal needs. The full contract lives in ../contracts. */
export const NFT_ABI = parseAbi([
  "function totalMinted() view returns (uint256)",
  "function claimerOf(uint256 tokenId) view returns (address)",
  "function revealedCount() view returns (uint256)",
  "function baseURI() view returns (string)",
  "function claimOpen() view returns (bool)",
  "function metadataFrozen() view returns (bool)"
]);

const NETWORKS: Record<string, {chainId: number; rpcVariable: string; defaultRpc?: string}> = {
  sepolia: {chainId: 11155111, rpcVariable: "SEPOLIA_RPC_URL"},
  anvil: {chainId: 31337, rpcVariable: "ANVIL_RPC_URL", defaultRpc: "http://127.0.0.1:8545"}
};

export interface Deployment {
  network: string;
  chainId: number;
  contractAddress: Address;
  deploymentBlock: number;
}

export const deploymentPath = (network: string): string => fromRoot("..", "deployments", `${network}.json`);

export function readDeployment(network: string): Deployment {
  const known = NETWORKS[network];
  if (!known) throw new Error(`unknown network "${network}". Expected one of: ${Object.keys(NETWORKS).join(", ")}`);
  const path = deploymentPath(network);
  if (!existsSync(path)) throw new Error(`no deployments/${network}.json. Deploy first: scripts/deploy.sh ${network}`);
  const record = JSON.parse(readFileSync(path, "utf8")) as Partial<Deployment>;
  if (!record.contractAddress || !isAddress(record.contractAddress)) {
    throw new Error(`deployments/${network}.json has no contract address. Deploy first: scripts/deploy.sh ${network}`);
  }
  if (record.chainId !== known.chainId) {
    throw new Error(`deployments/${network}.json is for chain ${record.chainId}, expected ${known.chainId}`);
  }
  return {network, chainId: known.chainId, contractAddress: record.contractAddress, deploymentBlock: record.deploymentBlock ?? 0};
}

/** Connects, and refuses to continue if the RPC serves a different chain than the record. */
export async function connect(network: string): Promise<{client: PublicClient; deployment: Deployment}> {
  const deployment = readDeployment(network);
  const {rpcVariable, defaultRpc} = NETWORKS[network]!;
  loadDotEnv([rpcVariable]);
  const url = process.env[rpcVariable] || defaultRpc;
  if (!url) throw new Error(`${rpcVariable} is not set. Add it to the repository's .env.`);

  const client = createPublicClient({transport: http(url, {retryCount: 3, timeout: 30_000})});
  const chainId = await client.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(`${rpcVariable} serves chain ${chainId}, but deployments/${network}.json is on chain ${deployment.chainId}`);
  }
  return {client, deployment};
}
