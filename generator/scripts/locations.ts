/** Where a revealed collection's files are fetched from. */

const trim = (gateway: string): string => gateway.replace(/\/+$/, "");

/** The URL prefix for `<id>.json`, given what the contract is (or will be) pointed at. */
export function metadataBase(uri: string, gateway: string): string {
  const ipfs = /^ipfs:\/\/([^/]+)\/$/.exec(uri);
  if (ipfs) return `${trim(gateway)}/ipfs/${ipfs[1]}/`;
  if (/^https?:\/\/[^\s]+\/$/.test(uri)) return uri;
  throw new Error(`"${uri}" is not an ipfs://<cid>/ or http(s):// location ending in "/"`);
}

/** The URL prefix for `<id>.png`. */
export const imagesBase = (imageCid: string, gateway: string): string => `${trim(gateway)}/ipfs/${imageCid}/`;
