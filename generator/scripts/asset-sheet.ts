/**
 * A visual asset preview sheet (spec section 19): the page to look at before
 * trusting a batch.
 *
 *   1. every base template with its protected text regions and every slot drawn on
 *   2. what each template's decorable mask allows
 *   3. one showcase render per template, with its busiest legal trait set
 *   4. every overlay on its own
 *
 *   npm run asset-sheet      -> output/asset-sheet/index.html
 */
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import sharp from "sharp";
import {allSlots, slotRect} from "../src/config";
import {loadConfig} from "../src/loadConfig";
import {maskPath, overlayPath} from "../src/assets";
import {fromRoot} from "../src/paths";
import {renderImage} from "../src/renderer";
import {deriveSeed} from "../src/seed";
import {planTraits, type ForcedTraits} from "../src/traits";
import {NO_LAYER, ROLE_GROUPS} from "../src/types";
import {PUBLIC_PREVIEW_SALT, TEST_WALLETS, run} from "./cli";
import {escapeHtml, page} from "./html";

const SHOWCASE: Record<string, ForcedTraits> = {
  tower_clock: {background_style: "dense_starfield", border_style: "segmented_circuit", halo: "soft_gold", micro_icons: ["book", "lock"], badge: "genesis", easter_egg: "tiny_eth_gem"},
  knowledge_tree: {background_style: "light_particles", border_style: "cyan_glow", halo: "soft_cyan", micro_icons: ["node", "spark"], badge: "researcher", easter_egg: "tiny_lock"},
  gothic_gate: {background_style: "vertical_glow", border_style: "double_gold", halo: "soft_gold", micro_icons: ["book"], badge: "honors", easter_egg: "none"},
  modern_cube: {background_style: "grid_overlay", border_style: "segmented_circuit", halo: "geometric_ring", micro_icons: ["chip", "block"], badge: "auditor", easter_egg: "none"},
  yale_shield: {background_style: "plain_starfield", border_style: "double_gold", halo: "soft_gold", micro_icons: ["coin"], badge: "staff", easter_egg: "tiny_yale_y"},
  bulldog_special: {background_style: "light_particles", border_style: "soft_holographic", halo: "dual_gold_cyan", micro_icons: ["chain", "chip"], badge: "early_minter", easter_egg: "tiny_bulldog"}
};

