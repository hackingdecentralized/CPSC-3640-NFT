import {loadConfig} from "../src/loadConfig";
import {deriveSeed} from "../src/seed";
import type {GeneratorConfig} from "../src/types";

export const config: GeneratorConfig = loadConfig();

export const WALLET_A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const WALLET_B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const SALT_X = "fall-2026-test-salt";

/** A fixed, reproducible sweep of seeds for statistical checks. */
export const seeds = (count: number, salt = SALT_X): string[] =>
  Array.from({length: count}, (_, i) => deriveSeed(i + 1, WALLET_A, salt));

/** A deep copy, for tests that break the configuration on purpose. */
export const cloneConfig = (): GeneratorConfig => structuredClone(config);
