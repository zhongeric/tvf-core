import type { ChainId, ParamType, TvfCheck, TvfFramework } from "./types.js";

export const PROFILES = {
  fast: { panelSize: 7, quorum: 5 },
  standard: { panelSize: 15, quorum: 11 },
  strict: { panelSize: 25, quorum: 20 },
} as const;
export type Profile = keyof typeof PROFILES;

/** IMD oracle.request limits (https://imd.fun/docs/llms.txt) plus the bundle cap from PLAN §9.5. */
export const LIMITS = {
  questionChars: 2000,
  definitionKeys: 64,
  definitionChars: 512,
  sources: 32,
  bodyBytes: 16 * 1024,
  maxK: 16,
} as const;

export const DEFAULT_K = 6;
export const DEFAULT_VALID_FOR_SECONDS = 86400;
export const CHAIN_NAMES: Record<ChainId, string> = { 1: "Ethereum mainnet", 4663: "Robinhood Chain" };

export type PoolRef = { protocol: "v2" | "v3" | "v4"; id: string };
export type Subject = { token: string; pool?: PoolRef };

export type OracleRequestInput = {
  v: 1;
  question: string;
  chainId: ChainId;
  window: { hours: number };
  answerType: "bytes32";
  evidence: "panel";
  panelSize: number;
  quorum: number;
  validForSeconds: number;
  definitions: Record<string, string>;
  guards: { sources: string[]; minSources: number };
};

export type BundleBit = { bit: number; token: string; checkId: string };
export type Bundle = { input: OracleRequestInput; bits: BundleBit[] };

export type CompileOptions = {
  chainId: ChainId;
  subjects: Subject[];
  checks?: string[];
  params?: Record<string, Record<string, number>>;
  k?: number;
  profile?: Profile;
  validForSeconds?: number;
};

export type CompiledPlan = {
  framework: { id: string; version: string; hash: string };
  chainId: ChainId;
  profile: Profile;
  k: number;
  params: Record<string, Record<string, number>>;
  bundles: Bundle[];
};

export class CompileError extends Error {}

const DEFAULT_POOL_DEFINITION =
  "The main pool is the Uniswap v2, v3 or v4 pool pairing the token with WETH, USDC or USDT that has the highest TVL at the window closing block.";

export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? "");
}

const groupThousands = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatParam(type: ParamType, value: number): string {
  switch (type) {
    case "bps":
      return `${value} bps (${value / 100}%)`;
    case "days":
      return value === 1 ? "1 day" : `${value} days`;
    case "usd":
      return `${groupThousands(value)} USD`;
    case "count":
      return String(value);
  }
}

export function renderFact(
  check: TvfCheck,
  ctx: { chainId: ChainId; subject: Subject; params: Record<string, number> },
): string {
  const { token, pool } = ctx.subject;
  return check.fact.replace(/\{([^{}]*)\}/g, (_, ph: string) => {
    if (ph === "token") return token;
    if (ph === "chain") return CHAIN_NAMES[ctx.chainId];
    if (ph === "pool") return pool ? `the Uniswap ${pool.protocol} pool ${pool.id}` : `the main pool of ${token} (see pool)`;
    const name = ph.startsWith("param.") ? ph.slice("param.".length) : undefined;
    const spec = name !== undefined ? check.params?.[name] : undefined;
    const value = name !== undefined ? ctx.params[name] : undefined;
    if (!spec || value === undefined) throw new CompileError(`check ${check.id}: cannot render {${ph}}`);
    return formatParam(spec.type, value);
  });
}

export function resolveParams(
  fw: TvfFramework,
  overrides: Record<string, Record<string, number>> = {},
): Record<string, Record<string, number>> {
  const byId = new Map(fw.checks.map((c) => [c.id, c]));
  for (const [checkId, values] of Object.entries(overrides)) {
    const check = byId.get(checkId);
    if (!check) throw new CompileError(`params: unknown check ${checkId}`);
    for (const [name, value] of Object.entries(values)) {
      const spec = check.params?.[name];
      if (!spec) throw new CompileError(`params: check ${checkId} has no param ${name}`);
      if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
        throw new CompileError(`params: ${checkId}.${name} must be an integer in [${spec.min}, ${spec.max}]`);
      }
    }
  }
  const resolved: Record<string, Record<string, number>> = {};
  for (const check of fw.checks) {
    if (!check.params) continue;
    resolved[check.id] = Object.fromEntries(
      Object.entries(check.params).map(([name, p]) => [name, overrides[check.id]?.[name] ?? p.default]),
    );
  }
  return resolved;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function checkSubject(s: Subject): void {
  if (!ADDRESS.test(s.token)) throw new CompileError(`subject: token ${s.token} is not an address`);
  if (!s.pool) return;
  const ok = s.pool.protocol === "v4" ? BYTES32.test(s.pool.id) : ADDRESS.test(s.pool.id);
  if (!["v2", "v3", "v4"].includes(s.pool.protocol) || !ok) {
    throw new CompileError(`subject: pool ${s.pool.protocol}:${s.pool.id} is not a v2/v3 address or a v4 pool id`);
  }
}

