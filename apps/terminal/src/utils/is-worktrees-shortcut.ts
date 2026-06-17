// Excludes Shift so it doesn't shadow the create shortcut (⌘/Ctrl+Shift+B):
// without an explicit shift check, a shared modifier-only helper would match
// both ⌘B and ⌘Shift+B.
export const isWorktreesShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "b" && event.key !== "B") return false;
  return isMac
    ? event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey;
};
