import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, strings and keys
 * escaped as JSON.stringify does, numbers restricted to safe integers. Anything else
 * (floats, undefined, functions, non-plain objects) is rejected so two encoders can't disagree.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON allows only safe integers, got ${value}`);
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => {
        if (obj[k] === undefined) throw new Error(`canonical JSON does not allow undefined (key ${k})`);
        return `${JSON.stringify(k)}:${canonicalize(obj[k])}`;
      })
      .join(",")}}`;
  }
  throw new Error(`canonical JSON cannot encode ${typeof value}`);
}

export function keccakHex(text: string): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(text)))}`;
}

/** keccak256 of the canonical JSON of the document with its own `hash` field removed. */
export function documentHash(doc: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = doc;
  return keccakHex(canonicalize(rest));
}
