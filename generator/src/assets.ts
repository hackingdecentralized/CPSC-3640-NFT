/** Where every asset lives. The renderer and the validators share these. */
import type {RoleGroup} from "./types";

export const MASK_DIR = "assets/masks";
export const PREPARED_MANIFEST = "assets/.prepared.json";

export const maskPath = (template: string): string => `${MASK_DIR}/${template}.png`;
export const matteInfoPath = (template: string): string => `${MASK_DIR}/${template}.json`;

const ROLE_DIRS: Record<RoleGroup, string> = {
  human_icon: "human",
  contract_icon: "contract",
  ai_icon: "ai"
};

export const overlayPath = {
  background: (value: string) => `assets/overlays/backgrounds/${value}.svg`,
  border: (value: string) => `assets/overlays/borders/${value}.svg`,
  halo: (value: string) => `assets/overlays/halos/${value}.svg`,
  badge: (value: string) => `assets/overlays/badges/${value}.svg`,
  micro: (value: string) => `assets/overlays/icons/micro/${value}.svg`,
  role: (group: RoleGroup, value: string) => `assets/overlays/icons/${ROLE_DIRS[group]}/${value}.svg`,
  easterEgg: (value: string) => `assets/overlays/easter_eggs/${value}.svg`
};

/** What prepare-assets records about each template's artwork. */
export interface MatteInfo {
  template: string;
  /** Bounding box of the detected illustration, in canvas pixels. */
  art: {x: number; y: number; w: number; h: number};
  centroid: {cx: number; cy: number};
  /** Share of the canvas where decorative layers may draw. */
  decorableFraction: number;
}
