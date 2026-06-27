import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { LocalEcho } from "../../src/lib/local-echo";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface LocalEchoHandle {
  localEcho: LocalEcho;
  write: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

const instances: LocalEcho[] = [];

const makeLocalEcho = (isSafeState: () => boolean = () => true): LocalEchoHandle => {
  const write = vi.fn((_data: string | Uint8Array) => {});
  const send = vi.fn((_data: string) => {});
  const terminal = { write } as unknown as XtermTerminal;
  const localEcho = new LocalEcho({ terminal, send, isSafeState });
  instances.push(localEcho);
  return { localEcho, write, send };
};

const lastWriteText = (handle: LocalEchoHandle): string => {
  const arg = handle.write.mock.calls.at(-1)?.[0];
  if (typeof arg === "string") return arg;
  if (arg instanceof Uint8Array) return decoder.decode(arg);
  return "";
};

const reconcileText = (localEcho: LocalEcho, data: string): string =>
  decoder.decode(localEcho.reconcile(encoder.encode(data)));

afterEach(() => {
  for (const instance of instances) instance.dispose();
  instances.length = 0;
  vi.restoreAllMocks();
});

describe("LocalEcho gate", () => {
  it("does not predict when the safe-state gate is closed (TUI / foreground program)", () => {
    const handle = makeLocalEcho(() => false);
    handle.localEcho.handleInput("a");
    expect(handle.send).toHaveBeenCalledWith("a");
    expect(handle.write).not.toHaveBeenCalled();
  });

  it("does not predict pastes, control sequences, or multi-code-point input", () => {
    const handle = makeLocalEcho();
    handle.localEcho.handleInput("hello");
    handle.localEcho.handleInput("\r");
    handle.localEcho.handleInput("\x1b[A");
    expect(handle.send).toHaveBeenCalledWith("hello");
    expect(handle.send).toHaveBeenCalledWith("\r");
    expect(handle.send).toHaveBeenCalledWith("\x1b[A");
    expect(handle.write).not.toHaveBeenCalled();
  });

  it("does not predict when disabled", () => {
    const handle = makeLocalEcho();
    handle.localEcho.setEnabled(false);
    handle.localEcho.handleInput("a");
    expect(handle.send).toHaveBeenCalledWith("a");
    expect(handle.write).not.toHaveBeenCalled();
  });
});

describe("LocalEcho reconcile full match", () => {
  it("predicts the first keystroke (probe) and lets the real echo overwrite the dim cell", () => {
    const handle = makeLocalEcho();
    handle.localEcho.handleInput("a");
    expect(handle.write).toHaveBeenCalledTimes(1);
    expect(lastWriteText(handle)).toBe("\x1b[2ma\x1b[22m");
    expect(handle.send).toHaveBeenCalledWith("a");
    expect(handle.localEcho.hasPending()).toBe(true);

    expect(reconcileText(handle.localEcho, "a")).toBe("\ba");
    expect(handle.localEcho.hasPending()).toBe(false);
  });

  it("overwrites the whole dim span when the echo carries trailing output", () => {
    const handle = makeLocalEcho();
    handle.localEcho.handleInput("g");
    handle.localEcho.handleInput("it");
    // "it" is multi-char so it round-trips; only "g" was predicted.
    expect(handle.localEcho.hasPending()).toBe(true);
    expect(reconcileText(handle.localEcho, "git\r\n")).toBe("\bgit\r\n");
    expect(handle.localEcho.hasPending()).toBe(false);
  });
});

describe("LocalEcho reconcile mismatch", () => {
  it("erases the dim span and defers to a reprinting shell's real output", () => {
    const handle = makeLocalEcho();
    handle.localEcho.handleInput("a");
    expect(reconcileText(handle.localEcho, "\x1b[2J")).toBe("\b \b\x1b[2J");
    expect(handle.localEcho.hasPending()).toBe(false);
  });
});

describe("LocalEcho reconcile partial (chunked echo)", () => {
  it("confirms a prefix and advances the cursor over the remaining dim cells", () => {
    const handle = makeLocalEcho();
    const nowSpy = vi.spyOn(performance, "now");
    let now = 1000;
    nowSpy.mockImplementation(() => now);

    now = 1000;
    handle.localEcho.handleInput("a"); // probe -> pending "a"
    now = 1100;
    expect(reconcileText(handle.localEcho, "a")).toBe("\ba"); // confirm probe, rtt=100ms
    now = 1110;
    handle.localEcho.handleInput("b"); // predict (rtt above threshold) -> pending "b"
    now = 1120;
    handle.localEcho.handleInput("c"); // predict -> pending "bc"

    now = 1130;
    expect(reconcileText(handle.localEcho, "b")).toBe("\b\bb\x1b[C");
    expect(handle.localEcho.hasPending()).toBe(true);
    now = 1140;
    expect(reconcileText(handle.localEcho, "c")).toBe("\bc");
    expect(handle.localEcho.hasPending()).toBe(false);

    nowSpy.mockRestore();
  });
});

describe("LocalEcho flush", () => {
  it("erases unconfirmed predictions without waiting for the echo", () => {
    const handle = makeLocalEcho();
    handle.localEcho.handleInput("a");
    handle.write.mockClear();
    handle.localEcho.flush();
    expect(lastWriteText(handle)).toBe("\b \b");
    expect(handle.localEcho.hasPending()).toBe(false);
  });
});

describe("LocalEcho reconcile passthrough", () => {
  it("returns the real output bytes unchanged when nothing is pending", () => {
    const handle = makeLocalEcho();
    const bytes = encoder.encode("replayed transcript");
    expect(handle.localEcho.reconcile(bytes)).toBe(bytes);
  });
});
