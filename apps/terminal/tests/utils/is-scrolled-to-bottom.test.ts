import { describe, expect, it } from "vite-plus/test";
import { isScrolledToBottom } from "../../src/utils/is-scrolled-to-bottom";

const stubElement = (
  overrides: Partial<Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">>,
) =>
  ({
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    ...overrides,
  }) as HTMLElement;

describe("isScrolledToBottom", () => {
  it("is true when the scroll position rests at the bottom", () => {
    const element = stubElement({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 });
    expect(isScrolledToBottom(element, 0)).toBe(true);
  });

  it("is true within the tolerance so rounding doesn't flicker", () => {
    const element = stubElement({ scrollHeight: 1000, scrollTop: 796, clientHeight: 200 });
    expect(isScrolledToBottom(element, 4)).toBe(true);
  });

  it("is false when scrolled away from the bottom", () => {
    const element = stubElement({ scrollHeight: 1000, scrollTop: 0, clientHeight: 200 });
    expect(isScrolledToBottom(element, 4)).toBe(false);
  });

  it("treats subpixel overshoot (negative distance) as at the bottom", () => {
    const element = stubElement({ scrollHeight: 1000, scrollTop: 801, clientHeight: 200 });
    expect(isScrolledToBottom(element, 0)).toBe(true);
  });
});
