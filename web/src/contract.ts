/**
 * Reads and writes against the deployed course NFT.
 *
 * Every read goes through the wallet's own RPC connection, so the page needs no API
 * key and no backend. Eligibility is always confirmed here, against the contract,
 * even though proofs.json already suggested an answer.
 */
import {
  createPublicClient,
  custom,
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {CHAIN, CONTRACT_ADDRESS, DEPLOYMENT} from "./config";
import {CPSC3640NFT_ABI} from "./abi";
import {getProvider} from "./wallet";

export interface ContractState {
  claimOpen: boolean;
  merkleRoot: Hex;
  hasClaimed: boolean;
  totalMinted: bigint;
}

export interface OwnedToken {
  tokenId: bigint;
  /** The `image` field decoded out of the on-chain tokenURI. */
  image: string;
  name: string;
  /** Current holder. Not necessarily the claimer: these tokens are transferable. */
  owner: Address;
}

/** Typed separately from the ABI so `getLogs` can infer `args.tokenId`. */
const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed account, uint256 indexed tokenId)"
);

function contractAddress(): Address {
  if (!CONTRACT_ADDRESS) {
    throw new Error("No contract address is configured for this network");
  }
  return CONTRACT_ADDRESS;
}

export function publicClient(): PublicClient {
  const provider = getProvider();
  if (!provider) throw new Error("No injected wallet is available");
  return createPublicClient({chain: CHAIN, transport: custom(provider)});
}

/** One round trip for everything the eligibility screen needs. */
export async function readContractState(account: Address): Promise<ContractState> {
  const client = publicClient();
  const address = contractAddress();
  const base = {address, abi: CPSC3640NFT_ABI} as const;

  const [claimOpen, merkleRoot, hasClaimed, totalMinted] = await Promise.all([
    client.readContract({...base, functionName: "claimOpen"}),
    client.readContract({...base, functionName: "merkleRoot"}),
    client.readContract({...base, functionName: "hasClaimed", args: [account]}),
    client.readContract({...base, functionName: "totalMinted"})
  ]);

  return {claimOpen, merkleRoot, hasClaimed, totalMinted};
}

/** Ask the contract, not proofs.json, whether this proof actually works. */
export async function isEligibleOnChain(account: Address, proof: Hex[]): Promise<boolean> {
  return publicClient().readContract({
    address: contractAddress(),
    abi: CPSC3640NFT_ABI,
    functionName: "isEligible",
    args: [account, proof]
  });
}

/**
 * Simulate first, then send. Simulation surfaces a revert as a decoded custom error
 * before the user is asked to sign, instead of after they have paid for a failure.
 */
export async function submitClaim(
  account: Address,
  proof: Hex[],
  wallet: ReturnType<typeof import("./wallet").walletClient>
): Promise<Hex> {
  const {request} = await publicClient().simulateContract({
    address: contractAddress(),
    abi: CPSC3640NFT_ABI,
    functionName: "claim",
    args: [proof],
    account
  });

  return wallet.writeContract(request);
}

/** Wait for the claim to be mined and pull the token id straight out of the receipt. */
export async function waitForClaim(hash: Hex): Promise<bigint> {
  const receipt = await publicClient().waitForTransactionReceipt({hash, confirmations: 1});

  if (receipt.status !== "success") {
    throw new Error("The claim transaction was mined but reverted");
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress().toLowerCase()) continue;
    try {
      const event = decodeEventLog({abi: CPSC3640NFT_ABI, ...log});
      if (event.eventName === "Claimed") return event.args.tokenId;
    } catch {
      // Not a Claimed event. Ignore and keep looking.
    }
  }

  throw new Error("The transaction succeeded but emitted no Claimed event");
}

/**
 * Find the token a wallet claimed in some earlier session.
 *
 * `Claimed` indexes `account`, and the search starts at the deployment block rather
 * than at genesis, which keeps this within the range limits public RPCs impose.
 */
export async function findClaimedTokenId(
  account: Address
): Promise<{tokenId: bigint; transactionHash: Hex} | null> {
  const logs = await publicClient().getLogs({
    address: contractAddress(),
    event: CLAIMED_EVENT,
    args: {account},
    fromBlock: BigInt(DEPLOYMENT.deploymentBlock),
    toBlock: "latest"
  });

  const last = logs.at(-1);
  if (!last?.args.tokenId) return null;

  return {tokenId: last.args.tokenId, transactionHash: last.transactionHash};
}

/**
 * Read the real on-chain `tokenURI` and decode it.
 *
 * The success screen deliberately renders this rather than the local preview SVG, so
 * what the student sees is what the contract will hand any wallet or marketplace.
 */
export async function readToken(tokenId: bigint): Promise<OwnedToken> {
  const [uri, holder] = await Promise.all([
    publicClient().readContract({
      address: contractAddress(),
      abi: CPSC3640NFT_ABI,
      functionName: "tokenURI",
      args: [tokenId]
    }),
    ownerOf(tokenId)
  ]);

  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    throw new Error("tokenURI is not a base64 JSON data URI");
  }

  const metadata = JSON.parse(atob(uri.slice(prefix.length))) as {
    name?: string;
    image?: string;
  };

  if (!metadata.image) throw new Error("tokenURI metadata has no image");

  return {
    tokenId,
    image: metadata.image,
    name: metadata.name ?? `Token #${tokenId}`,
    owner: holder
  };
}

/** Native balance, used to catch a student who has no gas before they try to claim. */
export async function balanceOf(account: Address): Promise<bigint> {
  return publicClient().getBalance({address: account});
}

/** Just the claim count. Cheap enough to re-read on a timer. */
export async function readTotalMinted(): Promise<bigint> {
  return publicClient().readContract({
    address: contractAddress(),
    abi: CPSC3640NFT_ABI,
    functionName: "totalMinted"
  });
}

export async function ownerOf(tokenId: bigint): Promise<Address> {
  return publicClient().readContract({
    address: contractAddress(),
    abi: CPSC3640NFT_ABI,
    functionName: "ownerOf",
    args: [tokenId]
  });
}
