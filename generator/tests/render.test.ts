import {existsSync} from "node:fs";
import sharp from "sharp";
import {beforeAll, describe, expect, it} from "vitest";
import {maskPath} from "../src/assets";
import {fromRoot} from "../src/paths";
import {renderImage} from "../src/renderer";
import {deriveSeed} from "../src/seed";
import {planTraits, type ForcedTraits} from "../src/traits";
import {SALT_X, WALLET_A, config} from "./helpers";

/** The busiest legal trait set for each template: every layer that can draw, draws. */
const BUSY: Record<string, ForcedTraits> = {
  tower_clock: {background_style: "dense_starfield", border_style: "segmented_circuit", halo: "geometric_ring", micro_icons: ["book", "lock"], badge: "genesis", easter_egg: "tiny_eth_gem"},
  knowledge_tree: {background_style: "light_particles", border_style: "cyan_glow", halo: "dual_gold_cyan", micro_icons: ["node", "spark"], badge: "researcher", easter_egg: "rare_blue_flame"},
  gothic_gate: {background_style: "vertical_glow", border_style: "double_gold", halo: "soft_gold", micro_icons: ["coin", "chain"], badge: "honors", easter_egg: "tiny_lock"},
  modern_cube: {background_style: "grid_overlay", border_style: "soft_holographic", halo: "geometric_ring", micro_icons: ["chip", "block"], badge: "auditor", easter_egg: "tiny_bulldog"},
  yale_shield: {background_style: "dense_starfield", border_style: "double_gold", halo: "soft_cyan", micro_icons: ["coin", "book"], badge: "ta_edition", easter_egg: "tiny_yale_y"},
  bulldog_special: {background_style: "light_particles", border_style: "soft_holographic", halo: "dual_gold_cyan", micro_icons: ["chain", "chip"], badge: "staff", easter_egg: "tiny_bulldog"}
};

const prepared = Object.keys(config.baseTemplates).every(
  (id) => existsSync(fromRoot(config.baseTemplates[id]!.asset)) && existsSync(fromRoot(maskPath(id)))
);

const raw = async (input: Buffer | string) =>
  sharp(input).removeAlpha().raw().toBuffer({resolveWithObject: true});

// These tests are the proof that overlays never touch course text, so they must not
// quietly skip. Set SKIP_RENDER_TESTS=1 only when you deliberately want them off.
const skip = process.env.SKIP_RENDER_TESTS === "1";

describe.skipIf(skip)("rendering", () => {
  it("has prepared assets to render with", () => {
    expect(prepared, "Run `npm run prepare-assets` before the render tests").toBe(true);
  });

  const renders = new Map<string, Buffer>();

  beforeAll(async () => {
    if (!prepared) return;
    for (const [template, traits] of Object.entries(BUSY)) {
      const plan = planTraits(config, deriveSeed(1, WALLET_A, SALT_X), {base_template: template, ...traits});
      renders.set(template, await renderImage(config, plan));
    }
  }, 120_000);

  it("produces 2048x2048 PNGs", async () => {
    for (const image of renders.values()) {
      const meta = await sharp(image).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", 2048, 2048]);
    }
  });

  it.each(Object.keys(BUSY))("never changes a single pixel of course text on %s", async (template) => {
    const rendered = await raw(renders.get(template)!);
    const base = await raw(fromRoot(config.baseTemplates[template]!.asset));
    const size = config.layout.canvas;
    for (const [region, r] of Object.entries(config.layout.protected)) {
      let changed = 0;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = (y * size + x) * 3;
          if (
            rendered.data[i] !== base.data[i] ||
            rendered.data[i + 1] !== base.data[i + 1] ||
            rendered.data[i + 2] !== base.data[i + 2]
          ) {
            changed++;
          }
        }
      }
      expect(changed, `${template}: ${changed} pixel(s) changed in ${region}`).toBe(0);
    }
  });

  it("actually draws the overlays outside the protected regions", async () => {
    const rendered = await raw(renders.get("tower_clock")!);
    const base = await raw(fromRoot(config.baseTemplates.tower_clock!.asset));
    let changed = 0;
    for (let i = 0; i < rendered.data.length; i++) if (rendered.data[i] !== base.data[i]) changed++;
    expect(changed).toBeGreaterThan(100_000);
  });

  it("renders byte-identical output for the same inputs", async () => {
    const plan = planTraits(config, deriveSeed(1, WALLET_A, SALT_X), {base_template: "bulldog_special", ...BUSY.bulldog_special});
    const again = await renderImage(config, plan);
    expect(again.equals(renders.get("bulldog_special")!)).toBe(true);
  }, 30_000);
});
