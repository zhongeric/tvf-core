#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { documentHash } from "./canonical.js";
import { compile, CompileError, PROFILES, type PoolRef, type Profile, type Subject } from "./compile.js";
import type { ChainId, TvfFramework } from "./types.js";
import { validateFramework, validateProposal, validateVersionSet } from "./validate.js";

const USAGE = `usage:
  tvf validate <file.json>...          validate frameworks and proposals (schema, rules, hash)
  tvf hash <framework.json> [--write]  print the canonical keccak256 hash, or write it into the file
  tvf compile <framework.json> --chain <1|4663> --token <0xTOKEN[@v2|v3|v4:0xPOOL]>...
      [--checks id,id] [--k 6] [--profile fast|standard|strict] [--param <checkId>:<name>=<int>]...`;

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8"));

function validate(files: string[]): number {
  if (files.length === 0) throw new CompileError("validate needs at least one file");
  let failed = 0;
  const frameworks: TvfFramework[] = [];
  for (const file of files) {
    const doc = readJson(file);
    let errors: string[];
    if ("tvf" in doc) {
      errors = validateFramework(doc);
      const m = file.replaceAll("\\", "/").match(/frameworks\/([^/]+)\/([^/]+)\.json$/);
      if (m && (m[1] !== doc.id || m[2] !== doc.version)) errors.push(`path: expected frameworks/${doc.id}/${doc.version}.json`);
      if (errors.length === 0) frameworks.push(doc as unknown as TvfFramework);
    } else if ("proposal" in doc) {
      errors = validateProposal(doc);
      const dir = basename(dirname(file));
      if (basename(file) === "proposal.json" && !dir.startsWith("_") && dir !== doc.id) {
        errors.push(`path: proposal ${String(doc.id)} must live in proposals/${String(doc.id)}/`);
      }
    } else {
      errors = ["not a tvf framework or proposal document"];
    }
    for (const e of errors) console.error(`${file}: ${e}`);
    if (errors.length) failed++;
    else console.log(`ok ${file}`);
  }
  const setErrors = validateVersionSet(frameworks);
  for (const e of setErrors) console.error(e);
  return failed || setErrors.length ? 1 : 0;
}

function hash(file: string, write: boolean): number {
  const doc = readJson(file);
  const h = documentHash(doc);
  if (write) writeFileSync(file, `${JSON.stringify({ ...doc, hash: h }, null, 2)}\n`);
  console.log(h);
  return 0;
}

function parseSubject(arg: string): Subject {
  const [token = "", pool] = arg.split("@");
  if (!pool) return { token };
  const [protocol, id = ""] = pool.split(":");
  return { token, pool: { protocol: protocol as PoolRef["protocol"], id } };
}

function parseParam(arg: string, into: Record<string, Record<string, number>>): void {
  const m = arg.match(/^([a-z][a-z0-9_.]*):([a-z][a-z0-9_]*)=(-?\d+)$/);
  if (!m) throw new CompileError(`--param ${arg}: expected <checkId>:<name>=<int>`);
  const [, checkId = "", name = "", value = ""] = m;
  into[checkId] = { ...into[checkId], [name]: Number(value) };
}

function compileCmd(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      chain: { type: "string" },
      token: { type: "string", multiple: true },
      checks: { type: "string" },
      k: { type: "string" },
      profile: { type: "string" },
      param: { type: "string", multiple: true },
    },
  });
  const [file] = positionals;
  if (!file || !values.chain || !values.token?.length) throw new CompileError(USAGE);
  const fw = readJson(file);
  const errors = validateFramework(fw);
  if (errors.length) throw new CompileError(`${file} is invalid:\n${errors.join("\n")}`);
  const chainId = Number(values.chain);
  if (chainId !== 1 && chainId !== 4663) throw new CompileError("--chain must be 1 or 4663");
  if (values.profile && !(values.profile in PROFILES)) throw new CompileError(`unknown profile ${values.profile}`);
  const params: Record<string, Record<string, number>> = {};
  for (const p of values.param ?? []) parseParam(p, params);
  const plan = compile(fw as unknown as TvfFramework, {
    chainId: chainId as ChainId,
    subjects: values.token.map(parseSubject),
    checks: values.checks?.split(",").filter(Boolean),
    k: values.k === undefined ? undefined : Number(values.k),
    profile: values.profile as Profile | undefined,
    params,
  });
  console.log(JSON.stringify(plan, null, 2));
  return 0;
}

export function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case "validate":
        return validate(rest);
      case "hash":
        if (!rest[0]) throw new CompileError(USAGE);
        return hash(rest[0], rest.includes("--write"));
      case "compile":
        return compileCmd(rest);
      default:
        console.error(USAGE);
        return 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
