import { spawn, type ChildProcess } from "node:child_process";

// JSONL line reader over a child's stdout. Splits on `\n` only (RPC mode uses
// LF as the record delimiter; readline is non-compliant because it also splits
// on U+2028/U+2029, which are valid inside JSON strings). Resolves each line to
// the next waiter, or null on close/timeout.
export class RpcClient {
  readonly child: ChildProcess;
  private buffer = "";
  private readonly lineQueue: string[] = [];
  private readonly lineWaiters: Array<(line: string | null) => void> = [];
  closed = false;

  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.on("close", () => {
      this.closed = true;
      while (this.lineWaiters.length > 0) this.lineWaiters.shift()?.(null);
    });
    this.child.on("error", () => {
      this.closed = true;
      while (this.lineWaiters.length > 0) this.lineWaiters.shift()?.(null);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let index: number;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const waiter = this.lineWaiters.shift();
      if (waiter) waiter(line);
      else this.lineQueue.push(line);
    }
  }

  nextLine(timeoutMs: number): Promise<string | null> {
    if (this.lineQueue.length > 0) return Promise.resolve(this.lineQueue.shift() ?? null);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const waiter = (line: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = this.lineWaiters.indexOf(waiter);
        if (idx !== -1) this.lineWaiters.splice(idx, 1);
        resolve(line);
      };
      const timer = setTimeout(() => waiter(null), Math.max(0, timeoutMs));
      this.lineWaiters.push(waiter);
    });
  }

  send(command: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(command)}\n`);
  }

  close(): void {
    try {
      this.child.stdin?.end();
    } catch {
      // already closed
    }
    setTimeout(() => {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 2000).unref?.();
  }
}
