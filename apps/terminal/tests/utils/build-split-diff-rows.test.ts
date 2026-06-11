import { describe, expect, it } from "vite-plus/test";
import { buildSplitDiffRows } from "../../src/utils/build-split-diff-rows";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

const hunkFrom = (patch: string) => parseUnifiedDiff(patch)[0];

describe("buildSplitDiffRows", () => {
  it("places context lines on both sides", () => {
    const hunk = hunkFrom("@@ -1,2 +1,2 @@\n one\n two\n");
    const rows = buildSplitDiffRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows[0].left).toBe(rows[0].right);
    expect(rows[0].left?.text).toBe("one");
  });

  it("pairs a deletion run with the following addition run", () => {
    const hunk = hunkFrom("@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n");
    const rows = buildSplitDiffRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows[0].left?.text).toBe("a");
    expect(rows[0].right?.text).toBe("A");
    expect(rows[1].left?.text).toBe("b");
    expect(rows[1].right?.text).toBe("B");
  });

  it("leaves unpaired deletions and additions one-sided", () => {
    const deletionsOnly = buildSplitDiffRows(hunkFrom("@@ -1,2 +1,1 @@\n-a\n-b\n+A\n"));
    expect(deletionsOnly).toHaveLength(2);
    expect(deletionsOnly[1].left?.text).toBe("b");
    expect(deletionsOnly[1].right).toBeNull();

    const additionsOnly = buildSplitDiffRows(hunkFrom("@@ -1,1 +1,2 @@\n-a\n+A\n+B\n"));
    expect(additionsOnly).toHaveLength(2);
    expect(additionsOnly[1].left).toBeNull();
    expect(additionsOnly[1].right?.text).toBe("B");
  });

  it("flushes pending changes at a context boundary", () => {
    const hunk = hunkFrom("@@ -1,3 +1,3 @@\n-a\n+A\n mid\n-z\n+Z\n");
    const rows = buildSplitDiffRows(hunk);
    expect(rows).toHaveLength(3);
    expect(rows[0].left?.text).toBe("a");
    expect(rows[0].right?.text).toBe("A");
    expect(rows[1].left?.text).toBe("mid");
    expect(rows[2].left?.text).toBe("z");
    expect(rows[2].right?.text).toBe("Z");
  });

  it("flushes a trailing change run", () => {
    const hunk = hunkFrom("@@ -1,2 +1,1 @@\n keep\n-tail\n");
    const rows = buildSplitDiffRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows[1].left?.text).toBe("tail");
    expect(rows[1].right).toBeNull();
  });
});
