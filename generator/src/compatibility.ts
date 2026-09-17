/**
 * Template compatibility (spec section 10).
 *
 * "preferred" multiplies a value's weight for that template. "avoid" makes a value
 * invalid for that template: if drawn, that one trait is redrawn with the offending
 * value removed. Removing it before redrawing gives exactly the same distribution
 * as the configured weights restricted to the allowed values, which is what the
 * rarity report uses as its expectation.
 */
import {toEntries, toUnits, WEIGHT_SCALE, type Entry} from "./weights";
import type {GeneratorConfig, RuleGroup, Traits} from "./types";
import {NO_LAYER, SINGLE_GROUPS} from "./types";

export function isAvoided(config: GeneratorConfig, group: RuleGroup, value: string, template: string): boolean {
  return config.compatibility.templates[template]?.avoid?.[group]?.includes(value) ?? false;
}

export function isPreferred(config: GeneratorConfig, group: RuleGroup, value: string, template: string): boolean {
  return config.compatibility.templates[template]?.preferred?.[group]?.includes(value) ?? false;
}

/**
 * Weights as used for drawing on this template: preferred values multiplied, every
 * other value multiplied by 1. Both are scaled by WEIGHT_SCALE so the multiplier can
 * have two decimals and the arithmetic stays integral. Avoided values stay in, since
 * the draw-then-check loop is what counts them.
 */
export function effectiveEntries(config: GeneratorConfig, group: RuleGroup, template: string): Entry[] {
  const multiplier = toUnits(config.compatibility.preferredMultiplier, "preferredMultiplier");
  return toEntries(config.traits[group], group).map(
    ([value, units]) =>
      [value, units * (isPreferred(config, group, value, template) ? multiplier : WEIGHT_SCALE)] as const
  );
}

/** Probability of each value for one draw on this template, avoided values excluded. */
export function allowedDistribution(
  config: GeneratorConfig,
  group: RuleGroup,
  template: string
): Map<string, number> {
  const allowed = effectiveEntries(config, group, template).filter(
    ([value]) => !isAvoided(config, group, value, template)
  );
  const total = allowed.reduce((sum, [, units]) => sum + units, 0);
  return new Map(allowed.map(([value, units]) => [value, units / total]));
}

/**
 * Every reason a finished trait set is not a legal NFT. Used after forced traits are
 * applied, and by the tests as the final word on validity.
 */
export function traitProblems(config: GeneratorConfig, traits: Traits): string[] {
  const problems: string[] = [];
  const template = traits.base_template;
  if (!(template in config.baseTemplates)) {
    return [`unknown base_template "${template}"`];
  }

  for (const group of SINGLE_GROUPS) {
    const value = traits[group];
    if (!(value in config.traits[group])) {
      problems.push(`${group} "${value}" is not a configured value`);
    } else if (isAvoided(config, group, value, template)) {
      problems.push(`${group} "${value}" is not allowed on template "${template}"`);
    }
  }

  const icons = traits.micro_icons;
  if (!Array.isArray(icons)) {
    problems.push("micro_icons must be an array");
  } else {
    if (new Set(icons).size !== icons.length) problems.push("micro_icons contains a duplicate");
    if (!(String(icons.length) in config.traits.micro_icon_count)) {
      problems.push(`micro_icons has ${icons.length} entries, which is not a configured count`);
    }
    for (const icon of icons) {
      if (!(icon in config.traits.micro_icons)) {
        problems.push(`micro icon "${icon}" is not a configured value`);
      } else if (isAvoided(config, "micro_icons", icon, template)) {
        problems.push(`micro icon "${icon}" is not allowed on template "${template}"`);
      }
    }
  }
  return problems;
}

/** Whether a trait value produces an image layer at all. */
export const drawsLayer = (key: keyof Traits, value: string): boolean => NO_LAYER[key] !== value;
