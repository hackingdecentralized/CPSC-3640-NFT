/**
 * Render a batch of preview NFTs and an HTML page to inspect them (spec section 21).
 *
 *   npm run preview -- --count 20
 *
 * Uses fixed test wallets, token ids 1..count and the public preview salt, so the
 * batch is identical on every run. Output: output/preview/
 */
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import sharp from "sharp";
import {loadConfig} from "../src/loadConfig";
import {generateNFT} from "../src/generator";
import {fromRoot} from "../src/paths";
import {PUBLIC_PREVIEW_SALT, TEST_WALLETS, intArg, parseArgs, run} from "./cli";
import {escapeHtml, mapLimit, page} from "./html";

const RARE = new Set(["bulldog_special", "tiny_eth_gem", "tiny_bulldog", "tiny_yale_y", "tiny_lock", "rare_blue_flame", "honors", "ta_edition", "staff"]);

run(async () => {
  const count = intArg(parseArgs(), "count", 20);
  const config = loadConfig();
  const dir = fromRoot("output", "preview");
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(join(dir, "thumbs"), {recursive: true});

  const started = Date.now();
  const tokens = Array.from({length: count}, (_, i) => i + 1);
  const results = await mapLimit(tokens, 3, async (tokenId) => {
    const wallet = TEST_WALLETS[(tokenId - 1) % TEST_WALLETS.length]!;
    const result = await generateNFT({tokenId, walletAddress: wallet, salt: PUBLIC_PREVIEW_SALT, outputDir: dir}, config);
    await sharp(result.imagePath).resize(600, 600).webp({quality: 84}).toFile(join(dir, "thumbs", `${result.tokenId}.webp`));
    process.stdout.write(`  #${result.tokenId} ${result.traits.base_template}\n`);
    return {...result, wallet};
  });

  const templateCounts = new Map<string, number>();
  for (const r of results) templateCounts.set(r.traits.base_template, (templateCounts.get(r.traits.base_template) ?? 0) + 1);

  const cards = results
    .map((r) => {
      const rows = r.metadata.attributes
        .map((a) => {
          const values = a.value.split("+");
          const cell = values.map((v) => `<span class="pill${RARE.has(v) ? " rare" : ""}">${escapeHtml(v)}</span>`).join("");
          return `<tr><td>${escapeHtml(a.trait_type)}</td><td>${cell}</td></tr>`;
        })
        .join("");
      return (
        `<article class="card"><a href="images/${r.tokenId}.png"><img src="thumbs/${r.tokenId}.webp" alt="Token ${r.tokenId}" loading="lazy"></a>` +
        `<div class="body"><h3>Token #${r.tokenId} &middot; ${escapeHtml(config.baseTemplates[r.traits.base_template]!.label)}</h3>` +
        `<div class="muted mono">wallet ${r.wallet.slice(0, 10)}&hellip; &middot; seed ${r.seed.slice(0, 12)}&hellip;</div>` +
        `<table>${rows}</table>` +
        `<div class="muted" style="margin-top:8px">micro icon slots: ${r.plan.microIconSlots.length ? r.plan.microIconSlots.map(escapeHtml).join(", ") : "none"}</div>` +
        `</div></article>`
      );
    })
    .join("");

  const summary = [...templateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="pill${RARE.has(t) ? " rare" : ""}">${escapeHtml(t)} &times; ${n}</span>`)
    .join("");

  writeFileSync(
    join(dir, "index.html"),
    page(
      `CPSC 3640/5400 NFT preview (${count})`,
      `<h1>Course NFT preview</h1>` +
        `<p class="lede">${count} deterministic previews: token ids 1&ndash;${count}, Anvil test wallets, public preview salt ` +
        `<code>${escapeHtml(PUBLIC_PREVIEW_SALT)}</code>. Click an image for the full ${config.layout.outputSize}&times;${config.layout.outputSize} PNG. Gold pills are rare values.</p>` +
        `<div>${summary}</div><h2>Tokens</h2><div class="grid">${cards}</div>`
    )
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nRendered ${count} previews in ${seconds}s -> ${relative(fromRoot(), join(dir, "index.html"))}`);
});
