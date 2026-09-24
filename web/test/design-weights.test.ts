import {strict as assert} from "node:assert";
import {test} from "node:test";
import {readDesignWeights} from "../../scripts/design-weights.mjs";
import {slideshowHtml} from "../src/slideshow.ts";

const address = "0x1111111111111111111111111111111111111111";
const weights = [19, 19, 19, 19, 19, 5];
const designs = ["Tower", "Elm", "Sterling", "Beinecke", "Shield", "Handsome Dan"]
  .map(label => ({label, sample: "card.jpg"}));
const log = {
  address,
  topics: ["0xca317ff94fb603d49f315c83fb7c6cd4229a9ef477d952063f4c2bea71302edd"],
  data: "0x" + weights.map(w => w.toString(16).padStart(64, "0")).join("")
};

test("deployment weights reach each card's initial and scrolling captions", () => {
  const recorded = readDesignWeights({receipts: [{status: "0x1", contractAddress: address, logs: [log]}]}, address);
  assert.deepEqual(recorded, weights);
  const html = slideshowHtml(designs, value => value, recorded);
  assert.equal((html.match(/data-chance="19% chance"/g) ?? []).length, 5);
  assert.match(html, /data-label="Handsome Dan" data-chance="5% chance"/);
  assert.match(html, /<strong>Tower<\/strong> <span>19% chance<\/span>/);
  assert.doesNotMatch(html, /Equal chance/);
});

test("old and unrelated deployment logs cannot acquire new odds", () => {
  for (const receipts of [[], [{status: "0x1", contractAddress: address, logs: []}],
    [{status: "0x0", contractAddress: address, logs: [log]}],
    [{status: "0x1", contractAddress: address, logs: [{...log, address: "0x2222"}]}]]) {
    const recorded = readDesignWeights({receipts}, address);
    assert.equal(recorded, null);
    assert.match(slideshowHtml(designs, value => value, recorded), /Equal chance/);
    assert.doesNotMatch(slideshowHtml(designs, value => value, recorded), /5% chance/);
  }
});

test("rejects malformed weights instead of saving incorrect odds", () => {
  for (const data of ["0x", "0x" + "0".repeat(384)]) {
    assert.throws(() => readDesignWeights({receipts: [{status: "0x1", contractAddress: address, logs: [{...log, data}]}]}, address));
  }
});
