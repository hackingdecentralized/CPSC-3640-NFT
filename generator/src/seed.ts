/**
 * Seed derivation (spec section 5).
 *
 *   seed = SHA256( normalize(tokenId) || ":" || lowercase(walletAddress) || ":" || salt )
 *
 * Every trait then draws from its own sub-stream, SHA256(seed || ":" || label), so
 * no trait's draws can shift another's. Forcing a badge, or retuning the background
 * weights, leaves every other trait of an existing token exactly as it was.
 */
import {createHash} from "node:crypto";

export type TokenIdInput = string | number | bigint;

/** Canonical base-10 form: no sign, no leading zeros. */
export function normalizeTokenId(tokenId: TokenIdInput): string {
  if (typeof tokenId === "bigint") {
    if (tokenId < 0n) throw new Error(`tokenId must not be negative: ${tokenId}`);
    return tokenId.toString(10);
  }
  if (typeof tokenId === "number") {
    if (!Number.isSafeInteger(tokenId) || tokenId < 0) {
      throw new Error(`tokenId must be a non-negative safe integer: ${tokenId}`);
    }
    return tokenId.toString(10);
  }
  const text = String(tokenId).trim();
  if (!/^\d+$/.test(text)) throw new Error(`tokenId must be a base-10 integer: "${tokenId}"`);
  return BigInt(text).toString(10);
}

export function normalizeWallet(walletAddress: string): string {
  const text = String(walletAddress).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new Error(`walletAddress must be a 20-byte hex address: "${walletAddress}"`);
  }
  return text.toLowerCase();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function deriveSeed(tokenId: TokenIdInput, walletAddress: string, salt: string): string {
  if (typeof salt !== "string" || salt.length === 0) throw new Error("salt must be a non-empty string");
  return sha256Hex(`${normalizeTokenId(tokenId)}:${normalizeWallet(walletAddress)}:${salt}`);
}

/** An independent stream for one named use of the seed. */
export function subSeed(seed: string, label: string): string {
  return sha256Hex(`${seed}:${label}`);
}
