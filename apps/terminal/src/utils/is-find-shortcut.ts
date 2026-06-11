import { isKeyboardShortcutWithKey } from "./is-keyboard-shortcut-with-key.js";

export const isFindShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  isKeyboardShortcutWithKey(event, "f", isMac);
