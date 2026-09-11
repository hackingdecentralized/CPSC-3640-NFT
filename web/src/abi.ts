/**
 * The slice of CPSC3640NFT the claim page uses.
 *
 * Written out by hand rather than imported from the Foundry artifact so it stays
 * readable in class. The custom errors matter as much as the functions: with them
 * present, viem decodes a revert into `AlreadyClaimed` instead of an opaque hex blob.
 */
export const CPSC3640NFT_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{name: "proof", type: "bytes32[]"}],
    outputs: []
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [{name: "", type: "address"}],
    outputs: [{name: "", type: "bool"}]
  },
  {
    type: "function",
    name: "isEligible",
    stateMutability: "view",
    inputs: [
      {name: "account", type: "address"},
      {name: "proof", type: "bytes32[]"}
    ],
    outputs: [{name: "", type: "bool"}]
  },
  {
    type: "function",
    name: "allowlistEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "bool"}]
  },
  {
    type: "function",
    name: "claimOpen",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "bool"}]
  },
  {
    type: "function",
    name: "merkleRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "bytes32"}]
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "uint256"}]
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{name: "tokenId", type: "uint256"}],
    outputs: [{name: "", type: "string"}]
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{name: "tokenId", type: "uint256"}],
    outputs: [{name: "", type: "address"}]
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      {name: "account", type: "address", indexed: true},
      {name: "tokenId", type: "uint256", indexed: true}
    ]
  },
  {type: "error", name: "ClaimClosed", inputs: []},
  {type: "error", name: "AlreadyClaimed", inputs: []},
  {type: "error", name: "InvalidProof", inputs: []},
  {type: "error", name: "MerkleRootNotSet", inputs: []},
  {type: "error", name: "UnsupportedChain", inputs: [{name: "chainId", type: "uint256"}]}
] as const;
