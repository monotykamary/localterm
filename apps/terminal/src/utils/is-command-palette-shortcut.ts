import { isKeyboardShortcutWithKey } from "./is-keyboard-shortcut-with-key.js";

export const isCommandPaletteShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  isKeyboardShortcutWithKey(event, "k", isMac);
