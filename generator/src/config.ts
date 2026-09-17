/**
 * Loading and validating configuration (spec section 11).
 *
 * Validation is strict and reports every problem at once. Generation refuses to run
 * against an invalid configuration: a typo in a trait name should fail loudly here,
 * not quietly produce a collection with a missing layer.
 */
import {readFileSync} from "node:fs";
import {fromRoot} from "./paths";
import {FULL_GROUP, toEntries, toUnits, totalUnits} from "./weights";
import {
  ALL_GROUPS,
  ROLE_GROUPS,
  type Compatibility,
  type GeneratorConfig,
  type Layout,
  type Rect,
  type RuleGroup,
  type Slot,
  type TraitGroup,
  type Weights
} from "./types";

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid generator configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** A compatibility multiplier above this could overflow the integer weight math. */
const MAX_MULTIPLIER = 100;

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(fromRoot(relativePath), "utf8")) as T;

const stripComments = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("$"))) as T;

export function loadConfig(): GeneratorConfig {
  const config: GeneratorConfig = {
    baseTemplates: stripComments(readJson("config/base-templates.json")),
    traits: stripComments(readJson("config/traits.json")),
    compatibility: stripComments(readJson<Compatibility>("config/compatibility.json")),
    layout: stripComments(readJson<Layout>("config/layout.json"))
  };
  assertValidConfig(config);
  return config;
}

export function assertValidConfig(config: GeneratorConfig): void {
  const problems = validateConfig(config);
  if (problems.length > 0) throw new ConfigError(problems);
}

/** Returns every problem found. An empty array means the configuration is usable. */
export function validateConfig(config: GeneratorConfig): string[] {
  const problems: string[] = [];
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      problems.push((error as Error).message);
    }
  };

  // --- base templates --------------------------------------------------------
  const templateIds = Object.keys(config.baseTemplates);
  if (templateIds.length === 0) problems.push("base-templates.json defines no templates");
  attempt(() => {
    const weights: Weights = Object.fromEntries(
      templateIds.map((id) => [id, config.baseTemplates[id]!.weight])
    );
    checkSumsTo100(toEntries(weights, "base-templates"), "base-templates", problems);
  });
  for (const id of templateIds) {
    const t = config.baseTemplates[id]!;
    for (const field of ["label", "source", "sha256", "asset"] as const) {
      if (typeof t[field] !== "string" || t[field].length === 0) {
        problems.push(`base-templates.${id}.${field} must be a non-empty string`);
      }
    }
    if (typeof t.sha256 === "string" && !/^[0-9a-f]{64}$/.test(t.sha256)) {
      problems.push(`base-templates.${id}.sha256 must be 64 lowercase hex characters`);
    }
  }

  // --- trait groups ----------------------------------------------------------
  for (const group of Object.keys(config.traits)) {
    if (!(ALL_GROUPS as readonly string[]).includes(group)) {
      problems.push(`traits.json has an unknown group "${group}"`);
    }
  }
  for (const group of ALL_GROUPS) {
    const weights = config.traits[group];
    if (!weights || Object.keys(weights).length === 0) {
      problems.push(`traits.json is missing the "${group}" group`);
      continue;
    }
    attempt(() => checkSumsTo100(toEntries(weights, `traits.${group}`), `traits.${group}`, problems));
  }

  const countWeights = config.traits.micro_icon_count ?? {};
  const counts = Object.keys(countWeights).filter((k) => !k.startsWith("$"));
  for (const key of counts) {
    if (!/^\d+$/.test(key)) problems.push(`traits.micro_icon_count key "${key}" is not a whole number`);
  }
  const maxIcons = Math.max(0, ...counts.filter((k) => /^\d+$/.test(k)).map(Number));

  // --- compatibility ---------------------------------------------------------
  const compat = config.compatibility;
  attempt(() => {
    const units = toUnits(compat.preferredMultiplier, "compatibility.preferredMultiplier");
    if (units <= 0 || compat.preferredMultiplier > MAX_MULTIPLIER) {
      throw new Error(`compatibility.preferredMultiplier must be > 0 and <= ${MAX_MULTIPLIER}`);
    }
  });

  const ruleTemplates = Object.keys(compat.templates ?? {});
  for (const id of templateIds) {
    if (!ruleTemplates.includes(id)) problems.push(`compatibility.json has no rules for template "${id}"`);
  }
  for (const id of ruleTemplates) {
    if (!templateIds.includes(id)) problems.push(`compatibility.json has rules for unknown template "${id}"`);
  }

  for (const id of ruleTemplates) {
    const rules = compat.templates[id]!;
    for (const kind of ["preferred", "avoid"] as const) {
      for (const [group, values] of Object.entries(rules[kind] ?? {})) {
        if (group === "micro_icon_count" || !(ALL_GROUPS as readonly string[]).includes(group)) {
          problems.push(`compatibility.${id}.${kind} names unknown group "${group}"`);
          continue;
        }
        const pool = config.traits[group as TraitGroup] ?? {};
        for (const value of values ?? []) {
          if (!(value in pool)) {
            problems.push(`compatibility.${id}.${kind}.${group} names "${value}", which is not in traits.${group}`);
          }
        }
      }
    }

    // Every group must keep at least one drawable value for this template, or the
    // resample loop could never finish.
    for (const group of ALL_GROUPS) {
      if (group === "micro_icon_count") continue;
      const weights = config.traits[group];
      if (!weights) continue;
      const avoided = new Set(rules.avoid?.[group as RuleGroup] ?? []);
      let drawable = 0;
      try {
        drawable = toEntries(weights, group).filter(([v, u]) => u > 0 && !avoided.has(v)).length;
      } catch {
        continue;
      }
      const needed = group === "micro_icons" ? Math.max(1, maxIcons) : 1;
      if (drawable < needed) {
        problems.push(
          `template "${id}" leaves only ${drawable} drawable value(s) in "${group}", needs ${needed}`
        );
      }
    }
  }

  // --- layout ----------------------------------------------------------------
  problems.push(...validateLayout(config.layout, maxIcons));
  return problems;
}

