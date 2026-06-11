export const isKeyboardShortcutWithKey = (
  event: KeyboardEvent,
  key: string,
  isMac: boolean,
): boolean => {
  if (event.key !== key && event.key !== key.toUpperCase()) return false;
  return isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
};
