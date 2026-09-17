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

export interface RevealState {
  /**
   * Whether this deployment gives each token a generated card. The first Sepolia
   * deployment predates that and only ever shows the on-chain artwork.
   */
  revealable: boolean;
  /** Tokens 1..revealedCount already show their card in wallets. */
  revealedCount: bigint;
}

export interface ContractState extends RevealState {
  claimOpen: boolean;
  /** When false the contract lets any address claim, and proofs.json is not consulted. */
  allowlistEnabled: boolean;
  merkleRoot: Hex;
  hasClaimed: boolean;
  totalMinted: bigint;
}

export interface OwnedToken {
  tokenId: bigint;
  /** Current holder. Not necessarily the claimer: these tokens are transferable. */
  owner: Address;
  /** Who claimed it, which is what its card is drawn from. Null where not recorded. */
  claimer: Address | null;
  /** The on-chain artwork and name, while tokenURI still serves them. */
  placeholder: {image: string; name: string} | null;
}

/** ERC-4906 metadata updates. Only the reveal-capable contract advertises it. */
const ERC4906_INTERFACE = "0x49064906";

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

  const [claimOpen, allowlistEnabled, merkleRoot, hasClaimed, totalMinted, reveal] = await Promise.all([
    client.readContract({...base, functionName: "claimOpen"}),
    client.readContract({...base, functionName: "allowlistEnabled"}),
    client.readContract({...base, functionName: "merkleRoot"}),
    client.readContract({...base, functionName: "hasClaimed", args: [account]}),
    client.readContract({...base, functionName: "totalMinted"}),
    readRevealState()
  ]);

  return {claimOpen, allowlistEnabled, merkleRoot, hasClaimed, totalMinted, ...reveal};
}

/**
 * Asked through ERC-165 rather than by calling `revealedCount` and treating a revert
 * as "not supported", which would also swallow a flaky RPC and quietly show the
 * wrong artwork.
 */
export async function readRevealState(): Promise<RevealState> {
  const client = publicClient();
  const base = {address: contractAddress(), abi: CPSC3640NFT_ABI} as const;
  const revealable = await client.readContract({
    ...base,
    functionName: "supportsInterface",
    args: [ERC4906_INTERFACE]
  });
  const revealedCount = revealable ? await client.readContract({...base, functionName: "revealedCount"}) : 0n;
  return {revealable, revealedCount};
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
 * Read a token as wallets see it.
 *
 * Until its card is revealed, tokenURI is an on-chain data URI, decoded here so the
 * page can show exactly what the contract hands out. Afterwards it points at the
 * uploaded metadata, and the page draws the card itself instead.
 */
export async function readToken(tokenId: bigint, revealable: boolean): Promise<OwnedToken> {
  const base = {address: contractAddress(), abi: CPSC3640NFT_ABI} as const;
  const [uri, holder, claimer] = await Promise.all([
    publicClient().readContract({...base, functionName: "tokenURI", args: [tokenId]}),
    ownerOf(tokenId),
    revealable ? publicClient().readContract({...base, functionName: "claimerOf", args: [tokenId]}) : null
  ]);

  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return {tokenId, owner: holder, claimer, placeholder: null};

  const metadata = JSON.parse(atob(uri.slice(prefix.length))) as {
    name?: string;
    image?: string;
  };

  if (!metadata.image) throw new Error("tokenURI metadata has no image");

  return {
    tokenId,
    owner: holder,
    claimer,
    placeholder: {image: metadata.image, name: metadata.name ?? `Token #${tokenId}`}
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

/** How many tokens show their card in wallets. Re-read on a timer after claiming. */
export async function readRevealedCount(): Promise<bigint> {
  return publicClient().readContract({
    address: contractAddress(),
    abi: CPSC3640NFT_ABI,
    functionName: "revealedCount"
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
