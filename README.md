# CPSC 3640 / CPSC 5400 Course NFT

A Fall 2026 course collectible. Each wallet claims one ERC-721 on Ethereum Sepolia.
Its original address and claim order select one of six base cards, an accent color,
a small symbol, and an optional ring. The card also carries its unique claim number.

**The final image and metadata are available immediately after minting, entirely
on-chain. There is no IPFS, reveal, image server, or later publishing step.**
The website reads the same `tokenURI` that wallets read; it does not generate a
separate version of the student's card.

This is a course collectible, not an official academic credential or a Yale-issued
credential.

## How it works

1. A student connects a wallet and switches to Sepolia.
2. `claim(proof)` checks eligibility and the one-claim-per-address rule.
3. The contract assigns `tokenId = ++totalMinted` and records `claimerOf[tokenId]`.
4. `tokenURI(tokenId)` asks the fixed renderer for JSON containing an embedded SVG.
5. The SVG embeds the selected JPEG base and draws the accent, symbol and number.

Handsome Dan has a 5% draw weight; each of the other five designs has 19%.
These are per-draw probabilities, not guaranteed class-wide counts. The draw is derived from
`keccak256(abi.encode("CPSC3640-onchain-v1", originalClaimer, tokenId))`.
It is deterministic and publicly predictable, appropriate for a classroom collectible,
not unpredictable prize allocation. Refreshing or transferring never changes the card.
The order is the actual on-chain claim order, not the order students clicked a button.
The website reads the weights from the renderer's deployment event, saved in
`deployments/<network>.json`. An older equal-chance deployment keeps its original
odds until a new renderer and NFT are deployed and the website is rebuilt.

## Architecture

| Component | Responsibility |
| --- | --- |
| `CPSC3640NFT` | Ownership, one claim per address, optional roster, original claimer |
| `CourseRenderer` | Fixed draw and SVG/JSON rendering; no owner or setters |
| Six `CourseArtwork` data contracts | One compressed base card each, stored as immutable code |
| Static Vite website | Wallet flow, base previews, and the actual image returned by the NFT |

Deployment creates eight contracts once. Each image is stored once for the whole
class, not once per student. The NFT's renderer reference cannot change. Artwork
contracts contain a STOP byte followed by image data; the renderer reads those bytes
using `EXTCODECOPY`. Neither the renderer nor the artwork can be upgraded.

Base images are 512×512 JPEG, about 18–23 KB each, displayed inside a 1254×1254 SVG.
This trades some original image detail for compact, self-contained artwork. The base
files fit under the 24,576-byte runtime limit individually. Reading metadata costs
roughly 7–9 million gas in local tests but uses a read-only RPC call, not a paid
transaction. Claims do not render or store another copy of the image.

## Wallet display

The standard ERC-721 metadata includes `name`, `description`, `attributes`, and an
`image` data URI. Minting produces complete metadata without waiting for staff.
Wallet discovery, indexing, caching and SVG/JPEG rendering still depend on the wallet.

For MetaMask on Sepolia, use **NFTs → Import NFT**, choose Sepolia, and enter the NFT
contract address and token ID. Enable NFT media if hidden. The claim page exposes
these values under **Show in my wallet**. Test the actual target extension/mobile
version before distributing the collection; a successful browser render is not proof
that every wallet supports this embedded format.

## Setup and checks

Requires Node 20+ and Foundry.

```bash
git submodule update --init --recursive
npm ci
npm --prefix web ci
forge test -vv
forge build --sizes
npm run test:web
npm --prefix web run build
```

The six compressed images are committed in `nft/cards/`, so normal builds and
deployments need no image generator. To regenerate them from the supplied originals:

```bash
npm --prefix generator ci
npm run image
```

This uses the pinned Sharp version and updates the images and their SHA-256 manifest.
Image bytes are immutable once deployed. Regenerating files affects future deployments
only. The older layered generator remains under `generator/` as historical tooling;
it is not part of the current claim, build, or deployment flow.

## Run locally

Start Anvil in one terminal:

```bash
anvil
```

In another, use a disposable Anvil test key:

```bash
export DEPLOYER_PRIVATE_KEY=<an Anvil test key>
scripts/deploy.sh anvil
npm --prefix web run dev:anvil
```

Connect a local test wallet on chain 31337. Each account can claim once. The completed
card comes directly from `tokenURI`, including after reload and transfer.

## Deploy to Sepolia

Copy `.env.example` to `.env` and set `DEPLOYER_PRIVATE_KEY` and `SEPOLIA_RPC_URL`.
Use a disposable key containing only test ETH. `ETHERSCAN_API_KEY` enables explorer
verification. Never put secrets into frontend settings or deployment records.

```bash
scripts/deploy.sh sepolia
```

The script runs the contract tests, deploys the six artwork contracts, renderer and
NFT, records their public addresses, and verifies the NFT and renderer when configured.
Each artwork is a separate deployment transaction. The script uses `--slow` to wait
for confirmation before sending the next transaction, including for EIP-7702 delegated
wallets with a small pending-transaction limit. If a run fails partway through, keep
the broadcast and cache files, keep the same deployer/configuration, and continue:

```bash
scripts/deploy.sh sepolia --resume
```

This resumes the saved transaction plan; already-created contracts remain on-chain.
Avoid other transactions from the deployer until it finishes, so the saved nonces
remain valid. A fresh run is refused while the latest broadcast record is incomplete.

```bash
scripts/verify.sh sepolia    # retry source verification
scripts/publish-pages.sh    # build and publish the static claim page
```

`deployments/<network>.json` is the frontend configuration and records constructor
arguments for verification. `onchainCards: true` is written only after the deployment
creation code is matched to this build.

**Migration:** the existing Sepolia deployment uses the previous reveal design and
cannot be upgraded into this version. Deploy a new collection and publish the updated
record. Existing NFTs remain in the old contract. Until the record is updated, the
page labels the old artwork honestly and reads what that old contract actually returns.
Old source verification and reveal administration require the original source revision.

## Optional student roster

Open claiming is the default: any address may claim once. This is one per wallet,
not proof of one per person. To restrict eligibility, put wallet addresses only in
`allowlist/addresses.json`:

```bash
npm run merkle
REQUIRE_ALLOWLIST=true scripts/deploy.sh sepolia
```

The contract verifies OpenZeppelin StandardMerkleTree proofs. The fixture tests use
proofs generated by the TypeScript tool, so incompatible encoding is caught locally.
The owner can change the Merkle root, enable/disable the roster, or open/close claiming.
Those actions do not alter existing cards. When rotating a roster, update the on-chain
root and republish the matching proofs together. Never include student names or emails
in the public allowlist.

## Repository

```text
contracts/                  NFT, immutable renderer, artwork data constructor
nft/cards/                  six deployable JPEGs and their checksum manifest
script/Deploy.s.sol         deployment of all eight contracts
scripts/                    deploy, record, verify, publish
web/                        static wallet/claim interface
allowlist/                  roster-to-Merkle-proof tooling
test/                       contract, image and metadata tests
generator/assets/source/    original high-resolution card designs
```

CI verifies image reproducibility, all contract tests, frontend metadata parsing and
the production build. GitHub Pages publishing is explicit through
`scripts/publish-pages.sh`; `gh-pages` remains disposable build output.
