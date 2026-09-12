import path from "node:path";
import { watch } from "chokidar";
import type { WatchFactory } from "./watch-with-recovery.js";

// Node's Linux recursive watcher creates child FSWatchers whose errors can
// escape the root handle. Chokidar owns those handles and forwards errors.
export const watchFilesystem: WatchFactory = (target, options, listener) => {
  const watcher = watch(target, {
    persistent: false,
    ignoreInitial: true,
    followSymlinks: false,
    atomic: false,
    depth: options.recursive ? undefined : 0,
    ignored: (candidate) =>
      path
        .relative(target, candidate)
        .split(path.sep)
        .some((part) => options.ignoredDirectories?.includes(part)),
  });
  watcher.on("all", (event, candidate) => {
    listener(event === "change" ? "change" : "rename", path.relative(target, candidate) || null);
  });
  return watcher;
};
