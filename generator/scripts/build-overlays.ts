/**
 * Author every overlay as an SVG file (spec sections 6-9 and 13).
 *
 * Generated rather than hand-drawn so that every asset shares one palette, one
 * stroke weight and one set of proportions, and so random-looking layers such as
 * star fields are drawn from a fixed seed and come out identical on every run.
 *
 * The output files are committed: they are the "existing assets" that mint-time
 * rendering composes. Re-run this only to change the artwork.
 *
 *   npm run build-overlays
 */
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {loadConfig} from "../src/config";
import {fromRoot} from "../src/paths";
import {Rng} from "../src/random";
import {sha256Hex} from "../src/seed";
import {textPath, textUnits} from "../src/strokeFont";
import {overlayPath} from "../src/assets";
import {NO_LAYER, ROLE_GROUPS, type RoleGroup} from "../src/types";

/** Colours measured from the supplied templates. Nothing outside this set is used. */
const C = {
  gold: "#cd9133",
  goldBright: "#e8b64f",
  teal: "#5eb086",
  tealBright: "#7fd3a8",
  cream: "#f6efe4",
  bg: "#17171e",
  navy: "#1d3f86",
  navyDeep: "#10254f"
};

const config = loadConfig();
const {layout} = config;
const N = layout.canvas;
const HALO = {cx: layout.haloCenter.cx, cy: layout.haloCenter.cy};

const n1 = (value: number): string => (Math.round(value * 10) / 10).toString();

const svg = (w: number, h: number, body: string, defs = ""): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  (defs ? `<defs>${defs}</defs>` : "") +
  body +
  `</svg>\n`;

let written = 0;
const emit = (relativePath: string, content: string) => {
  const path = fromRoot(relativePath);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content);
  written++;
};

/** A seeded stream for one asset, so each star field is fixed forever. */
const assetRng = (name: string) => Rng.fromSeed(sha256Hex(`overlay:${name}`));
const unit = (rng: Rng) => rng.below(1_000_000) / 1_000_000;
const between = (rng: Rng, lo: number, hi: number) => lo + unit(rng) * (hi - lo);

const roundRect = (r: {x: number; y: number; w: number; h: number; r: number}, attrs: string) =>
  `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" fill="none" ${attrs}/>`;

// ---------------------------------------------------------------------------
// Backgrounds: full canvas, composited with `screen` and masked to the
// decorable area, so they only ever add light to empty background.
// ---------------------------------------------------------------------------

function starfield(name: string, count: number, bright: number): string {
  const rng = assetRng(name);
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const roll = unit(rng);
    const colour = roll < 0.8 ? C.cream : roll < 0.92 ? C.tealBright : C.goldBright;
    stars.push(
      `<circle cx="${n1(between(rng, 100, N - 100))}" cy="${n1(between(rng, 100, N - 100))}" ` +
        `r="${n1(between(rng, 1.1, 2.6))}" fill="${colour}" opacity="${n1(between(rng, 0.35, 0.9))}"/>`
    );
  }
  for (let i = 0; i < bright; i++) {
    const x = n1(between(rng, 140, N - 140));
    const y = n1(between(rng, 140, N - 140));
    const s = between(rng, 9, 17);
    stars.push(
      `<circle cx="${x}" cy="${y}" r="${n1(s * 1.6)}" fill="url(#glow)"/>` +
        `<path d="M${x} ${n1(+y - s)}L${n1(+x + s * 0.18)} ${n1(+y - s * 0.18)}L${n1(+x + s)} ${y}` +
        `L${n1(+x + s * 0.18)} ${n1(+y + s * 0.18)}L${x} ${n1(+y + s)}L${n1(+x - s * 0.18)} ${n1(+y + s * 0.18)}` +
        `L${n1(+x - s)} ${y}L${n1(+x - s * 0.18)} ${n1(+y - s * 0.18)}Z" fill="${C.cream}" opacity="0.85"/>`
    );
  }
  const defs =
    `<radialGradient id="glow"><stop offset="0" stop-color="${C.cream}" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="${C.cream}" stop-opacity="0"/></radialGradient>`;
  return svg(N, N, stars.join(""), defs);
}

