import { isKeyboardShortcutWithKey } from "./is-keyboard-shortcut-with-key.js";

export const isDiffViewerShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  isKeyboardShortcutWithKey(event, "g", isMac);
