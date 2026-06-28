import { describe, expect, it } from "vite-plus/test";
import { isPortsShortcut } from "../../src/utils/is-ports-shortcut";

const keyboardEvent = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", init);

describe("isPortsShortcut", () => {
  it("matches cmd+shift+d on mac", () => {
    expect(isPortsShortcut(keyboardEvent({ key: "d", metaKey: true, shiftKey: true }), true)).toBe(
      true,
    );
    expect(isPortsShortcut(keyboardEvent({ key: "D", metaKey: true, shiftKey: true }), true)).toBe(
      true,
    );
  });

  it("matches ctrl+shift+d elsewhere", () => {
    expect(isPortsShortcut(keyboardEvent({ key: "d", ctrlKey: true, shiftKey: true }), false)).toBe(
      true,
    );
  });

  it("requires shift", () => {
    expect(isPortsShortcut(keyboardEvent({ key: "d", metaKey: true }), true)).toBe(false);
    expect(isPortsShortcut(keyboardEvent({ key: "d", ctrlKey: true }), false)).toBe(false);
  });

  it("rejects the wrong modifier for the platform", () => {
    expect(isPortsShortcut(keyboardEvent({ key: "d", ctrlKey: true, shiftKey: true }), true)).toBe(
      false,
    );
    expect(isPortsShortcut(keyboardEvent({ key: "d", metaKey: true, shiftKey: true }), false)).toBe(
      false,
    );
  });

  it("rejects other keys and extra modifiers", () => {
    expect(isPortsShortcut(keyboardEvent({ key: "p", metaKey: true, shiftKey: true }), true)).toBe(
      false,
    );
    expect(
      isPortsShortcut(
        keyboardEvent({ key: "d", metaKey: true, shiftKey: true, altKey: true }),
        true,
      ),
    ).toBe(false);
    expect(isPortsShortcut(keyboardEvent({ key: "d", shiftKey: true }), true)).toBe(false);
  });
});
