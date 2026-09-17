import {describe, expect, it} from "vitest";
import {allowedDistribution, isAvoided, traitProblems} from "../src/compatibility";
import {deriveSeed} from "../src/seed";
import {ForcedTraitError, planTraits} from "../src/traits";
import {SINGLE_GROUPS, type RuleGroup} from "../src/types";
import {SALT_X, WALLET_A, cloneConfig, config, seeds} from "./helpers";

const sweep = seeds(5000).map((seed) => planTraits(config, seed));

describe("template compatibility", () => {
  it("no invalid template/trait combination survives", () => {
    for (const plan of sweep) {
      expect(traitProblems(config, plan.traits)).toEqual([]);
      const {base_template: template} = plan.traits;
      for (const group of SINGLE_GROUPS) {
        expect(isAvoided(config, group, plan.traits[group], template)).toBe(false);
      }
      for (const icon of plan.traits.micro_icons) {
        expect(isAvoided(config, "micro_icons", icon, template)).toBe(false);
      }
    }
  });

  it("actually exercises the resample path", () => {
    const resampled = sweep.filter((p) => p.stats.resamples > 0);
    expect(resampled.length).toBeGreaterThan(0);
    for (const plan of resampled) expect(plan.stats.invalidCombination).toBe(true);
  });

  it("resamples only the invalid trait", () => {
    // Compare against a configuration where gothic_gate has no avoid rules at all.
    // Wherever the real run had to redraw, the redrawn traits may differ, but every
    // other trait must be identical: the redraw consumed nothing from their streams.
    const permissive = cloneConfig();
    permissive.compatibility.templates.gothic_gate!.avoid = {};

    const redrawnGroups = ["background_style", "halo"] as const;
    const gate = sweep.filter((p) => p.traits.base_template === "gothic_gate" && p.stats.resamples > 0);
    expect(gate.length).toBeGreaterThan(0);

    for (const plan of gate) {
      const unconstrained = planTraits(permissive, plan.seed).traits;
      const differing = (Object.keys(plan.traits) as Array<keyof typeof plan.traits>).filter(
        (key) => JSON.stringify(plan.traits[key]) !== JSON.stringify(unconstrained[key])
      );
      expect(differing.length).toBeGreaterThan(0);
      for (const key of differing) expect(redrawnGroups).toContain(key);
    }
  });

  it("draws preferred values more often than their plain weight", () => {
    // tower_clock prefers soft_gold (30% base weight). Doubled and renormalised it
    // should land well above 30%.
    const tower = sweep.filter((p) => p.traits.base_template === "tower_clock");
    const softGold = tower.filter((p) => p.traits.halo === "soft_gold").length / tower.length;
    expect(allowedDistribution(config, "halo", "tower_clock").get("soft_gold")).toBeCloseTo(60 / 130, 6);
    expect(softGold).toBeGreaterThan(0.4);
  });

  it("allowed distributions sum to 1 and exclude avoided values", () => {
    for (const template of Object.keys(config.baseTemplates)) {
      for (const group of [...SINGLE_GROUPS, "micro_icons"] as RuleGroup[]) {
        const dist = allowedDistribution(config, group, template);
        const total = [...dist.values()].reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 9);
        for (const value of dist.keys()) expect(isAvoided(config, group, value, template)).toBe(false);
      }
    }
  });

  it("never draws a micro icon twice on one NFT", () => {
    for (const plan of sweep) {
      expect(new Set(plan.traits.micro_icons).size).toBe(plan.traits.micro_icons.length);
      expect(new Set(plan.microIconSlots).size).toBe(plan.microIconSlots.length);
      expect(plan.microIconSlots.length).toBe(plan.traits.micro_icons.length);
    }
  });
});

describe("forced traits", () => {
  const seed = deriveSeed(7, WALLET_A, SALT_X);

  it.each(["staff", "ta_edition"])("force badge = %s overrides the random badge", (badge) => {
    for (let id = 1; id <= 30; id++) {
      expect(planTraits(config, deriveSeed(id, WALLET_A, SALT_X), {badge}).traits.badge).toBe(badge);
    }
  });

  it("can force the base template", () => {
    expect(planTraits(config, seed, {base_template: "bulldog_special"}).traits.base_template).toBe(
      "bulldog_special"
    );
  });

  it("can force micro icons, and places them in distinct slots", () => {
    const plan = planTraits(config, seed, {micro_icons: ["node", "book"]});
    expect(plan.traits.micro_icons).toEqual(["book", "node"]);
    expect(new Set(plan.microIconSlots).size).toBe(2);
  });

  it("refuses a forced value that the template does not allow", () => {
    expect(() =>
      planTraits(config, seed, {base_template: "gothic_gate", background_style: "grid_overlay"})
    ).toThrow(ForcedTraitError);
  });

  it("refuses unknown values and unknown keys", () => {
    expect(() => planTraits(config, seed, {badge: "emperor"})).toThrow(/not a configured value/);
    expect(() => planTraits(config, seed, {base_template: "moon_base"})).toThrow(/unknown base_template/);
    expect(() => planTraits(config, seed, {colour: "red"} as never)).toThrow(/unknown trait "colour"/);
  });

  it("refuses duplicate or too many forced micro icons", () => {
    expect(() => planTraits(config, seed, {micro_icons: ["book", "book"]})).toThrow(/duplicate/);
    expect(() => planTraits(config, seed, {micro_icons: ["book", "node", "coin"]})).toThrow(
      /not a configured count/
    );
  });
});
