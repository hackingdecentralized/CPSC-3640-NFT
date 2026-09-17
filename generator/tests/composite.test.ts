import {describe, expect, it} from "vitest";
import {compositeLayer} from "../src/composite";
import {Rng} from "../src/random";

const card = (width: number, height: number, fill: number[]) =>
  Uint8Array.from({length: width * height * 3}, (_, i) => fill[i % 3]!);

describe("compositeLayer", () => {
  it("implements the W3C over and screen formulas for an opaque backdrop", () => {
    const rng = Rng.fromSeed("0123456789abcdef0123456789abcdef");
    for (let i = 0; i < 20000; i++) {
      const b = rng.below(256), s = rng.below(256), a = rng.below(256);
      const over = card(1, 1, [b, b, b]);
      compositeLayer(over, 1, Uint8Array.of(s, s, s, a), {left: 0, top: 0, width: 1, height: 1}, "over");
      expect(over[0]).toBe(Math.round(255 * ((s / 255) * (a / 255) + (b / 255) * (1 - a / 255))));

      const screen = card(1, 1, [b, b, b]);
      compositeLayer(screen, 1, Uint8Array.of(s, s, s, a), {left: 0, top: 0, width: 1, height: 1}, "screen");
      // Screen, then source-over by the layer's alpha: b + a*(B(b,s) - b), with B = b + s - b*s.
      const [bn, sn, an] = [b / 255, s / 255, a / 255];
      expect(screen[0]).toBe(Math.round(255 * (bn + an * (bn + sn - bn * sn - bn))));
    }
  });

  it("leaves the card alone where the layer is transparent, and paints it where opaque", () => {
    const target = card(2, 1, [10, 20, 30]);
    const layer = Uint8Array.of(200, 100, 50, 0, 200, 100, 50, 255);
    compositeLayer(target, 2, layer, {left: 0, top: 0, width: 2, height: 1}, "over");
    expect([...target]).toEqual([10, 20, 30, 200, 100, 50]);
  });

  it("places the layer at its offset and nowhere else", () => {
    const target = card(4, 3, [0, 0, 0]);
    const white = Uint8Array.from({length: 2 * 1 * 4}, () => 255);
    compositeLayer(target, 4, white, {left: 1, top: 2, width: 2, height: 1}, "over");
    const lit = [...target].flatMap((v, i) => (v ? [i / 3 | 0] : []));
    expect([...new Set(lit)]).toEqual([9, 10]);
  });

  it("refuses a layer that does not fit or does not match its size", () => {
    const target = card(4, 4, [0, 0, 0]);
    const pixel = Uint8Array.of(1, 2, 3, 4);
    expect(() => compositeLayer(target, 4, pixel, {left: 4, top: 0, width: 1, height: 1}, "over")).toThrow();
    expect(() => compositeLayer(target, 4, pixel, {left: 0, top: -1, width: 1, height: 1}, "over")).toThrow();
    expect(() => compositeLayer(target, 4, pixel, {left: 0, top: 0, width: 2, height: 1}, "over")).toThrow();
  });
});
