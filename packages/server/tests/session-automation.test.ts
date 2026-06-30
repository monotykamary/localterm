import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import { SessionManager, type WaitPredicate, type WaitResult } from "../src/session-manager.js";
import { encodeClick, encodeDrag, encodeMove, encodeScroll } from "../src/utils/sgr-mouse.js";
import { resolveNamedKeys } from "../src/utils/named-keys.js";

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    getGraceMs: () => graceMs,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const shellInput = { shell: "/bin/sh", cwd: os.tmpdir() };

const textPredicate = (needle: string, caseSensitive = false): WaitPredicate => ({
  kind: "text",
  test: caseSensitive
    ? (text) => text.includes(needle)
    : (text) => text.toLowerCase().includes(needle.toLowerCase()),
});

const regexPredicate = (pattern: RegExp): WaitPredicate => ({
  kind: "regex",
  test: (text) => pattern.test(text),
});

const idlePredicate = (): WaitPredicate => ({ kind: "idle", test: () => false });

// Poll a boolean condition up to ~2s so a test never depends on the shell's
// round-trip latency (the printf output lands whenever the PTY schedules it).
const pollFor = async (fn: () => boolean, attempts = 40): Promise<boolean> => {
  for (let i = 0; i < attempts; i++) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
};

describe("named-key resolver", () => {
  it("maps key names to xterm escape bytes", () => {
    expect(resolveNamedKeys("Ctrl-C")).toBe("\x03");
    expect(resolveNamedKeys("F2")).toBe("\x1bOQ");
    expect(resolveNamedKeys("Enter")).toBe("\r");
    expect(resolveNamedKeys("Escape")).toBe("\x1b");
    expect(resolveNamedKeys("Up")).toBe("\x1b[A");
    expect(resolveNamedKeys("Backspace")).toBe("\x7f");
  });

  it("concatenates a key chord (single chars + named keys)", () => {
    expect(resolveNamedKeys("Escape : w q Enter")).toBe("\x1b:wq\r");
    expect(resolveNamedKeys("a b c")).toBe("abc");
    expect(resolveNamedKeys("Ctrl-A Ctrl-E")).toBe("\x01\x05");
  });

  it("passes unknown multi-char tokens through as literal text", () => {
    expect(resolveNamedKeys("hello")).toBe("hello");
    expect(resolveNamedKeys("echo Space hi")).toBe("echo hi");
  });
});

describe("SGR-1006 mouse encoder (headless fallback)", () => {
  it("encodes a click as press + release (1-indexed)", () => {
    expect(encodeClick(5, 10, "left", 1)).toBe("\x1b[<0;5;10M\x1b[<0;5;10m");
    expect(encodeClick(1, 1, "right", 1)).toBe("\x1b[<2;1;1M\x1b[<2;1;1m");
  });
  it("repeats the press for a multi-click", () => {
    expect(encodeClick(3, 3, "left", 2)).toBe("\x1b[<0;3;3M\x1b[<0;3;3M\x1b[<0;3;3m");
  });
  it("encodes a drag as press + motion (button+32) + release", () => {
    expect(encodeDrag(1, 1, 4, 4, "left")).toBe("\x1b[<0;1;1M\x1b[<32;4;4M\x1b[<0;4;4m");
  });
  it("encodes a move (no button) with motion code 35", () => {
    expect(encodeMove(2, 7)).toBe("\x1b[<35;2;7M");
  });
  it("encodes scroll as wheel button 64/65, repeated", () => {
    expect(encodeScroll(0, 0, "up", 1)).toBe("\x1b[<64;0;0M");
    expect(encodeScroll(0, 0, "down", 2)).toBe("\x1b[<65;0;0M\x1b[<65;0;0M");
  });
});

describe("SessionManager wait + press + mouse state", () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("pressKeysById sends named keys that the shell executes", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    // "echo" + Space + "hi" + Enter — typed via named keys.
    expect(manager.pressKeysById(id, "echo Space hi Enter")).toBe(true);
    const result = await manager.waitFor(id, textPredicate("hi"), 5_000);
    expect(result?.matched).toBe(true);
    const pane = await manager.capturePane(id);
    expect(pane).toContain("hi");
  }, 10_000);

  it("pressKeysById returns false for an unknown id", () => {
    manager = createManager(30_000);
    expect(manager.pressKeysById("00000000-0000-0000-0000-000000000000", "Enter")).toBe(false);
  });

  it("waitFor matches text once the pane contains it", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    manager.writeInputById(id, "echo TARGET-MARKER\n");
    const result = await manager.waitFor(id, textPredicate("TARGET-MARKER"), 5_000);
    expect(result?.matched).toBe(true);
    expect(result?.snapshot).toContain("TARGET-MARKER");
  }, 10_000);

  it("waitFor matches a regex predicate", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    manager.writeInputById(id, "echo code-99\n");
    const result = await manager.waitFor(id, regexPredicate(/code-\d+/), 5_000);
    expect(result?.matched).toBe(true);
  }, 10_000);

  it("waitFor resolves unmatched=false on timeout", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    const result = await manager.waitFor(id, textPredicate("never-here"), 200);
    expect(result?.matched).toBe(false);
    expect(result?.elapsedMs).toBeGreaterThanOrEqual(150);
  }, 10_000);

  it("waitFor idle resolves once output stops", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    manager.writeInputById(id, "echo burst\n");
    const result = await manager.waitFor(id, idlePredicate(), 5_000, 100);
    const idleResult = result as WaitResult | null;
    expect(idleResult?.matched).toBe(true);
  }, 10_000);

  it("waitFor returns null for an unknown id", async () => {
    manager = createManager(30_000);
    const result = await manager.waitFor(
      "00000000-0000-0000-0000-000000000000",
      textPredicate("x"),
      100,
    );
    expect(result).toBeNull();
  });

  it("findTextInViewport locates a label's viewport coords", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    manager.writeInputById(id, "echo FINDME\n");
    await manager.waitFor(id, textPredicate("FINDME"), 5_000);
    const found = await manager.findTextInViewport(id, "FINDME");
    expect(found).not.toBeNull();
    expect(found?.col).toBeGreaterThanOrEqual(0);
    expect(found?.row).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it("findTextInViewport returns null for absent text", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    await wait(150);
    const found = await manager.findTextInViewport(id, "NOT-ON-SCREEN");
    expect(found).toBeNull();
  });

  it("mouseEnabledFor tracks the foreground app's mouse mode", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    await wait(100);
    expect(manager.mouseEnabledFor(id)).toBe(false);
    // Enable SGR mouse (1006) + basic tracking (1000) as a TUI would.
    manager.writeInputById(id, "printf '\\033[?1006h\\033[?1000h'\n");
    expect(await pollFor(() => manager.mouseEnabledFor(id))).toBe(true);
    // Disable → false.
    manager.writeInputById(id, "printf '\\033[?1000l'\n");
    expect(await pollFor(() => !manager.mouseEnabledFor(id))).toBe(true);
  }, 10_000);

  it("sessionSizeFor reports the live PTY size", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    const size = manager.sessionSizeFor(id);
    expect(size.cols).toBeGreaterThan(0);
    expect(size.rows).toBeGreaterThan(0);
    manager.resizeById(id, 100, 40);
    expect(manager.sessionSizeFor(id)).toEqual({ cols: 100, rows: 40 });
  });
});