export function bundleQuestion(k: number, chainId: ChainId): string {
  return (
    `Bitmap of ${k} token-safety facts on ${CHAIN_NAMES[chainId]} (chain ${chainId}) at the window closing block. ` +
    `Fact i is the proposition in definition f<i>. Return a bytes32 in which bit i (bit 0 = least significant) ` +
    `is 1 if fact i is true and 0 if it is false; bits ${k} and above are 0.`
  );
}

export function bitsDefinition(k: number): string {
  return (
    `Bit i of the answer is (answer >> i) & 1 for i from 0 to ${k - 1}. Bit i is 1 exactly when the proposition ` +
    `in definition f<i> is true at the window closing block. Bits ${k} to 255 are 0. Each fact is judged on its own.`
  );
}

/** Packs facts (subjects × checks) into bytes32 bitmap bundles of at most k facts that share a window. */
export function compile(fw: TvfFramework, opts: CompileOptions): CompiledPlan {
  if (!fw.chains.includes(opts.chainId)) throw new CompileError(`chain ${opts.chainId} is not in ${fw.id}@${fw.version}`);
  const k = opts.k ?? DEFAULT_K;
  if (!Number.isInteger(k) || k < 1 || k > LIMITS.maxK) throw new CompileError(`k must be an integer in [1, ${LIMITS.maxK}]`);
  const profile = opts.profile ?? "standard";
  const panel = PROFILES[profile];
  if (!panel) throw new CompileError(`unknown profile ${profile}`);
  if (opts.subjects.length === 0) throw new CompileError("at least one subject is required");
  opts.subjects.forEach(checkSubject);

  const byId = new Map(fw.checks.map((c) => [c.id, c]));
  const checks = (opts.checks ?? fw.checks.map((c) => c.id)).map((id) => {
    const c = byId.get(id);
    if (!c) throw new CompileError(`unknown check ${id}`);
    return c;
  });
  const params = resolveParams(fw, opts.params);

  const groups = new Map<number, { subject: Subject; check: TvfCheck }[]>();
  for (const subject of opts.subjects) {
    for (const check of checks) {
      const hours = check.window.hours;
      groups.set(hours, [...(groups.get(hours) ?? []), { subject, check }]);
    }
  }

  const bundles: Bundle[] = [];
  for (const [hours, facts] of groups) {
    for (let start = 0; start < facts.length; start += k) {
      const chunk = facts.slice(start, start + k);
      const definitions: Record<string, string> = { bits: bitsDefinition(chunk.length) };
      const shared: Record<string, string> = {};
      const sources: string[] = [];
      let defaultPool = false;
      chunk.forEach(({ subject, check }, bit) => {
        definitions[`f${bit}`] = renderFact(check, { chainId: opts.chainId, subject, params: params[check.id] ?? {} });
        if (!subject.pool && check.fact.includes("{pool}")) defaultPool = true;
        for (const [key, text] of Object.entries(check.definitions)) {
          if (shared[key] !== undefined && shared[key] !== text) {
            throw new CompileError(`definition ${key} conflicts between checks in one bundle`);
          }
          shared[key] = text;
        }
        for (const s of check.sources) if (!sources.includes(s)) sources.push(s);
      });
      Object.assign(definitions, shared);
      if (defaultPool) definitions.pool = DEFAULT_POOL_DEFINITION;

      const input: OracleRequestInput = {
        v: 1,
        question: bundleQuestion(chunk.length, opts.chainId),
        chainId: opts.chainId,
        window: { hours },
        answerType: "bytes32",
        evidence: "panel",
        panelSize: panel.panelSize,
        quorum: panel.quorum,
        validForSeconds: opts.validForSeconds ?? DEFAULT_VALID_FOR_SECONDS,
        definitions,
        guards: { sources, minSources: 1 },
      };
      assertWithinLimits(input, bundles.length);
      bundles.push({
        input,
        bits: chunk.map(({ subject, check }, bit) => ({ bit, token: subject.token, checkId: check.id })),
      });
    }
  }

  return { framework: { id: fw.id, version: fw.version, hash: fw.hash }, chainId: opts.chainId, profile, k, params, bundles };
}

export function assertWithinLimits(input: OracleRequestInput, index: number): void {
  const at = `bundle ${index}`;
  if (input.question.length > LIMITS.questionChars) throw new CompileError(`${at}: question over ${LIMITS.questionChars} chars`);
  const defs = Object.entries(input.definitions);
  if (defs.length > LIMITS.definitionKeys) throw new CompileError(`${at}: more than ${LIMITS.definitionKeys} definitions`);
  for (const [key, text] of defs) {
    if (text.length > LIMITS.definitionChars) throw new CompileError(`${at}: definition ${key} over ${LIMITS.definitionChars} chars`);
  }
  if (input.guards.sources.length > LIMITS.sources) throw new CompileError(`${at}: more than ${LIMITS.sources} sources`);
  const body = JSON.stringify({ requestKey: "00000000-0000-0000-0000-000000000000", action: "oracle.request", input });
  if (Buffer.byteLength(body, "utf8") > LIMITS.bodyBytes) throw new CompileError(`${at}: quote body over ${LIMITS.bodyBytes} bytes`);
}
