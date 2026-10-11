import { describe, expect, it } from "vitest";
import { canonicalize, documentHash, keccakHex } from "../src/canonical.js";

// The canonical encoder from IMD's docs (llms.txt, "POST /requests/:id/submit").
const imdCanon = (v: unknown): string =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? `[${v.map(imdCanon).join(",")}]`
      : typeof v === "object"
        ? `{${Object.keys(v as object)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${imdCanon((v as Record<string, unknown>)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);

describe("canonicalize", () => {
  it("sorts keys at every depth and drops whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("matches IMD's reference encoder", () => {
    const doc = { z: "é \"q\" \n", a: [1, -2, { b: false, a: "0x00" }], m: { "k-2": 0, k1: 10 } };
    expect(canonicalize(doc)).toBe(imdCanon(doc));
  });

  it("encodes -0 as 0", () => {
    expect(canonicalize([-0])).toBe("[0]");
  });

  it.each([[1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])("rejects the number %s", (n) => {
    expect(() => canonicalize({ n })).toThrow(/safe integers/);
  });

  it("rejects undefined values and non-plain objects", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalize({ d: new Date(0) })).toThrow(/cannot encode/);
    expect(() => canonicalize(10n)).toThrow(/cannot encode/);
  });
});

describe("hashing", () => {
  it("is keccak256, not SHA3-256", () => {
    expect(keccakHex("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  it("ignores the hash field and key order", () => {
    const a = documentHash({ x: 1, y: [2], hash: "0xabc" });
    const b = documentHash({ y: [2], x: 1 });
    expect(a).toBe(b);
    expect(a).toBe(keccakHex('{"x":1,"y":[2]}'));
  });
});