function verticalGlow(): string {
  const rng = assetRng("vertical_glow");
  const shafts: string[] = [];
  for (let i = 0; i < 9; i++) {
    const cx = HALO.cx + between(rng, -620, 620);
    const rx = between(rng, 40, 120);
    const ry = between(rng, 520, 820);
    const cy = between(rng, 900, 1150);
    shafts.push(
      `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="url(#shaft)" ` +
        `opacity="${n1(between(rng, 0.45, 0.85))}"/>`
    );
  }
  const defs =
    `<radialGradient id="shaft"><stop offset="0" stop-color="${C.goldBright}" stop-opacity="0.42"/>` +
    `<stop offset="0.55" stop-color="${C.gold}" stop-opacity="0.16"/>` +
    `<stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>`;
  return svg(N, N, shafts.join(""), defs);
}

function gridOverlay(): string {
  const lines: string[] = [];
  for (let p = 0; p <= N; p += 64) {
    const major = p % 256 === 0;
    const attrs = `stroke="${C.teal}" stroke-width="${major ? 2 : 1.2}" opacity="${major ? 0.22 : 0.11}"`;
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="${N}" ${attrs}/>`);
    lines.push(`<line x1="0" y1="${p}" x2="${N}" y2="${p}" ${attrs}/>`);
  }
  for (let x = 256; x < N; x += 256) {
    for (let y = 256; y < N; y += 256) {
      lines.push(
        `<path d="M${x - 9} ${y}L${x + 9} ${y}M${x} ${y - 9}L${x} ${y + 9}" stroke="${C.tealBright}" stroke-width="2" opacity="0.4"/>`
      );
    }
  }
  return svg(N, N, lines.join(""));
}

function lightParticles(): string {
  const rng = assetRng("light_particles");
  const parts: string[] = [];
  for (let i = 0; i < 70; i++) {
    const gradient = unit(rng) < 0.55 ? "bokehGold" : "bokehTeal";
    parts.push(
      `<circle cx="${n1(between(rng, 110, N - 110))}" cy="${n1(between(rng, 110, N - 110))}" ` +
        `r="${n1(between(rng, 8, 34))}" fill="url(#${gradient})" opacity="${n1(between(rng, 0.4, 0.95))}"/>`
    );
  }
  for (let i = 0; i < 40; i++) {
    parts.push(
      `<circle cx="${n1(between(rng, 110, N - 110))}" cy="${n1(between(rng, 110, N - 110))}" ` +
        `r="${n1(between(rng, 1.5, 3.2))}" fill="${C.cream}" opacity="${n1(between(rng, 0.4, 0.8))}"/>`
    );
  }
  const bokeh = (id: string, colour: string) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="0.5"/>` +
    `<stop offset="0.7" stop-color="${colour}" stop-opacity="0.18"/>` +
    `<stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`;
  return svg(N, N, parts.join(""), bokeh("bokehGold", C.goldBright) + bokeh("bokehTeal", C.tealBright));
}

// ---------------------------------------------------------------------------
// Borders: drawn over the template's own border, adding to it rather than
// replacing it. gold_cyan_standard is the template's border as supplied.
// ---------------------------------------------------------------------------

const {outer, inner} = layout.border;

function doubleGold(): string {
  const inset = {x: inner.x + 14, y: inner.y + 14, w: inner.w - 28, h: inner.h - 28, r: 22};
  const mid = N / 2;
  const diamond = (x: number, y: number) =>
    `<path d="M${x} ${y - 11}L${x + 11} ${y}L${x} ${y + 11}L${x - 11} ${y}Z" fill="${C.goldBright}"/>`;
  return svg(
    N,
    N,
    roundRect(outer, `stroke="${C.gold}" stroke-width="3.5"`) +
      roundRect(inset, `stroke="${C.gold}" stroke-width="3" opacity="0.9"`) +
      diamond(mid, inset.y) +
      diamond(mid, inset.y + inset.h) +
      diamond(inset.x, mid) +
      diamond(inset.x + inset.w, mid)
  );
}

function cyanGlow(): string {
  const defs = `<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="10"/></filter>`;
  return svg(
    N,
    N,
    `<g filter="url(#soft)">${roundRect(outer, `stroke="${C.tealBright}" stroke-width="16" opacity="0.5"`)}</g>` +
      roundRect(outer, `stroke="${C.tealBright}" stroke-width="2.5" opacity="0.95"`) +
      roundRect(inner, `stroke="${C.teal}" stroke-width="1.5" opacity="0.7"`),
    defs
  );
}

function segmentedCircuit(): string {
  const parts = [roundRect(inner, `stroke="${C.teal}" stroke-width="3" stroke-dasharray="110 34" opacity="0.9"`)];
  const nodes: Array<[number, number, number, number]> = [];
  for (let t = 250; t <= N - 250; t += 180) {
    nodes.push([t, inner.y, 0, 1]);
    nodes.push([t, inner.y + inner.h, 0, -1]);
    nodes.push([inner.x, t, 1, 0]);
    nodes.push([inner.x + inner.w, t, -1, 0]);
  }
  nodes.forEach(([x, y, dx, dy], i) => {
    const colour = i % 2 === 0 ? C.goldBright : C.tealBright;
    if (i % 3 === 0) {
      parts.push(
        `<path d="M${x} ${y}L${x + dx * 22} ${y + dy * 22}" stroke="${colour}" stroke-width="2.5"/>` +
          `<circle cx="${x + dx * 22}" cy="${y + dy * 22}" r="4.5" fill="${colour}"/>`
      );
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="5.5" fill="${C.bg}" stroke="${colour}" stroke-width="2.5"/>`);
  });
  return svg(N, N, parts.join(""));
}

function softHolographic(): string {
  const defs =
    `<linearGradient id="holo" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${C.goldBright}"/><stop offset="0.25" stop-color="${C.cream}"/>` +
    `<stop offset="0.5" stop-color="${C.tealBright}"/><stop offset="0.75" stop-color="#6f8fd6"/>` +
    `<stop offset="1" stop-color="${C.goldBright}"/></linearGradient>`;
  return svg(
    N,
    N,
    roundRect(outer, `stroke="url(#holo)" stroke-width="18" opacity="0.18"`) +
      roundRect(outer, `stroke="url(#holo)" stroke-width="4.5" opacity="0.9"`) +
      roundRect(inner, `stroke="url(#holo)" stroke-width="1.8" opacity="0.6"`),
    defs
  );
}

// ---------------------------------------------------------------------------
// Halos: full canvas, `screen` blend, masked so they only light the background
// around the illustration and never the illustration itself.
// ---------------------------------------------------------------------------

function haloFill(id: string, colour: string, radius: number, stops: Array<[number, number]>): [string, string] {
  const defs =
    `<radialGradient id="${id}" cx="${HALO.cx}" cy="${HALO.cy}" r="${radius}" gradientUnits="userSpaceOnUse">` +
    stops.map(([o, a]) => `<stop offset="${o}" stop-color="${colour}" stop-opacity="${a}"/>`).join("") +
    `</radialGradient>`;
  return [defs, `<circle cx="${HALO.cx}" cy="${HALO.cy}" r="${radius}" fill="url(#${id})"/>`];
}

function softHalo(colour: string): string {
  const [defs, body] = haloFill("h", colour, 700, [
    [0, 0.6],
    [0.55, 0.5],
    [0.78, 0.18],
    [1, 0]
  ]);
  return svg(N, N, body, defs);
}

function dualHalo(): string {
  const [d1, b1] = haloFill("g", C.goldBright, 600, [
    [0, 0.6],
    [0.6, 0.42],
    [1, 0]
  ]);
  const [d2, b2] = haloFill("c", C.tealBright, 760, [
    [0, 0],
    [0.7, 0],
    [0.84, 0.42],
    [1, 0]
  ]);
  return svg(N, N, b1 + b2, d1 + d2);
}

function geometricRing(): string {
  const {cx, cy} = HALO;
  const hex = Array.from({length: 6}, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${n1(cx + 640 * Math.cos(a))} ${n1(cy + 640 * Math.sin(a))}`;
  });
  const ticks = Array.from({length: 72}, (_, i) => {
    const a = (2 * Math.PI * i) / 72;
    const r1 = i % 6 === 0 ? 566 : 574;
    return `M${n1(cx + r1 * Math.cos(a))} ${n1(cy + r1 * Math.sin(a))}L${n1(cx + 592 * Math.cos(a))} ${n1(cy + 592 * Math.sin(a))}`;
  }).join("");
  const [defs, glow] = haloFill("r", C.tealBright, 700, [
    [0, 0.18],
    [0.8, 0.14],
    [1, 0]
  ]);
  return svg(
    N,
    N,
    glow +
      `<circle cx="${cx}" cy="${cy}" r="600" fill="none" stroke="${C.tealBright}" stroke-width="3.5" opacity="0.75"/>` +
      `<path d="${ticks}" stroke="${C.teal}" stroke-width="2.5" opacity="0.7"/>` +
      `<path d="M${hex.join("L")}Z" fill="none" stroke="${C.goldBright}" stroke-width="3" opacity="0.65"/>`,
    defs
  );
}

// ---------------------------------------------------------------------------
// Icons. Every glyph is drawn in a 48-unit box and placed on a small dark disc,
// so it stays legible over any background and reads as an intended ornament.
// ---------------------------------------------------------------------------

const GLYPHS_48: Record<string, (stroke: string) => string> = {
  book: (s) =>
    `<path d="M24 12C18 8 9 8 4 11L4 38C9 35 18 35 24 39C30 35 39 35 44 38L44 11C39 8 30 8 24 12ZM24 12L24 39M9 17C13 16 17 16 20 18M9 23C13 22 17 22 20 24M28 18C31 16 35 16 39 17M28 24C31 22 35 22 39 23" fill="none" stroke="${s}"/>`,
  block: (s) =>
    `<path d="M24 5L42 15L42 35L24 45L6 35L6 15ZM6 15L24 25L42 15M24 25L24 45" fill="none" stroke="${s}"/>`,
  cube: (s) =>
    `<path d="M24 5L42 15L42 35L24 45L6 35L6 15ZM6 15L24 25L42 15M24 25L24 45" fill="none" stroke="${s}"/>`,
  chain: (s) =>
    `<g fill="none" stroke="${s}"><rect x="2" y="17" width="26" height="14" rx="7" transform="rotate(-35 15 24)"/>` +
    `<rect x="20" y="17" width="26" height="14" rx="7" transform="rotate(-35 33 24)"/></g>`,
  coin: (s) =>
    `<circle cx="24" cy="24" r="19" fill="none" stroke="${s}"/><circle cx="24" cy="24" r="13" fill="none" stroke="${s}" opacity="0.6"/>` +
    `<path d="M24 15L30 24L24 33L18 24Z" fill="${s}" opacity="0.9"/>`,
  chip: (s) =>
    `<rect x="12" y="12" width="24" height="24" rx="3" fill="none" stroke="${s}"/><rect x="18" y="18" width="12" height="12" rx="1.5" fill="${s}" opacity="0.5"/>` +
    `<path d="M18 12L18 5M24 12L24 5M30 12L30 5M18 36L18 43M24 36L24 43M30 36L30 43M12 18L5 18M12 24L5 24M12 30L5 30M36 18L43 18M36 24L43 24M36 30L43 30" stroke="${s}"/>`,
  spark: (s) =>
    `<path d="M24 3C26 17 31 22 45 24C31 26 26 31 24 45C22 31 17 26 3 24C17 22 22 17 24 3Z" fill="${s}"/>`,
  lock: (s) =>
    `<rect x="10" y="22" width="28" height="21" rx="4" fill="none" stroke="${s}"/><path d="M16 22L16 16C16 7 32 7 32 16L32 22" fill="none" stroke="${s}"/>` +
    `<circle cx="24" cy="31" r="3" fill="${s}"/><path d="M24 33L24 38" stroke="${s}"/>`,
  node: (s) =>
    `<path d="M24 24L9 11M24 24L41 14M24 24L22 42" stroke="${s}"/><circle cx="24" cy="24" r="6.5" fill="${s}"/>` +
    `<circle cx="9" cy="11" r="4.5" fill="none" stroke="${s}"/><circle cx="41" cy="14" r="4.5" fill="none" stroke="${s}"/><circle cx="22" cy="42" r="4.5" fill="none" stroke="${s}"/>`,
  person: (s) =>
    `<circle cx="24" cy="15" r="8" fill="none" stroke="${s}"/><path d="M9 43C9 31 39 31 39 43" fill="none" stroke="${s}"/>`,
  group: (s) =>
    `<circle cx="24" cy="15" r="7" fill="none" stroke="${s}"/><path d="M12 43C12 32 36 32 36 43" fill="none" stroke="${s}"/>` +
    `<circle cx="9" cy="19" r="5" fill="none" stroke="${s}" opacity="0.8"/><circle cx="39" cy="19" r="5" fill="none" stroke="${s}" opacity="0.8"/>` +
    `<path d="M2 38C2 31 8 28 13 30M46 38C46 31 40 28 35 30" fill="none" stroke="${s}" opacity="0.8"/>`,
  handshake: (s) =>
    `<path d="M2 26L11 18L19 21L27 17L36 18L46 26M11 18L11 29M36 18L36 29M19 21L14 27C13 29 15 31 17 30L23 26M21 30L26 34M25 27L31 31M29 24L34 28" fill="none" stroke="${s}"/>`,
  student: (s) =>
    `<path d="M24 4L43 11L24 18L5 11Z" fill="${s}" opacity="0.9"/><path d="M43 11L43 20" stroke="${s}"/>` +
    `<circle cx="24" cy="24" r="7" fill="none" stroke="${s}"/><path d="M10 45C10 35 38 35 38 45" fill="none" stroke="${s}"/>`,
  document: (s) =>
    `<path d="M11 4L30 4L38 12L38 44L11 44ZM30 4L30 12L38 12" fill="none" stroke="${s}"/><path d="M17 20L32 20M17 27L32 27M17 34L27 34" stroke="${s}"/>`,
  ledger: (s) =>
    `<rect x="8" y="5" width="32" height="38" rx="3" fill="none" stroke="${s}"/><path d="M18 5L18 43M8 15L40 15M8 24L40 24M8 33L40 33" stroke="${s}" opacity="0.8"/>`,
  network: (s) => {
    const a: Array<[number, number]> = [[7, 12], [7, 36]];
    const b: Array<[number, number]> = [[24, 6], [24, 24], [24, 42]];
    const c: Array<[number, number]> = [[41, 15], [41, 33]];
    const edges = [...a.flatMap((p) => b.map((q) => [p, q])), ...b.flatMap((p) => c.map((q) => [p, q]))]
      .map(([p, q]) => `M${p![0]} ${p![1]}L${q![0]} ${q![1]}`)
      .join("");
    const dots = [...a, ...b, ...c].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${s}"/>`).join("");
    return `<path d="${edges}" stroke="${s}" stroke-width="1.6" opacity="0.7"/>${dots}`;
  },
  spark_brain: (s) =>
    `<path d="M22 8C15 5 8 9 9 16C4 18 4 26 9 28C8 35 15 40 22 36M22 8L22 36M22 16C19 16 17 18 17 21M22 27C19 27 17 29 17 31" fill="none" stroke="${s}"/>` +
    `<path d="M36 6C37 13 39 15 45 16C39 17 37 19 36 26C35 19 33 17 27 16C33 15 35 13 36 6Z" fill="${s}"/>` +
    `<path d="M30 30L40 40M30 38L34 34" stroke="${s}" opacity="0.8"/>`,
  agent_node: (s) =>
    `<rect x="10" y="15" width="28" height="23" rx="6" fill="none" stroke="${s}"/><path d="M24 15L24 8M17 44L17 38M31 44L31 38" stroke="${s}"/>` +
    `<circle cx="24" cy="6" r="3" fill="${s}"/><circle cx="18" cy="25" r="3" fill="${s}"/><circle cx="30" cy="25" r="3" fill="${s}"/>` +
    `<path d="M18 31L30 31" stroke="${s}"/>`
};

function iconDisc(size: number, glyph: string, ring: string, glyphColour: string, strokeWidth: number): string {
  const c = size / 2;
  const glyphScale = (size * 0.5) / 48;
  const offset = c - 24 * glyphScale;
  return svg(
    size,
    size,
    `<circle cx="${c}" cy="${c}" r="${n1(c - 3)}" fill="${C.bg}" fill-opacity="0.88" stroke="${ring}" stroke-width="${n1(size / 40)}"/>` +
      `<g transform="translate(${n1(offset)} ${n1(offset)}) scale(${Math.round(glyphScale * 1000) / 1000})" ` +
      `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
      GLYPHS_48[glyph]!(glyphColour) +
      `</g>`
  );
}

const MICRO_ACCENT: Record<string, string> = {
  book: C.goldBright,
  block: C.tealBright,
  chain: C.tealBright,
  coin: C.goldBright,
  chip: C.tealBright,
  spark: C.goldBright,
  lock: C.goldBright,
  node: C.tealBright
};

const ROLE_ACCENT: Record<RoleGroup, string> = {
  human_icon: C.goldBright,
  contract_icon: C.tealBright,
  ai_icon: C.goldBright
};

// ---------------------------------------------------------------------------
// Badges: a seal with a glyph, and a label drawn in the stroke font.
// ---------------------------------------------------------------------------

type BadgeSpec = {label: string; ring: string; fill: string; glyph: (s: string) => string; accent: string};

const BADGE_GLYPHS: Record<string, (s: string) => string> = {
  genesis: (s) =>
    `<circle cx="40" cy="40" r="30" fill="none" stroke="${s}" stroke-dasharray="4 5" opacity="0.7"/>` +
    `<path d="M40 8C42 30 50 38 72 40C50 42 42 50 40 72C38 50 30 42 8 40C30 38 38 30 40 8Z" fill="${s}"/>` +
    `<path d="M40 24L43 37L56 40L43 43L40 56L37 43L24 40L37 37Z" fill="${C.bg}"/>`,
  early_minter: (s) =>
    `<path d="M8 54L72 54" stroke="${s}"/><path d="M22 54A18 18 0 0 1 58 54" fill="${s}" opacity="0.85"/>` +
    `<path d="M40 30L40 18M24 36L16 28M56 36L64 28M17 47L6 44M63 47L74 44" stroke="${s}"/>` +
    `<path d="M16 64L64 64M26 72L54 72" stroke="${s}" opacity="0.55"/>`,
  builder: (s) => {
    const cube = (x: number, y: number) =>
      `<path d="M${x} ${y - 13}L${x + 13} ${y - 6}L${x + 13} ${y + 8}L${x} ${y + 15}L${x - 13} ${y + 8}L${x - 13} ${y - 6}ZM${x - 13} ${y - 6}L${x} ${y + 1}L${x + 13} ${y - 6}M${x} ${y + 1}L${x} ${y + 15}" fill="none" stroke="${s}"/>`;
    return cube(27, 52) + cube(53, 52) + cube(40, 28);
  },
  researcher: (s) =>
    `<circle cx="34" cy="34" r="19" fill="none" stroke="${s}"/><path d="M48 48L68 68" stroke="${s}" stroke-width="8"/>` +
    `<path d="M34 23C35 30 37 32 44 34C37 35 35 37 34 45C33 37 31 35 24 34C31 32 33 30 34 23Z" fill="${s}" opacity="0.85"/>`,
  auditor: (s) =>
    `<path d="M40 7L66 17L66 39C66 56 54 66 40 73C26 66 14 56 14 39L14 17Z" fill="none" stroke="${s}"/>` +
    `<path d="M27 40L36 50L54 29" fill="none" stroke="${s}" stroke-width="6"/>`,
  project_deployer: (s) =>
    `<path d="M40 5C53 16 55 34 51 50L29 50C25 34 27 16 40 5Z" fill="none" stroke="${s}"/>` +
    `<circle cx="40" cy="27" r="6" fill="${s}"/><path d="M29 42L18 57L30 53ZM51 42L62 57L50 53Z" fill="${s}" opacity="0.85"/>` +
    `<path d="M34 55L40 74L46 55" fill="none" stroke="${C.goldBright}"/>`,
  honors: (s) => {
    const leaves = (side: 1 | -1) =>
      Array.from({length: 6}, (_, i) => {
        const a = Math.PI * (0.95 - i * 0.13);
        const x = 40 + side * 30 * Math.cos(a) * -1;
        const y = 44 + 30 * Math.sin(a) * 0.9;
        const rot = side === 1 ? (i * 22 - 40) : (40 - i * 22);
        return `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="4" ry="9" transform="rotate(${rot} ${n1(x)} ${n1(y)})" fill="${s}"/>`;
      }).join("");
    return (
      leaves(1) +
      leaves(-1) +
      `<path d="M40 14L43 23L52 23L45 29L48 38L40 32L32 38L35 29L28 23L37 23Z" fill="${C.goldBright}"/>`
    );
  },
  ta_edition: (s) =>
    `<path d="M40 12L74 27L40 42L6 27Z" fill="${s}"/><path d="M22 34L22 49C22 58 58 58 58 49L58 34" fill="none" stroke="${s}"/>` +
    `<path d="M74 27L74 47" stroke="${s}"/><circle cx="74" cy="50" r="3.5" fill="${s}"/>`,
  staff: (s) =>
    `<circle cx="25" cy="40" r="14" fill="none" stroke="${s}"/><circle cx="25" cy="40" r="5" fill="${s}"/>` +
    `<path d="M39 40L72 40M60 40L60 52M68 40L68 49" fill="none" stroke="${s}"/>`
};

const BADGES: Record<string, BadgeSpec> = {
  genesis: {label: "GENESIS", ring: C.goldBright, fill: C.bg, glyph: BADGE_GLYPHS.genesis!, accent: C.goldBright},
  early_minter: {label: "EARLY MINTER", ring: C.goldBright, fill: C.bg, glyph: BADGE_GLYPHS.early_minter!, accent: C.goldBright},
  builder: {label: "BUILDER", ring: C.tealBright, fill: C.bg, glyph: BADGE_GLYPHS.builder!, accent: C.tealBright},
  researcher: {label: "RESEARCHER", ring: C.tealBright, fill: C.bg, glyph: BADGE_GLYPHS.researcher!, accent: C.tealBright},
  auditor: {label: "AUDITOR", ring: C.tealBright, fill: C.bg, glyph: BADGE_GLYPHS.auditor!, accent: C.tealBright},
  project_deployer: {label: "DEPLOYER", ring: C.tealBright, fill: C.bg, glyph: BADGE_GLYPHS.project_deployer!, accent: C.tealBright},
  honors: {label: "HONORS", ring: C.goldBright, fill: C.bg, glyph: BADGE_GLYPHS.honors!, accent: C.goldBright},
  ta_edition: {label: "TA EDITION", ring: C.goldBright, fill: C.navyDeep, glyph: BADGE_GLYPHS.ta_edition!, accent: C.cream},
  staff: {label: "STAFF", ring: C.goldBright, fill: C.navyDeep, glyph: BADGE_GLYPHS.staff!, accent: C.cream}
};

const LONGEST_LABEL = Math.max(...Object.values(BADGES).map((b) => textUnits(b.label)));

function badge(spec: BadgeSpec): string {
  const w = layout.slots.badge.w;
  const h = layout.slots.badge.h;
  const cx = w / 2;
  const cy = 90;
  const ticks = Array.from({length: 40}, (_, i) => {
    const a = (2 * Math.PI * i) / 40;
    return `M${n1(cx + 72 * Math.cos(a))} ${n1(cy + 72 * Math.sin(a))}L${n1(cx + 79 * Math.cos(a))} ${n1(cy + 79 * Math.sin(a))}`;
  }).join("");
  // One letter size for every badge, fitted to the longest label.
  const labelScale = (w - 40) / LONGEST_LABEL;
  const ribbon = {x: 8, y: h - 44, w: w - 16, h: 36};
  return svg(
    w,
    h,
    `<circle cx="${cx}" cy="${cy}" r="82" fill="${spec.fill}" fill-opacity="0.94" stroke="${spec.ring}" stroke-width="3.5"/>` +
      `<path d="${ticks}" stroke="${spec.ring}" stroke-width="2.2" opacity="0.8"/>` +
      `<circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="${spec.ring}" stroke-width="1.5" opacity="0.6"/>` +
      `<g transform="translate(${cx - 40} ${cy - 40})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">` +
      spec.glyph(spec.accent) +
      `</g>` +
      `<rect x="${ribbon.x}" y="${ribbon.y}" width="${ribbon.w}" height="${ribbon.h}" rx="11" fill="${spec.fill}" fill-opacity="0.94" stroke="${spec.ring}" stroke-width="2.5"/>` +
      `<path d="${textPath(spec.label, cx, ribbon.y + ribbon.h / 2, labelScale)}" fill="none" stroke="${C.cream}" ` +
      `stroke-width="${n1(labelScale * 0.62)}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

// ---------------------------------------------------------------------------
// Easter eggs: small and easy to miss.
// ---------------------------------------------------------------------------

function easterEgg(name: string): string {
  const s = layout.slots.easter_egg.w;
  const k = s / 56;
  const body: Record<string, string> = {
    tiny_eth_gem:
      `<path d="M28 3L45 29L28 39L11 29Z" fill="${C.tealBright}" fill-opacity="0.45" stroke="${C.cream}" stroke-width="2"/>` +
      `<path d="M11 33L28 53L45 33L28 43Z" fill="${C.tealBright}" fill-opacity="0.3" stroke="${C.cream}" stroke-width="2"/>` +
      `<path d="M28 3L28 39" stroke="${C.cream}" stroke-width="1.2" opacity="0.6"/>`,
    tiny_bulldog:
      `<path d="M14 18L7 9L19 13ZM42 18L49 9L37 13Z" fill="#8d5a3c"/>` +
      `<path d="M28 12C40 12 48 18 48 30C48 44 40 50 28 50C16 50 8 44 8 30C8 18 16 12 28 12Z" fill="#e6d6bd"/>` +
      `<circle cx="20" cy="27" r="2.6" fill="${C.bg}"/><circle cx="36" cy="27" r="2.6" fill="${C.bg}"/>` +
      `<ellipse cx="28" cy="34" rx="6" ry="4" fill="${C.bg}"/>` +
      `<path d="M28 38L28 42M20 42C24 46 32 46 36 42" fill="none" stroke="#7a6a58" stroke-width="2" stroke-linecap="round"/>` +
      `<rect x="16" y="50" width="24" height="5" rx="2.5" fill="${C.navy}"/>`,
    tiny_yale_y:
      `<circle cx="28" cy="28" r="24" fill="${C.navy}" fill-opacity="0.9" stroke="${C.goldBright}" stroke-width="2"/>` +
      `<path d="${textPath("Y", 28, 28, 5.2)}" fill="none" stroke="${C.cream}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    tiny_lock:
      `<rect x="13" y="26" width="30" height="23" rx="5" fill="${C.goldBright}" fill-opacity="0.35" stroke="${C.goldBright}" stroke-width="3"/>` +
      `<path d="M19 26L19 19C19 9 37 9 37 19L37 26" fill="none" stroke="${C.goldBright}" stroke-width="3"/>` +
      `<circle cx="28" cy="36" r="3.5" fill="${C.cream}"/>`,
    rare_blue_flame:
      `<path d="M28 3C37 15 46 24 44 37C43 47 36 53 28 53C20 53 13 47 12 37C11 26 21 20 23 9C26 16 28 18 28 3Z" fill="url(#flame)"/>` +
      `<path d="M28 22C33 30 38 35 37 42C36 48 32 51 28 51C24 51 20 48 19 42C19 36 25 33 26 27C27 31 28 31 28 22Z" fill="${C.cream}" opacity="0.75"/>`
  };
  const defs =
    name === "rare_blue_flame"
      ? `<linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#3f7fff"/>` +
        `<stop offset="0.6" stop-color="#5ec8ff"/><stop offset="1" stop-color="${C.tealBright}"/></linearGradient>`
      : "";
  return svg(s, s, `<g transform="scale(${Math.round(k * 100) / 100})">${body[name]!}</g>`, defs);
}

// ---------------------------------------------------------------------------

function main() {
  const values = (group: keyof typeof config.traits) => Object.keys(config.traits[group]);

  const backgrounds: Record<string, () => string> = {
    plain_starfield: () => starfield("plain_starfield", 150, 4),
    dense_starfield: () => starfield("dense_starfield", 520, 22),
    vertical_glow: verticalGlow,
    grid_overlay: gridOverlay,
    light_particles: lightParticles
  };
  const borders: Record<string, () => string> = {
    double_gold: doubleGold,
    cyan_glow: cyanGlow,
    segmented_circuit: segmentedCircuit,
    soft_holographic: softHolographic
  };
  const halos: Record<string, () => string> = {
    soft_gold: () => softHalo(C.goldBright),
    soft_cyan: () => softHalo(C.tealBright),
    dual_gold_cyan: dualHalo,
    geometric_ring: geometricRing
  };

  const require = <T>(table: Record<string, T>, value: string, group: string): T => {
    const entry = table[value];
    if (!entry) throw new Error(`build-overlays has no artwork for ${group} "${value}"`);
    return entry;
  };

  for (const v of values("background_style")) emit(overlayPath.background(v), require(backgrounds, v, "background_style")());
  for (const v of values("border_style")) {
    if (v !== NO_LAYER.border_style) emit(overlayPath.border(v), require(borders, v, "border_style")());
  }
  for (const v of values("halo")) {
    if (v !== NO_LAYER.halo) emit(overlayPath.halo(v), require(halos, v, "halo")());
  }

  const microSize = Math.max(...Object.values(layout.slots.micro).map((slot) => slot.w));
  for (const v of values("micro_icons")) {
    require(GLYPHS_48, v, "micro_icons");
    emit(overlayPath.micro(v), iconDisc(microSize, v, MICRO_ACCENT[v] ?? C.tealBright, MICRO_ACCENT[v] ?? C.tealBright, 3.4));
  }
  for (const group of ROLE_GROUPS) {
    const size = layout.slots.role[group].w;
    for (const v of values(group)) {
      require(GLYPHS_48, v, group);
      emit(overlayPath.role(group, v), iconDisc(size, v, ROLE_ACCENT[group], C.cream, 3.6));
    }
  }
  for (const v of values("badge")) {
    if (v !== NO_LAYER.badge) emit(overlayPath.badge(v), badge(require(BADGES, v, "badge")));
  }
  for (const v of values("easter_egg")) {
    if (v !== NO_LAYER.easter_egg) emit(overlayPath.easterEgg(v), easterEgg(v));
  }
  console.log(`Wrote ${written} overlay files under assets/overlays/`);
}

main();
