import { spawn, type ChildProcess } from "node:child_process";
import { AUTOMATION_AGENT_FORCE_KILL_DELAY_MS } from "./constants.js";

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode != null || child.signalCode != null;

const signalChild = (child: ChildProcess, processGroup: boolean, signal: NodeJS.Signals): void => {
  if (processGroup && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may already be gone; still try the child if it has not exited.
    }
  }
  if (!hasExited(child)) {
    try {
      child.kill(signal);
    } catch {
      // Exit can race signal delivery.
    }
  }
};

// A shell can exit on TERM while a descendant keeps running (or holds its pipes).
// Keep the group escalation alive until it disappears, not merely until shell exit.
export const closeChildProcess = (
  child: ChildProcess,
  processGroup = false,
  signal?: "SIGTERM",
): Promise<void> =>
  new Promise((resolve) => {
    let exited = hasExited(child);
    let settled = false;
    let forceKilled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const groupExists = (): boolean => {
      if (!processGroup || !child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      child.off("exit", onExit);
      child.off("close", onExit);
      child.off("error", onError);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
    };
    const onExit = (): void => {
      exited = true;
      if (forceKilled || !groupExists()) finish();
    };
    const onError = (): void => {
      if (!child.pid) finish();
    };
    child.on("exit", onExit);
    child.on("close", onExit);
    child.on("error", onError);
    if (exited && !groupExists()) {
      finish();
      return;
    }
    forceKillTimer = setTimeout(() => {
      forceKilled = true;
      signalChild(child, processGroup, "SIGKILL");
      // After KILL, reap the leader but do not wait for inherited pipe handles.
      if (exited || hasExited(child)) finish();
    }, AUTOMATION_AGENT_FORCE_KILL_DELAY_MS);
    // Keep this referenced: awaiting a Promise alone does not keep the daemon
    // alive after the shell exits while descendants still need KILL.
    if (signal) signalChild(child, processGroup, signal);
    else {
      try {
        child.stdin?.end();
      } catch {
        // Already closed.
      }
    }
  });

// JSONL line reader over a child's stdout. Splits on `\n` only (RPC mode uses
// LF as the record delimiter; readline also splits valid JSON U+2028/U+2029).
export class RpcClient {
  readonly child: ChildProcess;
  private buffer = "";
  private readonly lineQueue: string[] = [];
  private readonly lineWaiters: Array<(line: string | null) => void> = [];
  private closing: Promise<void> | undefined;
  private shutdownComplete = false;
  closed = false;

  constructor(
    binary: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    private readonly processGroup = false,
  ) {
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: processGroup,
    });
    this.child.stdout?.on("data", this.onData);
    this.child.stderr?.resume();
    this.child.stdin?.on("error", this.onInputError);
    this.child.on("close", this.onClosed);
    this.child.on("error", this.onInputError);
  }

  private readonly onInputError = (): void => {
    this.closed = true;
    while (this.lineWaiters.length > 0) this.lineWaiters.shift()?.(null);
  };

  private readonly onClosed = (): void => {
    this.onInputError();
    this.child.stdout?.off("data", this.onData);
    this.child.stdin?.off("error", this.onInputError);
    this.child.off("close", this.onClosed);
    this.child.off("error", this.onInputError);
  };

  private readonly onData = (chunk: Buffer): void => {
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
  };

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
    if (!this.closed) this.child.stdin?.write(`${JSON.stringify(command)}\n`);
  }

  // Existing model/compact callers still request EOF; runners can additionally
  // request TERM, including while an EOF shutdown is already in progress.
  close(signal?: "SIGTERM"): Promise<void> {
    if (this.closing) {
      if (signal && !this.shutdownComplete) signalChild(this.child, this.processGroup, signal);
      return this.closing;
    }
    const spawnFailed = this.closed && !this.child.pid;
    this.onInputError();
    this.child.stdout?.off("data", this.onData);
    this.lineQueue.length = 0;
    this.buffer = "";
    this.closing = (
      spawnFailed ? Promise.resolve() : closeChildProcess(this.child, this.processGroup, signal)
    ).then(() => {
      this.shutdownComplete = true;
      this.onClosed();
    });
    return this.closing;
  }
}
