import { describe, expect, it } from "vite-plus/test";
import { materializeEntryTokens, requestSyntaxTokens } from "../../src/utils/syntax-token-manager";

// Real shiki tokenization through the same code the worker runs (main-thread
// fallback in jsdom, since Worker is undefined there).
describe("syntax side-document tokenization", () => {
  it("applies enclosing grammar state (block comment interior colors as comment)", async () => {
    const source = [
      "/*",
      "const notCode = 1;",
      "const alsoNotCode = 2;",
      "*/",
      "export const code = 3;",
    ].join("\n");
    const entry = await requestSyntaxTokens({
      langId: "typescript",
      documents: { oldText: source, newText: source },
      oldMaxLines: 5,
      newMaxLines: 5,
      priority: 0,
    });
    const dark = materializeEntryTokens(entry, "dark");
    const openerLine = dark.next?.[0];
    const interiorLine = dark.next?.[1];
    const deeperInteriorLine = dark.next?.[2];
    if (!openerLine || !interiorLine || !deeperInteriorLine) {
      throw new Error("syntax highlighting did not load");
    }
    const openerColors = new Set(openerLine.tokens.map((token) => token.color));
    for (const token of interiorLine.tokens) expect(openerColors.has(token.color)).toBe(true);
    for (const token of deeperInteriorLine.tokens) expect(openerColors.has(token.color)).toBe(true);
    expect(interiorLine.tokens.map((token) => token.content).join("")).toBe("const notCode = 1;");
  });

  it("ships both schemes from one request and re-serves the entry from cache", async () => {
    const source = 'const message = "hello";';
    const entry = await requestSyntaxTokens({
      langId: "typescript",
      documents: { oldText: source, newText: source },
      oldMaxLines: 1,
      newMaxLines: 1,
      priority: 0,
    });
    const dark = materializeEntryTokens(entry, "dark");
    const light = materializeEntryTokens(entry, "light");
    const darkColors = new Set(dark.next?.[0]?.tokens.map((token) => token.color));
    const lightColors = new Set(light.next?.[0]?.tokens.map((token) => token.color));
    expect(lightColors).not.toEqual(darkColors);

    const cachedEntry = await requestSyntaxTokens({
      langId: "typescript",
      documents: { oldText: source, newText: source },
      oldMaxLines: 1,
      newMaxLines: 1,
      priority: 0,
    });
    expect(cachedEntry).toBe(entry);
  });

  it("serves a darker-colored slice from a truncated bound as plain-absent, not clipped tokens", async () => {
    const source = "export const a = 1;\nexport const b = 2;\nexport const c = 3;";
    const entry = await requestSyntaxTokens({
      langId: "typescript",
      documents: { oldText: null, newText: source },
      oldMaxLines: 0,
      newMaxLines: 2,
      priority: 0,
    });
    const dark = materializeEntryTokens(entry, "dark");
    expect(dark.old).toBeNull();
    expect(dark.next?.[0]).toBeDefined();
    expect(dark.next?.[1]).toBeDefined();
    expect(dark.next?.[2]).toBeUndefined();
  });
});
