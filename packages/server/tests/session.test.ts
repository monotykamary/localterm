import { describe, expect, it, vi } from "vite-plus/test";
import { serverToClientMessageSchema } from "../src/schemas.js";
import { Session } from "../src/session.js";

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

  it("exposes a foreground event channel that settles to null for an idle shell", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      const foregroundEvents: Array<string | null> = [];
      session.on("foreground", (process) => foregroundEvents.push(process));
      await collectOutput(session);
      // /bin/sh never enters alt-screen mode, but the 250ms pty.process poll
      // can observe a transient process name during spawn under load, so only
      // the settled value is asserted. The stream-based detection is
      // exercised through unit tests for parseAltScreenFromChunk.
      await vi.waitFor(() => {
        expect(foregroundEvents.at(-1) ?? null).toBeNull();
      });
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
});
