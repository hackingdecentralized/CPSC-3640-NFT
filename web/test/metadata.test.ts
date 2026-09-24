import {strict as assert} from "node:assert";
import {test} from "node:test";
import {decodeMetadata} from "../src/metadata.ts";

const wrap = (data: unknown) => "data:application/json;base64," + Buffer.from(JSON.stringify(data)).toString("base64");
const image = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");

test("uses the exact on-chain image and preserves UTF-8 labels", () => {
  const card = decodeMetadata(wrap({name: "课程 #2", image, attributes: [{trait_type: "Claim Number", value: 2}, {trait_type: "Accent", value: "Cyan"}]}));
  assert.equal(card.image, image);
  assert.equal(card.name, "课程 #2");
  assert.deepEqual(card.traits, [{label: "Claim Number", value: "2"}, {label: "Accent", value: "Cyan"}]);
});
test("rejects metadata needing an external server instead of synthesizing another image", () => {
  assert.throws(() => decodeMetadata("ipfs://old/1.json"), /new deployment/);
  assert.throws(() => decodeMetadata(wrap({image: "https://example.com/card.png"})), /embedded image/);
});
test("rejects missing or malformed metadata and unsafe image attributes", () => {
  for (const data of [null, {}, {image: "javascript:alert(1)"}, {image: image + '\" onerror=\"alert(1)'}]) {
    assert.throws(() => decodeMetadata(wrap(data)));
  }
  assert.throws(() => decodeMetadata("data:application/json;base64,broken!"));
});
test("ignores malformed traits and supplies a default name", () => {
  const card = decodeMetadata(wrap({image, attributes: [null, 3, {trait_type: "bad", value: {}}, {trait_type: "Symbol", value: "Book"}]}));
  assert.equal(card.name, "Course NFT");
  assert.deepEqual(card.traits, [{label: "Symbol", value: "Book"}]);
});
