/** Shared command-line helpers for the generator scripts. */
import {existsSync, readFileSync} from "node:fs";
import {fromRoot} from "../src/paths";

export type Args = Record<string, string | true>;

/** `--key value`, `--key=value`, and bare `--flag`. */
export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}"`);
    const [key, inline] = token.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (inline !== undefined) {
      args[key] = inline;
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      args[key] = argv[++i]!;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function stringArg(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === true) throw new Error(`--${key} needs a value`);
  return value;
}

export function intArg(args: Args, key: string, fallback: number): number {
  const value = stringArg(args, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`--${key} must be a positive integer`);
  return parsed;
}

/**
 * Fill in the named variables from generator/.env, then from the repository's .env,
 * without overriding the real environment. Only the names asked for are read, so a
 * script that needs an RPC URL never also loads the deployer's key. Kept
 * dependency-free: KEY=value lines, # comments, optional quotes.
 */
export function loadDotEnv(names: readonly string[]): void {
  for (const path of [fromRoot(".env"), fromRoot("..", ".env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || line.trim().startsWith("#")) continue;
      const [, key, raw] = match as unknown as [string, string, string];
      if (!names.includes(key) || process.env[key]) continue;
      const value = raw.replace(/^(['"])(.*)\1$/, "$2");
      if (value) process.env[key] = value;
    }
  }
}

/** Anvil's deterministic accounts. Public test addresses, safe for previews. */
export const TEST_WALLETS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"
];

/**
 * The salt for previews and rarity simulations, which are samples rather than the
 * collection. The live collection's salt is in config/collection.json.
 */
export const PUBLIC_PREVIEW_SALT = "cpsc3640-public-preview-salt";

export function run(main: () => Promise<void> | void): void {
  Promise.resolve()
    .then(main)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
