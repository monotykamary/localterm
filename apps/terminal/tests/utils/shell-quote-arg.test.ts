import { describe, expect, it } from "vite-plus/test";
import { shellQuoteArg } from "../../src/utils/shell-quote-arg";

describe("shellQuoteArg", () => {
  it("wraps a plain path in single quotes", () => {
    expect(shellQuoteArg("src/app.ts")).toBe("'src/app.ts'");
  });

  it("escapes embedded single quotes via close-escape-reopen", () => {
    expect(shellQuoteArg("it's")).toBe("'it'\\''s'");
    expect(shellQuoteArg("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("leaves shell metacharacters untouched (they're inside the quotes)", () => {
    expect(shellQuoteArg("$HOME `cmd` $(whoami) && rm -rf /")).toBe(
      "'$HOME `cmd` $(whoami) && rm -rf /'",
    );
  });

  it("preserves spaces, parens, and glob characters without expansion", () => {
    expect(shellQuoteArg("docs/My (Draft) Notes.md")).toBe("'docs/My (Draft) Notes.md'");
    expect(shellQuoteArg("pkg/*/**/*.test.ts")).toBe("'pkg/*/**/*.test.ts'");
  });

  it("quotes an empty string", () => {
    expect(shellQuoteArg("")).toBe("''");
  });
});
