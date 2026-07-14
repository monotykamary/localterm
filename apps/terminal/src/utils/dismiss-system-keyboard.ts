export const dismissSystemKeyboard = (): void => {
  if (typeof navigator !== "undefined" && "virtualKeyboard" in navigator) {
    const virtualKeyboard = navigator.virtualKeyboard;
    if (
      typeof virtualKeyboard === "object" &&
      virtualKeyboard !== null &&
      "hide" in virtualKeyboard &&
      typeof virtualKeyboard.hide === "function"
    ) {
      try {
        virtualKeyboard.hide.call(virtualKeyboard);
      } catch {
        // Some Chromium builds expose the API but reject hide outside their
        // accepted IME state.
      }
    }
  }

  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
};
