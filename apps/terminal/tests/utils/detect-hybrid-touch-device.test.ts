import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { detectHybridTouchDevice } from "../../src/utils/detect-hybrid-touch-device";

interface MatchMediaMatches {
  readonly hoverOrFinePointer?: boolean;
  readonly primaryCoarsePointer?: boolean;
  readonly anyCoarsePointer?: boolean;
}

const installMatchMedia = ({
  hoverOrFinePointer = false,
  primaryCoarsePointer = false,
  anyCoarsePointer = false,
}: MatchMediaMatches) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(hover: hover), (pointer: fine)"
          ? hoverOrFinePointer
          : query === "(pointer: coarse)"
            ? primaryCoarsePointer
            : query === "(any-pointer: coarse)"
              ? anyCoarsePointer
              : false,
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

describe("detectHybridTouchDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true for a touchscreen beside a fine primary pointer (touch laptop)", () => {
    installMatchMedia({ hoverOrFinePointer: true, anyCoarsePointer: true });
    expect(detectHybridTouchDevice()).toBe(true);
  });

  it("returns false for a touch-primary phone or tablet", () => {
    installMatchMedia({ primaryCoarsePointer: true, anyCoarsePointer: true });
    expect(detectHybridTouchDevice()).toBe(false);
  });

  it("returns false for a desktop without a touchscreen", () => {
    installMatchMedia({ hoverOrFinePointer: true });
    expect(detectHybridTouchDevice()).toBe(false);
  });

  it("returns false when no pointer queries match at all", () => {
    installMatchMedia({});
    expect(detectHybridTouchDevice()).toBe(false);
  });
});
