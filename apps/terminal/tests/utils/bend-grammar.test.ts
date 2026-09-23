import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import bendGrammar from "../../src/utils/bend-grammar";

describe("Bend 2 grammar", () => {
  let highlighter: Awaited<ReturnType<typeof createHighlighterCore>>;

  beforeAll(async () => {
    highlighter = await createHighlighterCore({
      langs: [bendGrammar],
      themes: [import("@shikijs/themes/dark-plus"), import("@shikijs/themes/light-plus")],
      engine: createJavaScriptRegexEngine(),
    });
  });

  afterAll(() => highlighter.dispose());

  it.each([
    ["law add_zero:", "law", "storage.type.function.bend"],
    ["def Laws.add_zero(x):", "Laws.add_zero", "entity.name.function.bend"],
    ["type List<a, -A: Kind(a)> is Kind(a):", "List", "entity.name.type.bend"],
    ["import ./math.bend as M", "./math.bend", "entity.name.namespace.bend"],
    ["for y: Nat where P(y)", "where", "keyword.control.bend"],
    ["exs z: Nat", "exs", "keyword.control.bend"],
    ["match x:", "match", "keyword.control.bend"],
    ["case 1n+p:", "case", "keyword.control.bend"],
    ["do IO<Unit>:", "do", "keyword.control.bend"],
    ["return x", "return", "keyword.control.bend"],
    ["@unsafe def loop(x):", "@unsafe", "storage.modifier.bend"],
    ["List<&2, U32>", "&2", "constant.numeric.bend"],
    ["1n+p", "1n", "constant.numeric.bend"],
    ["(1.5 * x : F32)", "1.5", "constant.numeric.bend"],
    ["0xFF", "0xFF", "constant.numeric.bend"],
    ["(x : Quant)", "Quant", "support.type.bend"],
    ["False{}", "False", "constant.language.boolean.bend"],
    ["Con{head, tail}", "Con", "entity.name.type.bend"],
    ["IO.print(message)", "IO.print", "entity.name.function.bend"],
    ["pow2!(20n)", "pow2", "entity.name.function.bend"],
    ["?TODO", "?TODO", "variable.language.bend"],
    ["%add_zero(p) : {1n+p == 1n+_ : Nat}", "%", "keyword.operator.bend"],
    ["{==}", "==", "keyword.operator.bend"],
    ["a <&> b", "<&>", "keyword.operator.bend"],
    ["x .&. y", ".&.", "keyword.operator.bend"],
    ["t(~g, x)", "~", "keyword.operator.bend"],
    ["# law not_code: 1n", "law", "comment.line.number-sign.bend"],
    ['"# not a comment"', "#", "string.quoted.double.bend"],
    ["'#'", "#", "string.quoted.single.bend"],
    ['"say \\"hello\\""', '\\"', "constant.character.escape.bend"],
    ["lawful = format_value", "lawful", "variable.other.bend"],
  ])("scopes %s (%s)", (source, fragment, scope) => {
    const tokens = highlighter.codeToTokensBase(source, {
      lang: "bend",
      theme: "dark-plus",
      includeExplanation: true,
    })[0];
    const offset = source.indexOf(fragment);
    const token = tokens.find(
      (entry) => entry.offset <= offset && entry.offset + entry.content.length > offset,
    );
    const scopes = token?.explanation?.flatMap((entry) =>
      entry.scopes.map((entry) => entry.scopeName),
    );
    expect(scopes).toContain(scope);
    expect(tokens.map((entry) => entry.content).join("")).toBe(source);
  });

  it.each(["dark-plus", "light-plus"])(
    "keeps strings, comments and following code distinct in %s",
    (theme) => {
      const source =
        '"# string" # comment\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}';
      const lines = highlighter.codeToTokensBase(source, { lang: "bend", theme });
      const stringColor = lines[0].find((token) => token.content.includes("string"))?.color;
      const commentColor = lines[0].find((token) => token.content.includes("comment"))?.color;
      const lawColor = lines[1].find((token) => token.content === "law")?.color;
      expect(stringColor).toBeTruthy();
      expect(commentColor).toBeTruthy();
      expect(lawColor).toBeTruthy();
      expect(new Set([stringColor, commentColor, lawColor]).size).toBe(3);
      expect(lines.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(
        source,
      );
    },
  );
});
