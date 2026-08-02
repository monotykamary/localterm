import { describe, expect, it, vi } from "vite-plus/test";
import { computeHeaderLayout } from "../../src/utils/compute-header-layout";

vi.mock("@chenglou/pretext", () => ({
  prepareWithSegments: (text: string) => text,
  measureNaturalWidth: (text: string) => Array.from(text).length,
}));

const MINIMUM_AUDITED_HEADER_WIDTH_PX = 200;
const MAXIMUM_AUDITED_HEADER_WIDTH_PX = 1280;
const HEADER_WIDTH_AUDIT_STEP_PX = 8;

const ADVERSARIAL_BRANCH_NAMES = [
  "main",
  "feature/a-branch-name-that-keeps-going-without-a-natural-break-for-a-very-long-time",
  "功能/非常に長いブランチ名/🚀-إصلاح-طويل",
] as const;

const assertLayoutsFit = (previousConfigIndex?: number) => {
  const failures: string[] = [];
  for (
    let availableWidth = MINIMUM_AUDITED_HEADER_WIDTH_PX;
    availableWidth <= MAXIMUM_AUDITED_HEADER_WIDTH_PX;
    availableWidth += HEADER_WIDTH_AUDIT_STEP_PX
  ) {
    for (const selectedBranch of ADVERSARIAL_BRANCH_NAMES) {
      const layout = computeHeaderLayout({
        availableWidth,
        pr: {
          number: Number.MAX_SAFE_INTEGER,
          state: "merged",
          title:
            "An intentionally unbounded pull request title that must yield before fixed controls",
        },
        isBranchMode: true,
        selectedBranch,
        additions: Number.MAX_SAFE_INTEGER,
        deletions: Number.MAX_SAFE_INTEGER,
        binaryCount: Number.MAX_SAFE_INTEGER,
        isLoading: true,
        previousConfigIndex,
      });

      if (!layout.fitsAvailableWidth) {
        failures.push(`${availableWidth}px ${selectedBranch}: layout does not fit`);
      }
      if (layout.requiredWidthPx > availableWidth) {
        failures.push(
          `${availableWidth}px ${selectedBranch}: requires ${layout.requiredWidthPx}px`,
        );
      }
      if (layout.selectWidthPx >= availableWidth) {
        failures.push(
          `${availableWidth}px ${selectedBranch}: select uses ${layout.selectWidthPx}px`,
        );
      }
    }
  }
  expect(failures).toEqual([]);
};

describe("computeHeaderLayout", () => {
  it("fits adversarial dynamic text at every supported width", () => {
    assertLayoutsFit();
  });

  it("continues to fit while hysteresis retains a previous tier", () => {
    assertLayoutsFit(9);
  });

  it("reveals details progressively as room becomes available", () => {
    const narrow = computeHeaderLayout({
      availableWidth: MINIMUM_AUDITED_HEADER_WIDTH_PX,
      pr: { number: 123, state: "open", title: "A pull request" },
      isBranchMode: true,
      selectedBranch: ADVERSARIAL_BRANCH_NAMES[1],
      additions: 12,
      deletions: 7,
      binaryCount: 1,
      isLoading: false,
    });
    const wide = computeHeaderLayout({
      availableWidth: MAXIMUM_AUDITED_HEADER_WIDTH_PX,
      pr: { number: 123, state: "open", title: "A pull request" },
      isBranchMode: true,
      selectedBranch: ADVERSARIAL_BRANCH_NAMES[1],
      additions: 12,
      deletions: 7,
      binaryCount: 1,
      isLoading: false,
    });

    expect(narrow.configIndex).toBeGreaterThan(wide.configIndex);
    expect(narrow.selectWidthPx).toBeLessThan(wide.selectWidthPx);
    expect(narrow.showStats).toBe(false);
    expect(wide.showStats).toBe(true);
  });
});
