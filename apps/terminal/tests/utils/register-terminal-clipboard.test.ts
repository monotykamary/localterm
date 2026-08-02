import { Terminal as XtermTerminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { OSC_CLIPBOARD_IDENTIFIER, OSC_CLIPBOARD_READ_TIMEOUT_MS } from "../../src/lib/constants";
import { registerTerminalClipboard } from "../../src/utils/register-terminal-clipboard";

interface ClipboardMethodStubs {
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
}

interface ClipboardHarness {
  dispose: () => void;
  handleClipboard: (data: string) => boolean | Promise<boolean>;
  input: ReturnType<typeof vi.fn>;
  handlerDispose: ReturnType<typeof vi.fn>;
}

const createClipboardHarness = (clipboard: ClipboardMethodStubs): ClipboardHarness => {
  vi.stubGlobal("navigator", { clipboard });
  const input = vi.fn();
  const handlerDispose = vi.fn();
  let handleClipboard: ClipboardHarness["handleClipboard"] | null = null;
  const registration = registerTerminalClipboard({
    input,
    parser: {
      registerOscHandler: (identifier, callback) => {
        expect(identifier).toBe(OSC_CLIPBOARD_IDENTIFIER);
        handleClipboard = callback;
        return { dispose: handlerDispose };
      },
    },
  });
  if (handleClipboard === null) throw new Error("OSC clipboard handler was not registered");
  return {
    dispose: registration.dispose,
    handleClipboard,
    input,
    handlerDispose,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("registerTerminalClipboard", () => {
  it("continues parsing output while a clipboard write is blocked", async () => {
    vi.useFakeTimers();
    const blockedWrite = new Promise<void>(() => {});
    const writeText = vi.fn((_text: string) => blockedWrite);
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: vi.fn(() => Promise.resolve("")),
        writeText,
      },
    });
    const terminal = new XtermTerminal({ allowProposedApi: true });
    const registration = registerTerminalClipboard(terminal);
    const writeComplete = vi.fn();

    terminal.write("\x1b]52;c;bG9jYWx0ZXJt\x07after", writeComplete);
    await vi.runOnlyPendingTimersAsync();

    expect(writeText).toHaveBeenCalledWith("localterm");
    expect(writeComplete).toHaveBeenCalledOnce();
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("after");
    registration.dispose();
    terminal.dispose();
  });

  it("reports clipboard reads without pausing the parser", async () => {
    let resolveClipboardRead = (_text: string): void => {};
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveClipboardRead = resolve;
        }),
    );
    const { dispose, handleClipboard, handlerDispose, input } = createClipboardHarness({
      readText,
      writeText: vi.fn(() => Promise.resolve()),
    });

    expect(handleClipboard("c;?")).toBe(true);
    expect(input).not.toHaveBeenCalled();
    resolveClipboardRead("clipboard text");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(input).toHaveBeenCalledWith("\x1b]52;c;Y2xpcGJvYXJkIHRleHQ=\x07", false);
    dispose();
    expect(handlerDispose).toHaveBeenCalledOnce();
  });

  it("returns an empty response when a clipboard read remains blocked", async () => {
    vi.useFakeTimers();
    const { handleClipboard, input } = createClipboardHarness({
      readText: vi.fn(() => new Promise<string>(() => {})),
      writeText: vi.fn(() => Promise.resolve()),
    });

    expect(handleClipboard("c;?")).toBe(true);
    await vi.advanceTimersByTimeAsync(OSC_CLIPBOARD_READ_TIMEOUT_MS);

    expect(input).toHaveBeenCalledWith("\x1b]52;c;\x07", false);
  });
});
