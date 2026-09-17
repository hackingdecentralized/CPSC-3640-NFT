/**
 * Shared types. A "trait group" is one independently drawn property of an NFT.
 */

/** Groups drawn as one weighted choice each, subject to template compatibility. */
export const SINGLE_GROUPS = [
  "background_style",
  "border_style",
  "halo",
  "human_icon",
  "contract_icon",
  "ai_icon",
  "badge",
  "easter_egg"
] as const;

export const ROLE_GROUPS = ["human_icon", "contract_icon", "ai_icon"] as const;

export type SingleGroup = (typeof SINGLE_GROUPS)[number];
export type RoleGroup = (typeof ROLE_GROUPS)[number];

/** Every group that appears in traits.json. */
export const ALL_GROUPS = [...SINGLE_GROUPS, "micro_icons", "micro_icon_count"] as const;
export type TraitGroup = (typeof ALL_GROUPS)[number];

/** Groups a compatibility rule may name. micro_icon_count is never template-specific. */
export type RuleGroup = Exclude<TraitGroup, "micro_icon_count">;

/** value -> percentage. Each group sums to 100. */
export type Weights = Record<string, number>;

export interface Traits {
  base_template: string;
  background_style: string;
  border_style: string;
  halo: string;
  /** In canonical (alphabetical) order. May be empty. */
  micro_icons: string[];
  human_icon: string;
  contract_icon: string;
  ai_icon: string;
  badge: string;
  easter_egg: string;
}

/** Values that mean "draw nothing for this layer". */
export const NO_LAYER: Partial<Record<keyof Traits, string>> = {
  border_style: "gold_cyan_standard",
  halo: "none",
  badge: "standard",
  easter_egg: "none"
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoundRect extends Rect {
  r: number;
}

export interface Slot {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface Layout {
  /** The design space every coordinate is written in. Always 2048. */
  canvas: number;
  /** Width and height of the rendered PNG. Coordinates are scaled to it. */
  outputSize: number;
  sourceSize: number;
  border: {outer: RoundRect; inner: RoundRect};
  protected: Record<string, Rect>;
  centralArt: Rect;
  haloCenter: {cx: number; cy: number};
  slots: {
    badge: Slot;
    easter_egg: Slot;
    micro: Record<string, Slot>;
    role: Record<RoleGroup, Slot>;
  };
}

export interface BaseTemplate {
  weight: number;
  label: string;
  source: string;
  sha256: string;
  asset: string;
}

export interface TemplateRules {
  preferred: Partial<Record<RuleGroup, string[]>>;
  avoid: Partial<Record<RuleGroup, string[]>>;
  notApplicable: string[];
}

export interface Compatibility {
  preferredMultiplier: number;
  templates: Record<string, TemplateRules>;
}

export interface GeneratorConfig {
  baseTemplates: Record<string, BaseTemplate>;
  traits: Record<TraitGroup, Weights>;
  compatibility: Compatibility;
  layout: Layout;
}
