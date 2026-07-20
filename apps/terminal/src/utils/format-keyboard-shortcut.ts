import type { KeyboardShortcutBinding } from "@/lib/keyboard-shortcuts";

export const formatKeyboardShortcut = (
  shortcut: KeyboardShortcutBinding,
  isMac: boolean,
): string | undefined => {
  if (!shortcut) return undefined;
  const modifiers: string[] = [];
  if (shortcut.ctrlKey) modifiers.push(isMac ? "⌃" : "Ctrl");
  if (shortcut.altKey) modifiers.push(isMac ? "⌥" : "Alt");
  if (shortcut.shiftKey) modifiers.push(isMac ? "⇧" : "Shift");
  if (shortcut.metaKey) modifiers.push(isMac ? "⌘" : "Meta");
  const key =
    shortcut.key === " "
      ? "Space"
      : shortcut.key.length === 1
        ? shortcut.key.toUpperCase()
        : shortcut.key;
  return isMac ? [...modifiers, key].join("") : [...modifiers, key].join("+");
};
