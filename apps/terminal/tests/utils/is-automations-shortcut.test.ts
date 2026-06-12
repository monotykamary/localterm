import { describe, expect, it } from "vite-plus/test";
import { isAutomationsShortcut } from "../../src/utils/is-automations-shortcut";

const keyboardEvent = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", init);

describe("isAutomationsShortcut", () => {
  it("matches cmd+j on mac", () => {
    expect(isAutomationsShortcut(keyboardEvent({ key: "j", metaKey: true }), true)).toBe(true);
    expect(isAutomationsShortcut(keyboardEvent({ key: "J", metaKey: true }), true)).toBe(true);
  });

  it("matches ctrl+j elsewhere", () => {
    expect(isAutomationsShortcut(keyboardEvent({ key: "j", ctrlKey: true }), false)).toBe(true);
  });

  it("rejects the wrong modifier for the platform", () => {
    expect(isAutomationsShortcut(keyboardEvent({ key: "j", ctrlKey: true }), true)).toBe(false);
    expect(isAutomationsShortcut(keyboardEvent({ key: "j", metaKey: true }), false)).toBe(false);
  });

  it("rejects other keys and extra modifiers", () => {
    expect(isAutomationsShortcut(keyboardEvent({ key: "k", metaKey: true }), true)).toBe(false);
    expect(
      isAutomationsShortcut(keyboardEvent({ key: "j", metaKey: true, altKey: true }), true),
    ).toBe(false);
    expect(isAutomationsShortcut(keyboardEvent({ key: "j" }), true)).toBe(false);
  });
});
