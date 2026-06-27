import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { isCoarsePointer } from "../../src/utils/is-coarse-pointer";

const installMatchMedia = (coarse: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)" ? coarse : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

describe("isCoarsePointer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the primary pointer is coarse", () => {
    installMatchMedia(true);
    expect(isCoarsePointer()).toBe(true);
  });

  it("returns false when the primary pointer is fine", () => {
    installMatchMedia(false);
    expect(isCoarsePointer()).toBe(false);
  });

  it("returns false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(isCoarsePointer()).toBe(false);
  });
});
