import {describe, expect, it} from "vitest";
import {imagesBase, metadataBase} from "../scripts/locations";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("upload locations", () => {
  it("reads ipfs:// locations through the gateway, however the gateway is written", () => {
    for (const gateway of ["https://ipfs.io", "https://ipfs.io/", "https://ipfs.io//"]) {
      expect(metadataBase(`ipfs://${CID}/`, gateway)).toBe(`https://ipfs.io/ipfs/${CID}/`);
      expect(imagesBase(CID, gateway)).toBe(`https://ipfs.io/ipfs/${CID}/`);
    }
  });

  it("reads http(s) locations as they are", () => {
    expect(metadataBase("https://example.org/cards/", "https://ipfs.io")).toBe("https://example.org/cards/");
    expect(metadataBase("http://127.0.0.1:8000/metadata/", "https://ipfs.io")).toBe("http://127.0.0.1:8000/metadata/");
  });

  it("refuses anything a contract should not point at", () => {
    for (const uri of [`ipfs://${CID}`, "https://example.org/cards", "ftp://example.org/", "", `ipfs://${CID}/sub/`, "https://exa mple.org/"]) {
      expect(() => metadataBase(uri, "https://ipfs.io"), uri).toThrow();
    }
  });
});
