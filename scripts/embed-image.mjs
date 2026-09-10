#!/usr/bin/env node
/**
 * Generate contracts/CourseArtwork.sol from nft/course-nft-onchain.webp.
 *
 * The artwork lives in the contract's bytecode, so the contract needs a literal
 * copy of the image bytes. This script is the only thing allowed to write that
 * copy. It lives in its own Solidity file purely so CPSC3640NFT.sol stays short
 * enough to read in class; the library is `internal`, so it compiles into the
 * same single deployed contract.
 *
 * Pipeline when the artwork changes:
 *   python3 scripts/make-onchain-image.py   # master -> 512px WebP
 *   npm run embed:image                     # WebP    -> Solidity
 *   forge test                              # verifies the two still match
 */
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = join(ROOT, "nft", "course-nft-onchain.webp");
const OUT = join(ROOT, "contracts", "CourseArtwork.sol");

// EIP-170 caps runtime bytecode at 24,576 bytes and the contract logic needs
// roughly 6.9 KB of that. Fail loudly here rather than at deployment.
const BUDGET = 17_000;

const bytes = readFileSync(IMAGE);

if (bytes.length > BUDGET) {
  throw new Error(
    `${bytes.length.toLocaleString()} bytes of artwork exceeds the ${BUDGET.toLocaleString()} ` +
      `byte budget. Re-run scripts/make-onchain-image.py with a lower size or quality.`
  );
}
if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
  throw new Error(`${IMAGE} is not a WebP file`);
}

// Adjacent hex literals concatenate at compile time, so the bytes can be laid
// out in readable rows instead of one enormous line.
const PER_ROW = 32;
const rows = [];
for (let i = 0; i < bytes.length; i += PER_ROW) {
  rows.push(`        hex"${bytes.subarray(i, i + PER_ROW).toString("hex")}"`);
}

const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CPSC 3640/5400 course artwork
/// @notice The course NFT's image, stored in contract bytecode.
/// @dev GENERATED FILE - DO NOT EDIT BY HAND.
///
///      Produced by \`npm run embed:image\` from \`nft/course-nft-onchain.webp\`,
///      which \`scripts/make-onchain-image.py\` derives from the master artwork in
///      \`nft/course-nft.svg\`.
///
///      ${bytes.length.toLocaleString()} bytes of WebP, 512x512.
///
///      This sits in its own file so CPSC3640NFT.sol stays readable. The function
///      is \`internal\`, so it is inlined and there is still only one deployed
///      contract. \`test_EmbeddedImageMatchesSourceFile\` re-reads the .webp at test
///      time and fails if this file has drifted from it.
library CourseArtwork {
    /// @return The raw WebP bytes of the course artwork.
    function image() internal pure returns (bytes memory) {
        return
${rows.join("\n")};
    }
}
`;

writeFileSync(OUT, source);
console.log(
  `Embedded ${bytes.length.toLocaleString()} bytes of WebP (${rows.length} rows) ` +
    `into contracts/CourseArtwork.sol`
);
