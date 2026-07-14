import {
  TERMINAL_CURSOR_LINE_END_SEQUENCE,
  TERMINAL_CURSOR_LINE_START_SEQUENCE,
  TERMINAL_CURSOR_WORD_LEFT_SEQUENCE,
  TERMINAL_CURSOR_WORD_RIGHT_SEQUENCE,
  TERMINAL_DELETE_TO_LINE_START_SEQUENCE,
} from "@/lib/constants";

export interface TerminalEditingInput {
  readonly key: string;
  readonly alternate: boolean;
  readonly command: boolean;
  readonly control: boolean;
}

// These readline bindings are also recognized by pi, while xterm modifier CSI
// sequences are unbound in default macOS bash and leak tails such as ";3D".
export const buildTerminalEditingOutput = ({
  key,
  alternate,
  command,
  control,
}: TerminalEditingInput): string | null => {
  if (command) {
    if (key === "ArrowLeft" || key === "ArrowUp") return TERMINAL_CURSOR_LINE_START_SEQUENCE;
    if (key === "ArrowRight" || key === "ArrowDown") return TERMINAL_CURSOR_LINE_END_SEQUENCE;
    if (key === "Backspace") return TERMINAL_DELETE_TO_LINE_START_SEQUENCE;
  }
  if (alternate || control) {
    if (key === "ArrowLeft") return TERMINAL_CURSOR_WORD_LEFT_SEQUENCE;
    if (key === "ArrowRight") return TERMINAL_CURSOR_WORD_RIGHT_SEQUENCE;
  }
  return null;
};
