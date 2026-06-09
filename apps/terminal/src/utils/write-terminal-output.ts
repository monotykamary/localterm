import type { Terminal as XtermTerminal } from "@xterm/xterm";

interface WriteBufferInternals {
  handleUserInput: () => void;
}

interface CoreInternals {
  _writeBuffer: WriteBufferInternals;
}

interface TerminalInternals {
  _core: CoreInternals;
}

const flushOutput = (terminal: XtermTerminal, data: string) => {
  const internals = terminal as unknown as Partial<TerminalInternals>;
  internals._core?._writeBuffer?.handleUserInput();
  terminal.write(data);
};

export { flushOutput };
