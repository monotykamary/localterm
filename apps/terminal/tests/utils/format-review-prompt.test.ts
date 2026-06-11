import { describe, expect, it } from "vite-plus/test";
import {
  diffAnnotationKey,
  formatReviewPrompt,
  type DiffAnnotation,
} from "../../src/utils/format-review-prompt";

const annotation = (overrides: Partial<DiffAnnotation>): DiffAnnotation => ({
  filePath: "src/main.ts",
  side: "new",
  lineNumber: 1,
  comment: "comment",
  ...overrides,
});

describe("formatReviewPrompt", () => {
  it("formats an added or context line as a line reference", () => {
    const prompt = formatReviewPrompt([
      annotation({ lineNumber: 45, comment: "Handle the empty case." }),
    ]);
    expect(prompt).toContain("Please address the following code review comments.");
    expect(prompt).toContain("\n- src/main.ts L45: Handle the empty case.");
  });

  it("marks deleted lines and points at git diff", () => {
    const prompt = formatReviewPrompt([
      annotation({ side: "old", lineNumber: 12, comment: "Why was this removed?" }),
    ]);
    expect(prompt).toContain(
      "\n- src/main.ts (deleted, was L12 — see `git diff`): Why was this removed?",
    );
  });

  it("sorts comments by file path, then line number", () => {
    const prompt = formatReviewPrompt([
      annotation({ filePath: "src/b.ts", lineNumber: 9, comment: "third" }),
      annotation({ filePath: "src/b.ts", lineNumber: 2, comment: "second" }),
      annotation({ filePath: "src/a.ts", lineNumber: 30, comment: "first" }),
    ]);
    const firstIndex = prompt.indexOf("first");
    const secondIndex = prompt.indexOf("second");
    const thirdIndex = prompt.indexOf("third");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });
});

describe("diffAnnotationKey", () => {
  it("distinguishes the same line number on opposite sides", () => {
    expect(diffAnnotationKey(annotation({ side: "old", lineNumber: 3 }))).not.toBe(
      diffAnnotationKey(annotation({ side: "new", lineNumber: 3 })),
    );
  });
});