run(async () => {
  const config = loadConfig();
  const {layout} = config;
  const dir = fromRoot("output", "asset-sheet");
  rmSync(join(dir, "img"), {recursive: true, force: true});
  mkdirSync(join(dir, "img"), {recursive: true});
  const thumb = (input: Buffer | string, name: string, size = 520) =>
    sharp(input).resize(size, size).webp({quality: 86}).toFile(join(dir, "img", name));

  // 1 + 2: bases with regions, and masks.
  const regionSvg =
    `<svg viewBox="0 0 ${layout.canvas} ${layout.canvas}" class="over">` +
    Object.entries(layout.protected)
      .map(([name, r]) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" class="prot"><title>${name}</title></rect>`)
      .join("") +
    allSlots(layout)
      .map(([name, s]) => {
        const r = slotRect(s);
        return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" class="slot"><title>${name}</title></rect>`;
      })
      .join("") +
    `<circle cx="${layout.haloCenter.cx}" cy="${layout.haloCenter.cy}" r="14" class="centre"/>` +
    `</svg>`;

  const baseCards: string[] = [];
  const maskCards: string[] = [];
  for (const [id, t] of Object.entries(config.baseTemplates)) {
    await thumb(fromRoot(t.asset), `base-${id}.webp`);
    baseCards.push(
      `<article class="card"><div class="frame"><img src="img/base-${id}.webp" alt="${id}">${regionSvg}</div>` +
        `<div class="body"><h3>${escapeHtml(t.label)}</h3><div class="muted mono">${id} &middot; weight ${t.weight}%</div></div></article>`
    );
    const alpha = await sharp(fromRoot(maskPath(id))).extractChannel(3).toBuffer();
    const tint = await sharp({create: {width: layout.outputSize, height: layout.outputSize, channels: 3, background: "#3ddc84"}})
      .joinChannel(alpha)
      .png()
      .toBuffer();
    const shown = await sharp(fromRoot(t.asset)).modulate({brightness: 0.55}).composite([{input: tint}]).png().toBuffer();
    await thumb(shown, `mask-${id}.webp`);
    maskCards.push(
      `<article class="card"><img src="img/mask-${id}.webp" alt="${id} mask"><div class="body"><h3>${escapeHtml(t.label)}</h3>` +
        `<div class="muted">green: where backgrounds and halos may paint</div></div></article>`
    );
  }

  // 3: showcase renders.
  const showcaseCards: string[] = [];
  for (const [id, forced] of Object.entries(SHOWCASE)) {
    const plan = planTraits(config, deriveSeed(1, TEST_WALLETS[0]!, PUBLIC_PREVIEW_SALT), {base_template: id, ...forced});
    const image = await renderImage(config, plan);
    writeFileSync(join(dir, "img", `showcase-${id}.png`), image);
    await thumb(image, `showcase-${id}.webp`, 700);
    const traits = Object.entries(plan.traits)
      .filter(([k]) => k !== "base_template")
      .map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(Array.isArray(v) ? v.join(" + ") || "none" : v)}</td></tr>`)
      .join("");
    showcaseCards.push(
      `<article class="card"><a href="img/showcase-${id}.png"><img src="img/showcase-${id}.webp" alt="${id} showcase"></a>` +
        `<div class="body"><h3>${escapeHtml(config.baseTemplates[id]!.label)}</h3><table>${traits}</table></div></article>`
    );
  }

  // 4: every overlay.
  const tile = async (relativePath: string, label: string, dark = true) => {
    const name = relativePath.replace(/[^a-z0-9]+/gi, "-") + ".webp";
    const svg = readFileSync(fromRoot(relativePath));
    const rendered = await sharp(svg, {density: 144}).resize(260, 260, {fit: "contain", background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();
    await sharp({create: {width: 260, height: 260, channels: 3, background: dark ? "#17171e" : "#2a2733"}})
      .composite([{input: rendered}])
      .webp({quality: 88})
      .toFile(join(dir, "img", name));
    return `<figure class="tile"><img src="img/${name}" alt="${escapeHtml(label)}"><figcaption class="mono">${escapeHtml(label)}</figcaption></figure>`;
  };
  const group = async (title: string, items: Array<[string, string]>) =>
    `<h3>${escapeHtml(title)}</h3><div class="tiles">${(await Promise.all(items.map(([p, l]) => tile(p, l)))).join("")}</div>`;
  const vals = (g: keyof typeof config.traits) => Object.keys(config.traits[g]);
  const drawn = (key: keyof typeof NO_LAYER, v: string) => NO_LAYER[key] !== v;

  const overlays = [
    await group("Backgrounds", vals("background_style").map((v) => [overlayPath.background(v), v])),
    await group("Borders", vals("border_style").filter((v) => drawn("border_style", v)).map((v) => [overlayPath.border(v), v])),
    await group("Halos", vals("halo").filter((v) => drawn("halo", v)).map((v) => [overlayPath.halo(v), v])),
    await group("Micro icons", vals("micro_icons").map((v) => [overlayPath.micro(v), v])),
    ...(await Promise.all(ROLE_GROUPS.map((g) => group(g, vals(g).map((v) => [overlayPath.role(g, v), v]))))),
    await group("Badges", vals("badge").filter((v) => drawn("badge", v)).map((v) => [overlayPath.badge(v), v])),
    await group("Easter eggs", vals("easter_egg").filter((v) => drawn("easter_egg", v)).map((v) => [overlayPath.easterEgg(v), v]))
  ].join("");

  const style = `<style>
    .frame { position:relative; } .frame .over { position:absolute; inset:0; width:100%; height:100%; }
    .prot { fill:rgba(255,70,70,.18); stroke:#ff5a5a; stroke-width:6; stroke-dasharray:24 14; }
    .slot { fill:rgba(127,211,168,.15); stroke:#7fd3a8; stroke-width:5; }
    .centre { fill:#e8b64f; }
    .tiles { display:flex; flex-wrap:wrap; gap:12px; } .tile { margin:0; width:130px; }
    .tile img { width:130px; height:130px; border-radius:8px; border:1px solid var(--line); }
    .tile figcaption { font-size:11px; color:var(--muted); margin-top:4px; word-break:break-all; }
    h3 { margin:22px 0 10px; font-size:14px; }
  </style>`;

  writeFileSync(
    join(dir, "index.html"),
    page(
      "CPSC 3640/5400 NFT asset sheet",
      style +
        `<h1>Asset sheet</h1><p class="lede">Check this before trusting a batch. Red dashed boxes are protected course text: ` +
        `nothing may draw there, and the render tests prove nothing does. Green boxes are the fixed slots for icons, the badge ` +
        `and the easter egg. The gold dot is the halo centre.</p>` +
        `<h2>1. Base templates, regions and slots</h2><div class="grid">${baseCards.join("")}</div>` +
        `<h2>2. Where backgrounds and halos may paint</h2><div class="grid">${maskCards.join("")}</div>` +
        `<h2>3. Showcase: one busy render per template</h2><div class="grid">${showcaseCards.join("")}</div>` +
        `<h2>4. Every overlay</h2>${overlays}`
    )
  );
  console.log("Wrote output/asset-sheet/index.html");
});
