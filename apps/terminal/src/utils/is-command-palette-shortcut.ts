export const isCommandPaletteShortcut = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.key !== "k" && event.key !== "K") return false;
  return isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
};
