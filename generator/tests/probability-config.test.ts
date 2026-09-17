import {describe, expect, it} from "vitest";
import {validateConfig} from "../src/config";
import {deriveSeed} from "../src/seed";
import {planTraits} from "../src/traits";
import {FULL_GROUP, toEntries, totalUnits} from "../src/weights";
import {ALL_GROUPS} from "../src/types";
import {SALT_X, WALLET_A, cloneConfig, config, seeds} from "./helpers";

const problemsFor = (mutate: (c: ReturnType<typeof cloneConfig>) => void): string[] => {
  const broken = cloneConfig();
  mutate(broken);
  return validateConfig(broken);
};

describe("probability configuration", () => {
  it("ships a valid configuration", () => {
    expect(validateConfig(config)).toEqual([]);
  });

  it.each(ALL_GROUPS)("trait group %s sums to exactly 100", (group) => {
    expect(totalUnits(toEntries(config.traits[group], group))).toBe(FULL_GROUP);
  });

  it("base templates sum to 100 with the specified 19/19/19/19/19/5 split", () => {
    const weights = Object.fromEntries(
      Object.entries(config.baseTemplates).map(([id, t]) => [id, t.weight])
    );
    expect(weights).toEqual({
      tower_clock: 19,
      knowledge_tree: 19,
      gothic_gate: 19,
      modern_cube: 19,
      yale_shield: 19,
      bulldog_special: 5
    });
  });

  it("selects base templates close to their configured rates", () => {
    const counts: Record<string, number> = {};
    const sample = seeds(20000);
    for (const seed of sample) {
      const {base_template} = planTraits(config, seed).traits;
      counts[base_template] = (counts[base_template] ?? 0) + 1;
    }
    for (const [id, template] of Object.entries(config.baseTemplates)) {
      const observed = ((counts[id] ?? 0) / sample.length) * 100;
      expect(Math.abs(observed - template.weight)).toBeLessThan(1);
    }
  });

  it("gives the same outcome however the JSON keys are ordered", () => {
    const reordered = cloneConfig();
    for (const group of ALL_GROUPS) {
      reordered.traits[group] = Object.fromEntries(Object.entries(reordered.traits[group]).reverse());
    }
    for (let id = 1; id <= 100; id++) {
      const seed = deriveSeed(id, WALLET_A, SALT_X);
      expect(planTraits(reordered, seed).traits).toEqual(planTraits(config, seed).traits);
    }
  });
});

describe("configuration validation rejects", () => {
  it("a group that does not sum to 100", () => {
    const problems = problemsFor((c) => {
      c.traits.halo.none = 21;
    });
    expect(problems.join()).toMatch(/traits\.halo sums to 101/);
  });

  it("base templates that do not sum to 100", () => {
    const problems = problemsFor((c) => {
      c.baseTemplates.bulldog_special!.weight = 6;
    });
    expect(problems.join()).toMatch(/base-templates sums to 101/);
  });

  it("weights with more than two decimal places", () => {
    const problems = problemsFor((c) => {
      c.traits.easter_egg.tiny_lock = 1.005;
    });
    expect(problems.join()).toMatch(/more than two decimal places/);
  });

  it("a negative weight", () => {
    const problems = problemsFor((c) => {
      c.traits.badge.standard = -40;
    });
    expect(problems.join()).toMatch(/non-negative/);
  });

  it("an unknown or missing trait group", () => {
    expect(problemsFor((c) => ((c.traits as Record<string, object>).haloo = {x: 100})).join()).toMatch(
      /unknown group "haloo"/
    );
    expect(problemsFor((c) => delete (c.traits as Partial<typeof c.traits>).badge).join()).toMatch(
      /missing the "badge" group/
    );
  });

  it("a rule naming a value that does not exist", () => {
    const problems = problemsFor((c) => {
      c.compatibility.templates.tower_clock!.avoid.halo = ["rainbow"];
    });
    expect(problems.join()).toMatch(/names "rainbow", which is not in traits\.halo/);
  });

  it("rules for a template that does not exist, or a template with no rules", () => {
    const problems = problemsFor((c) => {
      c.compatibility.templates.moon_base = c.compatibility.templates.tower_clock!;
      delete c.compatibility.templates.modern_cube;
    });
    expect(problems.join()).toMatch(/unknown template "moon_base"/);
    expect(problems.join()).toMatch(/no rules for template "modern_cube"/);
  });

  it("a template that avoids every value in a group", () => {
    const problems = problemsFor((c) => {
      c.compatibility.templates.gothic_gate!.avoid.border_style = Object.keys(c.traits.border_style);
    });
    expect(problems.join()).toMatch(/leaves only 0 drawable value\(s\) in "border_style"/);
  });

  it("a template that leaves fewer micro icons than can be drawn", () => {
    const problems = problemsFor((c) => {
      c.compatibility.templates.gothic_gate!.avoid.micro_icons = Object.keys(c.traits.micro_icons).slice(1);
    });
    expect(problems.join()).toMatch(/needs 2/);
  });

  it("a slot that would cover course text", () => {
    const problems = problemsFor((c) => {
      c.layout.slots.badge = {cx: 1024, cy: 250, w: 200, h: 200};
    });
    expect(problems.join()).toMatch(/slot badge overlaps protected region "header"/);
  });

  it("a slot outside the border, and slots that overlap each other", () => {
    const outside = problemsFor((c) => {
      c.layout.slots.easter_egg = {cx: 40, cy: 738, w: 56, h: 56};
    });
    expect(outside.join()).toMatch(/easter_egg extends outside the inner border/);

    const overlapping = problemsFor((c) => {
      c.layout.slots.easter_egg = {...c.layout.slots.micro.center_left!};
    });
    expect(overlapping.join()).toMatch(/overlap/);
  });

  it("a preferred multiplier out of range", () => {
    expect(problemsFor((c) => (c.compatibility.preferredMultiplier = 0)).join()).toMatch(/preferredMultiplier/);
    expect(problemsFor((c) => (c.compatibility.preferredMultiplier = 1000)).join()).toMatch(/preferredMultiplier/);
  });
});
