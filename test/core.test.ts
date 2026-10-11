import { describe, expect, it } from "vitest";
import { documentHash } from "../src/canonical.js";
import { validateFramework } from "../src/validate.js";
import { loadCore } from "./helpers.js";

const CORE_1_0_0_HASH = "0xee0f45612ab4ecdbee689b7a0f5a5e19e7d89505bceb30b58cc24854aa925edd";

// SPEC §3: index, id, severity, param defaults.
const SPEC_CHECKS: [string, string, Record<string, number>?][] = [
  ["code.unverified", "high"],
  ["code.proxy", "medium"],
  ["code.proxy_unverified_impl", "critical"],
  ["code.selfdestruct", "high"],
  ["control.owner_active", "low"],
  ["control.admin_is_eoa", "high", { delay: 1 }],
  ["control.hidden_owner", "high"],
  ["control.mintable", "high"],
  ["control.change_balance", "critical"],
  ["control.pausable", "medium"],
  ["control.blacklist", "medium"],
  ["control.reclaim_ownership", "high"],
  ["trading.sell_reverts", "critical"],
  ["trading.buy_tax_gt", "high", { bps: 1000 }],
  ["trading.sell_tax_gt", "high", { bps: 1000 }],
  ["trading.transfer_tax_gt", "medium", { bps: 500 }],
  ["trading.tax_modifiable", "high"],
  ["trading.per_address_tax", "high"],
  ["trading.limits", "low", { bps: 100 }],
  ["trading.cooldown", "low"],
  ["supply.noncirc_gt", "medium", { bps: 5000 }],
  ["supply.top10_gt", "high", { bps: 3000 }],
  ["supply.owner_gt", "high", { bps: 500 }],
  ["liquidity.no_pool", "high", { usd: 10000 }],
  ["liquidity.lp_locked_lt", "high", { bps: 5000, days: 30 }],
  ["liquidity.unlock_soon", "high", { days: 7 }],
  ["liquidity.v4_hook_risky", "high"],
  ["identity.impersonation", "critical"],
  ["identity.unlisted", "info"],
  ["identity.deployer_rug", "high", { days: 180 }],
];

describe("core@1.0.0", () => {
  const core = loadCore();

  it("is valid", () => {
    expect(validateFramework(core)).toEqual([]);
  });

  it("has the golden hash", () => {
    expect(core.hash).toBe(CORE_1_0_0_HASH);
    expect(documentHash(core as unknown as Record<string, unknown>)).toBe(CORE_1_0_0_HASH);
  });

  it("covers both chains", () => {
    expect(core.chains).toEqual([1, 4663]);
  });

  it("has the 30 spec checks in order, with spec severities and param defaults", () => {
    expect(core.checks).toHaveLength(30);
    core.checks.forEach((check, i) => {
      const [id, severity, defaults] = SPEC_CHECKS[i]!;
      expect(check.id).toBe(id);
      expect(check.category).toBe(id.split(".")[0]);
      expect(check.severity).toBe(severity);
      expect(check.riskIf).toBe(true);
      const actual = Object.fromEntries(Object.entries(check.params ?? {}).map(([n, p]) => [n, p.default]));
      expect(actual).toEqual(defaults ?? {});
    });
  });

  it("uses the spec scoring", () => {
    expect(core.scoring).toEqual({
      weights: { critical: 100, high: 25, medium: 10, low: 3, info: 0 },
      verdict: { fail: "anyCriticalRisky", warn: { scoreBelow: 70, orHighUnanswered: true } },
      unanswered: "severityMinusOne",
    });
  });

  it("pins the review request from SPEC §8", () => {
    const r = core.review!;
    expect(r.question).toBe(
      "Is proposal {proposalId}, the framework diff with keccak256 {diffHash} from core@{base} to core@{next}, beneficial to the framework under every criterion in the definitions?",
    );
    expect([r.action, r.answerType, r.evidence]).toEqual(["oracle.request", "bool", "panel"]);
    expect([r.panelSize, r.quorum, r.window.hours, r.validForSeconds]).toEqual([100, 85, 72, 604800]);
    expect(r.allowAmbiguous).toBe(false);
    expect(Object.keys(r.definitions)).toEqual([
      "diff", "accuracy", "regression", "gaming", "schema", "scope", "evidence", "default",
    ]);
    expect(r.guards.minSources).toBe(2);
    expect(r.guards.sources).toContain("https://github.com/zhongeric/tvf-core/");
  });
});
