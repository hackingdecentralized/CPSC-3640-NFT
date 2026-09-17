/**
 * Weighted selection in exact integer arithmetic.
 *
 * Weights are percentages with at most two decimal places (easter eggs use 1.5),
 * so they are converted to integer "units" of 0.01% before anything else happens.
 * A group sums to exactly 10000 units, with no floating-point tolerance involved.
 */
import type {Rng} from "./random";
import type {Weights} from "./types";

export const WEIGHT_SCALE = 100;
export const FULL_GROUP = 100 * WEIGHT_SCALE;

export type Entry = readonly [value: string, units: number];

/** Percentage -> integer units. Throws on anything with more than two decimals. */
export function toUnits(weight: unknown, where: string): number {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
    throw new Error(`${where}: weight must be a non-negative number, got ${JSON.stringify(weight)}`);
  }
  const scaled = weight * WEIGHT_SCALE;
  const units = Math.round(scaled);
  if (Math.abs(scaled - units) > 1e-9) {
    throw new Error(`${where}: weight ${weight} has more than two decimal places`);
  }
  return units;
}

/**
 * Entries sorted by value name. Selection walks this order, so the order of keys in
 * a JSON file can never change which value a given seed selects.
 */
export function toEntries(weights: Weights, where: string): Entry[] {
  return Object.keys(weights)
    .filter((key) => !key.startsWith("$"))
    .sort()
    .map((value) => [value, toUnits(weights[value], `${where}.${value}`)] as const);
}

export function totalUnits(entries: readonly Entry[]): number {
  return entries.reduce((sum, [, units]) => sum + units, 0);
}

export function weightedPick(entries: readonly Entry[], rng: Rng): string {
  const total = totalUnits(entries);
  if (total <= 0) throw new Error("weightedPick: no value has a positive weight");
  let roll = rng.below(total);
  for (const [value, units] of entries) {
    if (roll < units) return value;
    roll -= units;
  }
  throw new Error("weightedPick: unreachable");
}
