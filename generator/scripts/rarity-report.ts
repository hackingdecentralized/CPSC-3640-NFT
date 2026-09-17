/**
 * Simulate trait draws without rendering and compare against expectation
 * (spec section 22).
 *
 *   npm run rarity -- --count 10000
 *
 * "Expected" is the exact distribution the generator targets: configured weights,
 * with each template's preferred multipliers and avoided values applied, averaged
 * over the base-template weights. That is what the observed rates should converge
 * to, so a large gap means a bug rather than bad luck.
 *
 * Output: output/rarity-report.json and output/rarity-report.md
 */
import {mkdirSync, writeFileSync} from "node:fs";
import {loadConfig} from "../src/config";
import {allowedDistribution} from "../src/compatibility";
import {planNFT} from "../src/generator";
import {fromRoot} from "../src/paths";
import {SINGLE_GROUPS, type GeneratorConfig, type RuleGroup} from "../src/types";
import {PUBLIC_PREVIEW_SALT, TEST_WALLETS, intArg, parseArgs, run} from "./cli";

interface Row {
  value: string;
  count: number;
  observed: number;
  expected: number;
  /** Observed minus expected, in standard errors. */
  z: number;
}

const templateProbabilities = (config: GeneratorConfig): Map<string, number> =>
  new Map(Object.entries(config.baseTemplates).map(([id, t]) => [id, t.weight / 100]));

function expectedSingle(config: GeneratorConfig, group: RuleGroup): Map<string, number> {
  const out = new Map<string, number>(Object.keys(config.traits[group]).map((v) => [v, 0]));
  for (const [template, p] of templateProbabilities(config)) {
    for (const [value, q] of allowedDistribution(config, group, template)) out.set(value, out.get(value)! + p * q);
  }
  return out;
}

/** P(value is among k draws without replacement), exactly, by enumeration. */
function inclusion(weights: Map<string, number>, k: number): Map<string, number> {
  const out = new Map<string, number>([...weights.keys()].map((v) => [v, 0]));
  const recurse = (remaining: Map<string, number>, depth: number, prob: number) => {
    if (depth === k || prob === 0) return;
    const total = [...remaining.values()].reduce((a, b) => a + b, 0);
    for (const [value, w] of remaining) {
      const p = prob * (w / total);
      out.set(value, out.get(value)! + p);
      const rest = new Map(remaining);
      rest.delete(value);
      recurse(rest, depth + 1, p);
    }
  };
  recurse(weights, 0, 1);
  return out;
}

function expectedMicroIcons(config: GeneratorConfig): Map<string, number> {
  const out = new Map<string, number>(Object.keys(config.traits.micro_icons).map((v) => [v, 0]));
  const counts = Object.entries(config.traits.micro_icon_count).map(([k, w]) => [Number(k), w / 100] as const);
  for (const [template, pt] of templateProbabilities(config)) {
    const weights = allowedDistribution(config, "micro_icons", template);
    for (const [k, pk] of counts) {
      for (const [value, q] of inclusion(weights, k)) out.set(value, out.get(value)! + pt * pk * q);
    }
  }
  return out;
}

