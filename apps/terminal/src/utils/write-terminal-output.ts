import type { Terminal as XtermTerminal } from "@xterm/xterm";

const flushOutput = (terminal: XtermTerminal, data: string) => {
  terminal.write(data);
};

export { flushOutput };
