import { watch as nativeWatch } from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { watch } from "chokidar";
import type { WatchFactory } from "./watch-with-recovery.js";

export const watchFilesystem: WatchFactory = (target, options, listener) => {
  const ignored = (relative: string): boolean =>
    relative.split(path.sep).some((part) => options.ignoredDirectories?.includes(part));
  const host = platform();
  // Native recursion on macOS/Windows avoids a descriptor for every file.
  if (!options.recursive || host === "darwin" || host === "win32") {
    return nativeWatch(
      target,
      { recursive: options.recursive, persistent: false, encoding: "utf8" },
      (event, filename) => {
        if (filename === null || !ignored(filename)) listener(event, filename);
      },
    );
  }

  // Node's Linux recursive child watcher errors can escape the root handle.
  // Chokidar only attaches native error handlers in its persistent branch.
  const watcher = watch(target, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    atomic: false,
    ignored: (candidate) => ignored(path.relative(target, candidate)),
  });
  watcher.on("all", (event, candidate) => {
    listener(event === "change" ? "change" : "rename", path.relative(target, candidate) || null);
  });
  return watcher;
};
