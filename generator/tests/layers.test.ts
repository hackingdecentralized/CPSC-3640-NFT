import {describe, expect, it} from "vitest";
import {outputScale, scaleSlot} from "../src/config";
import {everyLayer, layerStack, type Layer} from "../src/layers";
import {planTraits} from "../src/traits";
import {SINGLE_GROUPS} from "../src/types";
import {config, seeds} from "./helpers";

const exported = new Map(everyLayer(config).map((layer) => [layer.key, layer]));
const size = config.layout.outputSize;

describe("layer stack", () => {
  it("names each raster once", () => {
    const keys = everyLayer(config).map((layer) => layer.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exports every layer any card uses, with the same pixels", () => {
    // A key names one raster, which may be drawn at several positions: compare
    // everything that decides its pixels, not where it goes.
    const raster = ({key, source, blend, width, height}: Layer) => ({key, source, blend, width, height});
    for (const seed of seeds(3000)) {
      for (const layer of layerStack(config, planTraits(config, seed))) {
        const known = exported.get(layer.key);
        expect(known, layer.key).toBeDefined();
        expect(raster(known!)).toEqual(raster(layer));
      }
    }
  });

  it("exports every value of every group on every template it is allowed on", () => {
    const [seed] = seeds(1);
    for (const template of Object.keys(config.baseTemplates)) {
      for (const group of SINGLE_GROUPS) {
        for (const value of Object.keys(config.traits[group])) {
          let plan;
          try {
            plan = planTraits(config, seed!, {base_template: template, [group]: value});
          } catch {
            continue; // not allowed on this template
          }
          for (const layer of layerStack(config, plan)) expect(exported.has(layer.key), layer.key).toBe(true);
        }
      }
      for (const icon of Object.keys(config.traits.micro_icons)) {
        let plan;
        try {
          plan = planTraits(config, seed!, {base_template: template, micro_icons: [icon]});
        } catch {
          continue;
        }
        for (const layer of layerStack(config, plan)) expect(exported.has(layer.key), layer.key).toBe(true);
      }
    }
  });

  it("starts with the opaque base and keeps every layer on the card", () => {
    for (const seed of seeds(500)) {
      const [base, ...rest] = layerStack(config, planTraits(config, seed));
      expect(base).toMatchObject({source: {kind: "base"}, blend: "over", left: 0, top: 0, width: size, height: size});
      for (const layer of rest) {
        expect(layer.source.kind).not.toBe("base");
        expect(layer.left).toBeGreaterThanOrEqual(0);
        expect(layer.top).toBeGreaterThanOrEqual(0);
        expect(layer.left + layer.width).toBeLessThanOrEqual(size);
        expect(layer.top + layer.height).toBeLessThanOrEqual(size);
      }
    }
  });

  it("screens the masked layers and places slot layers exactly where layout says", () => {
    const scale = outputScale(config.layout);
    for (const seed of seeds(500)) {
      const plan = planTraits(config, seed);
      for (const layer of layerStack(config, plan)) {
        if (layer.source.kind === "masked") expect(layer.blend).toBe("screen");
        if (layer.source.kind !== "slot") continue;
        const matches = [
          config.layout.slots.badge,
          config.layout.slots.easter_egg,
          ...Object.values(config.layout.slots.micro),
          ...Object.values(config.layout.slots.role)
        ].some((slot) => {
          const r = scaleSlot(slot, scale);
          return r.x === layer.left && r.y === layer.top && r.w === layer.width && r.h === layer.height;
        });
        expect(matches, layer.key).toBe(true);
      }
    }
  });

  it("draws layers in the order the spec gives", () => {
    const order = ["base", "backgrounds", "borders", "halos", "icons/micro", "icons/human", "icons/contract", "icons/ai", "badges", "easter_eggs"];
    const rank = (layer: Layer) => order.findIndex((part) => layer.key.startsWith(part) || layer.key.includes(`/${part}/`));
    for (const seed of seeds(500)) {
      const ranks = layerStack(config, planTraits(config, seed)).map(rank);
      expect(ranks.every((r) => r >= 0)).toBe(true);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });
});
