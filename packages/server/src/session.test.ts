import { describe, expect, it } from "vitest";
import { Session } from "./session.js";

const waitFor = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

const collectOutput = async (session: Session, timeoutMs = 1500): Promise<string> => {
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
  it("spawns a shell and produces a snapshot containing typed input", async () => {
    const session = new Session({ shell: "/bin/sh" });
    try {
      await collectOutput(session);
      session.write("echo SESSION_TEST_TOKEN\n");
      await collectOutput(session);
      const snapshot = session.snapshot();
      expect(snapshot.type).toBe("snapshot");
      if (snapshot.type === "snapshot") {
        expect(snapshot.data).toContain("SESSION_TEST_TOKEN");
        expect(snapshot.cols).toBeGreaterThan(0);
        expect(snapshot.rows).toBeGreaterThan(0);
      }
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
      3000,
    );
    session.write("exit 0\n");
    const code = await exitPromise;
    expect(code).toBe(0);
    session.dispose();
  });

  it("ignores writes after exit", async () => {
    const session = new Session({ shell: "/bin/sh" });
    const exitPromise = new Promise<void>((resolve) => session.once("exit", () => resolve()));
    session.kill();
    await waitFor(exitPromise, 3000);
    expect(session.isExited).toBe(true);
    expect(() => session.write("anything")).not.toThrow();
    session.dispose();
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
});
