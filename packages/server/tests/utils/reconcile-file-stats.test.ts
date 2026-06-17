import { describe, expect, it } from "vitest";
import { reconcileFileStats } from "../../src/utils/reconcile-file-stats.js";

interface File {
  additions: number;
  deletions: number;
  binary: boolean;
}

const file = (additions: number, deletions: number, binary = false): File => ({
  additions,
  deletions,
  binary,
});

describe("reconcileFileStats", () => {
  it("leaves counts unchanged when per-file totals already match the aggregate", () => {
    const files = [file(3, 1), file(0, 5), file(2, 0)];
    reconcileFileStats(files, 5, 6);
    expect(files).toEqual([file(3, 1), file(0, 5), file(2, 0)]);
  });

  it("distributes a positive surplus across non-binary files", () => {
    const files = [file(3, 1), file(0, 5), file(2, 0)];
    reconcileFileStats(files, 7, 8);
    expect(files.reduce((sum, f) => sum + f.additions, 0)).toBe(7);
    expect(files.reduce((sum, f) => sum + f.deletions, 0)).toBe(8);
  });

  it("never drives a zero-count file negative when the per-file sum overshoots", () => {
    // computePatchFromContents can over-count vs git's diff.stats(); the
    // surplus must be taken only from files with room, never driving a 0 to -1
    // (the wire schema rejects negative additions).
    const files = [file(0, 0), file(0, 0), file(4, 2)];
    reconcileFileStats(files, 3, 1);
    for (const f of files) {
      expect(f.additions).toBeGreaterThanOrEqual(0);
      expect(f.deletions).toBeGreaterThanOrEqual(0);
    }
    expect(files[0]).toEqual(file(0, 0));
    expect(files[1]).toEqual(file(0, 0));
    expect(files[2]).toEqual(file(3, 1));
  });

  it("leaves a surplus unreconciled when no non-zero files can absorb it", () => {
    const files = [file(0, 0), file(0, 0)];
    reconcileFileStats(files, 0, 0);
    expect(files).toEqual([file(0, 0), file(0, 0)]);
  });

  it("skips binary files for both totals and redistribution", () => {
    const files = [file(5, 2, true), file(2, 1), file(1, 0)];
    reconcileFileStats(files, 4, 3);
    expect(files[0]).toEqual(file(5, 2, true));
    expect(files[1]).toEqual(file(3, 2));
    expect(files[2]).toEqual(file(1, 1));
  });
});
