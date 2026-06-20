import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { familyForFont, type TerminalFont } from "@/lib/terminal-fonts";
import { fitTerminalPreservingScroll } from "./fit-terminal-preserving-scroll";

export const applyTerminalFont = (
  terminal: Terminal,
  fitAddon: FitAddon | null,
  font: TerminalFont,
  nerdFontEnabled: boolean,
): void => {
  terminal.options.fontFamily = familyForFont(font, nerdFontEnabled);
  terminal.clearTextureAtlas();
  const internals = terminal as unknown as {
    _core: { _charSizeService: { measure: () => void } };
  };
  internals._core._charSizeService.measure();
  if (fitAddon) fitTerminalPreservingScroll(terminal, fitAddon);
};
