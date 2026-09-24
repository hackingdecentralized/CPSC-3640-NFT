/** Base-card previews only. Claimed cards always come directly from tokenURI. */
import tower from "../../nft/cards/0.jpg";
import elm from "../../nft/cards/1.jpg";
import sterling from "../../nft/cards/2.jpg";
import beinecke from "../../nft/cards/3.jpg";
import shield from "../../nft/cards/4.jpg";
import dan from "../../nft/cards/5.jpg";
import type {TokenMetadata} from "./metadata";

export interface Design {
  label: string;
  sample: string;
}
export interface Card extends TokenMetadata {
  fileName: string;
}
export const designs: Design[] = [
  {label: "Harkness Tower", sample: tower},
  {label: "Elm Tree", sample: elm},
  {label: "Sterling Memorial Library", sample: sterling},
  {label: "Beinecke Library", sample: beinecke},
  {label: "Yale Shield", sample: shield},
  {label: "Handsome Dan", sample: dan}
];
