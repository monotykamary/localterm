import { describe, expect, it } from "vite-plus/test";
import { getCachedTokens, tokenizeDiffLines } from "../../src/utils/syntax-highlight";

describe("syntax highlighting color schemes", () => {
  it("tokenizes and caches light and dark palettes independently", async () => {
    const filePath = "scheme-cache-example.ts";
    const lines = ['const message = "hello";'];
    const darkTokens = await tokenizeDiffLines(filePath, lines, "typescript", "dark");
    const lightTokens = await tokenizeDiffLines(filePath, lines, "typescript", "light");

    if (!darkTokens || !lightTokens) throw new Error("syntax highlighting did not load");

    const darkColors = darkTokens.flatMap((line) => line.tokens.map((token) => token.color));
    const lightColors = lightTokens.flatMap((line) => line.tokens.map((token) => token.color));

    expect(lightColors).not.toEqual(darkColors);
    expect(getCachedTokens(filePath, lines, "dark")).toBe(darkTokens);
    expect(getCachedTokens(filePath, lines, "light")).toBe(lightTokens);
  });
});
