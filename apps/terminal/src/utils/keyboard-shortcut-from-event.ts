import type { KeyboardShortcut } from "@/lib/keyboard-shortcuts";

export const keyboardShortcutFromEvent = (event: KeyboardEvent): KeyboardShortcut | null => {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null;
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  const isFunctionKey = /^F(?:[1-9]|1[0-2])$/.test(event.key);
  if (!hasModifier && !isFunctionKey) return null;
  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
};
