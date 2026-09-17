# Course NFT generator

Deterministic image and metadata generation for the CPSC 3640 / CPSC 5400 Fall 2026
course NFT. Six base templates, layered traits, and one rule above all others:

> Randomness changes details, not identity. Every token must still read as the
> CPSC 3640 / CPSC 5400 Fall 2026 course NFT.

This package stands alone. It does not touch the contract or the claim website, and
needs no IPFS account to render.

## Quick start

```bash
cd generator
npm ci
npm run prepare-assets     # build the 1024px bases and masks (about 5 s)
npm test                   # 70 tests, including pixel checks on real renders
npm run preview -- --count 20
open output/preview/index.html
```

## How a token is made

```
tokenId, walletAddress, salt
        |
        v  seed = SHA256(tokenId ":" lowercase(wallet) ":" salt)
        |
        v  base template        19 / 19 / 19 / 19 / 19 / 5
        v  traits               each from its own stream, filtered by template rules
        |
        v  base + background + border + halo + micro icons + role icons + badge + egg
        |
        v  output/images/<id>.png        1024 x 1024 RGB
           output/metadata/<id>.json     ERC-721 metadata
```

The same three inputs always give the same traits and a byte-identical PNG, as long as
the pinned `sharp` version is the same. On another version expect visually identical
output rather than identical bytes.

### Randomness

The PRNG is **xoshiro128\*\*** (Blackman and Vigna), in `src/random.ts`. It is 30 lines,
matches the published reference output (tested), and behaves identically on every
JavaScript engine. `Math.random()` is never called; a test fails if it is.

Each trait draws from its own stream, `SHA256(seed ":" traitName)`. That has two useful
consequences. Forcing one trait never changes any other trait of the same token. And
retuning one group's weights never reshuffles an existing token's other traits.

Weights are percentages with at most two decimals and are handled as integers, so
"sums to 100" is an exact check with no floating-point tolerance. Values are drawn in
alphabetical order, so reordering keys in a JSON file never changes an outcome.

### The salt

The salt decides whether a student can know their result before minting.

- **Previews and simulations** use the public salt `cpsc3640-public-preview-salt`.
  Those are not real tokens.
- **Real tokens need a secret salt**, kept in `generator/.env` as `NFT_SALT` and never
  in the repository or the website. With a public salt, anyone could compute the
  traits for the next token id from any wallet address, and grind throwaway wallets
  until one lands on `bulldog_special`.

Because the salt is secret, generation has to happen off the website: run it here, or
in a controlled CI job, after tokens are claimed. If you later want the public to be
able to verify the draw, publish `SHA256(salt)` now as a commitment and reveal the
salt once claiming closes.

Use the address that **claimed** the token, from the contract's `Claimed` event, not
whoever holds it today. Tokens are transferable, and a token's image should not change
when it changes hands.

## Configuration

Everything that decides an outcome lives in `config/`, not in code. Generation refuses
to run against an invalid configuration and lists every problem at once.

| File | Holds |
| --- | --- |
| `base-templates.json` | the six templates, their weights, and a SHA-256 of each supplied file |
| `traits.json` | every trait group and its weights; each group sums to 100 |
| `compatibility.json` | per-template preferred and avoided values |
| `layout.json` | every coordinate: border, protected text, slots, halo centre |

### Template rules

Your spec describes these in prose. They are applied like this:

- **avoid**: that value is invalid on that template. If drawn, only that trait is
  redrawn, with the value removed. The resulting distribution is exactly the
  configured weights restricted to the allowed values.
- **preferred**: that value's weight is multiplied by `preferredMultiplier` (2) on that
  template.
- A named value that exists in more than one group, such as `chain` or `chip`, is
  preferred in every group that has it.
- Phrases that name no existing trait, such as "stone motifs", are recorded under
  `notApplicable` rather than guessed at.

Four phrases needed a judgement call, recorded under `$mappings`. The least obvious:
"aggressive mascot effects" on the bulldog maps to the `rare_blue_flame` easter egg.

Values that draw no layer: `border_style: gold_cyan_standard` (the template's own
border), `halo: none`, `badge: standard`, `easter_egg: none`.

## Protecting the course text

The header, subtitle, HUMAN / BLOCKCHAIN CONTRACT / AI row and footer are protected
regions in `layout.json`. Three things keep them intact:

1. Configuration validation fails if any slot overlaps a protected region, leaves the
   border, or overlaps another slot.