function checkSumsTo100(entries: ReturnType<typeof toEntries>, where: string, problems: string[]): void {
  const total = totalUnits(entries);
  if (total !== FULL_GROUP) {
    problems.push(`${where} sums to ${total / 100}, must be exactly 100`);
  }
}

export const slotRect = (slot: Slot): Rect => ({
  x: slot.cx - slot.w / 2,
  y: slot.cy - slot.h / 2,
  w: slot.w,
  h: slot.h
});

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Every placed slot, keyed by a readable name. */
export function allSlots(layout: Layout): Array<[string, Slot]> {
  return [
    ["badge", layout.slots.badge],
    ["easter_egg", layout.slots.easter_egg],
    ...Object.entries(layout.slots.micro).map(([k, s]) => [`micro.${k}`, s] as [string, Slot]),
    ...Object.entries(layout.slots.role).map(([k, s]) => [`role.${k}`, s] as [string, Slot])
  ];
}

function validateLayout(layout: Layout, maxIcons: number): string[] {
  const problems: string[] = [];
  if (layout.canvas !== 2048) problems.push(`layout.canvas must be 2048, got ${layout.canvas}`);

  const microSlots = Object.keys(layout.slots.micro);
  if (microSlots.length < maxIcons) {
    problems.push(`layout has ${microSlots.length} micro icon slots, but up to ${maxIcons} icons can be drawn`);
  }
  for (const role of ROLE_GROUPS) {
    if (!layout.slots.role[role]) problems.push(`layout.slots.role is missing "${role}"`);
  }

  const slots = allSlots(layout);
  const border = layout.border.inner;
  for (const [name, slot] of slots) {
    const rect = slotRect(slot);
    if (!inside(rect, border)) problems.push(`slot ${name} extends outside the inner border`);
    for (const [region, area] of Object.entries(layout.protected)) {
      if (intersects(rect, area)) problems.push(`slot ${name} overlaps protected region "${region}"`);
    }
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (intersects(slotRect(slots[i]![1]), slotRect(slots[j]![1]))) {
        problems.push(`slots ${slots[i]![0]} and ${slots[j]![0]} overlap`);
      }
    }
  }
  return problems;
}
