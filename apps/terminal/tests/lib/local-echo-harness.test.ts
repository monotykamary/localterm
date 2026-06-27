import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type ScenarioHandle, runScenario } from "../../tests/lib/local-echo-harness";

// Diffs the model screen against the shell's ground-truth line: content cells
// match with no dim, trailing cells are blank with no dim, the cursor sits at
// the shell's logical cursor, and no prediction stays unconfirmed.
const expectSettled = (handle: ScenarioHandle): void => {
  const { model, shell, localEcho } = handle;
  const expected = shell.prompt + shell.line;
  const expectedCursor = shell.absoluteCursor();
  for (let i = 0; i < expected.length; i += 1) {
    const cell = model.cellAt(i);
    expect(cell?.char, `content cell ${i}`).toBe(expected[i]);
    expect(cell?.dim, `content cell ${i} dim leak`).toBe(false);
  }
  for (let i = expected.length; i < model.cols; i += 1) {
    const cell = model.cellAt(i);
    expect(cell?.char, `trailing cell ${i}`).toBe(" ");
    expect(cell?.dim, `trailing cell ${i} dim leak`).toBe(false);
  }
  expect(model.cursorX, "cursorX").toBe(expectedCursor);
  expect(localEcho.hasPending(), "pending drained").toBe(false);
};

beforeEach(() => {
  // Fake timers + the performance clock so performance.now() tracks the fire
  // time of each scheduled echo delivery (the RTT probe is measured inside
  // reconcile at the moment the echo arrives).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number): void => {
  vi.advanceTimersByTime(ms);
};

const SLOW_RTT_MS = 150;
const FAST_RTT_MS = 10;

describe("LocalEcho harness — plain typing", () => {
  it("settles to the typed line with no leftover dim (slow link predicts)", () => {
    const handle = runScenario({ keystrokes: ["l", "s"], rttMs: SLOW_RTT_MS, advance });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("ls");
    expect(handle.dimWrites).toBeGreaterThan(0);
  });

  it("settles correctly on a fast link (sub-frame dim is overwritten)", () => {
    const handle = runScenario({ keystrokes: ["l", "s"], rttMs: FAST_RTT_MS, advance });
    handle.advance(FAST_RTT_MS);
    expectSettled(handle);
  });
});

describe("LocalEcho harness — chunked / coalesced echo", () => {
  it("settles when the server batches echoes into one frame", () => {
    const handle = runScenario({
      keystrokes: ["l", "s", " ", "-", "l", "a"],
      rttMs: SLOW_RTT_MS,
      echoChunkSize: 2,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("ls -la");
  });
});

describe("LocalEcho harness — syntax-highlighting shell", () => {
  it("erases the dim span on each reprint and defers to the real line", () => {
    const handle = runScenario({
      keystrokes: ["g", "i", "t"],
      rttMs: SLOW_RTT_MS,
      syntaxHighlight: true,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("git");
  });
});

describe("LocalEcho harness — backspace", () => {
  it("erases the last char after typing at the end of the line", () => {
    const handle = runScenario({
      keystrokes: ["a", "b", "c", "\x7f"],
      rttMs: SLOW_RTT_MS,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("ab");
  });

  it("erases a mid-line char after a left arrow (no cursor desync)", () => {
    const handle = runScenario({
      keystrokes: ["a", "b", "c", "\x1b[D", "\x7f"],
      rttMs: SLOW_RTT_MS,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("ac");
  });
});

describe("LocalEcho harness — mid-line insert", () => {
  it("inserts a char mid-line after an arrow without desync", () => {
    const handle = runScenario({
      keystrokes: ["a", "b", "c", "\x1b[D", "X"],
      rttMs: SLOW_RTT_MS,
      advance,
    });
    // Before the echoes arrive: a/b/c were predicted (dim at the line end), but
    // the X typed after the left arrow must NOT be predicted onto the wrong
    // column — a cursor-moving control leaves xterm's cursor out of sync with
    // the shell's, so prediction suspends until the control's echo resyncs it.
    expect(handle.model.cellAt(2)?.dim).toBe(true);
    expect(handle.model.cellAt(5)?.dim).toBe(false);
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("abXc");
  });
});

describe("LocalEcho harness — Ctrl-U line discard", () => {
  it("clears the line on Ctrl-U and defers to the real reprint", () => {
    const handle = runScenario({
      keystrokes: ["a", "b", "c", "\x15"],
      rttMs: SLOW_RTT_MS,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("");
  });
});

describe("LocalEcho harness — silent prompt (read -s / password)", () => {
  it("erases unconfirmed predictions via the watchdog so typed text never persists", () => {
    const handle = runScenario({
      keystrokes: ["s", "e", "c", "r", "e", "t"],
      rttMs: SLOW_RTT_MS,
      silent: true,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    // The leak: with no echo, predicted chars stay dim until the watchdog fires.
    expect(handle.model.hasDimInRow()).toBe(true);
    expect(handle.shell.line).toBe("secret");

    // Past the watchdog: the dim span is erased; the screen holds only the prompt.
    handle.advance(2_000);
    expect(handle.model.hasDimInRow()).toBe(false);
    const prompt = handle.shell.prompt;
    for (let i = 0; i < prompt.length; i += 1) {
      expect(handle.model.cellAt(i)?.char).toBe(prompt[i]);
      expect(handle.model.cellAt(i)?.dim).toBe(false);
    }
    expect(handle.model.cursorX).toBe(prompt.length);
    expect(handle.localEcho.hasPending()).toBe(false);
  });
});

describe("LocalEcho harness — RTT gate (spaced typing)", () => {
  it("predicts only the probe when the link is fast and typing is spaced", () => {
    const handle = runScenario({
      keystrokes: ["l", "s", " ", "l", "s"],
      rttMs: FAST_RTT_MS,
      interKeyGapMs: 100,
      advance,
    });
    handle.advance(FAST_RTT_MS);
    expectSettled(handle);
    expect(handle.shell.line).toBe("ls ls");
    // First keystroke probes (measures the fast RTT); the rest skip, so only
    // one dim write occurred across the whole typed command.
    expect(handle.dimWrites).toBe(1);
  });
});

describe("LocalEcho harness — gates", () => {
  it("does not predict when disabled", () => {
    const handle = runScenario({
      keystrokes: ["l", "s"],
      rttMs: SLOW_RTT_MS,
      enabled: false,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.dimWrites).toBe(0);
  });

  it("does not predict when the safe-state gate is closed (TUI / foreground)", () => {
    const handle = runScenario({
      keystrokes: ["l", "s"],
      rttMs: SLOW_RTT_MS,
      safeState: false,
      advance,
    });
    handle.advance(SLOW_RTT_MS);
    expectSettled(handle);
    expect(handle.dimWrites).toBe(0);
  });
});
