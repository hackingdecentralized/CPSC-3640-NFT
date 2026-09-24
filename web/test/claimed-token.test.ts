import {strict as assert} from "node:assert";
import {test} from "node:test";
import {findOriginalClaim} from "../src/claimed-token.ts";

test("finds an older claim from current state in bounded batches", async () => {
  const requested: bigint[] = [];
  let pending = 0;
  let maximum = 0;
  const result = await findOriginalClaim("0xABc", 31n, async tokenId => {
    requested.push(tokenId);
    maximum = Math.max(maximum, ++pending);
    await new Promise(resolve => setImmediate(resolve));
    pending--;
    return tokenId === 2n ? "0xabc" : "0xdef";
  });
  assert.equal(result, 2n);
  assert.equal(maximum, 8);
  assert.equal(new Set(requested).size, 31);
  assert.ok(requested.every(id => id >= 1n && id <= 31n));
});

test("uses the original claimer after transfer and stops after a matching batch", async () => {
  const requested: bigint[] = [];
  // Token #31 has been transferred to 0xnew; claimerOf still returns 0xoriginal.
  const readClaimer = async (id: bigint) => {
    requested.push(id);
    return id === 31n ? "0xoriginal" : "0xother";
  };
  assert.equal(await findOriginalClaim("0xoriginal", 31n, readClaimer), 31n);
  assert.equal(requested.length, 8);
  assert.equal(await findOriginalClaim("0xnew", 31n, readClaimer), null);
});

test("empty supply makes no RPC calls and missing claims return null", async () => {
  assert.equal(await findOriginalClaim("0xa", 0n, async () => { throw new Error("unexpected read"); }), null);
  assert.equal(await findOriginalClaim("0xa", 3n, async () => "0xb"), null);
});

test("a transient read failure is retryable instead of being treated as no claim", async () => {
  await assert.rejects(findOriginalClaim("0xa", 3n, async () => { throw new Error("RPC unavailable"); }), /RPC unavailable/);
  assert.equal(await findOriginalClaim("0xa", 3n, async id => id === 1n ? "0xa" : "0xb"), 1n);
});
