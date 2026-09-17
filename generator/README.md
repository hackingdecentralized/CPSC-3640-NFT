# Course NFT generator

Deterministic image and metadata generation for the CPSC 3640 / CPSC 5400 Fall 2026
course NFT. Six base templates, layered traits, and one rule above all others:

> Randomness changes details, not identity. Every token must still read as the
> CPSC 3640 / CPSC 5400 Fall 2026 course NFT.

The claim page runs this package's trait code in the browser, so a student sees the card
their token will be generated with the moment they claim. Rendering needs no IPFS
account; only publishing the finished collection does.

## Quick start

```bash
cd generator
npm ci
npm run prepare-assets     # build the 1024px bases and masks (about 5 s)
npm test                   # the test suite, including pixel checks on real renders
npm run preview -- --count 20
open output/preview/index.html
```

## How a token is made

```
tokenId, claimer address, collection salt
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

The live collection's salt is **public**, in `config/collection.json`. That is a
deliberate trade, and the spec allows it provided it is written down (section 27):

- **What it buys.** The claim page draws each student's card in their own browser the
  moment they claim, with no server and no waiting for a reveal. A browser can only do
  that if it knows the salt.
- **What it costs.** Anyone can compute the card for any token id and address. Token
  ids are handed out by the contract in claim order, so a student can look up what
  claiming as number N would give them and try to time their claim, or, with the
  allowlist off, try several wallets. Rarity is fair to people who just claim; it is
  not proof against someone determined to game it.

If unpredictable rarity matters more than the instant card, switch to a secret salt:
keep it out of the repository, generate after claiming closes, and give up drawing
cards on the page. `--salt` on `npm run generate` exists for experiments like that.

Previews and rarity simulations use a separate salt, `cpsc3640-public-preview-salt`,
because they are samples and not the collection.

A card is drawn from the address that **claimed** the token, not whoever holds it
today. The contract records it as `claimerOf(tokenId)`; tokens are transferable, and a
card should not change when it changes hands.

**Once claiming opens, freeze `config/` and `assets/`.** Students have already been shown
cards drawn from them. Changing a weight, a rule, the layout, a template or the salt
changes what those students would be sent. The collection fingerprint (below) exists to
catch exactly that.

## Configuration

Everything that decides an outcome lives in `config/`, not in code. Generation refuses
to run against an invalid configuration and lists every problem at once.

| File | Holds |
| --- | --- |
| `base-templates.json` | the six templates, their weights, and a SHA-256 of each supplied file |
| `traits.json` | every trait group and its weights; each group sums to 100 |
| `compatibility.json` | per-template preferred and avoided values |
| `layout.json` | every coordinate: border, protected text, slots, halo centre |
| `collection.json` | the live collection's public salt |

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
| `npm run generate -- --token-id 123 --wallet 0x...` | one token, with the collection salt; add `--badge staff`, `--base bulldog_special`, `--cid`, `--out`, `--salt` |
| `npm run preview -- --count 20` | `output/preview/index.html` |
| `npm run rarity -- --count 10000` | `output/rarity-report.{json,md}`, no rendering |
| `npm run export-web` | the card layers the claim page draws with, into `../web/public/nft/` |
| `npm run collection -- --network sepolia` | every claimed token, read from the contract, into `output/collection/sepolia/` |
| `npm run set-image-cid -- --dir <dir> --cid <CID>` | point metadata at uploaded images |
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

## The claim page

`web/` imports the modules in `src/` that are marked browser-safe (a test keeps them
free of Node built-ins) along with `config/` itself. It picks traits with `planToken`
and stacks layers with `layerStack`, the same functions the generator uses, so the
traits a student sees are the traits their token gets.

Pixels come from `npm run export-web`: every layer raster the renderer can use, written
as lossless WebP, about 7 MB in all and roughly 1 MB for any one card. The page stacks
them on a canvas. Compositing uses the standard W3C formulas on both sides:
`src/composite.ts` in Node, the canvas's own `source-over` and `screen` in the browser.
Background and halo rasters carry their alpha squared, which keeps their glow soft at
the mask's edge.

Measured on a real claim: the page's card matched the generated PNG to within 2 levels
out of 255 on every channel, with 93% of values identical. The downloaded image and
the revealed one look the same. They are not byte-identical files.

The page's footer shows a **collection fingerprint**: a digest of the salt, weights,
rules, layout and template hashes. `npm run collection -- --expect <fingerprint>`
refuses to generate if this checkout disagrees with the page students used.

`web/public/nft/` is derived and not committed. `scripts/publish-pages.sh` rebuilds it
before every publish.

## Revealing the collection

The contract serves an on-chain placeholder until the owner points it at uploaded
metadata. `setBaseURI(uri, count)` reveals tokens `1..count`. Anything claimed after the
collection was generated keeps the placeholder until the next reveal, so a reveal never
points a token at a file that does not exist.

```bash
cd generator
npm run collection -- --network sepolia --expect <fingerprint from the page>
# upload output/collection/sepolia/images as one directory to any IPFS pinning service
npm run set-image-cid -- --dir output/collection/sepolia --cid <IMAGE_CID>
# upload output/collection/sepolia/metadata as one directory
cd ..
scripts/reveal.sh sepolia publish <METADATA_CID>
```

`publish` downloads the last token's metadata and image back through a gateway and
refuses to continue unless both match what was generated. Set `IPFS_GATEWAY` to your
pinning service's gateway if the public one is slow to see a new upload.

You can reveal as often as you like while claiming is open; each run covers everyone who
has claimed so far. To finish:

```bash
scripts/reveal.sh sepolia close      # no more claims
# generate, upload and publish once more, as above
scripts/reveal.sh sepolia freeze     # permanent; claiming can never reopen
```

`freeze` requires every token to be revealed, and it ends claiming for good: an IPFS
directory cannot gain files, so a token minted afterwards could never get its card.
`scripts/reveal.sh sepolia status` shows where things stand.

No IPFS provider is assumed. Pinned content stays available only while someone keeps
paying for the pin. The first Sepolia deployment predates all of this and can never
show generated cards; revealing needs the current contract.

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
