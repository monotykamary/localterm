import { describe, expect, it } from "vitest";
import { memoBy } from "../../src/utils/memo-by.js";

describe("memoBy", () => {
  it("returns items in order, keeping the first per key", () => {
    const result = memoBy(
      [
        { name: "a", val: 1 },
        { name: "b", val: 2 },
        { name: "a", val: 3 },
      ],
      (item) => item.name,
    );
    expect(result).toEqual([
      { name: "a", val: 1 },
      { name: "b", val: 2 },
    ]);
  });

  it("returns all items when keys are unique", () => {
    const items = [1, 2, 3];
    expect(memoBy(items, (n) => n)).toEqual([1, 2, 3]);
  });

  it("returns empty for empty input", () => {
    expect(memoBy([], (x) => x)).toEqual([]);
  });

  it("memoizes by a derived key", () => {
    const result = memoBy(["Foo", "foo", "BAR"], (s) => s.toLowerCase());
    expect(result).toEqual(["Foo", "BAR"]);
  });

  it("preserves stability: first occurrence wins", () => {
    const result = memoBy([5, 3, 5, 1, 3], (n) => n);
    expect(result).toEqual([5, 3, 1]);
  });
});
