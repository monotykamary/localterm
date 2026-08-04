import type { Terminal as XtermTerminal } from "@xterm/xterm";

interface TerminalOutputScrollSnapshot {
  bufferType: "normal" | "alternate";
  userScrollGeneration: number;
  viewportY: number;
  wasAtBottom: boolean;
}

export interface TerminalOutputScrollController {
  capture: () => TerminalOutputScrollSnapshot;
  noteUserScroll: () => void;
  scrollToBottomOnUserInput: () => boolean;
  restore: (snapshot: TerminalOutputScrollSnapshot) => void;
}

export const createTerminalOutputScrollController = (
  terminal: XtermTerminal,
): TerminalOutputScrollController => {
  let userScrollGeneration = 0;

  return {
    capture: () => {
      const buffer = terminal.buffer.active;
      return {
        bufferType: buffer.type,
        userScrollGeneration,
        viewportY: buffer.viewportY,
        wasAtBottom: buffer.viewportY === buffer.baseY,
      };
    },
    noteUserScroll: () => {
      userScrollGeneration += 1;
    },
    scrollToBottomOnUserInput: () => {
      if (!terminal.options.scrollOnUserInput) return false;
      userScrollGeneration += 1;
      const buffer = terminal.buffer.active;
      if (buffer.viewportY !== buffer.baseY) terminal.scrollToBottom();
      return true;
    },
    restore: (snapshot) => {
      if (snapshot.userScrollGeneration !== userScrollGeneration) return;
      const buffer = terminal.buffer.active;
      if (buffer.type !== snapshot.bufferType) return;
      if (snapshot.wasAtBottom) {
        if (buffer.viewportY !== buffer.baseY) terminal.scrollToBottom();
        return;
      }
      const targetViewportY = Math.min(snapshot.viewportY, buffer.baseY);
      const lineDelta = targetViewportY - buffer.viewportY;
      if (lineDelta !== 0) terminal.scrollLines(lineDelta);
    },
  };
};
