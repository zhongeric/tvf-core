import { describe, expect, it } from "vitest";
import { assertWithinLimits, compile, CompileError, formatParam, LIMITS } from "../src/compile.js";
import { BIO, loadCore, USDC } from "./helpers.js";

const core = loadCore();
const POOL_V3 = { protocol: "v3" as const, id: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" };

describe("compile", () => {
  it("packs core into 5 six-fact bundles per token, in check order", () => {
    const plan = compile(core, { chainId: 1, subjects: [{ token: USDC }] });
    expect(plan.framework).toEqual({ id: "core", version: "1.0.0", hash: core.hash });
    expect(plan.bundles).toHaveLength(5);
    const bits = plan.bundles.flatMap((b) => b.bits);
    expect(bits.map((b) => b.checkId)).toEqual(core.checks.map((c) => c.id));
    for (const b of plan.bundles) {
      expect(b.bits.map((x) => x.bit)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(b.input).toMatchObject({
        v: 1,
        chainId: 1,
        answerType: "bytes32",
        evidence: "panel",
        panelSize: 15,
        quorum: 11,
        validForSeconds: 86400,
        window: { hours: 24 },
      });
      expect(Object.keys(b.input.definitions)).toEqual(expect.arrayContaining(["bits", "f0", "f5"]));
      expect(b.input.definitions.f6).toBeUndefined();
      expect(b.input).not.toHaveProperty("toleranceBps");
      expect(b.input).not.toHaveProperty("allowAmbiguous");
    }
  });

  it("keeps fact wording out of the question and names the token in each fact", () => {
    const [first] = compile(core, { chainId: 1, subjects: [{ token: USDC }] }).bundles;
    expect(first!.input.question).not.toContain(USDC);
    expect(first!.input.question).toContain("definition f<i>");
    expect(first!.input.definitions.f0).toContain(`The source code of ${USDC} on Ethereum mainnet is not verified`);
    expect(first!.input.definitions.proxy).toBe(core.checks[1]!.definitions.proxy);
  });

  it("renders params, and applies overrides within [min, max]", () => {
    const facts = (params?: Record<string, Record<string, number>>) =>
      compile(core, { chainId: 1, subjects: [{ token: USDC }], checks: ["trading.sell_tax_gt", "liquidity.no_pool"], params })
        .bundles[0]!.input.definitions;
    expect(facts().f0).toContain("greater than 1000 bps (10%)");
    expect(facts().f1).toContain("at least 10,000 USD");
    expect(facts({ "trading.sell_tax_gt": { bps: 250 } }).f0).toContain("greater than 250 bps (2.5%)");
    expect(() => facts({ "trading.sell_tax_gt": { bps: 10001 } })).toThrow(/integer in \[0, 10000\]/);
    expect(() => facts({ "trading.sell_tax_gt": { days: 1 } })).toThrow(/has no param days/);
    expect(() => facts({ "nope.check": { bps: 1 } })).toThrow(/unknown check/);
  });

  it("uses the subject's pool when given, else defines the main pool", () => {
    const run = (pool?: typeof POOL_V3) =>
      compile(core, { chainId: 1, subjects: [{ token: USDC, pool }], checks: ["trading.sell_reverts"] }).bundles[0]!.input
        .definitions;
    expect(run().f0).toContain(`via the main pool of ${USDC} (see pool)`);
    expect(run().pool).toMatch(/highest TVL/);
    expect(run(POOL_V3).f0).toContain(`via the Uniswap v3 pool ${POOL_V3.id}`);
    expect(run(POOL_V3).pool).toBeUndefined();
  });

  it("names the chain and keeps the bundle question chain-specific", () => {
    const [b] = compile(core, { chainId: 4663, subjects: [{ token: USDC }], checks: ["code.proxy"] }).bundles;
    expect(b!.input.chainId).toBe(4663);
    expect(b!.input.question).toContain("Bitmap of 1 token-safety facts on Robinhood Chain (chain 4663)");
    expect(b!.input.definitions.f0).toBe(`${USDC} on Robinhood Chain is a proxy (see proxy).`);
  });

  it("packs facts from several tokens and stays within IMD limits at k=16", () => {
    const plan = compile(core, { chainId: 1, subjects: [{ token: USDC }, { token: BIO, pool: POOL_V3 }], k: 16 });
    expect(plan.bundles.map((b) => b.bits.length)).toEqual([16, 16, 16, 12]);
    expect(plan.bundles[1]!.bits.map((b) => b.token)).toEqual([...Array(14).fill(USDC), BIO, BIO]);
    for (const b of plan.bundles) {
      expect(b.input.question.length).toBeLessThanOrEqual(LIMITS.questionChars);
      expect(Object.keys(b.input.definitions).length).toBeLessThanOrEqual(LIMITS.definitionKeys);
      expect(b.input.guards.sources.length).toBeLessThanOrEqual(LIMITS.sources);
    }
  });

  it("maps profiles to panel sizes", () => {
    const panel = (profile: "fast" | "standard" | "strict") => {
      const { panelSize, quorum } = compile(core, { chainId: 1, subjects: [{ token: USDC }], profile }).bundles[0]!.input;
      return [panelSize, quorum];
    };
    expect([panel("fast"), panel("standard"), panel("strict")]).toEqual([[7, 5], [15, 11], [25, 20]]);
  });

  it("is deterministic", () => {
    const opts = { chainId: 1 as const, subjects: [{ token: USDC }, { token: BIO }] };
    expect(JSON.stringify(compile(core, opts))).toBe(JSON.stringify(compile(core, opts)));
  });

  it("rejects bad inputs", () => {
    const base = { chainId: 1 as const, subjects: [{ token: USDC }] };
    expect(() => compile(core, { ...base, k: 17 })).toThrow(/k must be an integer in \[1, 16\]/);
    expect(() => compile(core, { ...base, k: 0 })).toThrow(CompileError);
    expect(() => compile(core, { ...base, chainId: 56 as 1 })).toThrow(/chain 56 is not in core@1.0.0/);
    expect(() => compile(core, { ...base, subjects: [] })).toThrow(/at least one subject/);
    expect(() => compile(core, { ...base, subjects: [{ token: "0x1234" }] })).toThrow(/not an address/);
    expect(() => compile(core, { ...base, subjects: [{ token: USDC, pool: { protocol: "v4", id: USDC } }] })).toThrow(
      /v4 pool id/,
    );
    expect(() => compile(core, { ...base, checks: ["code.nope"] })).toThrow(/unknown check code.nope/);
  });

  it("enforces the 16 KiB body and 512-char definition limits", () => {
    const input = compile(core, { chainId: 1, subjects: [{ token: USDC }] }).bundles[0]!.input;
    expect(() => assertWithinLimits({ ...input, definitions: { ...input.definitions, f0: "x".repeat(513) } }, 0)).toThrow(
      /definition f0 over 512/,
    );
    const big = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`d${i}`, "x".repeat(500)]));
    expect(() => assertWithinLimits({ ...input, definitions: big }, 0)).toThrow(/over 16384 bytes/);
  });
});

describe("formatParam", () => {
  it("formats each unit", () => {
    expect(formatParam("bps", 5000)).toBe("5000 bps (50%)");
    expect(formatParam("days", 1)).toBe("1 day");
    expect(formatParam("days", 30)).toBe("30 days");
    expect(formatParam("usd", 1234567)).toBe("1,234,567 USD");
    expect(formatParam("count", 3)).toBe("3");
  });
});
