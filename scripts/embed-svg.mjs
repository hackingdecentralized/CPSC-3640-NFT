#!/usr/bin/env node
/**
 * Embed `nft/course-nft.svg` into `contracts/CPSC3640NFT.sol`.
 *
 * The artwork lives on-chain, so the contract carries a copy of the SVG source.
 * This script is the only thing allowed to write that copy: edit the .svg file,
 * run `npm run embed:svg`, and the two stay byte-for-byte identical.
 *
 * `test/CPSC3640NFT.t.sol` re-reads the .svg at test time and fails if they drift,
 * so forgetting to run this is caught by `forge test`, not discovered after deploy.
 */
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "nft", "course-nft.svg");
const solPath = join(root, "contracts", "CPSC3640NFT.sol");

const BEGIN = "        // >>> BEGIN GENERATED SVG -- do not edit by hand";
const END = "        // <<< END GENERATED SVG";

// Drop exactly one trailing newline: the file ends with one, the Solidity constant does not.
const svg = readFileSync(svgPath, "utf8").replace(/\n$/, "");

if (svg.includes('"')) {
  throw new Error(
    "course-nft.svg contains a double quote. Attributes must use single quotes so the SVG " +
      "can be embedded in a Solidity string literal without escaping."
  );
}
if (svg.includes("\\")) {
  throw new Error("course-nft.svg contains a backslash, which Solidity would treat as an escape.");
}

// One Solidity string literal per SVG line. Adjacent literals concatenate at compile time.
const lines = svg.split("\n");
const literals = lines
  .map((line, i) => `        "${line}${i === lines.length - 1 ? "" : "\\n"}"`)
  .join("\n");

const sol = readFileSync(solPath, "utf8");
const beginAt = sol.indexOf(BEGIN);
const endAt = sol.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  throw new Error(`Could not find the generated-SVG markers in ${solPath}`);
}

const updated =
  sol.slice(0, beginAt) + BEGIN + "\n" + literals + ";\n" + sol.slice(endAt);
writeFileSync(solPath, updated);

console.log(
  `Embedded ${svg.length} bytes of SVG (${lines.length} lines) into contracts/CPSC3640NFT.sol`
);
