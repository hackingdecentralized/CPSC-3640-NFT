// keccak256("DesignWeights(uint256[6])"). Read only a successful renderer's log;
// local source changes must never relabel an already-deployed equal-chance draw.
const WEIGHTS_TOPIC = "0xca317ff94fb603d49f315c83fb7c6cd4229a9ef477d952063f4c2bea71302edd";

export function readDesignWeights(run, renderer) {
  if (!renderer) return null;
  const address = renderer.toLowerCase();
  const receipt = (run.receipts ?? []).find(r =>
    Number(r.status) === 1 && r.contractAddress?.toLowerCase() === address);
  const log = receipt?.logs?.find(l =>
    l.address?.toLowerCase() === address && l.topics?.[0]?.toLowerCase() === WEIGHTS_TOPIC);
  if (!log) return null; // Previous renderers used six equal chances.
  if (!/^0x[0-9a-fA-F]{384}$/.test(log.data ?? "")) throw new Error("Invalid DesignWeights log");
  const weights = Array.from({length: 6}, (_, i) => Number(BigInt(`0x${log.data.slice(2 + i * 64, 66 + i * 64)}`)));
  if (weights.some(w => !Number.isInteger(w) || w < 0 || w > 100) || weights.reduce((a, b) => a + b, 0) !== 100) {
    throw new Error("Design weights must sum to 100");
  }
  return weights;
}
