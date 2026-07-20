import { describe, expect, it } from "vite-plus/test";
import {
  MAC_KEYBOARD_SHORTCUT_DEFAULTS,
  NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS,
} from "../../src/lib/keyboard-shortcuts";
import { formatKeyboardShortcut } from "../../src/utils/format-keyboard-shortcut";
import { isConfiguredKeyboardShortcut } from "../../src/utils/is-configured-keyboard-shortcut";
import { keyboardShortcutFromEvent } from "../../src/utils/keyboard-shortcut-from-event";

const keyboardEvent = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", init);

describe("keyboard shortcuts", () => {
  it("avoids ctrl+b for non-Mac worktree defaults", () => {
    expect(
      isConfiguredKeyboardShortcut(
        keyboardEvent({ key: "b", ctrlKey: true }),
        NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS.worktrees,
      ),
    ).toBe(false);
    expect(
      isConfiguredKeyboardShortcut(
        keyboardEvent({ key: "b", altKey: true }),
        NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS.worktrees,
      ),
    ).toBe(true);
    expect(formatKeyboardShortcut(NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS.worktrees, false)).toBe(
      "Alt+B",
    );
  });

  it("keeps command+b as the Mac worktree default", () => {
    expect(
      isConfiguredKeyboardShortcut(
        keyboardEvent({ key: "b", metaKey: true }),
        MAC_KEYBOARD_SHORTCUT_DEFAULTS.worktrees,
      ),
    ).toBe(true);
    expect(formatKeyboardShortcut(MAC_KEYBOARD_SHORTCUT_DEFAULTS.worktrees, true)).toBe("⌘B");
  });

  it("does not match or format an unassigned shortcut", () => {
    expect(isConfiguredKeyboardShortcut(keyboardEvent({ key: "g", ctrlKey: true }), null)).toBe(
      false,
    );
    expect(formatKeyboardShortcut(null, false)).toBeUndefined();
  });

  it("captures modified keys and rejects bare typing", () => {
    expect(
      keyboardShortcutFromEvent(keyboardEvent({ key: "g", ctrlKey: true, shiftKey: true })),
    ).toEqual({ key: "g", altKey: false, ctrlKey: true, metaKey: false, shiftKey: true });
    expect(keyboardShortcutFromEvent(keyboardEvent({ key: "g" }))).toBeNull();
  });
});
