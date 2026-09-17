import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {fromRoot} from "../src/paths";

/**
 * The claim page imports these modules into the browser. They, and everything they
 * import, must stay free of Node built-ins and native packages.
 */
const SHARED = [
  "assets",
  "collection",
  "compatibility",
  "composite",
  "config",
  "layers",
  "metadata",
  "morphology",
  "random",
  "seed",
  "sha256",
  "strokeFont",
  "token",
  "traits",
  "types",
  "weights",
  "webAssets"
];

const importsOf = (module: string): string[] =>
  [...readFileSync(join(fromRoot("src"), `${module}.ts`), "utf8").matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1]!);

describe("browser-safe modules", () => {
  it.each(SHARED)("%s imports nothing Node-specific, directly or indirectly", (entry) => {
    const seen = new Set<string>();
    const visit = (module: string) => {
      if (seen.has(module)) return;
      seen.add(module);
      for (const specifier of importsOf(module)) {
        expect(specifier.startsWith("./"), `${module}.ts imports "${specifier}"`).toBe(true);
        visit(specifier.slice(2));
      }
    };
    visit(entry);
    for (const module of seen) expect(SHARED, `${entry} reaches ${module}`).toContain(module);
  });
});
