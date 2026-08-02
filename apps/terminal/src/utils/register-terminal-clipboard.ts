import { Base64 } from "@xterm/addon-clipboard";
import type { IDisposable } from "@xterm/xterm";

import { OSC_CLIPBOARD_IDENTIFIER, OSC_CLIPBOARD_READ_TIMEOUT_MS } from "@/lib/constants";

interface TerminalClipboardParser {
  registerOscHandler: (
    identifier: number,
    callback: (data: string) => boolean | Promise<boolean>,
  ) => IDisposable;
}

interface TerminalClipboard {
  readonly parser: TerminalClipboardParser;
  input: (data: string, wasUserInput?: boolean) => void;
}

export const registerTerminalClipboard = (terminal: TerminalClipboard): IDisposable => {
  const base64 = new Base64();
  let isDisposed = false;

  const readClipboardText = async (): Promise<string> => {
    let timeoutId: number | null = null;
    try {
      const timeout = new Promise<string>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(""), OSC_CLIPBOARD_READ_TIMEOUT_MS);
      });
      return await Promise.race([navigator.clipboard.readText(), timeout]);
    } catch {
      return "";
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  };

  const reportClipboard = async (selection: string): Promise<void> => {
    const clipboardText = await readClipboardText();
    if (isDisposed) return;
    const encodedText = base64.encodeText(clipboardText);
    terminal.input(`\x1b]52;${selection};${encodedText}\x07`, false);
  };

  const writeClipboard = (clipboardText: string): void => {
    try {
      void navigator.clipboard.writeText(clipboardText).catch(() => {});
    } catch {}
  };

  const handleClipboard = (data: string): boolean => {
    const separatorIndex = data.indexOf(";");
    if (separatorIndex < 0) return true;
    const selection = data.slice(0, separatorIndex);
    const payload = data.slice(separatorIndex + 1);
    if (payload === "?") {
      void reportClipboard(selection).catch(() => {});
      return true;
    }

    let clipboardText = "";
    try {
      clipboardText = base64.decodeText(payload);
    } catch {}
    writeClipboard(clipboardText);
    return true;
  };

  const handlerDisposable = terminal.parser.registerOscHandler(
    OSC_CLIPBOARD_IDENTIFIER,
    handleClipboard,
  );

  return {
    dispose: () => {
      isDisposed = true;
      handlerDisposable.dispose();
    },
  };
};
