export const isNewTabShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.code !== "Backslash") return false;
  if (event.altKey && !event.metaKey && !event.ctrlKey) return true;
  return isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
};
