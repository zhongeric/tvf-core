import { readFileSync } from "node:fs";
import { documentHash } from "../src/canonical.js";
import type { TvfFramework } from "../src/types.js";

export const CORE_PATH = new URL("../frameworks/core/1.0.0.json", import.meta.url);
export const TEMPLATE_PATH = new URL("../proposals/_template/proposal.json", import.meta.url);

export const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const BIO = "0x0e14Fb97222b06B0B4feFA224cc106A711dD4E1D";

export const loadCore = (): TvfFramework => JSON.parse(readFileSync(CORE_PATH, "utf8"));

/** A mutable copy of core with its hash recomputed after `mutate`. */
export function mutated(mutate: (fw: TvfFramework) => void): TvfFramework {
  const fw = loadCore();
  mutate(fw);
  fw.hash = documentHash(fw as unknown as Record<string, unknown>);
  return fw;
}
