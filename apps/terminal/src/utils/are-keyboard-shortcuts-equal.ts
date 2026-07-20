import type { KeyboardShortcut } from "@/lib/keyboard-shortcuts";

export const areKeyboardShortcutsEqual = (
  first: KeyboardShortcut,
  second: KeyboardShortcut,
): boolean =>
  first.key.toLowerCase() === second.key.toLowerCase() &&
  first.altKey === second.altKey &&
  first.ctrlKey === second.ctrlKey &&
  first.metaKey === second.metaKey &&
  first.shiftKey === second.shiftKey;
