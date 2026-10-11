/**
 * M0 gate (PLAN §2, §9.6): every 6-fact core bundle for USDC and BIO must get a free, unpaid
 * quote with no `problems`. Also compares fact wording in `definitions` (the design) against
 * fact wording inline in `question` (the fallback), at /requests/check and at the quote.
 *
 * Free endpoints only. The bearer token is random with no wallet behind it, nothing is signed,
 * and no order is ever submitted: quotes expire unpaid after 600 s.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile, type Bundle, type OracleRequestInput } from "./compile.js";
import type { TvfFramework } from "./types.js";

const API = process.env.IMD_API ?? "https://api.imd.fun";
const FREE_ROUTES = new Set(["/requests/check", "/requests/quote"]);
const QUOTES_PER_MINUTE = 25;
const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  BIO: "0x0e14Fb97222b06B0B4feFA224cc106A711dD4E1D",
};

const bearer = randomBytes(32).toString("hex");
let lastCall = 0;

async function post(route: string, body: unknown, auth: boolean): Promise<{ status: number; json: any }> {
  if (!FREE_ROUTES.has(route)) throw new Error(`refusing non-free route ${route}`);
  const wait = lastCall + 60000 / QUOTES_PER_MINUTE - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(`${API}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function inlineVariant(input: OracleRequestInput): OracleRequestInput {
  const definitions = Object.fromEntries(Object.entries(input.definitions).filter(([k]) => !/^f\d+$/.test(k)));
  const facts = Object.keys(input.definitions)
    .filter((k) => /^f\d+$/.test(k))
    .map((k) => `Fact ${k.slice(1)}: ${input.definitions[k]}`)
    .join(" ");
  const question = input.question.replace("Fact i is the proposition in definition f<i>. ", "") + ` ${facts}`;
  return { ...input, question, definitions };
}

const checkBody = (i: OracleRequestInput) => ({
  action: "oracle.request",
  input: { question: i.question, panelSize: i.panelSize, answerType: i.answerType, evidence: i.evidence, chainId: i.chainId },
});

type Row = Record<string, any>;

async function probe(name: string, b: Bundle, index: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [wording, input] of [["definitions", b.input], ["inline", inlineVariant(b.input)]] as const) {
    const base = { token: name, bundle: index, checks: b.bits.map((x) => x.checkId), wording, questionChars: input.question.length };
    if (input.question.length > 2000) {
      rows.push({ ...base, endpoint: "skipped", detail: "question over 2000 chars" });
      continue;
    }
    const check = await post("/requests/check", checkBody(input), false);
    rows.push({
      ...base,
      endpoint: "check",
      status: check.status,
      blockers: check.json?.blockers,
      suggestions: check.json?.suggestions,
      proposed: check.json?.proposed,
      error: check.json?.error,
      detail: check.json?.detail,
    });
    const quote = await post("/requests/quote", { requestKey: randomUUID(), action: "oracle.request", input }, true);
    const order = quote.json?.order;
    rows.push({
      ...base,
      endpoint: "quote",
      status: quote.status,
      problems: quote.json?.problems ?? [],
      error: quote.json?.error,
      detail: quote.json?.detail,
      orderId: order?.id,
      orderStatus: order?.status,
      amount: order?.quote?.payment?.amount,
      resultGuaranteed: order?.quote?.terms?.resultGuaranteed,
      inputHash: order?.quote?.inputHash,
    });
  }
  return rows;
}

async function run(): Promise<number> {
  const core: TvfFramework = JSON.parse(readFileSync(new URL("../frameworks/core/1.0.0.json", import.meta.url), "utf8"));
  const rows: Row[] = [];
  for (const [name, token] of Object.entries(TOKENS)) {
    const plan = compile(core, { chainId: 1, subjects: [{ token }], k: 6, profile: "standard" });
    for (const [i, b] of plan.bundles.entries()) {
      const r = await probe(name, b, i);
      for (const row of r) console.log(JSON.stringify({ ...row, proposed: undefined }));
      rows.push(...r);
    }
  }
  const gate = rows.filter((r) => r.wording === "definitions" && r.endpoint === "quote");
  const passed = gate.every((r) => (r.status === 201 || r.status === 200) && r.problems?.length === 0 && r.orderStatus === "quoted");
  const out = new URL("../probes/m0/", import.meta.url);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    new URL("results.json", out),
    `${JSON.stringify({ api: API, at: new Date().toISOString(), framework: `core@${core.version}`, hash: core.hash, gatePassed: passed, rows }, null, 2)}\n`,
  );
  console.log(`M0 gate (${gate.length} definitions-wording quotes without problems): ${passed ? "PASS" : "FAIL"}`);
  return passed ? 0 : 1;
}

run().then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
