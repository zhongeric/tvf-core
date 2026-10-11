import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFramework, validateProposal, validateVersionSet } from "../src/validate.js";
import type { TvfFramework } from "../src/types.js";
import { loadCore, mutated, TEMPLATE_PATH } from "./helpers.js";

const check = (fw: TvfFramework, id: string) => fw.checks.find((c) => c.id === id)!;
const errorsOf = (mutate: (fw: TvfFramework) => void) => validateFramework(mutated(mutate)).join("\n");

describe("validateFramework", () => {
  it("rejects a stale hash", () => {
    const fw = loadCore();
    fw.checks[0]!.severity = "low";
    expect(validateFramework(fw).join("\n")).toMatch(/hash: is 0x.*canonical hash is 0x/);
  });

  it("rejects duplicate check ids", () => {
    expect(errorsOf((fw) => fw.checks.push({ ...fw.checks[0]! }))).toMatch(/duplicate id/);
  });

  it("rejects bad check ids and unknown fields such as toleranceBps", () => {
    expect(errorsOf((fw) => (fw.checks[0]!.id = "Code.Bad"))).toMatch(/schema: \/checks\/0\/id/);
    expect(errorsOf((fw) => Object.assign(fw.checks[0]!, { toleranceBps: 0 }))).toMatch(/additional properties/);
  });

  it("rejects unknown placeholders and missing or unused params", () => {
    expect(errorsOf((fw) => (check(fw, "code.proxy").fact += " {holder}"))).toMatch(/unknown placeholder \{holder\}/);
    expect(errorsOf((fw) => (check(fw, "code.proxy").fact += " {param.bps}"))).toMatch(/has no param bps/);
    expect(errorsOf((fw) => (check(fw, "trading.limits").fact = "{token} has limits."))).toMatch(/param bps is not used/);
  });

  it("rejects defaults outside [min, max] and bps over 10000", () => {
    expect(errorsOf((fw) => (check(fw, "trading.limits").params!.bps!.default = 20000))).toMatch(/min <= default <= max/);
    expect(errorsOf((fw) => (check(fw, "trading.limits").params!.bps!.max = 10001))).toMatch(/max must be <= 10000/);
  });

  it("requires a shared definition key to have the same text everywhere", () => {
    expect(errorsOf((fw) => (check(fw, "code.proxy").definitions.proxy = "Something else."))).toMatch(
      /definition proxy differs/,
    );
  });

  it("rejects reserved definition keys and placeholders in definitions", () => {
    expect(errorsOf((fw) => (check(fw, "code.proxy").definitions.f0 = "x"))).toMatch(/schema:.*definitions/);
    expect(errorsOf((fw) => (check(fw, "code.proxy").definitions.bits = "x"))).toMatch(/schema:.*definitions/);
    expect(errorsOf((fw) => (check(fw, "code.proxy").definitions.extra = "{token}"))).toMatch(/must not contain placeholders/);
  });

  it("rejects facts that can render past 512 characters", () => {
    expect(errorsOf((fw) => (check(fw, "code.proxy").fact = `{token} ${"x".repeat(480)}`))).toMatch(/rendered fact can reach/);
  });

  it("keeps scoring fixed", () => {
    expect(errorsOf((fw) => ((fw.scoring.weights as { high: number }).high = 20))).toMatch(/schema: \/scoring\/weights\/high/);
  });

  it("requires review on core only, and extends on overlays only", () => {
    expect(errorsOf((fw) => delete fw.review)).toMatch(/must have required property 'review'/);
    expect(errorsOf((fw) => (fw.extends = { id: "core", version: "1.0.0" }))).toMatch(/schema/);
    expect(errorsOf((fw) => (fw.id = "acme.strict"))).toMatch(/must have required property 'extends'/);
    expect(
      errorsOf((fw) => {
        fw.id = "acme.strict";
        fw.extends = { id: "core", version: "1.0.0" };
      }),
    ).toMatch(/schema/);
    expect(
      validateFramework(
        mutated((fw) => {
          fw.id = "acme.strict";
          fw.extends = { id: "core", version: "1.0.0" };
          delete fw.review;
        }),
      ),
    ).toEqual([]);
  });

  it("checks the review block", () => {
    expect(errorsOf((fw) => (fw.review!.quorum = 101))).toMatch(/schema/);
    expect(errorsOf((fw) => (fw.review!.allowAmbiguous = true as false))).toMatch(/schema: \/review\/allowAmbiguous/);
    expect(errorsOf((fw) => (fw.review!.question = "Is {proposalId} good?"))).toMatch(/must contain \{diffHash\}/);
    expect(errorsOf((fw) => (fw.review!.definitions.diff += " {commit}"))).toMatch(/unknown placeholder \{commit\}/);
    expect(errorsOf((fw) => (fw.review!.guards.sources = ["https://github.com/zhongeric/tvf-core/"]))).toMatch(
      /minSources exceeds/,
    );
  });
});

describe("validateVersionSet", () => {
  const v = (version: string, mutate: (fw: TvfFramework) => void = () => {}) =>
    mutated((fw) => {
      fw.version = version;
      mutate(fw);
    });

  it("accepts versions that keep review and scoring within a major", () => {
    expect(validateVersionSet([loadCore(), v("1.0.1", (fw) => (fw.checks[0]!.fact += " Patch."))])).toEqual([]);
  });

  it("rejects a review change within a major, but not across majors", () => {
    expect(validateVersionSet([loadCore(), v("1.1.0", (fw) => (fw.review!.quorum = 80))]).join()).toMatch(
      /core@1.1.0: review differs from 1.0.0/,
    );
    expect(validateVersionSet([loadCore(), v("2.0.0", (fw) => (fw.review!.quorum = 80))])).toEqual([]);
  });

  it("rejects duplicate versions", () => {
    expect(validateVersionSet([loadCore(), loadCore()]).join()).toMatch(/duplicate version/);
  });
});

describe("validateProposal", () => {
  const template = () => JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

  it("accepts the template", () => {
    expect(validateProposal(template())).toEqual([]);
  });

  it("rejects more than 5 touched checks and non-core targets", () => {
    expect(validateProposal({ ...template(), checks: ["a", "b", "c", "d", "e", "f"] }).join()).toMatch(/checks/);
    expect(validateProposal({ ...template(), next: { id: "acme.x", version: "1.0.1" } }).join()).toMatch(/next\/id/);
  });
});
