# CPSC 3640 / CPSC 5400 Course NFT

A course collectible for **CPSC 3640 / CPSC 5400 - Decentralized Payments, Contracts,
and Finance for Humans and AI**, Fall 2026.

Enrolled students connect a wallet, get checked against an on-chain allowlist, and mint
one ERC-721 to themselves on Ethereum Sepolia. The point is to walk the whole path once,
for real: visit a page, connect a wallet, notice you are on the wrong network, fix that,
prove eligibility, sign a transaction, wait for a block, and end up owning something.

Every token gets its own card: one of six designs, with its own background, border,
halo, icons and badge, drawn from the token's claim number and the address that claimed
it. The claim page draws the card the moment a student claims.

Wallets see it in two phases:

1. **Until the reveal**, `tokenURI` is fully on-chain: a 512x512 WebP of about 14 KB,
   sitting in the contract's own bytecode, with the claim number composited on at read
   time, so the third student to claim sees "No. 3". No IPFS, no backend, no database.
   See `nft/README.md` for why that artwork is 512x512.
2. **After the reveal**, the course staff generate every card, upload them to IPFS and
   point the contract at them. Wallets then show each student the card the page showed
   them. See [Revealing the cards](#revealing-the-cards).

> This is a collectible, not an official academic credential, and not a Yale-issued
> anything. The metadata says so too.

## For students: before you claim

Three one-time steps. The claim page walks you through them, but here they are in full.

**0. Install a wallet.** [MetaMask](https://metamask.io/download/) in Chrome, Firefox,
Edge or Brave. Create a new wallet when it asks and keep the recovery phrase somewhere
safe. You do not need to put any real money in it.

**1. Switch to Sepolia.** Sepolia is Ethereum's test network, so nothing here costs real
money. Connect on the claim page and it will offer to switch for you.

**2. Get free test ETH.** The NFT is free, but Ethereum charges a small fee to process
any transaction. Any Sepolia faucet works, for example:

```text
https://cloud.google.com/application/web3/faucet/ethereum/sepolia
```

Paste your address in and it sends you a small amount. The claim page shows your address
with a copy button, and tells you when you have none.

Then connect and claim. Your token's number is your place in the queue, and your card is
drawn from that number and your wallet address, so you see it the moment your claim
lands. Download it from the page if you like. Your wallet shows a placeholder, stamped
with your number, until the course staff publish the collection.

## Architecture

```
                    main branch
                         |
        +----------------+----------------+
        |                |                |
    Solidity    Card generator     Web source
        |           |    \             |
        |           |     +--------->  |   same trait code and layers
        v           v                  v
 Ethereum Sepolia  IPFS (at reveal)  Vite build
        |                                 |
        |                                 v
        |                          gh-pages branch
        |                                 |
        +----------- browser -------------+
                    |
                    v
               Student wallet
                    |
                    v
                  claim()
                    |
                    v
                  ERC-721
```

Three places, three jobs:

| Where | Holds | Is the source of truth for |
| --- | --- | --- |
| `main` | Solidity, tests, artwork, generator, allowlist tooling, web source | everything a human writes, including which card each token gets |
| Ethereum Sepolia | the deployed contract | who owns what, who claimed it, and where its metadata lives |
| IPFS | the revealed collection | nothing new: it is generated from `main` and the chain |
| `gh-pages` | built static site | nothing; it is disposable output |

## Trait-layered collection generator

`generator/` renders the cards: five course-card templates plus a bulldog special
edition, with layered backgrounds, borders, halos, icons, badges and easter eggs, drawn
deterministically from `SHA256(tokenId : claimer : salt)`. It writes 1024px PNGs and
ERC-721 metadata. See [generator/README.md](generator/README.md).

The claim page imports its trait code and the layer rasters it exports, so the page and
the reveal cannot disagree about a card. The salt is public on purpose, which means a
card can be predicted; the generator README explains that trade.

## Repository layout

```
contracts/CPSC3640NFT.sol      ERC-721, Merkle allowlist, on-chain metadata
test/CPSC3640NFT.t.sol         Foundry tests
script/Deploy.s.sol            deployment script
script/Reveal.s.sol            owner actions for the reveal, run by scripts/reveal.sh
deployments/                   public record of each deployment
nft/course-nft.svg             master artwork; course-nft-onchain.webp is what ships on-chain
allowlist/                     roster in, Merkle root and proofs out
web/                           Vite + TypeScript + viem claim page
scripts/                       deploy, verify, reveal, page publishing, artwork embedding
generator/                     trait-layered card generator, shared with the claim page
```

## Setup

Needs [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 20+.

```bash
git clone --recursive https://github.com/hackingdecentralized/CPSC-3640-NFT.git
cd CPSC-3640-NFT
npm install              # allowlist + tooling
npm --prefix web install # claim page
npm --prefix generator ci                    # card generator
npm --prefix generator run prepare-assets    # 1024px bases and masks
npm --prefix generator run export-web        # card layers for the claim page
```

The last three are what let the claim page draw cards. Without them it still works, and
shows the on-chain artwork instead.

Already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

## How the claim flow works

```
wallet calls claim(proof)
        |
        v  is claiming open?          -> ClaimClosed
        v  has this address claimed?  -> AlreadyClaimed
        v  allowlist on?              -> if off, skip the next check
        v  does the proof verify?     -> InvalidProof
        v
   mark address as claimed, record claimerOf[tokenId]
        v
   _safeMint(msg.sender, tokenId)     tokenId starts at 1
        v
   emit Claimed(account, tokenId)
```

Whether a proof is needed at all is a deploy-time choice, held in `allowlistEnabled` and
changeable later by the owner. It is **off by default**: any address may claim one token,
and the page never fetches `proofs.json`. One per wallet still holds, but one person can use several
wallets, so an open claim is a collectible for whoever finds the page rather than a
record of who was enrolled.

With it on, eligibility is a Merkle proof. The contract stores one 32-byte root; the page
holds the proofs. Leaves use OpenZeppelin's `StandardMerkleTree` encoding:

```
leaf   = keccak256(bytes.concat(keccak256(abi.encode(address))))
parent = keccak256(sorted(left, right))
```

Both sides must agree exactly or every proof breaks. `allowlist/generate-merkle.ts`
builds the tree, `MerkleProof` verifies it, and the Foundry tests run against proofs
emitted by that script rather than against a tree rebuilt in Solidity. If the two
encodings ever drift apart, the test suite finds out before Sepolia does.

The page also asks the contract `isEligible` before it shows a claim button, so a
tampered or stale `proofs.json` cannot produce a button that leads to a failed
transaction.

## Common commands

```bash
npm run merkle                # build the Merkle tree from allowlist/addresses.json
npm run merkle -- --example   # rebuild the committed test fixture
npm run image                 # master artwork -> the 512px on-chain copy
npm run embed:image           # that copy -> contracts/CourseArtwork.sol
forge test -vv                # run the contract tests
forge build --sizes           # check bytecode against the 24,576-byte limit
npm --prefix web run dev      # claim page against Sepolia
npm --prefix web run dev:anvil# claim page against local Anvil
scripts/deploy.sh sepolia     # test, deploy and verify in one command
scripts/verify.sh sepolia     # retry explorer verification on its own
scripts/publish-pages.sh      # build and publish gh-pages
scripts/reveal.sh sepolia status             # claims, reveal and freeze state
scripts/reveal.sh sepolia publish <CID>      # reveal the uploaded collection
scripts/reveal.sh sepolia close | open       # pause or resume claiming
scripts/reveal.sh sepolia freeze             # make the final reveal permanent
```

## Running it locally end to end

Four terminals' worth of work, in order.

**1. Start a chain and generate the allowlist.**

```bash
anvil
npm run merkle -- --example
```

The example roster is Anvil's own accounts #0, #1, #3, #4 and #5. Account #2 is left out
on purpose so you have an address that is genuinely not eligible.

**2. Deploy.**

Anvil prints ten private keys when it starts. Copy any one of them. `REQUIRE_ALLOWLIST=true`
turns the example roster on, which is what makes account #2 ineligible below; without it,
anyone may claim.

```bash
export DEPLOYER_PRIVATE_KEY=<a private key from the anvil startup output>
REQUIRE_ALLOWLIST=true scripts/deploy.sh anvil
```

That writes `deployments/anvil.json`, which is what the claim page reads.

**3. Run the page.**

```bash
npm --prefix generator run export-web   # once, so the page can draw cards
npm --prefix web run dev:anvil
```

**4. Add Anvil to MetaMask** as a network on `http://127.0.0.1:8545`, chain id `31337`,
import a couple of Anvil private keys, and walk through it:

| Wallet | Expected |
| --- | --- |
| Account #0 | eligible, claims, receives token #1 and sees its card |
| Account #0 again, after reload | already claimed, the same card returns |
| Account #1 | eligible, claims, receives token #2 and its own card |
| Account #2 | not eligible, no claim button at all |

The card on the page is the one `npm --prefix generator run generate -- --token-id 1
--wallet <account #0>` renders.

**5. Optionally, rehearse the reveal.** Follow [Revealing the cards](#revealing-the-cards)
with `anvil` in place of `sepolia`. On the local chain, `publish` also accepts a plain
`http://` base URL, so any local web server can stand in for IPFS metadata.

## Deploying to Sepolia

**1. Configure secrets.** Copy `.env.example` to `.env` and fill it in. `.env` is
git-ignored. Use a throwaway key that holds nothing but Sepolia test ETH.

```bash
cp .env.example .env
```

`SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` are required. `ETHERSCAN_API_KEY` is
optional but worth setting: with it, the source is verified on Etherscan as part of the
deploy, with no second step.

**2. Choose who may claim.** By default anyone may claim one token, so there is nothing
to do here and you can go straight to step 3.

To restrict it to a roster instead, put the wallet addresses in
`allowlist/addresses.json`, addresses only and never names, emails or NetIDs, then build
the tree and deploy with the flag set:

```bash
npm run merkle
```

```bash
REQUIRE_ALLOWLIST=true scripts/deploy.sh sepolia
```

If `addresses.json` is missing the generator falls back to
`allowlist/addresses.example.json`, five Anvil test accounts. Deploying that root would
let those five test wallets claim and nobody else, so `scripts/deploy.sh` stops and asks
before it lets you.

**3. Deploy.**

```bash
scripts/deploy.sh sepolia
```

That one command runs the tests, refuses to continue if any fail, checks the deployer
has ETH, deploys, submits the source for verification, and writes
`deployments/sepolia.json`. Add `--no-verify` to skip the explorer step.

If the contract deploys but verification fails, which happens on rate limits or before
the explorer has indexed the creation transaction, the deployment is still recorded and
you can retry on its own:

```bash
scripts/verify.sh sepolia
```

`verify.sh` reads the constructor arguments back out of the deployment record rather
than guessing them, so the bytecode lines up.

The first Sepolia deployment, `0x91e67ce5...`, predates reveal support: its tokens will
only ever show the on-chain artwork, and the page shows that artwork for it rather than
cards. Generated cards need the current contract, which means a new deployment. Tokens
minted on the old contract stay where they are.

**4. Commit the deployment record and publish.**

```bash
git add deployments/sepolia.json && git commit -m "Record Sepolia deployment"
scripts/publish-pages.sh
```

`deployments/sepolia.json` is the frontend's configuration. `web/src/config.ts` imports
it, so updating that file and rebuilding is the whole of "update deployment config".
No chain id or contract address is written anywhere else in the frontend.

The deploy script refuses to run against Ethereum mainnet, as does `Deploy.s.sol`.

## Updating the allowlist

Enrollment changes are a root rotation. Nobody loses a token they already have.

```
allowlist/addresses.json
        |
        v  npm run merkle
new root + new proofs.json
        |
        v  cast send $CONTRACT "setMerkleRoot(bytes32)" $NEW_ROOT
contract now points at the new roster
        |
        v  scripts/publish-pages.sh
site serves proofs matching the new root
```

```bash
# after editing allowlist/addresses.json
npm run merkle
source .env
cast send "$CONTRACT_ADDRESS" "setMerkleRoot(bytes32)" \
  "$(jq -r .merkleRoot allowlist/generated/root.json)" \
  --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
scripts/publish-pages.sh
```

Rotate the root and republish the site together. In between, students on the new roster
hold proofs the contract does not recognise. The page detects exactly this and says the
site is out of date rather than showing a button that would fail.

Put only wallet addresses in `addresses.json`. No names, no emails, no NetIDs, no Canvas
identifiers. The file feeds a public Merkle tree and the proofs are served publicly.

## Revealing the cards

Until the reveal, wallets show the on-chain placeholder. The owner reveals by generating
every claimed card, uploading it, and pointing the contract at it:

```
generator: npm run collection -- --network sepolia --expect <fingerprint>
        |      reads totalMinted and claimerOf from the contract
        v
upload output/collection/sepolia/images            -> IMAGE_CID
npm run set-image-cid -- --dir output/collection/sepolia --cid <IMAGE_CID>
upload output/collection/sepolia/metadata          -> METADATA_CID
        |
        v
scripts/reveal.sh sepolia publish <METADATA_CID>
        |      checks the upload matches, then setBaseURI("ipfs://<cid>/", count)
        v
tokens 1..count now read ipfs://<cid>/<id>.json
```

`<fingerprint>` is the "Collection" value in the claim page's footer. If this checkout
would generate different cards than the page showed, the command stops.

A reveal covers the tokens that existed when the collection was generated. Tokens
claimed later keep the placeholder until the next reveal, so you can reveal as often as
you like while claiming is open. To finish, close claiming, reveal once more, and
freeze:

```bash
scripts/reveal.sh sepolia close
# collection, upload, set-image-cid, upload, publish, as above
scripts/reveal.sh sepolia freeze
```

Freezing is irreversible: the metadata location can never change again, and claiming
can never reopen, because a token minted afterwards could never be revealed. The
contract refuses to freeze until every token is revealed.

`reveal.sh` reads `DEPLOYER_PRIVATE_KEY` and `SEPOLIA_RPC_URL` from `.env`, and the key
must be the contract owner's. It never puts the key on a command line.

## GitHub Pages and CI

Publishing is a local, authenticated action: run `scripts/publish-pages.sh`. The script
rebuilds the card layers, builds `web/dist`, commits exactly those files to `gh-pages`,
and pushes. It never checks `gh-pages` out, so your working tree is never disturbed.

Enable it once, in **Settings -> Pages -> Deploy from a branch -> gh-pages -> /(root)**.

The included CI workflow runs tests and builds the site. It does **not** deploy, and that
is deliberate. A workflow that pushes `gh-pages` using the default `GITHUB_TOKEN` will
often appear to work and then not deploy: pushes made with that token do not trigger the
branch-based Pages build. If you want deployment automated later, use GitHub's official
Pages Actions flow (`actions/upload-pages-artifact` and `actions/deploy-pages`) and switch
the Pages source to "GitHub Actions". Do not bolt a token-push workflow onto the
branch-based setup and expect it to work.

Never develop on `gh-pages`, and never merge it back into `main`. It is build output.
Deleting and republishing it should always be safe.

## Security notes

The contract is the only thing enforcing anything.

- **Eligibility is enforced on-chain.** `proofs.json` is a convenience for building the
  proof argument. Editing it, or serving a different one, changes nothing: `claim`
  verifies against the root in contract storage.
- **One NFT per wallet, enforced on-chain** by `hasClaimed`, set before minting. A
  transfer does not restore a claim.
- **`_safeMint`**, so a token cannot be stranded in a contract that cannot handle it.
- **`claim` is not payable.** There is no price, no withdrawal path, and no ETH held.
- **No upgradeability, no proxy.** What is deployed is what was audited in class.
- **The page requests only what it needs:** the account list, the chain id, one chain
  switch, one transaction. No token approvals, no persistent permissions.
- **No secrets reach the browser.** `DEPLOYER_PRIVATE_KEY` and the RPC URL are read by
  Foundry from `.env` and are never referenced by any `VITE_`-prefixed variable, so Vite
  cannot bundle them. `.env` is git-ignored; only `.env.example` is committed.
- **The page shows the network and contract address** at all times, so students can check
  what they are about to sign against.
- **The deploy script refuses Ethereum mainnet** outright.
- **The collection salt is public by design.** Anyone can work out which card a token id
  and address would get. That is what lets the page draw cards without a server; the
  cost is that rarity can be predicted. See `generator/README.md`.
- **A reveal is checked before it is sent.** `scripts/reveal.sh publish` fetches the
  uploaded files back and compares them with the generated ones, and the contract only
  accepts a reveal that covers tokens which exist.

If a private key ever does reach a commit, rotating the file is not enough. Treat the key
as compromised, move the contract owner to a fresh key, and rewrite history.

## Contract reference

`CPSC3640NFT`, symbol `CPSC3640`. Solidity 0.8.24, OpenZeppelin 5.x.

| Function | Who | Does |
| --- | --- | --- |
| `claim(bytes32[] proof)` | anyone on the allowlist | mints one token to the caller |
| `canClaim(address)` | view | could this address claim right now |
| `isEligible(address, bytes32[])` | view | does this proof verify |
| `claimerOf(uint256)` | view | who claimed a token; its card is drawn from this |
| `tokenURI(uint256)` | view | revealed metadata, or the on-chain placeholder |
| `imageURI(uint256)` | view | the placeholder artwork, claim number composited in |
| `rawImage()` | view | the raw stored artwork bytes |
| `revealedCount()`, `baseURI()`, `metadataFrozen()` | view | reveal state |
| `setMerkleRoot(bytes32)` | owner | rotate the allowlist |
| `setClaimOpen(bool)` | owner | open or pause claiming; never reopens once frozen |
| `setAllowlistEnabled(bool)` | owner | require a proof, or let anyone claim |
| `setBaseURI(string, uint256 count)` | owner | reveal tokens `1..count`, or `("", 0)` to undo |
| `freezeMetadata()` | owner | make the reveal permanent and end claiming |

Events: `Claimed(address indexed account, uint256 indexed tokenId)`,
`MerkleRootUpdated`, `ClaimOpenUpdated`, `AllowlistEnabledUpdated`,
`BaseURIUpdated(string, uint256)`, `MetadataFrozen(string)`, and ERC-4906's
`BatchMetadataUpdate`, which tells marketplaces to refresh.

Errors: `ClaimClosed`, `AlreadyClaimed`, `InvalidProof`, `MerkleRootNotSet`,
`UnsupportedChain`, `InvalidReveal`, `RevealIncomplete`, `MetadataIsFrozen`.

The constructor refuses to deploy anywhere except Sepolia (11155111) or a local node
(31337). Scripts and config files can be edited or bypassed with a direct `forge create`;
that check cannot, and deployment is the only moment it can be enforced for good.

Tokens are ordinary transferable ERC-721s. A non-transferable badge would be a different
contract with different semantics, not a flag on this one.

## What `tokenURI` returns

Before its reveal:

```
tokenURI(1)
  -> data:application/json;base64,...
       {
         "name": "CPSC 3640/5400 - Fall 2026 #1",
         "description": "Decentralized Payments, Contracts, and Finance for Humans and AI...",
         "attributes": [ Course, Semester, Type, Network, Claim Number ],
         "image": "data:image/svg+xml;base64,..."     <- SVG wrapping the stored
                                                         WebP plus this token's
                                                         claim number
       }
```

After it:

```
tokenURI(1)
  -> ipfs://<METADATA_CID>/1.json
       {
         "name": "CPSC 3640 / CPSC 5400 Course NFT #0001",
         "image": "ipfs://<IMAGE_CID>/1.png",
         "attributes": [ Base Template, Background, Border, Halo, Badge, ... ]
       }
```

Decode one yourself:

```bash
cast call "$CONTRACT_ADDRESS" "tokenURI(uint256)(string)" 1 --rpc-url "$SEPOLIA_RPC_URL" \
  | sed 's/^"//; s/"$//; s|^data:application/json;base64,||' | base64 -d | jq .
```
