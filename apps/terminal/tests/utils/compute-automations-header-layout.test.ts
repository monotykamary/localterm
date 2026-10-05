import { describe, expect, it, vi } from "vite-plus/test";
import { computeAutomationsHeaderLayout } from "../../src/utils/compute-automations-header-layout";
vi.mock("@chenglou/pretext", () => ({
  prepareWithSegments: (text: string) => text,
  measureNaturalWidth: (text: string) => text.length * 7,
}));
describe("automation three-tab header", () => {
  it.each([280, 350, 390])(
    "moves full-label tabs below the title at %spx instead of abbreviating",
    (availableWidth) => {
      expect(
        computeAutomationsHeaderLayout({ availableWidth, showCreateButton: true }).tabsOnSecondRow,
      ).toBe(true);
    },
  );
  it("uses a single row when the title, full labels and actions fit", () => {
    expect(
      computeAutomationsHeaderLayout({ availableWidth: 800, showCreateButton: true })
        .tabsOnSecondRow,
    ).toBe(false);
  });
});
