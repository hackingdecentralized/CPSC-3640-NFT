/** Compress the six source cards once; deployment uses these committed bytes. */
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const designs = ["harkness_tower", "elm_tree", "sterling_memorial_library", "beinecke_library", "yale_shield", "handsome_dan"];
const dir = `${root}nft/cards`;
await mkdir(dir, {recursive: true});
const entries = [];
for (const [index, design] of designs.entries()) {
  const source = await readFile(`${root}generator/assets/source/${design}.png`);
  const image = await sharp(source).resize(512, 512).jpeg({quality: 60, mozjpeg: true}).toBuffer();
  if (image.length > 24_575) throw new Error(`${design} exceeds the artwork contract budget`);
  await writeFile(`${dir}/${index}.jpg`, image);
  entries.push({index, design, bytes: image.length, sha256: createHash("sha256").update(image).digest("hex")});
  console.log(`${index}: ${design}: ${image.length} bytes`);
}
await writeFile(`${dir}/manifest.json`, JSON.stringify({size: 512, quality: 60, cards: entries}, null, 2) + "\n");
