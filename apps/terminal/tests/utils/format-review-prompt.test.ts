import { describe, expect, it } from "vite-plus/test";
import {
  annotationRangeStart,
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

  it("formats a new-side range as a line span", () => {
    const prompt = formatReviewPrompt([
      annotation({
        startSide: "new",
        startLineNumber: 10,
        lineNumber: 14,
        comment: "Extract this block.",
      }),
    ]);
    expect(prompt).toContain("\n- src/main.ts L10-L14: Extract this block.");
  });

  it("formats an old-side range as a deleted span", () => {
    const prompt = formatReviewPrompt([
      annotation({
        side: "old",
        startSide: "old",
        startLineNumber: 3,
        lineNumber: 5,
        comment: "Keep these.",
      }),
    ]);
    expect(prompt).toContain(
      "\n- src/main.ts (deleted, was L3-L5 — see `git diff`): Keep these.",
    );
  });

  it("spells out both sides for a range that crosses removed lines", () => {
    const prompt = formatReviewPrompt([
      annotation({
        startSide: "old",
        startLineNumber: 7,
        lineNumber: 9,
        comment: "This replacement loses the null check.",
      }),
    ]);
    expect(prompt).toContain(
      "\n- src/main.ts old L7 through L9 (range spans removed lines — see `git diff`): " +
        "This replacement loses the null check.",
    );
  });

  it("treats a degenerate range as a single line", () => {
    const prompt = formatReviewPrompt([
      annotation({ startSide: "new", startLineNumber: 4, lineNumber: 4, comment: "One line." }),
    ]);
    expect(prompt).toContain("\n- src/main.ts L4: One line.");
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

describe("annotationRangeStart", () => {
  it("returns null for single-line annotations and degenerate ranges", () => {
    expect(annotationRangeStart(annotation({ lineNumber: 5 }))).toBeNull();
    expect(
      annotationRangeStart(
        annotation({ startSide: "new", startLineNumber: 5, lineNumber: 5 }),
      ),
    ).toBeNull();
  });

  it("returns the start of a real range", () => {
    expect(
      annotationRangeStart(
        annotation({ startSide: "old", startLineNumber: 2, lineNumber: 5 }),
      ),
    ).toEqual({ side: "old", lineNumber: 2 });
  });
});
