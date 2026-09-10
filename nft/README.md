# Course NFT artwork

`course-nft.svg` is the artwork, and it is also the artwork the contract stores. The
same bytes are compiled into `CPSC3640NFT`, so a minted token renders correctly with
no web server, no IPFS pin, and no dependence on this repository continuing to exist.

## Design

A 1024x1024 square. An original geometric drawing of a bulldog on a charcoal ground,
wearing a collar built from linked blocks, over the course's organising idea:

```
HUMAN  <->  BLOCKCHAIN / CONTRACT  <->  AI
```

The bulldog nods to Handsome Dan. It is drawn from scratch as flat vector shapes; no
existing illustration was traced or copied, and the Yale seal does not appear. The
metadata says plainly that this is a course collectible and not an academic credential.

## Editing it

Two constraints, both enforced automatically:

1. **Single quotes only.** Attributes use `'`, never `"`, so the whole file drops into
   a Solidity string literal without escaping. `npm run embed:svg` refuses to run if a
   double quote appears.
2. **No backslashes.** Solidity would read them as escapes. Also refused.

After any edit:

```bash
npm run embed:svg   # copy the SVG into contracts/CPSC3640NFT.sol
forge test          # test_EmbeddedSvgMatchesSourceFile checks they match
```

`test_EmbeddedSvgMatchesSourceFile` reads this file at test time and compares it to
what the contract returns from `rawSVG()`. Editing the SVG and forgetting to re-embed
fails the suite rather than shipping a contract whose artwork is a version behind.

## Size

The SVG is roughly 6.7 KB, and the deployed contract is about 13.5 KB against the
24,576-byte EIP-170 limit. `forge build --sizes` prints the current number, and
`test_BytecodeFitsContractSizeLimit` fails the suite if artwork growth ever threatens
the limit. Adding detail is fine; adding several kilobytes of it is not.
