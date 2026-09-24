import {defineConfig} from "vite";
import {rmSync} from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * GitHub project pages are served from https://<user>.github.io/<repo>/, so the
 * production build must be told about the `/<repo>/` prefix or every asset URL
 * 404s. Dev server keeps `/` so `npm run dev` behaves normally.
 *
 * Override for a different repository name or a custom domain:
 *   VITE_BASE=/my-repo/ npm run build
 *   VITE_BASE=/ npm run build          # user page or custom domain
 */
export default defineConfig(({command}) => ({
  base: command === "build" ? (process.env.VITE_BASE ?? "/CPSC-3640-NFT/") : "/",
  plugins: [{
    name: "remove-unused-legacy-layers",
    closeBundle() {
      rmSync(fileURLToPath(new URL("./dist/nft", import.meta.url)), {recursive: true, force: true});
    }
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  },
  server: {port: 5173, strictPort: false}
}));
