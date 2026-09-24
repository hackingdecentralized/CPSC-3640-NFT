# On-chain course cards

`cards/0.jpg` through `cards/5.jpg` are the exact image bytes deployed once as six
immutable `CourseArtwork` contracts. `cards/manifest.json` records the order, names,
size and SHA-256 digest of each image. The renderer uses that same order:

0. Harkness Tower — 19%
1. Elm Tree — 19%
2. Sterling Memorial Library — 19%
3. Beinecke Library — 19%
4. Yale Shield — 19%
5. Handsome Dan — 5%

Each base is 512×512, JPEG quality 60, and under 24,575 bytes (one byte is reserved for
STOP). Compression reduces detail compared with the originals. `CourseRenderer`
embeds the selected bytes in an SVG and adds a colored frame, symbol, optional ring
and claim number. The SVG and metadata are returned as self-contained Base64 data
URIs. No image is uploaded after a claim.

Regenerate before a new deployment:

```bash
npm --prefix generator ci
npm run image
forge test
```

The script uses `generator/assets/source/`, never the already-compressed JPEGs.
Contract tests read all six files and compare both their hashes and the deployed
bytes. Existing deployed cards cannot be changed by regenerating these files.

`course-nft.svg` and `course-nft-onchain.webp` are retained for the previous deployment.
The frontend uses the older preview only when configured with an old deployment
record. They are no longer embedded in new NFT contracts.
