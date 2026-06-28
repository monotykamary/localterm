import { describe, expect, it } from "vite-plus/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serverToClientMessageSchema } from "../src/schemas.js";
import { Session } from "../src/session.js";
import { terminalQueryResponder } from "../src/utils/terminal-query-responder.js";

const waitFor = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

const collectOutput = async (session: Session, timeoutMs = 5000): Promise<string> => {
  return waitFor(
    new Promise<string>((resolve) => {
      let buffer = "";
      let stableTimer: NodeJS.Timeout | null = null;
      const onData = (chunk: string) => {
        buffer += chunk;
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          session.off("output", onData);
          resolve(buffer);
        }, 200);
      };
      session.on("output", onData);
    }),
    timeoutMs,
  );
};

describe("Session", () => {
  it("sets LOCALTERM in the PTY environment", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session);
      session.write("echo $LOCALTERM\n");
      const output = await collectOutput(session);
      expect(output).toContain("1");
    } finally {
      session.dispose();
    }
  });

  it("spawns a shell and emits output for typed input", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session, 10_000);
      session.write("echo SESSION_TEST_TOKEN\n");
      const output = await collectOutput(session, 10_000);
      expect(output).toContain("SESSION_TEST_TOKEN");
    } finally {
      session.dispose();
    }
  }, 15_000);

  it("exposes shell metadata used by the settings panel (path, basename, pid, cwd)", () => {
    const session = new Session({ shell: "/bin/sh", cwd: "/" });
    try {
      expect(session.shell).toBe("/bin/sh");
      expect(session.shellBaseName).toBe("sh");
      expect(session.cwd).toBe("/");
      expect(Number.isInteger(session.pid)).toBe(true);
      expect(session.pid).toBeGreaterThan(0);
    } finally {
      session.dispose();
    }
  });

  it("Session metadata produces a 'session' WS frame accepted by the public schema", () => {
    // Locks in the contract that index.ts emits on WS open. If anyone changes the
    // Session getters or the schema in a way that breaks this round-trip, this test
    // catches it before the client silently loses the Settings → Shell section.
    const session = new Session({ shell: "/bin/sh", cwd: "/" });
    try {
      const frame = {
        type: "session" as const,
        shell: session.shell,
        shellName: session.shellBaseName,
        pid: session.pid,
        cwd: session.cwd,
        title: session.initialDocumentTitle,
      };
      const parsed = serverToClientMessageSchema.safeParse(frame);
      expect(parsed.success).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it("emits exit when the shell exits", async () => {
    const session = new Session({ shell: "/bin/sh" });
    const exitPromise = waitFor(
      new Promise<number | null>((resolve) => {
        session.once("exit", (code) => resolve(code));
      }),
      10_000,
    );
    session.write("exit 0\n");
    const code = await exitPromise;
    expect(code).toBe(0);
    session.dispose();
  }, 15_000);

  it("ignores writes after exit", async () => {
    const session = new Session({ shell: "/bin/sh" });
    const exitPromise = new Promise<void>((resolve) => session.once("exit", () => resolve()));
    session.kill();
    await waitFor(exitPromise, 5000);
    expect(session.isExited).toBe(true);
    expect(() => session.write("anything")).not.toThrow();
    session.dispose();
  });

  it("kills the underlying PTY child when dispose is called before the shell exits", async () => {
    const session = new Session({ shell: "/bin/sh" });
    await collectOutput(session);
    const childPid = session.pid;
    session.dispose();

    const isProcessAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    await waitFor(
      new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const poll = () => {
          if (!isProcessAlive(childPid)) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 4000) {
            reject(new Error(`pid ${childPid} still alive 4s after dispose`));
            return;
          }
          setTimeout(poll, 50);
        };
        poll();
      }),
      5000,
    );
  });

  it("clamps resize to current dimensions", () => {
    const session = new Session({ shell: "/bin/sh", cols: 80, rows: 24 });
    try {
      const before = { cols: session.cols, rows: session.rows };
      session.resize(0, 24);
      session.resize(80, 0);
      session.resize(-5, -5);
      expect(session.cols).toBe(before.cols);
      expect(session.rows).toBe(before.rows);
    } finally {
      session.dispose();
    }
  });

  it("never splices title OSC sequences into PTY output", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      const escapeChar = String.fromCharCode(0x1b);
      const outputChunks: string[] = [];
      const onData = (chunk: string) => outputChunks.push(chunk);
      session.on("output", onData);
      await collectOutput(session);
      session.off("output", onData);
      const combined = outputChunks.join("");
      expect(combined).not.toContain(`${escapeChar}]2;`);
      expect(combined).not.toContain(`${escapeChar}]0;`);
    } finally {
      session.dispose();
    }
  });

  it("dispose stops emitting any further title events", async () => {
    const session = new Session({ shell: "/bin/sh" });
    await collectOutput(session);
    session.dispose();
    let postDisposeTitleCount = 0;
    const onTitle = () => {
      postDisposeTitleCount += 1;
    };
    session.on("title", onTitle);
    await new Promise((resolve) => setTimeout(resolve, 800));
    session.off("title", onTitle);
    expect(postDisposeTitleCount).toBe(0);
  });

  it("pause() suppresses output emissions and resume() lets them flow again", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session);

      session.pause();
      expect(session.isPaused).toBe(true);

      const chunksWhilePaused: string[] = [];
      const collectWhilePaused = (chunk: string) => chunksWhilePaused.push(chunk);
      session.on("output", collectWhilePaused);
      session.write("printf PAUSED_MARKER_DOES_NOT_LEAK\n");
      // Generous window: even on a slow runner, paused output should never arrive.
      await new Promise((resolve) => setTimeout(resolve, 400));
      session.off("output", collectWhilePaused);
      expect(chunksWhilePaused.join("")).not.toContain("PAUSED_MARKER_DOES_NOT_LEAK");

      session.resume();
      expect(session.isPaused).toBe(false);
      const observed = await collectOutput(session, 3000);
      expect(observed).toContain("PAUSED_MARKER_DOES_NOT_LEAK");
    } finally {
      session.dispose();
    }
  });

  it("pause() and resume() are no-ops after the session has exited", () => {
    const session = new Session({ shell: "/bin/sh" });
    session.dispose();
    expect(session.isExited).toBe(true);
    expect(() => session.pause()).not.toThrow();
    expect(session.isPaused).toBe(false);
    expect(() => session.resume()).not.toThrow();
  });

  it("snapshotScrollback prepends the live mode-restore prefix and preserves non-DA queries", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session, 10_000);
      // Enter alt screen + enable mouse (tracked modes) and emit a DECRQM
      // request — a query the DA1/DA2 responder does NOT handle. DA1/DA2 are
      // removed at append time by the responder, so they never reach the ring
      // buffer; other queries (DECRQM/OSC/DSR) stay in the raw replay and are
      // dropped client-side by the replay suppression on `replay-end`.
      session.write("printf '\\033[?1049h\\033[?1002h\\033[?2026$p'\n");
      await collectOutput(session, 10_000);
      const snapshot = session.snapshotScrollback();
      // The restore prefix re-enters the alt screen and re-enables mouse before
      // the replayed content, so a switch into this TUI keeps wheel scrolling in
      // the TUI instead of the terminal scrollback.
      expect(snapshot.startsWith("\x1b[?1002h\x1b[?1049h")).toBe(true);
      // The DECRQM request stays in the raw replay: the server doesn't strip
      // non-DA queries (the client suppresses xterm's response to them on
      // replay), so this is independent of the responder's cache state.
      expect(snapshot).toContain("\x1b[?2026$p");
    } finally {
      session.dispose();
    }
  }, 15_000);

  it("answers DA1 from cache after capturing xterm's response via write (no round-trip)", async () => {
    // Isolation: the responder is a process-global singleton, so reset to a
    // cold cache for this case and restore (reset) in finally.
    terminalQueryResponder.reset();
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session, 10_000);
      // Simulate xterm's DA1 response flowing back through the input path
      // (onData -> client -> server -> session.write). write() captures it.
      session.write("\x1b[?62;4;9;22c");
      // Now the shell emits a DA1 request as output. With the cache warm the
      // request is removed from the output (xterm never sees it, never
      // responds) and the cached response is written straight to the PTY.
      const outputs: string[] = [];
      session.on("output", (chunk) => outputs.push(chunk));
      session.write("printf '\\033[cDONE'");
      session.write("\n");
      await collectOutput(session, 10_000);
      const emitted = outputs.join("");
      // The DA1 request (ESC [ c) is removed from the output stream.
      expect(emitted).not.toContain("\x1b[c");
      // The literal text after the request still lands.
      expect(emitted).toContain("DONE");
    } finally {
      terminalQueryResponder.reset();
      session.dispose();
    }
  }, 15_000);

  it("zsh emits no PROMPT_SP mark or fill-to-EOL spaces (no mobile resize leak)", async () => {
    // zsh-only fix; skip where zsh is absent (the bash hook has no equivalent).
    if (!existsSync("/bin/zsh")) return;
    const session = new Session({ shell: "/bin/zsh" });
    try {
      await collectOutput(session, 10_000);
      const outputs: string[] = [];
      session.on("output", (chunk) => outputs.push(chunk));
      // An empty Enter and a command whose output lacks a trailing newline are
      // the two paths that trigger zsh's PROMPT_SP: it prints the EOL mark
      // (bold+reverse % by default — "white-background %") AND a fill-to-
      // end-of-line space burst, then zle's redraw erases both. localterm resizes
      // xterm before the server's PTY catches up (async over a high-latency
      // relay), and at spawn the PTY starts at the wide DEFAULT_COLS while the
      // mobile xterm is still its narrow viewport — so the mark and fill spaces
      // (sized for the wider PTY) wrap in the narrower xterm and zle's clear-
      // to-end-of-screen erases from the wrapped line, leaving the mark as a
      // stray `%` and the spaces as a blank line above the prompt. The hook
      // disables PROMPT_SP so neither is emitted. Emptying PROMPT_EOL_MARK alone
      // is insufficient: the fill spaces still wrap.
      session.write("\r");
      session.write("printf 'partial-no-newline'\r");
      await collectOutput(session, 10_000);
      const emitted = outputs.join("");
      expect(emitted).not.toContain("\x1b[7m%");
      expect(emitted).not.toMatch(/ {10,}/);
    } finally {
      session.dispose();
    }
  }, 15_000);

  it("prepends the secrets shims dir to PATH after the user's rc files", async () => {
    // zsh-only; skip where zsh is absent. Verifies the Session threads the
    // shimsDir from spawn input into the shell hook, which prepends it AFTER
    // the user's .zshrc runs (so the shims reliably shadow the real binaries
    // despite rc PATH manipulation). The prepend is gated on the dir existing.
    if (!existsSync("/bin/zsh")) return;
    const shimsDir = mkdtempSync(path.join(os.tmpdir(), "localterm-shim-path-"));
    try {
      const session = new Session({ shell: "/bin/zsh", shimsDir });
      try {
        // Wait specifically for the result marker (not a fixed stable window) so a
        // slow shell can't make the collector resolve between the input echo
        // (literal `${PATH}`) and the expanded result. [^$] skips the input
        // echo; only the expanded result has no `$` between the markers.
        const waitMarker = new Promise<string>((resolve, reject) => {
          let buffer = "";
          const timer = setTimeout(() => {
            session.off("output", onData);
            reject(new Error("PATH marker timeout"));
          }, 15_000);
          const onData = (chunk: string) => {
            buffer += chunk;
            const match = /XPATHX([^$]*?)XENDX/.exec(buffer);
            if (match) {
              clearTimeout(timer);
              session.off("output", onData);
              resolve(match[1]);
            }
          };
          session.on("output", onData);
        });
        session.write('echo "XPATHX${PATH}XENDX"\r');
        const pathValue = await waitMarker;
        expect(pathValue.startsWith(`${shimsDir}:`)).toBe(true);
      } finally {
        session.dispose();
      }
    } finally {
      rmSync(shimsDir, { recursive: true, force: true });
    }
  }, 20_000);
});
