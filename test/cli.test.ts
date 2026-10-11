import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { CORE_PATH, TEMPLATE_PATH, USDC } from "./helpers.js";

const core = fileURLToPath(CORE_PATH);
const template = fileURLToPath(TEMPLATE_PATH);
let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
  vi.spyOn(console, "error").mockImplementation((m: string) => void err.push(m));
});
afterEach(() => vi.restoreAllMocks());

describe("tvf cli", () => {
  it("validates core and the proposal template", () => {
    expect(main(["validate", core, template])).toBe(0);
    expect(out).toEqual([`ok ${core}`, `ok ${template}`]);
  });

  it("fails validation on a framework stored under the wrong path", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tvf-")), "frameworks/core");
    mkdirSync(dir, { recursive: true });
    const misplaced = join(dir, "9.9.9.json");
    copyFileSync(core, misplaced);
    expect(main(["validate", misplaced])).toBe(1);
    expect(err.join()).toMatch(/expected frameworks\/core\/1.0.0.json/);
  });

  it("prints and writes the hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "tvf-"));
    const file = join(dir, "fw.json");
    const doc = JSON.parse(readFileSync(core, "utf8"));
    writeFileSync(file, JSON.stringify({ ...doc, hash: `0x${"0".repeat(64)}` }));
    expect(main(["hash", file])).toBe(0);
    expect(out[0]).toBe(doc.hash);
    expect(main(["hash", file, "--write"])).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).hash).toBe(doc.hash);
  });

  it("compiles bundles with a pool and a param override", () => {
    const pool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
    const code = main([
      "compile", core, "--chain", "1", "--token", `${USDC}@v3:${pool}`,
      "--checks", "trading.sell_tax_gt,code.proxy", "--k", "2", "--param", "trading.sell_tax_gt:bps=300",
    ]);
    expect(code).toBe(0);
    const plan = JSON.parse(out[0]!);
    expect(plan.bundles).toHaveLength(1);
    expect(plan.params["trading.sell_tax_gt"]).toEqual({ bps: 300 });
    expect(plan.bundles[0].input.definitions.f0).toContain(`the Uniswap v3 pool ${pool}`);
  });

  it("reports compile errors with exit code 1 and usage with 2", () => {
    expect(main(["compile", core, "--chain", "56", "--token", USDC])).toBe(1);
    expect(err.join()).toMatch(/--chain must be 1 or 4663/);
    expect(main(["nope"])).toBe(2);
  });
});
