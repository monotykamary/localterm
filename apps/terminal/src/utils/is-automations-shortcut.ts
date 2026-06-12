import { isKeyboardShortcutWithKey } from "./is-keyboard-shortcut-with-key.js";

export const isAutomationsShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  isKeyboardShortcutWithKey(event, "j", isMac);
