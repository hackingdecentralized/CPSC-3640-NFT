import {describe, expect, it} from "vitest";
import {
  ATTRIBUTES,
  DESCRIPTION,
  EXTERNAL_URL,
  PENDING_CID,
  buildMetadata,
  microIconsValue,
  traitsFromMetadata
} from "../src/metadata";
import {planTraits} from "../src/traits";
import {config, seeds} from "./helpers";

describe("metadata", () => {
  it("attributes match the selected traits exactly, for every token", () => {
    seeds(2000).forEach((seed, i) => {
      const {traits} = planTraits(config, seed);
      const metadata = buildMetadata(String(i + 1), traits);
      expect(traitsFromMetadata(metadata)).toEqual(traits);
    });
  });

  it("uses fixed trait names in a fixed order", () => {
    const {traits} = planTraits(config, seeds(1)[0]!);
    expect(buildMetadata("1", traits).attributes.map((a) => a.trait_type)).toEqual([
      "Base Template",
      "Background",
      "Border",
      "Halo",
      "Badge",
      "Human Icon",
      "Contract Icon",
      "AI Icon",
      "Micro Icons",
      "Easter Egg"
    ]);
    expect(ATTRIBUTES).toHaveLength(10);
  });

  it("has the standard fields", () => {
    const {traits} = planTraits(config, seeds(1)[0]!);
    const metadata = buildMetadata("123", traits);
    expect(metadata.name).toBe("CPSC 3640 / CPSC 5400 Course NFT #0123");
    expect(metadata.description).toBe(DESCRIPTION);
    expect(metadata.external_url).toBe(EXTERNAL_URL);
    expect(metadata.image).toBe(`ipfs://${PENDING_CID}/123.png`);
    expect(buildMetadata("123", traits, "bafyexample").image).toBe("ipfs://bafyexample/123.png");
  });

  it("pads short token ids in the name but not in file names", () => {
    const {traits} = planTraits(config, seeds(1)[0]!);
    expect(buildMetadata("7", traits).name).toMatch(/#0007$/);
    expect(buildMetadata("12345", traits).name).toMatch(/#12345$/);
    expect(buildMetadata("7", traits).image).toMatch(/\/7\.png$/);
  });

  it("writes micro icons canonically", () => {
    expect(microIconsValue([])).toBe("none");
    expect(microIconsValue(["node", "book"])).toBe("book+node");
    expect(microIconsValue(["book", "node"])).toBe("book+node");
  });

  it("every value is a string", () => {
    for (const seed of seeds(200)) {
      const metadata = buildMetadata("1", planTraits(config, seed).traits);
      for (const attribute of metadata.attributes) expect(typeof attribute.value).toBe("string");
    }
  });
});
