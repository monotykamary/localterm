import { describe, expect, it } from "vite-plus/test";
import { redactText } from "../src/utils/redact-output.js";

describe("redactText", () => {
  it("returns the input unchanged when there are no values", () => {
    expect(redactText("hello world", [])).toBe("hello world");
  });

  it("replaces every occurrence of a known value", () => {
    expect(redactText("key=sk_live_abc12345 again sk_live_abc12345", ["sk_live_abc12345"])).toBe(
      "key=* again *",
    );
  });

  it("skips values below the length floor", () => {
    expect(redactText("ab and short", ["ab", "short"])).toBe("ab and *");
  });

  it("scans longer values first so a shorter substring does not mask the longer match", () => {
    expect(redactText("token=sk_live_abc12345", ["sk_live", "sk_live_abc12345"])).toBe("token=*");
  });

  it("leaves text without any value untouched", () => {
    expect(redactText("nothing here", ["sk_live_abc12345"])).toBe("nothing here");
  });
});
