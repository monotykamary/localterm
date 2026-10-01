import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveNodePtyDirectory } from "../src/utils/resolve-node-pty-directory.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("node-pty backend selection", () => {
  it("uses the shipped patched backend on macOS", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    vi.mocked(existsSync).mockReturnValue(true);
    expect(resolveNodePtyDirectory()).toBe(
      fileURLToPath(new URL("../vendor/node-pty/", import.meta.url)),
    );
  });
  it("uses the workspace dependency before release artifacts are prepared", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    vi.mocked(existsSync).mockReturnValue(false);
    expect(path.basename(resolveNodePtyDirectory())).toBe("node-pty");
    expect(resolveNodePtyDirectory()).toContain("node_modules");
  });
  it("keeps Linux on its platform-native registry dependency", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    vi.mocked(existsSync).mockReturnValue(true);
    expect(resolveNodePtyDirectory()).toContain("node_modules");
    expect(existsSync).not.toHaveBeenCalled();
  });
});
