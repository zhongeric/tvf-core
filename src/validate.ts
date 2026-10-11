import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { canonicalize, documentHash } from "./canonical.js";
import { placeholders, renderFact } from "./compile.js";
import type { TvfFramework } from "./types.js";

const schemaDir = new URL("../schema/", import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const loadSchema = (name: string): ValidateFunction =>
  ajv.compile(JSON.parse(readFileSync(new URL(name, schemaDir), "utf8")));
const frameworkSchema = loadSchema("tvf-1.schema.json");
const proposalSchema = loadSchema("proposal-1.schema.json");

const REVIEW_PLACEHOLDERS = new Set(["proposalId", "diffHash", "base", "next", "diffUrl", "reportUrl"]);
const REVIEW_QUESTION_REQUIRED = ["proposalId", "diffHash", "base", "next"];

const formatAjv = (errors: ErrorObject[] | null | undefined): string[] =>
  (errors ?? []).map((e) => `schema: ${e.instancePath || "/"} ${e.message ?? "is invalid"}`);

export function validateFramework(doc: unknown): string[] {
  if (!frameworkSchema(doc)) return formatAjv(frameworkSchema.errors);
  const fw = doc as TvfFramework;
  const errors: string[] = [];

  const expected = documentHash(fw as unknown as Record<string, unknown>);
  if (fw.hash !== expected) errors.push(`hash: is ${fw.hash}, canonical hash is ${expected}`);

  const seen = new Set<string>();
  const sharedDefs = new Map<string, { text: string; check: string }>();
  for (const check of fw.checks) {
    const at = `check ${check.id}`;
    if (seen.has(check.id)) errors.push(`${at}: duplicate id`);
    seen.add(check.id);

    const params = check.params ?? {};
    for (const [name, p] of Object.entries(params)) {
      if (!(p.min <= p.default && p.default <= p.max)) errors.push(`${at}: param ${name} needs min <= default <= max`);
      if (p.type === "bps" && p.max > 10000) errors.push(`${at}: param ${name} is bps, max must be <= 10000`);
    }
    const used = new Set<string>();
    let renderable = true;
    for (const ph of placeholders(check.fact)) {
      if (ph.startsWith("param.")) {
        const name = ph.slice("param.".length);
        if (!(name in params)) {
          errors.push(`${at}: fact uses {${ph}} but has no param ${name}`);
          renderable = false;
        }
        used.add(name);
      } else if (!["token", "pool", "chain"].includes(ph)) {
        errors.push(`${at}: unknown placeholder {${ph}}`);
        renderable = false;
      }
    }
    for (const name of Object.keys(params)) {
      if (!used.has(name)) errors.push(`${at}: param ${name} is not used in the fact`);
    }

    for (const [key, text] of Object.entries(check.definitions)) {
      if (/[{}]/.test(text)) errors.push(`${at}: definition ${key} must not contain placeholders`);
      const prior = sharedDefs.get(key);
      if (prior && prior.text !== text) {
        errors.push(`${at}: definition ${key} differs from the one in ${prior.check}; shared keys must match`);
      } else if (!prior) sharedDefs.set(key, { text, check: check.id });
    }

    if (renderable) {
      const worst = renderFact(check, {
        chainId: 1,
        subject: { token: `0x${"f".repeat(40)}`, pool: { protocol: "v4", id: `0x${"f".repeat(64)}` } },
        params: Object.fromEntries(Object.entries(params).map(([n, p]) => [n, p.max])),
      });
      if (worst.length > 512) errors.push(`${at}: rendered fact can reach ${worst.length} chars, limit is 512`);
    }
  }

  if (fw.review) {
    const r = fw.review;
    if (r.quorum > r.panelSize) errors.push("review: quorum must be <= panelSize");
    const hosts = new Set(r.guards.sources.map((s) => new URL(s).host));
    if (r.guards.minSources > hosts.size) errors.push("review: guards.minSources exceeds the distinct source hosts");
    const qph = placeholders(r.question);
    for (const req of REVIEW_QUESTION_REQUIRED) {
      if (!qph.includes(req)) errors.push(`review: question must contain {${req}}`);
    }
    for (const text of [r.question, ...Object.values(r.definitions)]) {
      for (const ph of placeholders(text)) {
        if (!REVIEW_PLACEHOLDERS.has(ph)) errors.push(`review: unknown placeholder {${ph}}`);
      }
    }
  }
  return errors;
}

export function validateProposal(doc: unknown): string[] {
  return proposalSchema(doc) ? [] : formatAjv(proposalSchema.errors);
}

const major = (v: string) => v.split(".")[0];
const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/** Across versions of one framework id: versions are unique, and `review`/`scoring` never change within a major. */
export function validateVersionSet(frameworks: TvfFramework[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, TvfFramework[]>();
  for (const fw of frameworks) byId.set(fw.id, [...(byId.get(fw.id) ?? []), fw]);
  for (const [id, list] of byId) {
    const versions = new Set<string>();
    for (const fw of list) {
      if (versions.has(fw.version)) errors.push(`${id}@${fw.version}: duplicate version`);
      versions.add(fw.version);
    }
    for (const a of list) {
      for (const b of list) {
        if (a.version >= b.version || major(a.version) !== major(b.version)) continue;
        if (!same(a.review, b.review)) errors.push(`${id}@${b.version}: review differs from ${a.version} within major ${major(a.version)}`);
        if (!same(a.scoring, b.scoring)) errors.push(`${id}@${b.version}: scoring differs from ${a.version} within major ${major(a.version)}`);
      }
    }
  }
  return errors;
}
