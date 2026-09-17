import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {Rng} from "../src/random";
import {sha256Hex} from "../src/sha256";

const reference = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("sha256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("agrees with Node's OpenSSL at every length across several block boundaries", () => {
    for (let length = 0; length <= 300; length++) {
      const text = "x".repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(reference(text));
    }
  });

  it("agrees with Node on varied and non-ASCII input", () => {
    const rng = Rng.fromSeed("00112233445566778899aabbccddeeff");
    // Built from code points so this file stays plain ASCII.
    const alphabet = [
      ..."abcXYZ019:_- 0x",
      String.fromCodePoint(0xe9),
      String.fromCodePoint(0x6f22),
      String.fromCodePoint(0x1f642),
      String.fromCodePoint(0)
    ];
    for (let i = 0; i < 2000; i++) {
      const length = rng.below(160);
      const text = Array.from({length}, () => alphabet[rng.below(alphabet.length)]).join("");
      expect(sha256Hex(text)).toBe(reference(text));
    }
  });

  it("handles a long multi-block message", () => {
    const text = "cpsc3640:".repeat(10_000);
    expect(sha256Hex(text)).toBe(reference(text));
  });
});
