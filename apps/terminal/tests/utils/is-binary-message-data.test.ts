import { describe, expect, it } from "vite-plus/test";
import { isBinaryMessageData } from "../../src/utils/is-binary-message-data";

describe("isBinaryMessageData", () => {
  it("matches a same-realm ArrayBuffer via the instanceof fast path", () => {
    expect(isBinaryMessageData(new ArrayBuffer(8))).toBe(true);
  });

  it("matches a zero-length ArrayBuffer", () => {
    expect(isBinaryMessageData(new ArrayBuffer(0))).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "hello"],
    ["number", 42],
    ["plain object", {}],
    ["array", [1, 2, 3]],
    ["Uint8Array", new Uint8Array(8)],
  ])("rejects %s", (_label, value) => {
    expect(isBinaryMessageData(value)).toBe(false);
  });

  // This is the whole reason the helper exists. A real ArrayBuffer produced in
  // another realm (Node's TextEncoder under jsdom, the production failure that
  // shipped in 2.7.4) is not instanceof *this* realm's ArrayBuffer, but its
  // internal class string is still "ArrayBuffer". Object.prototype.toString
  // reads that string regardless of realm, so it catches the instanceof miss.
  // An object that lies about its toString tag exercises the same fallback
  // branch without needing a second JS realm to exist in the test.
  it("falls back to the class-string check when instanceof misses", () => {
    const crossRealmLike = { [Symbol.toStringTag]: "ArrayBuffer" };
    expect(crossRealmLike instanceof ArrayBuffer).toBe(false);
    expect(isBinaryMessageData(crossRealmLike)).toBe(true);
  });
});
