import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { detectTouchPresent } from "../../src/utils/detect-touch-present";

const installMatchMedia = (anyCoarsePointer: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(any-pointer: coarse)" ? anyCoarsePointer : false,
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

describe("detectTouchPresent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when any pointing device is coarse", () => {
    installMatchMedia(true);
    expect(detectTouchPresent()).toBe(true);
  });

  it("returns false when every pointing device is fine", () => {
    installMatchMedia(false);
    expect(detectTouchPresent()).toBe(false);
  });

  it("returns false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(detectTouchPresent()).toBe(false);
  });
});
