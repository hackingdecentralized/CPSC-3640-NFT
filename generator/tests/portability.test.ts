import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {fromRoot} from "../src/paths";
import {PORTABLE_MODULES} from "../src/portable";

const SHARED: readonly string[] = PORTABLE_MODULES;

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