2. Backgrounds and halos are clipped by a per-template mask that is exactly zero over
   protected text, zero over the illustration itself, and fades out well before the
   text so glows never outline a text box.
3. `tests/render.test.ts` renders every template with its busiest possible trait set
   and requires every pixel inside every protected region to be byte-identical to the
   base template.

## Commands

| Command | Does |
| --- | --- |
| `npm run prepare-assets` | resize templates to the output size and build masks; add `--force` to rebuild, `--debug` for mask images |
| `npm run build-overlays` | regenerate every overlay SVG from `scripts/build-overlays.ts` |
| `npm run validate-assets` | check sources are unchanged, prepared assets are current, masks protect the text, and every overlay exists at the right size |
| `npm run asset-sheet` | `output/asset-sheet/index.html`: regions, masks, showcase renders, every overlay |
| `npm run generate -- --token-id 123 --wallet 0x...` | one token; add `--badge staff`, `--base bulldog_special`, `--cid`, `--out` |
| `npm run preview -- --count 20` | `output/preview/index.html` |
| `npm run rarity -- --count 10000` | `output/rarity-report.{json,md}`, no rendering |
| `npm run set-image-cid -- --cid <CID>` | point metadata at uploaded images |
| `npm test` | the test suite |

### Reserved badges

`staff` and `ta_edition` stay in the random pool at 3% each, as specified. To issue one
deliberately:

```bash
npm run generate -- --token-id 7 --wallet 0x... --badge ta_edition
```

A forced value that the chosen template does not allow is an error, not something
quietly repaired.

`genesis` and `early_minter` are random at 10% each, as specified. They are not tied
to claim order. If you want them to mean "among the first N", that is a small change
and a different spec.

## Rarity report

`npm run rarity` simulates the draw for 10,000 tokens in well under a second and
compares each value against its exact expected rate, with template rules and
sampling without replacement already accounted for. Any value more than four standard
errors from expectation is flagged and the command exits non-zero, because at that
distance the cause is a bug rather than luck.

## Publishing to IPFS

```
npm run generate ...           # for every claimed token
upload output/images/          # to any IPFS pinning service
npm run set-image-cid -- --cid <IMAGE_CID>
upload output/metadata/        # gives a metadata CID
```

Metadata starts with `ipfs://IMAGE_CID_PENDING/<id>.png`. `set-image-cid` rewrites it
and can be re-run. No provider is assumed.

**The deployed contract cannot show these images yet.** Its `tokenURI` returns the one
image embedded in its own bytecode. Serving generated art needs a contract whose
`tokenURI` returns `ipfs://<METADATA_CID>/<id>.json`, and that means a new deployment.
Remember that pinned content only stays available while someone keeps paying for the
pin.

## Assets

| Path | What | In git |
| --- | --- | --- |
| `assets/source/` | the six supplied templates, byte-for-byte | yes |
| `assets/overlays/` | 47 SVG overlays, generated by `build-overlays` | yes |
| `assets/base/`, `assets/masks/` | derived by `prepare-assets` | no |
| `output/` | everything generated | no |

Five templates are exactly the files supplied. `bulldog_special` is the bulldog card
already used by this project, extracted unchanged from `nft/course-nft.svg`.

Badge labels use a small stroke font drawn as paths (`src/strokeFont.ts`), not SVG
text. Text would render with whatever fonts the machine has, and two machines would
produce different images.

## Output size

Tokens are **1024 x 1024 RGB PNGs**, about 1.3 MB each. That departs from the spec's
2048 x 2048 on purpose: the supplied templates are 1254px, so 2048 only invented pixels
and tripled file sizes.

Two sizes are involved, and they are separate settings in `layout.json`:

- `canvas: 2048` is the **design space**. Every coordinate and every overlay SVG is
  written in it, and the matte is tuned in it. It never changes.
- `outputSize: 1024` is what gets **rendered**. Everything is rasterised natively at
  this size. The base is resampled once, straight from the source; the SVGs are
  vector, so nothing is drawn large and shrunk.

Rendering at 2048 and then shrinking was measured and rejected: it differs from a
single resample by up to 83 levels at edges (PSNR 33 dB).

To change the size, edit `outputSize` (any whole number from 64 to 2048) and run
`npm run prepare-assets`; stale assets are detected automatically. Validation re-checks
every slot at the new size, because rounding can close a gap that exists in design
space.
