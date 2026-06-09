import type { TerminalCursorStyle } from "@/lib/terminal-cursor";
import { formatCursorResetSequence } from "@/utils/format-cursor-reset-sequence";

export const formatReconnectedMarker = (
  cursorStyle: TerminalCursorStyle,
  cursorBlink: boolean,
): string =>
  `${formatCursorResetSequence(cursorStyle, cursorBlink)}\r\n\x1b[2;32m[reconnected]\x1b[0m\r\n\r\n`;
