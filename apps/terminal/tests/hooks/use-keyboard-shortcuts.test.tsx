import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useKeyboardShortcuts } from "../../src/hooks/use-keyboard-shortcuts";
import { KEYBOARD_SHORTCUTS_STORAGE_KEY } from "../../src/lib/constants";

const KeyboardShortcutHarness = () => {
  const { keyboardShortcuts, setKeyboardShortcut } = useKeyboardShortcuts(false);
  return (
    <button type="button" onClick={() => setKeyboardShortcut("worktrees", null)}>
      {keyboardShortcuts.worktrees === null ? "Unassigned" : "Assigned"}
    </button>
  );
};

beforeEach(() => {
  localStorage.clear();
});

describe("useKeyboardShortcuts", () => {
  it("loads a cleared shortcut without restoring its default", () => {
    localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify({ worktrees: null }));

    render(<KeyboardShortcutHarness />);

    expect(screen.getByRole("button").textContent).toBe("Unassigned");
  });

  it("persists a cleared shortcut", () => {
    render(<KeyboardShortcutHarness />);

    fireEvent.click(screen.getByRole("button"));

    const stored = JSON.parse(localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY) ?? "{}");
    expect(stored.worktrees).toBeNull();
  });
});
