import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  KITTY_KEYBOARD_SET_MODE_AND_NOT,
  KITTY_KEYBOARD_SET_MODE_OR,
  KITTY_KEYBOARD_SET_MODE_REPLACE,
} from "@/lib/constants";

interface TerminalKittyKeyboardProtocol {
  getFlags: () => number;
  dispose: () => void;
}

export const registerTerminalKittyKeyboardProtocol = (
  terminal: XtermTerminal,
): TerminalKittyKeyboardProtocol => {
  // xterm.js owns Kitty keyboard encoding, including Escape press/release.
  // This mirror only distinguishes native protocol handling from LocalTerm's
  // legacy Shift+Enter fallback. Every parser callback returns false so the
  // request continues to xterm's built-in handler after updating this stack.
  const kittyFlagStack: number[] = [0];
  const getKittyFlags = (): number => kittyFlagStack[kittyFlagStack.length - 1] ?? 0;

  const pushDisposable = terminal.parser.registerCsiHandler(
    { prefix: ">", final: "u" },
    (params) => {
      const first = params[0];
      const flags = typeof first === "number" ? first : 1;
      kittyFlagStack.push(flags);
      return false;
    },
  );
  const popDisposable = terminal.parser.registerCsiHandler(
    { prefix: "<", final: "u" },
    (params) => {
      const first = params[0];
      const count = typeof first === "number" && first > 0 ? first : 1;
      for (let popIndex = 0; popIndex < count && kittyFlagStack.length > 1; popIndex += 1) {
        kittyFlagStack.pop();
      }
      return false;
    },
  );
  const setDisposable = terminal.parser.registerCsiHandler(
    { prefix: "=", final: "u" },
    (params) => {
      const first = params[0];
      const second = params[1];
      // Sub-params (number arrays) aren't defined for kitty `=`. Bail rather
      // than coerce them to 0, which would silently nuke the stack entry.
      if (typeof first !== "number") return false;
      const flags = first;
      const mode =
        typeof second === "number" && second > 0 ? second : KITTY_KEYBOARD_SET_MODE_REPLACE;
      const top = kittyFlagStack.length - 1;
      const current = kittyFlagStack[top] ?? 0;
      if (mode === KITTY_KEYBOARD_SET_MODE_REPLACE) {
        kittyFlagStack[top] = flags;
      } else if (mode === KITTY_KEYBOARD_SET_MODE_OR) {
        kittyFlagStack[top] = current | flags;
      } else if (mode === KITTY_KEYBOARD_SET_MODE_AND_NOT) {
        kittyFlagStack[top] = current & ~flags;
      }
      return false;
    },
  );
  return {
    getFlags: getKittyFlags,
    dispose: () => {
      pushDisposable.dispose();
      popDisposable.dispose();
      setDisposable.dispose();
    },
  };
};
