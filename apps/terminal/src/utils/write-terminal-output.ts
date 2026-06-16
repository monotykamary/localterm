import type { Terminal as XtermTerminal } from "@xterm/xterm";

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private chunks: string[] = [];
  private scheduled = false;
  private animationFrameId: number | null = null;
  private afterFlush: (() => void) | null = null;

  attach = (terminal: XtermTerminal) => {
    this.terminal = terminal;
  };

  setAfterFlush = (callback: (() => void) | null) => {
    this.afterFlush = callback;
  };

  detach = () => {
    this.flush();
    this.terminal = null;
    this.afterFlush = null;
  };

  push = (data: string) => {
    this.chunks.push(data);
    if (this.scheduled) return;
    this.scheduled = true;
    this.animationFrameId = requestAnimationFrame(() => this.flush());
  };

  private flush = () => {
    this.scheduled = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    const chunks = this.chunks;
    const terminal = this.terminal;
    this.chunks = [];
    if (!terminal || chunks.length === 0) return;
    if (chunks.length === 1) {
      terminal.write(chunks[0]);
    } else {
      terminal.write(chunks.join(""));
    }
    this.afterFlush?.();
  };
}

const outputBatcher = new OutputBatcher();

export { outputBatcher };
