/**
 * Turning wallet and RPC failures into something a student can act on.
 *
 * Rule: the page never shows a stack trace. It shows one plain sentence, and the
 * full error goes to the browser console for whoever is debugging.
 */
import {BaseError, ContractFunctionRevertedError, UserRejectedRequestError} from "viem";

export interface FriendlyError {
  message: string;
  /** Short technical hint, safe to show. Never a stack trace. */
  detail?: string;
}

/** EIP-1193 error codes worth naming. */
const USER_REJECTED = 4001;
const UNRECOGNISED_CHAIN = 4902;

function codeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as {code: unknown}).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export function isUserRejection(error: unknown): boolean {
  if (codeOf(error) === USER_REJECTED) return true;
  if (error instanceof BaseError) {
    return error.walk((e) => e instanceof UserRejectedRequestError) !== null;
  }
  return false;
}

export function isUnrecognisedChain(error: unknown): boolean {
  if (codeOf(error) === UNRECOGNISED_CHAIN) return true;
  // MetaMask sometimes nests the code one level down.
  if (typeof error === "object" && error !== null && "cause" in error) {
    return codeOf((error as {cause: unknown}).cause) === UNRECOGNISED_CHAIN;
  }
  return false;
}

/** The contract's custom errors, phrased for a person rather than for a debugger. */
const REVERT_MESSAGES: Record<string, string> = {
  AlreadyClaimed: "This wallet has already claimed its course NFT.",
  ClaimClosed: "Claiming is currently closed by the course staff.",
  InvalidProof: "This wallet is not on the allowlist for the current roster.",
  MerkleRootNotSet: "No allowlist has been configured on the contract yet.",
  ERC721InvalidReceiver: "This address cannot receive an ERC-721 token."
};

export function explain(error: unknown, fallback: string): FriendlyError {
  // Always keep the real thing available for debugging.
  console.error(fallback, error);

  if (isUserRejection(error)) {
    return {message: "You rejected the request in your wallet."};
  }

  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && REVERT_MESSAGES[name]) {
        return {message: REVERT_MESSAGES[name], detail: name};
      }
      if (name) {
        return {message: "The contract rejected this transaction.", detail: name};
      }
    }

    if (error.shortMessage) {
      return {message: fallback, detail: error.shortMessage};
    }
  }

  if (error instanceof Error && error.message) {
    // Trim anything that looks like a stack or a giant payload.
    const firstLine = error.message.split("\n")[0]!.trim();
    return {message: fallback, detail: firstLine.slice(0, 160)};
  }

  return {message: fallback};
}
