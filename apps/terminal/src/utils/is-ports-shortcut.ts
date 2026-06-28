// ⌘/Ctrl+Shift+D opens the dev-ports modal. Shift is required because every
// plain modifier-letter is already claimed — ⌘K/J/B/G/F/I and ⌘\ are localterm,
// the rest collide with the browser. "D" → dev ports; ⌘Shift+D is free in
// Chromium and mirrors the ⌘Shift+B create-worktree precedent. (⌘Shift+P was
// the stronger mnemonic but is taken by Dia; ⌘Shift+I is DevTools.)
export const isPortsShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "d" && event.key !== "D") return false;
  return isMac
    ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
};
