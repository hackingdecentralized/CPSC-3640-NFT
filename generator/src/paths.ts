import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

/** The generator package root. Every configured path is relative to it. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const fromRoot = (...parts: string[]): string => join(ROOT, ...parts);
