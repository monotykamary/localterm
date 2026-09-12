import path from "node:path";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { watch } from "chokidar";
import { watchFilesystem } from "../../src/utils/watch-filesystem.js";

vi.mock("chokidar", () => ({ watch: vi.fn() }));

describe("watchFilesystem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes dependency trees without excluding Git metadata", () => {
    const native = new EventEmitter();
    vi.mocked(watch).mockReturnValue(native as ReturnType<typeof watch>);
    const listener = vi.fn();
    const root = path.resolve("virtual-repo");
    watchFilesystem(root, { recursive: true, ignoredDirectories: ["node_modules"] }, listener);
    const options = vi.mocked(watch).mock.calls[0][1];
    expect(options).toMatchObject({
      persistent: false,
      followSymlinks: false,
      ignoreInitial: true,
      atomic: false,
    });
    const ignored = options?.ignored as (candidate: string) => boolean;
    expect(ignored(path.join(root, "node_modules", "pkg"))).toBe(true);
    expect(ignored(path.join(root, "nested", "node_modules"))).toBe(true);
    expect(ignored(path.join(root, ".git", "HEAD"))).toBe(false);
    native.emit("all", "change", path.join(root, "src", "file.ts"));
    native.emit("all", "unlink", path.join(root, "src", "file.ts"));
    expect(listener.mock.calls).toEqual([
      ["change", path.join("src", "file.ts")],
      ["rename", path.join("src", "file.ts")],
    ]);
  });

  it("limits nonrecursive subscriptions to immediate children", () => {
    vi.mocked(watch).mockReturnValue(new EventEmitter() as ReturnType<typeof watch>);
    watchFilesystem("/virtual", { recursive: false }, vi.fn());
    expect(vi.mocked(watch).mock.calls[0][1]?.depth).toBe(0);
  });
});
