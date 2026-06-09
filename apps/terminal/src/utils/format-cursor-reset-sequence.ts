import type { TerminalCursorStyle } from "@/lib/terminal-cursor";

const CURSOR_STYLE_DECSCUSR_MAP: Record<TerminalCursorStyle, { blink: string; steady: string }> =
  {
    block: { blink: "\x1b[1 q", steady: "\x1b[2 q" },
    underline: { blink: "\x1b[3 q", steady: "\x1b[4 q" },
    bar: { blink: "\x1b[5 q", steady: "\x1b[6 q" },
  };

export const formatCursorResetSequence = (
  style: TerminalCursorStyle,
  blink: boolean,
): string => {
  const mode = blink ? "blink" : "steady";
  return `\x1b[?25h${CURSOR_STYLE_DECSCUSR_MAP[style][mode]}`;
};
