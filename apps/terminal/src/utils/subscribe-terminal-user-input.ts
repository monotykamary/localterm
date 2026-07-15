import type { IDisposable, Terminal } from "@xterm/xterm";

interface TerminalWithUserInputEvent {
  _core?: {
    coreService?: {
      onUserInput?: (listener: () => void) => IDisposable;
    };
  };
}

// xterm's public onData event merges user input with emulator-generated
// replies; the internal onUserInput event fires synchronously only for the
// former. Return null if that private seam changes so input remains usable.
export const subscribeTerminalUserInput = (
  terminal: Terminal,
  listener: () => void,
): IDisposable | null => {
  const terminalWithUserInputEvent = terminal as unknown as TerminalWithUserInputEvent;
  return terminalWithUserInputEvent._core?.coreService?.onUserInput?.(listener) ?? null;
};
