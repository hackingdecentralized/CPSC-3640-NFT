/** Decode the contract's complete metadata without fetching any external URL. */
export interface TokenMetadata {
  name: string;
  image: string;
  traits: {label: string; value: string}[];
}

export function decodeMetadata(uri: string): TokenMetadata {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    throw new Error("This deployment uses external metadata. The on-chain card version needs a new deployment.");
  }
  const data: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.slice(prefix.length)), c => c.charCodeAt(0))));
  if (!data || typeof data !== "object") throw new Error("Invalid NFT metadata");
  const metadata = data as Record<string, unknown>;
  if (typeof metadata.image !== "string" || !/^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(metadata.image)) {
    throw new Error("NFT metadata does not contain an embedded image");
  }
  const traits = Array.isArray(metadata.attributes) ? metadata.attributes.flatMap((attribute: unknown) => {
    if (!attribute || typeof attribute !== "object") return [];
    const {trait_type, value} = attribute as Record<string, unknown>;
    return typeof trait_type === "string" && (typeof value === "string" || typeof value === "number")
      ? [{label: trait_type, value: String(value)}] : [];
  }) : [];
  return {name: typeof metadata.name === "string" ? metadata.name : "Course NFT", image: metadata.image, traits};
}
