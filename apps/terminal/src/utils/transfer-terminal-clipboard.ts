export const copyTerminalSelection = async (getSelection: () => string): Promise<boolean> => {
  const text = getSelection();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const pasteTerminalClipboard = async (paste: (text: string) => void): Promise<boolean> => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    paste(text);
    return true;
  } catch {
    return false;
  }
};
