import { describe, expect, it } from "vite-plus/test";
import { buildDiffTokenMap } from "../../src/utils/build-diff-token-map";
import type { DiffLine } from "../../src/utils/parse-unified-diff";
import type { MaterializedDocumentTokens } from "../../src/utils/syntax-token-manager";
import type { SyntaxLine } from "../../src/utils/syntax-highlight";

const syntaxLine = (text: string): SyntaxLine => ({
  tokens: [{ content: text, color: "#fff", fontStyle: 0 }],
});

describe("buildDiffTokenMap", () => {
  it("maps rows to their side's highlighted lines and verifies text", () => {
    const oldAlpha: DiffLine = {
      type: "del",
      text: "alpha",
      oldLine: 1,
      newLine: null,
      noNewline: false,
    };
    const newAlpha: DiffLine = {
      type: "add",
      text: "ALPHA",
      oldLine: null,
      newLine: 1,
      noNewline: false,
    };
    const materialized: MaterializedDocumentTokens = {
      old: [syntaxLine("alpha")],
      next: [syntaxLine("ALPHA")],
    };
    const map = buildDiffTokenMap(
      [oldAlpha, newAlpha],
      [
        { side: "old", docLine: 0 },
        { side: "new", docLine: 0 },
      ],
      materialized,
    );
    expect(map.get(oldAlpha)?.tokens[0]?.content).toBe("alpha");
    expect(map.get(newAlpha)?.tokens[0]?.content).toBe("ALPHA");
  });

  it("leaves rows plain when the documents raced the patch", () => {
    const staleAdd: DiffLine = {
      type: "add",
      text: "new text",
      oldLine: null,
      newLine: 1,
      noNewline: false,
    };
    const materialized: MaterializedDocumentTokens = {
      old: null,
      next: [syntaxLine("old text")],
    };
    const map = buildDiffTokenMap([staleAdd], [{ side: "new", docLine: 0 }], materialized);
    expect(map.size).toBe(0);
  });

  it("leaves rows plain outside the tokenized bound or on a missing side", () => {
    const beyond: DiffLine = {
      type: "add",
      text: "tail",
      oldLine: null,
      newLine: 7,
      noNewline: false,
    };
    const deleted: DiffLine = {
      type: "del",
      text: "gone",
      oldLine: 1,
      newLine: null,
      noNewline: false,
    };
    const materialized: MaterializedDocumentTokens = { old: null, next: [syntaxLine("tail")] };
    const map = buildDiffTokenMap(
      [beyond, deleted],
      [
        { side: "new", docLine: 6 },
        { side: "old", docLine: 0 },
      ],
      materialized,
    );
    expect(map.size).toBe(0);
  });
});
