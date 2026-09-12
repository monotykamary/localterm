import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  copyTerminalSelection,
  pasteTerminalClipboard,
} from "../../src/utils/transfer-terminal-clipboard";

describe("transferTerminalClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies non-empty selection text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTerminalSelection(() => "ls -la")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("ls -la");
  });

  it("skips empty selections and clipboard failures", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTerminalSelection(() => "")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    await expect(copyTerminalSelection(() => "text")).resolves.toBe(false);
  });

  it("pastes clipboard text into the terminal", async () => {
    const readText = vi.fn().mockResolvedValue("echo hi");
    const paste = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { readText } });

    await expect(pasteTerminalClipboard(paste)).resolves.toBe(true);
    expect(paste).toHaveBeenCalledWith("echo hi");
  });

  it("skips empty clipboard reads and permission errors", async () => {
    const paste = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("") } });
    await expect(pasteTerminalClipboard(paste)).resolves.toBe(false);
    expect(paste).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(pasteTerminalClipboard(paste)).resolves.toBe(false);
    expect(paste).not.toHaveBeenCalled();
  });
});
