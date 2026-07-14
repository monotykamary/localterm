export const suppressTerminalSystemKeyboard = (textarea: HTMLTextAreaElement | undefined): void => {
  if (!textarea) return;
  textarea.readOnly = true;
  textarea.inputMode = "none";
};
