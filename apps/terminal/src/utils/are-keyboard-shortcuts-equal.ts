import type { KeyboardShortcutBinding } from "@/lib/keyboard-shortcuts";

export const areKeyboardShortcutsEqual = (
  first: KeyboardShortcutBinding,
  second: KeyboardShortcutBinding,
): boolean =>
  first !== null &&
  second !== null &&
  first.key.toLowerCase() === second.key.toLowerCase() &&
  first.altKey === second.altKey &&
  first.ctrlKey === second.ctrlKey &&
  first.metaKey === second.metaKey &&
  first.shiftKey === second.shiftKey;
