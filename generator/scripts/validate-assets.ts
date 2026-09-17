/**
 * Check every asset the renderer can reach, before anything is generated.
 *
 *   - supplied templates are byte-for-byte unchanged
 *   - prepared bases and masks exist, are outputSize square, and are not stale
 *   - every mask is exactly zero over the protected text and outside the border
 *   - every overlay the configuration can select exists, renders, and has the
 *     right dimensions for its slot
 *
 *   npm run validate-assets
 */
import {createHash} from "node:crypto";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import sharp from "sharp";
import {loadConfig, outputScale, scaleOuter} from "../src/config";
import {fromRoot} from "../src/paths";
import {PREPARED_MANIFEST, maskPath, overlayPath} from "../src/assets";
import {NO_LAYER, ROLE_GROUPS, type RoleGroup} from "../src/types";
import {preparedFingerprint} from "../src/matte";
import {run} from "./cli";

run(async () => {
  const config = loadConfig();
  const {layout} = config;
  const size = layout.outputSize;
  const scale = outputScale(layout);
  const problems: string[] = [];
  const warnings: string[] = [];
  let checked = 0;

  const exists = (relativePath: string): boolean => {
    checked++;
    if (existsSync(fromRoot(relativePath))) return true;
    problems.push(`missing ${relativePath}`);
    return false;
  };

  // --- supplied templates ----------------------------------------------------
  for (const t of Object.values(config.baseTemplates)) {
    if (!exists(t.source)) continue;
    const actual = createHash("sha256").update(readFileSync(fromRoot(t.source))).digest("hex");
    if (actual !== t.sha256) problems.push(`${t.source} has changed since it was supplied (sha256 ${actual})`);
  }

  // --- prepared assets -------------------------------------------------------
  const manifestPath = fromRoot(PREPARED_MANIFEST);
  if (!existsSync(manifestPath)) {
    problems.push("assets have not been prepared. Run `npm run prepare-assets`.");
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const fingerprint = preparedFingerprint(layout);
    if (manifest.fingerprint !== fingerprint) {
      problems.push("prepared assets are stale (layout, matte settings or sharp changed). Run `npm run prepare-assets`.");
    }
  }

  const protectedRects = Object.values(layout.protected).map((r) => scaleOuter(r, scale));
  for (const [id, t] of Object.entries(config.baseTemplates)) {
    if (exists(t.asset)) {
      const meta = await sharp(fromRoot(t.asset)).metadata();
      if (meta.width !== size || meta.height !== size) problems.push(`${t.asset} is ${meta.width}x${meta.height}`);
    }
    if (!exists(maskPath(id))) continue;
    const {data, info} = await sharp(fromRoot(maskPath(id))).extractChannel(3).raw().toBuffer({resolveWithObject: true});
    if (info.width !== size || info.height !== size) {
      problems.push(`${maskPath(id)} is ${info.width}x${info.height}`);
      continue;
    }
    let leaks = 0;
    for (const r of protectedRects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) if (data[y * size + x] !== 0) leaks++;
      }
    }
    if (leaks > 0) problems.push(`${maskPath(id)} lets decoration through ${leaks} pixel(s) of protected text`);
    const outerTop = Math.floor(layout.border.outer.y * scale) - 1;
    let outside = 0;
    for (let i = 0; i < size; i++) {
      for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i], [i, outerTop]] as const) {
        if (data[y * size + x] !== 0) outside++;
      }
    }
    if (outside > 0) problems.push(`${maskPath(id)} lets decoration outside the border (${outside} px)`);
  }

  // --- overlays --------------------------------------------------------------
  const expectSize = async (relativePath: string, w: number, h: number) => {
    if (!exists(relativePath)) return;
    try {
      const svgText = readFileSync(fromRoot(relativePath), "utf8");
      const width = Number(/<svg[^>]*\bwidth="([\d.]+)"/.exec(svgText)?.[1]);
      const height = Number(/<svg[^>]*\bheight="([\d.]+)"/.exec(svgText)?.[1]);
      if (width !== w || height !== h) problems.push(`${relativePath} is ${width}x${height}, its slot is ${w}x${h}`);
      await sharp(fromRoot(relativePath)).png().toBuffer();
    } catch (error) {
      problems.push(`${relativePath} does not render: ${(error as Error).message}`);
    }
  };

  const referenced = new Set<string>();
  const want = async (relativePath: string, w: number, h: number) => {
    referenced.add(relativePath);
    await expectSize(relativePath, w, h);
  };
  const values = (group: keyof typeof config.traits) => Object.keys(config.traits[group]);
  const drawn = (key: keyof typeof NO_LAYER, value: string) => NO_LAYER[key] !== value;

  // Overlays are authored in the design space, whatever size is rendered.
  const design = layout.canvas;
  for (const v of values("background_style")) await want(overlayPath.background(v), design, design);
  for (const v of values("border_style")) if (drawn("border_style", v)) await want(overlayPath.border(v), design, design);
  for (const v of values("halo")) if (drawn("halo", v)) await want(overlayPath.halo(v), design, design);
  const micro = Object.values(layout.slots.micro)[0]!;
  for (const v of values("micro_icons")) await want(overlayPath.micro(v), micro.w, micro.h);
  for (const group of ROLE_GROUPS as readonly RoleGroup[]) {
    const slot = layout.slots.role[group];
    for (const v of values(group)) await want(overlayPath.role(group, v), slot.w, slot.h);
  }
  for (const v of values("badge")) {
    if (drawn("badge", v)) await want(overlayPath.badge(v), layout.slots.badge.w, layout.slots.badge.h);
  }
  for (const v of values("easter_egg")) {
    if (drawn("easter_egg", v)) await want(overlayPath.easterEgg(v), layout.slots.easter_egg.w, layout.slots.easter_egg.h);
  }

  // Files nothing can select are not an error, but usually mean a renamed trait.
  const walk = (dir: string): string[] =>
    readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [relative(fromRoot(), join(dir, e.name))]
    );
  if (existsSync(fromRoot("assets/overlays"))) {
    for (const file of walk(fromRoot("assets/overlays"))) {
      if (file.endsWith(".svg") && !referenced.has(file)) warnings.push(`${file} is not used by any trait`);
    }
  }

  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`All assets valid: ${checked} files checked, ${referenced.size} overlays, ${Object.keys(config.baseTemplates).length} templates.`);
});