function rows(counts: Map<string, number>, expected: Map<string, number>, n: number): Row[] {
  return [...expected.keys()].sort().map((value) => {
    const count = counts.get(value) ?? 0;
    const observed = count / n;
    const e = expected.get(value)!;
    const se = Math.sqrt((e * (1 - e)) / n);
    return {value, count, observed, expected: e, z: se === 0 ? 0 : (observed - e) / se};
  });
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

run(() => {
  const n = intArg(parseArgs(), "count", 10000);
  const config = loadConfig();
  const started = Date.now();

  const tally = new Map<string, Map<string, number>>();
  const bump = (group: string, value: string) => {
    const t = tally.get(group) ?? new Map<string, number>();
    t.set(value, (t.get(value) ?? 0) + 1);
    tally.set(group, t);
  };
  let invalidCombinations = 0;
  let resamples = 0;

  for (let tokenId = 1; tokenId <= n; tokenId++) {
    const plan = planNFT(
      {tokenId, walletAddress: TEST_WALLETS[(tokenId - 1) % TEST_WALLETS.length]!, salt: PUBLIC_PREVIEW_SALT},
      config
    );
    const {traits} = plan;
    bump("base_template", traits.base_template);
    for (const group of SINGLE_GROUPS) bump(group, traits[group]);
    bump("micro_icon_count", String(traits.micro_icons.length));
    for (const icon of traits.micro_icons) bump("micro_icons", icon);
    if (plan.stats.invalidCombination) invalidCombinations++;
    resamples += plan.stats.resamples;
  }

  const sections: Array<[string, string, Map<string, number>]> = [
    ["base_template", "Base template", templateProbabilities(config)],
    ...SINGLE_GROUPS.map((g) => [g, g, expectedSingle(config, g)] as [string, string, Map<string, number>]),
    [
      "micro_icon_count",
      "micro_icon_count",
      new Map(Object.entries(config.traits.micro_icon_count).map(([k, w]) => [k, w / 100]))
    ],
    ["micro_icons", "micro_icons (share of tokens that include the icon)", expectedMicroIcons(config)]
  ];

  const report = {
    samples: n,
    tokenIds: `1-${n}`,
    salt: PUBLIC_PREVIEW_SALT,
    invalidCombinations,
    invalidCombinationRate: invalidCombinations / n,
    resamples,
    easterEggCounts: Object.fromEntries(
      [...(tally.get("easter_egg") ?? new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]))
    ),
    groups: Object.fromEntries(
      sections.map(([key, , expected]) => [key, rows(tally.get(key) ?? new Map(), expected, n)])
    )
  };

  const flagged = Object.values(report.groups)
    .flat()
    .filter((r) => Math.abs(r.z) > 4);

  mkdirSync(fromRoot("output"), {recursive: true});
  writeFileSync(fromRoot("output", "rarity-report.json"), JSON.stringify(report, null, 2) + "\n");

  const md: string[] = [
    "# Rarity report",
    "",
    `Samples: **${n.toLocaleString()}** (token ids ${report.tokenIds}, Anvil test wallets, public preview salt)`,
    "",
    "| | |",
    "| --- | --- |",
    `| Invalid combinations | ${invalidCombinations.toLocaleString()} tokens (${pct(report.invalidCombinationRate)}) |`,
    `| Resamples | ${resamples.toLocaleString()} |`,
    `| Values more than 4 standard errors from expected | ${flagged.length} |`,
    "",
    "An invalid combination is a token whose first draw for some trait was a value its template avoids. " +
      "Only that trait was redrawn. Expected rates already account for template rules.",
    "",
    "## Easter eggs",
    "",
    "| Value | Count |",
    "| --- | ---: |",
    ...Object.entries(report.easterEggCounts).map(([v, c]) => `| ${v} | ${c} |`),
    ""
  ];
  for (const [key, title] of sections) {
    md.push(`## ${title}`, "", "| Value | Count | Observed | Expected | Δ (pp) | z |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const r of report.groups[key]!) {
      const flag = Math.abs(r.z) > 4 ? " ⚠" : "";
      md.push(
        `| ${r.value} | ${r.count} | ${pct(r.observed)} | ${pct(r.expected)} | ${((r.observed - r.expected) * 100).toFixed(2)} | ${r.z.toFixed(2)}${flag} |`
      );
    }
    md.push("");
  }
  writeFileSync(fromRoot("output", "rarity-report.md"), md.join("\n"));

  console.log(`Simulated ${n.toLocaleString()} tokens in ${Date.now() - started} ms`);
  console.log("\nBase template   observed  expected");
  for (const r of report.groups.base_template!) {
    console.log(`  ${r.value.padEnd(15)} ${pct(r.observed).padStart(7)}  ${pct(r.expected).padStart(7)}`);
  }
  console.log(`\nInvalid combinations: ${invalidCombinations} (${pct(report.invalidCombinationRate)}), resamples: ${resamples}`);
  console.log(`Easter eggs: ${JSON.stringify(report.easterEggCounts)}`);
  console.log(`Values beyond 4 standard errors: ${flagged.length}`);
  console.log("\nWrote output/rarity-report.json and output/rarity-report.md");
  if (flagged.length > 0) {
    for (const r of flagged) console.warn(`  ⚠ ${r.value}: observed ${pct(r.observed)}, expected ${pct(r.expected)}`);
    process.exitCode = 1;
  }
});
