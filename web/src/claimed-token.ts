/** Find the original claim using current contract state, without historical logs. */
export async function findOriginalClaim(
  account: string,
  totalMinted: bigint,
  readClaimer: (tokenId: bigint) => Promise<string>
): Promise<bigint | null> {
  // Small concurrent batches avoid overwhelming the wallet's RPC. Search recent
  // tokens first; claimerOf remains correct even after the NFT is transferred.
  const batchSize = 8n;
  for (let last = totalMinted; last > 0n; last -= batchSize) {
    const count = Number(last < batchSize ? last : batchSize);
    const ids = Array.from({length: count}, (_, i) => last - BigInt(i));
    const claimers = await Promise.all(ids.map(readClaimer));
    const match = claimers.findIndex(claimer => claimer.toLowerCase() === account.toLowerCase());
    if (match !== -1) return ids[match]!;
  }
  return null;
}
