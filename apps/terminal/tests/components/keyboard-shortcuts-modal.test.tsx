import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { KeyboardShortcutsModal } from "../../src/components/keyboard-shortcuts-modal";
import { NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS } from "../../src/lib/keyboard-shortcuts";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.unstubAllGlobals();
});

describe("KeyboardShortcutsModal", () => {
  it("clears an assigned shortcut", () => {
    const onChange = vi.fn();
    render(
      <KeyboardShortcutsModal
        open
        isMac={false}
        keyboardShortcuts={NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS}
        onChange={onChange}
        onClose={() => {}}
        onReset={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("clear Git worktrees shortcut"));

    expect(onChange).toHaveBeenCalledWith("worktrees", null);
  });

  it("shows an unassigned shortcut and disables clearing it again", () => {
    render(
      <KeyboardShortcutsModal
        open
        isMac={false}
        keyboardShortcuts={{ ...NON_MAC_KEYBOARD_SHORTCUT_DEFAULTS, worktrees: null }}
        onChange={() => {}}
        onClose={() => {}}
        onReset={() => {}}
      />,
    );

    expect(screen.getByLabelText("change Git worktrees shortcut").textContent).toBe("Unassigned");
    expect(screen.getByLabelText("clear Git worktrees shortcut").hasAttribute("disabled")).toBe(
      true,
    );
  });
});
