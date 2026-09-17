/**
 * How a layer is drawn onto the card.
 *
 * These are the W3C Compositing and Blending formulas for an opaque backdrop, which
 * is exactly what a browser canvas does for `source-over` and `screen`. The Node
 * renderer uses this function; the claim page lets its canvas do the same
 * arithmetic, so the two agree to within rounding.
 *
 * Values are 0-255. For a layer pixel with colour s and alpha a over card colour b:
 *   over:    b' = (s*a + b*(255 - a)) / 255
 *   screen:  b' = b + a*s*(255 - b) / 255^2
 */
import type {Blend} from "./layers";

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Draw an RGBA layer onto an opaque RGB card, in place. The layer must lie entirely
 * on the card; layers.ts guarantees that for every layer it produces.
 */
export function compositeLayer(
  card: Uint8Array,
  cardWidth: number,
  layer: Uint8Array,
  at: Placement,
  blend: Blend
): void {
  const {left, top, width, height} = at;
  const cardHeight = card.length / 3 / cardWidth;
  if (layer.length !== width * height * 4) throw new Error(`layer has ${layer.length} bytes, expected ${width * height * 4}`);
  if (left < 0 || top < 0 || left + width > cardWidth || top + height > cardHeight) {
    throw new Error(`layer at (${left},${top}) ${width}x${height} does not fit on the card`);
  }

  for (let y = 0; y < height; y++) {
    let from = y * width * 4;
    let to = ((top + y) * cardWidth + left) * 3;
    for (let x = 0; x < width; x++, from += 4, to += 3) {
      const a = layer[from + 3]!;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) {
        const b = card[to + c]!;
        const s = layer[from + c]!;
        card[to + c] =
          blend === "screen"
            ? Math.round(b + (a * s * (255 - b)) / 65025)
            : Math.round((s * a + b * (255 - a)) / 255);
      }
    }
  }
}
