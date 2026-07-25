import { describe, expect, it } from "vite-plus/test";
import { createStreamingRedactor, overlapTailLen, redactText } from "../src/utils/redact-output.js";

const SECRET = "sk_live_abc12345";

describe("redactText", () => {
  it("returns the input unchanged when there are no values", () => {
    expect(redactText("hello world", [])).toBe("hello world");
  });

  it("replaces every occurrence of a known value", () => {
    expect(redactText(`token=${SECRET} again ${SECRET}`, [SECRET])).toBe("token=* again *");
  });

  it("skips values below the length floor and redacts the rest", () => {
    expect(redactText("ab and short", ["ab", "short"])).toBe("ab and *");
  });

  it("scans longer values first so a shorter substring does not mask the longer match", () => {
    expect(redactText(`token=${SECRET}`, ["sk_live", SECRET])).toBe("token=*");
  });
});

describe("overlapTailLen", () => {
  it("returns the length of the suffix that is a value prefix", () => {
    expect(overlapTailLen("prefix sk_live", [SECRET])).toBe("sk_live".length);
  });

  it("returns 0 when no suffix is a value prefix", () => {
    expect(overlapTailLen("nothing here", [SECRET])).toBe(0);
  });

  it("returns 1 when the text ends in the value's first character", () => {
    expect(overlapTailLen("keys", [SECRET])).toBe(1);
  });

  it("ignores single-character values", () => {
    expect(overlapTailLen("ab", ["a"])).toBe(0);
  });

  it("takes the longest overlap across multiple values", () => {
    expect(overlapTailLen("ghp_ab", ["sk_live_abc12345", "ghp_abcdef"])).toBe("ghp_ab".length);
  });
});

describe("createStreamingRedactor", () => {
  it("is a pass-through when there is nothing to redact", () => {
    const redactor = createStreamingRedactor([]);
    expect(redactor.push("anything")).toBe("anything");
    expect(redactor.finish()).toBe("");
  });

  it("redacts a value split across two pushes without leaking its head", () => {
    const redactor = createStreamingRedactor([SECRET]);
    const half = Math.floor(SECRET.length / 2);
    const first = redactor.push(`the key is ${SECRET.slice(0, half)}`);
    expect(first.includes(SECRET.slice(0, half))).toBe(false);
    const second = redactor.push(`${SECRET.slice(half)} done`);
    expect(`${first}${second}`).toBe("the key is * done");
    expect(redactor.finish()).toBe("");
  });

  it("redacts a value that arrives whole in one chunk", () => {
    const redactor = createStreamingRedactor([SECRET]);
    expect(redactor.push(`secret: ${SECRET}`)).toBe("secret: ");
    expect(redactor.finish()).toBe("*");
  });

  it("flushes an unmatched held tail verbatim on finish", () => {
    const redactor = createStreamingRedactor([SECRET]);
    expect(redactor.push("just some text that ends with s")).toBe("just some text that ends with ");
    expect(redactor.finish()).toBe("s");
  });

  it("redacts multiple values across mixed chunks", () => {
    const redactor = createStreamingRedactor([SECRET, "ghp_abcdef"]);
    const out =
      redactor.push("keys: ") + redactor.push(`${SECRET} and ghp_ab`) + redactor.push("cdef done");
    expect(out + redactor.finish()).toBe("keys: * and * done");
  });
});
