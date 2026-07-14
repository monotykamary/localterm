import { describe, expect, it } from "vite-plus/test";
import { qwertyLayout } from "../../src/components/on-screen-keyboard/keyboard-layout";

const findSpecialKey = (action: "alternate" | "enter") => {
  for (const row of qwertyLayout.rows) {
    const key = row.cells.find((cell) => cell.type === "special" && cell.action === action);
    if (key?.type === "special") return key;
  }
  throw new Error(`missing ${action} key`);
};

describe("qwertyLayout mobile controls", () => {
  it("opens keyboard settings from the bottom-left Alt swipe", () => {
    const alternateKey = findSpecialKey("alternate");
    expect(alternateKey.alternates?.southWest?.action).toBe("keyboard-settings");
    expect(alternateKey.alternates?.southWest?.label).toBe("settings");
  });

  it("dismisses the keyboard from the bottom-right Enter swipe", () => {
    const enterKey = findSpecialKey("enter");
    expect(enterKey.alternates?.southEast?.action).toBe("dismiss");
    expect(enterKey.alternates?.southEast?.label).toBe("hide");
  });
});
