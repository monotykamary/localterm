import type { Terminal as XtermTerminal } from "@xterm/xterm";

const BSU_BEGIN = "\x1b[?2026h";
const BSU_END = "\x1b[?2026l";

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private chunks: string[] = [];
  private scheduled = false;

  attach(terminal: XtermTerminal) {
    this.terminal = terminal;
  }

  detach() {
    this.flush();
    this.terminal = null;
  }

  push(data: string) {
    this.chunks.push(data);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  flush() {
    this.scheduled = false;
    const chunks = this.chunks;
    const terminal = this.terminal;
    this.chunks = [];
    if (!terminal || chunks.length === 0) return;
    if (chunks.length === 1) {
      terminal.write(chunks[0]);
      return;
    }
    terminal.write(BSU_BEGIN + chunks.join("") + BSU_END);
  }
}

const outputBatcher = new OutputBatcher();

export { outputBatcher };
