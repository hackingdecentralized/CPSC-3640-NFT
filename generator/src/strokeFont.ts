/**
 * A tiny uppercase stroke font, drawn as SVG paths.
 *
 * SVG <text> renders with whatever fonts the machine happens to have, so the same
 * token would look different on a laptop and in CI. Paths render identically
 * everywhere, which the determinism requirement needs.
 *
 * Glyphs live on a 4 x 6 grid, y pointing down.
 */
const GLYPHS: Record<string, string> = {
  A: "M0 6L0 2L2 0L4 2L4 6M0 4L4 4",
  B: "M0 3L0 0L3 0L4 1L4 2L3 3L0 3L0 6L3 6L4 5L4 4L3 3",
  C: "M4 1L3 0L1 0L0 1L0 5L1 6L3 6L4 5",
  D: "M0 0L0 6L2.5 6L4 4.5L4 1.5L2.5 0L0 0",
  E: "M4 0L0 0L0 6L4 6M0 3L3 3",
  F: "M4 0L0 0L0 6M0 3L3 3",
  G: "M4 1L3 0L1 0L0 1L0 5L1 6L3 6L4 5L4 3L2 3",
  H: "M0 0L0 6M4 0L4 6M0 3L4 3",
  I: "M1 0L3 0M2 0L2 6M1 6L3 6",
  J: "M4 0L4 5L3 6L1 6L0 5",
  K: "M0 0L0 6M4 0L0 4M1.4 3L4 6",
  L: "M0 0L0 6L4 6",
  M: "M0 6L0 0L2 3L4 0L4 6",
  N: "M0 6L0 0L4 6L4 0",
  O: "M1 0L3 0L4 1L4 5L3 6L1 6L0 5L0 1L1 0",
  P: "M0 6L0 0L3 0L4 1L4 2L3 3L0 3",
  Q: "M1 0L3 0L4 1L4 5L3 6L1 6L0 5L0 1L1 0M2.5 4.5L4 6",
  R: "M0 6L0 0L3 0L4 1L4 2L3 3L0 3M2 3L4 6",
  S: "M4 1L3 0L1 0L0 1L0 2L1 3L3 3L4 4L4 5L3 6L1 6L0 5",
  T: "M0 0L4 0M2 0L2 6",
  U: "M0 0L0 5L1 6L3 6L4 5L4 0",
  V: "M0 0L2 6L4 0",
  W: "M0 0L1 6L2 3L3 6L4 0",
  X: "M0 0L4 6M4 0L0 6",
  Y: "M0 0L2 3L4 0M2 3L2 6",
  Z: "M0 0L4 0L0 6L4 6"
};

const GLYPH_WIDTH = 4;
const GLYPH_HEIGHT = 6;
const LETTER_GAP = 1.6;
const SPACE_WIDTH = 3;

/** Width of `text` in grid units. */
export function textUnits(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += text[i] === " " ? SPACE_WIDTH : GLYPH_WIDTH;
    if (i < text.length - 1 && text[i] !== " " && text[i + 1] !== " ") width += LETTER_GAP;
  }
  return width;
}

/**
 * `text` as one SVG path, horizontally centred on `cx`, vertically centred on `cy`,
 * with each grid unit `scale` pixels wide.
 */
export function textPath(text: string, cx: number, cy: number, scale: number): string {
  const upper = text.toUpperCase();
  let x = cx - (textUnits(upper) * scale) / 2;
  const top = cy - (GLYPH_HEIGHT * scale) / 2;
  const parts: string[] = [];
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i]!;
    if (ch === " ") {
      x += SPACE_WIDTH * scale;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`strokeFont has no glyph for "${ch}"`);
    const ox = x;
    parts.push(
      glyph.replace(/([ML])([\d.]+) ([\d.]+)/g, (_, cmd: string, gx: string, gy: string) =>
        `${cmd}${round(ox + Number(gx) * scale)} ${round(top + Number(gy) * scale)}`
      )
    );
    x += GLYPH_WIDTH * scale;
    if (i < upper.length - 1 && upper[i + 1] !== " ") x += LETTER_GAP * scale;
  }
  return parts.join("");
}

const round = (n: number): string => (Math.round(n * 10) / 10).toString();

export const STROKE_FONT_HEIGHT = GLYPH_HEIGHT;
