export const detectKeyboardLockSupported = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.keyboard?.lock === "function";
