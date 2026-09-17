/**
 * One token's card, from the three inputs that decide it (spec section 5).
 *
 * The claim page and the generator both call this, so a student's page shows the
 * traits their token is later generated with.
 */
import {deriveSeed, type TokenIdInput} from "./seed";
import {planTraits, type ForcedTraits, type Plan} from "./traits";
import type {GeneratorConfig} from "./types";

export function planToken(
  config: GeneratorConfig,
  tokenId: TokenIdInput,
  walletAddress: string,
  salt: string,
  forced?: ForcedTraits
): Plan {
  return planTraits(config, deriveSeed(tokenId, walletAddress, salt), forced);
}
