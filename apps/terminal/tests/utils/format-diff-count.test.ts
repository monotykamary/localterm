import { describe, expect, it } from "vite-plus/test";
import { formatDiffCount } from "../../src/utils/format-diff-count";

describe("formatDiffCount", () => {
  it("keeps counts below 1000 as-is", () => {
    expect(formatDiffCount(0)).toBe("0");
    expect(formatDiffCount(999)).toBe("999");
  });

  it("compacts thousands with one decimal", () => {
    expect(formatDiffCount(1000)).toBe("1k");
    expect(formatDiffCount(1234)).toBe("1.2k");
    expect(formatDiffCount(9949)).toBe("9.9k");
    expect(formatDiffCount(9990)).toBe("10k");
  });

  it("drops the decimal at ten thousand and above", () => {
    expect(formatDiffCount(10_000)).toBe("10k");
    expect(formatDiffCount(123_456)).toBe("123k");
  });
});
