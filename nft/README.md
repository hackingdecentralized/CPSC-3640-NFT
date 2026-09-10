# Course NFT artwork

Two files, and the difference between them matters.

| File | What it is |
| --- | --- |
| `course-nft.svg` | the master, 1254x1254, about 1.7 MB |
| `course-nft-onchain.webp` | the derived 512x512 copy actually stored in the contract |

## Why there are two

The whole point of this project is that the artwork lives in the contract, so a
minted token stays valid with no IPFS pin and no web server. That puts the artwork
under a hard ceiling: EIP-170 caps a contract's runtime bytecode at 24,576 bytes,
and the contract logic already needs about 6.9 KB. The artwork gets roughly 17 KB.

The master is about 1.7 MB, which is 73 times over that budget. Despite the `.svg`
extension it is not vector art: it is a single 1254x1254 raster wrapped in an
`<image>` element. So it cannot be shrunk by simplifying paths, only by
re-encoding.

Downscaling to 512x512 and encoding as WebP gets it to 14,292 bytes, which fits
with about 3.4 KB of contract headroom to spare. At that size every line of course
text is still legible.

## Regenerating

Only needed when the master changes.

```bash
pip install pillow
python3 scripts/make-onchain-image.py   # master -> course-nft-onchain.webp
npm run embed:image                     # webp   -> contracts/CourseArtwork.sol
forge test                              # proves the two still match
```

`scripts/make-onchain-image.py` refuses to write a file over the 17 KB budget, and
`npm run embed:image` refuses to embed one, so an oversized artwork fails at your
desk rather than at deployment. `test_EmbeddedImageMatchesSourceFile` re-reads the
`.webp` at test time and fails if the Solidity copy has drifted from it, so
forgetting to re-embed is caught by `forge test`.

To trade resolution against quality, edit `SIZE` and `QUALITY` in
`scripts/make-onchain-image.py`. For reference, at quality 65: 384px is about
9.7 KB, 512px about 14.3 KB, and 576px runs over budget.

## Per-token claim numbers

The stored artwork is one fixed image, but every token's image is different.
`imageURI(tokenId)` wraps the stored WebP in an SVG at read time and draws that
token's claim number on it, so token 3 shows "No. 3". Token ids are assigned in
`claim` order, so the number on the picture is literally where that student came
in the queue.

Nothing extra is stored per token. One image in bytecode, N distinct images out.
Adding a student costs nothing, and the badge needs no upload, no pre-rendering
and no roster known in advance. The number is also exposed as a sortable
`Claim Number` attribute in the metadata.

Costs about 5.1 million gas to read, which is free: `tokenURI` is a view function
and this is well inside what public RPCs allow for `eth_call`.

## What is in the picture

A bulldog in a Yale bandana over the course's organising idea:

```
HUMAN  <->  BLOCKCHAIN / CONTRACT  <->  AI
```

with the course number, title, and term.

## Two things to know

**It is a raster, not vector.** The previous artwork was hand-drawn SVG and stayed
crisp at any size. This one is fixed at 512x512 on-chain and will soften on a large
display. That is the cost of using this illustration.

**The bandana carries a Yale "Y".** The Yale seal does not appear and the metadata
says plainly that this is a course collectible and not an academic credential, but
the "Y" is a university trademark. Using it is a call for the course staff, not a
technical question. Replace the master and regenerate if you would rather not.
