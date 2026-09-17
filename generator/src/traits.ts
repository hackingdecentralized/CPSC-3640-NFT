/**
 * Deterministic trait selection (spec sections 5-10 and 17).
 *
 * Each trait draws from its own stream, derived from the seed and the trait's name.
 * Consequences worth knowing:
 *   - forcing one trait never changes any other trait
 *   - retuning one group's weights never reshuffles the others
 *   - forcing base_template can change other traits, because it changes which
 *     compatibility rules apply; that is intended
 */
import {Rng} from "./random";
import {subSeed} from "./seed";
import {toEntries, weightedPick, type Entry} from "./weights";
import {effectiveEntries, isAvoided, traitProblems} from "./compatibility";
import {SINGLE_GROUPS, type GeneratorConfig, type SingleGroup, type Traits} from "./types";

export type ForcedTraits = Partial<Traits>;

export interface Plan {
  seed: string;
  traits: Traits;
  /** Where each micro icon is drawn, in draw order. Paired with microIconsDrawOrder. */
  microIconsDrawOrder: string[];
  microIconSlots: string[];
  stats: {
    /** True if any trait's first draw was not allowed on the chosen template. */
    invalidCombination: boolean;
    /** How many individual redraws that caused. */
    resamples: number;
  };
}

export class ForcedTraitError extends Error {
  constructor(readonly problems: string[]) {
    super(`Forced traits are not valid:\n  - ${problems.join("\n  - ")}`);
    this.name = "ForcedTraitError";
  }
}

const KNOWN_KEYS = new Set<keyof Traits>(["base_template", "micro_icons", ...SINGLE_GROUPS]);

export function planTraits(config: GeneratorConfig, seed: string, forced: ForcedTraits = {}): Plan {
  for (const key of Object.keys(forced)) {
    if (!KNOWN_KEYS.has(key as keyof Traits)) throw new ForcedTraitError([`unknown trait "${key}"`]);
  }

  const stream = (label: string) => Rng.fromSeed(subSeed(seed, label));
  let resamples = 0;

  // The template comes first: every compatibility rule depends on it.
  const template =
    forced.base_template ??
    weightedPick(
      toEntries(
        Object.fromEntries(Object.entries(config.baseTemplates).map(([id, t]) => [id, t.weight])),
        "base-templates"
      ),
      stream("base_template")
    );
  if (!(template in config.baseTemplates)) {
    throw new ForcedTraitError([`unknown base_template "${template}"`]);
  }

  /** Draw, and on an avoided value remove it and draw again. Only this trait is redrawn. */
  const drawAllowed = (group: SingleGroup | "micro_icons", rng: Rng, pool: Entry[]): [string, Entry[]] => {
    let entries = pool;
    for (;;) {
      const value = weightedPick(entries, rng);
      if (!isAvoided(config, group, value, template)) return [value, entries];
      resamples++;
      entries = entries.filter(([v]) => v !== value);
    }
  };

  const single = {} as Record<SingleGroup, string>;
  for (const group of SINGLE_GROUPS) {
    [single[group]] = drawAllowed(group, stream(group), effectiveEntries(config, group, template));
  }

  // Micro icons: how many, then which (no repeats), then where.
  const forcedIcons = forced.micro_icons;
  const count =
    forcedIcons?.length ??
    Number(weightedPick(toEntries(config.traits.micro_icon_count, "micro_icon_count"), stream("micro_icon_count")));

  let iconsInDrawOrder: string[];
  if (forcedIcons) {
    iconsInDrawOrder = [...forcedIcons];
  } else {
    iconsInDrawOrder = [];
    const rng = stream("micro_icons");
    let pool = effectiveEntries(config, "micro_icons", template);
    while (iconsInDrawOrder.length < count) {
      const [icon, remaining] = drawAllowed("micro_icons", rng, pool);
      iconsInDrawOrder.push(icon);
      pool = remaining.filter(([v]) => v !== icon);
    }
  }

  // Slots are picked one at a time, so the first icon's slot is the same whether
  // one icon or two end up being drawn.
  const slotRng = stream("micro_icon_slots");
  const freeSlots = Object.keys(config.layout.slots.micro).sort();
  const slots: string[] = [];
  for (let i = 0; i < iconsInDrawOrder.length; i++) {
    if (freeSlots.length === 0) throw new ForcedTraitError(["more micro icons than slots"]);
    slots.push(freeSlots.splice(slotRng.below(freeSlots.length), 1)[0]!);
  }

  const traits: Traits = {
    base_template: template,
    background_style: forced.background_style ?? single.background_style,
    border_style: forced.border_style ?? single.border_style,
    halo: forced.halo ?? single.halo,
    micro_icons: [...iconsInDrawOrder].sort(),
    human_icon: forced.human_icon ?? single.human_icon,
    contract_icon: forced.contract_icon ?? single.contract_icon,
    ai_icon: forced.ai_icon ?? single.ai_icon,
    badge: forced.badge ?? single.badge,
    easter_egg: forced.easter_egg ?? single.easter_egg
  };

  // Forced values are the caller's responsibility, so an illegal one is an error,
  // not something to quietly repair.
  const problems = traitProblems(config, traits);
  if (problems.length > 0) throw new ForcedTraitError(problems);

  return {
    seed,
    traits,
    microIconsDrawOrder: iconsInDrawOrder,
    microIconSlots: slots,
    stats: {invalidCombination: resamples > 0, resamples}
  };
}
