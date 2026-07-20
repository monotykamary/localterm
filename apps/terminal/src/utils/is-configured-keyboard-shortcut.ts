import type { KeyboardShortcut } from "@/lib/keyboard-shortcuts";

export const isConfiguredKeyboardShortcut = (
  event: KeyboardEvent,
  shortcut: KeyboardShortcut,
): boolean =>
  event.key.toLowerCase() === shortcut.key.toLowerCase() &&
  event.altKey === shortcut.altKey &&
  event.ctrlKey === shortcut.ctrlKey &&
  event.metaKey === shortcut.metaKey &&
  event.shiftKey === shortcut.shiftKey;
