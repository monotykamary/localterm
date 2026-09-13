import path from "node:path";
import { watch as nativeWatch } from "node:fs";
import { platform } from "node:os";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { watch } from "chokidar";
import { watchFilesystem } from "../../src/utils/watch-filesystem.js";

vi.mock("chokidar", () => ({ watch: vi.fn() }));
vi.mock("node:fs", () => ({ watch: vi.fn() }));
vi.mock("node:os", () => ({ platform: vi.fn() }));

const handle = () => Object.assign(new EventEmitter(), { close: vi.fn(), unref: vi.fn() });

describe("watchFilesystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue("linux");
  });

  it("owns Linux recursive errors and excludes dependency trees, not Git metadata", () => {
    const watcher = handle();
    vi.mocked(watch).mockReturnValue(watcher as ReturnType<typeof watch>);
    const listener = vi.fn();
    const root = path.resolve("virtual-repo");
    expect(
      watchFilesystem(root, { recursive: true, ignoredDirectories: ["node_modules"] }, listener),
    ).toBe(watcher);
    const options = vi.mocked(watch).mock.calls[0][1];
    expect(options).toMatchObject({
      persistent: true,
      followSymlinks: false,
      ignoreInitial: true,
      atomic: false,
    });
    expect(nativeWatch).not.toHaveBeenCalled();
    const ignored = options?.ignored as (candidate: string) => boolean;
    expect(ignored(path.join(root, "node_modules", "pkg"))).toBe(true);
    expect(ignored(path.join(root, "nested", "node_modules"))).toBe(true);
    expect(ignored(path.join(root, ".git", "HEAD"))).toBe(false);
    watcher.emit("all", "change", path.join(root, "src", "file.ts"));
    watcher.emit("all", "unlink", path.join(root, "src", "file.ts"));
    expect(listener.mock.calls).toEqual([
      ["change", path.join("src", "file.ts")],
      ["rename", path.join("src", "file.ts")],
    ]);
  });

  it.each(["darwin", "win32"] as const)("uses one native recursive subscription on %s", (host) => {
    vi.mocked(platform).mockReturnValue(host);
    const watcher = handle();
    vi.mocked(nativeWatch).mockReturnValue(watcher as ReturnType<typeof nativeWatch>);
    const listener = vi.fn();
    const root = path.resolve("virtual-repo");
    expect(
      watchFilesystem(root, { recursive: true, ignoredDirectories: ["node_modules"] }, listener),
    ).toBe(watcher);
    expect(nativeWatch).toHaveBeenCalledExactlyOnceWith(
      root,
      { recursive: true, persistent: false, encoding: "utf8" },
      expect.any(Function),
    );
    expect(watch).not.toHaveBeenCalled();
    const callback = vi.mocked(nativeWatch).mock.calls[0][2];
    callback?.("change", path.join("src", "file.ts"));
    callback?.("rename", path.join("nested", "node_modules", "pkg"));
    callback?.("change", path.join(".git", "HEAD"));
    callback?.("rename", null);
    expect(listener.mock.calls).toEqual([
      ["change", path.join("src", "file.ts")],
      ["change", path.join(".git", "HEAD")],
      ["rename", null],
    ]);
  });

  it("does not allocate per-file watches for a nonrecursive Linux subscription", () => {
    const watcher = handle();
    vi.mocked(nativeWatch).mockReturnValue(watcher as ReturnType<typeof nativeWatch>);
    watchFilesystem("/virtual", { recursive: false }, vi.fn());
    expect(watch).not.toHaveBeenCalled();
    expect(nativeWatch).toHaveBeenCalledExactlyOnceWith(
      "/virtual",
      { recursive: false, persistent: false, encoding: "utf8" },
      expect.any(Function),
    );
  });
});
