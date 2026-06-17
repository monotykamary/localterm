// Create + open: Shift distinguishes it from the plain ⌘/Ctrl+B modal toggle.
export const isWorktreesCreateShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "b" && event.key !== "B") return false;
  return isMac
    ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
};
