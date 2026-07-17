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
  // Kitty keyboard protocol (https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
  // tracks a stack of flags so a TUI can push/pop reporting modes. We only
  // care that *some* flags are active when intercepting modifier+Enter so
  // shells (which never push flags) keep getting bare \r and don't see CSI u
  // garbage in their input. Stack always has at least one entry per spec.
  const kittyFlagStack: number[] = [0];
  const getKittyFlags = (): number => kittyFlagStack[kittyFlagStack.length - 1] ?? 0;

  const pushDisposable = terminal.parser.registerCsiHandler(
    { prefix: ">", final: "u" },
    (params) => {
      const first = params[0];
      const flags = typeof first === "number" ? first : 1;
      kittyFlagStack.push(flags);
      return true;
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
      return true;
    },
  );
  const setDisposable = terminal.parser.registerCsiHandler(
    { prefix: "=", final: "u" },
    (params) => {
      const first = params[0];
      const second = params[1];
      // Sub-params (number arrays) aren't defined for kitty `=`. Bail rather
      // than coerce them to 0, which would silently nuke the stack entry.
      if (typeof first !== "number") return true;
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
      return true;
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
