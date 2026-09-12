import { FILE_WATCH_RETRY_INITIAL_MS, FILE_WATCH_RETRY_MAX_MS } from "../constants.js";
import { watchFilesystem } from "./watch-filesystem.js";

export interface WatchSubscription {
  close: () => void;
}

interface FileWatchHandle {
  close: () => void | Promise<void>;
  on: (event: "error", listener: (error: unknown) => void) => unknown;
  unref?: () => void;
}

export interface FileWatchOptions {
  recursive: boolean;
  ignoredDirectories?: readonly string[];
}

export type WatchFactory = (
  target: string,
  options: FileWatchOptions,
  listener: (event: string, filename: string | null) => void,
) => FileWatchHandle;

export const watchWithRecovery = (
  target: string,
  options: FileWatchOptions,
  listener: (event: string, filename: string | null) => void,
  factory: WatchFactory = watchFilesystem,
): WatchSubscription => {
  let closed = false;
  let active: FileWatchHandle | null = null;
  let retry: NodeJS.Timeout | null = null;
  let delayMs = FILE_WATCH_RETRY_INITIAL_MS;
  let lastFailure: string | null = null;

  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (lastFailure === message) return;
    lastFailure = message;
    console.warn(`filesystem watcher failed (${target}): ${message}; retrying`);
  };

  const release = (handle: FileWatchHandle): Promise<void> => {
    try {
      return Promise.resolve(handle.close()).catch(report);
    } catch (error) {
      report(error);
      return Promise.resolve();
    }
  };

  const scheduleRetry = (): void => {
    if (closed || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      start();
    }, delayMs);
    retry.unref?.();
    delayMs = Math.min(delayMs * 2, FILE_WATCH_RETRY_MAX_MS);
  };

  const start = (): void => {
    if (closed) return;
    let handle: FileWatchHandle;
    try {
      handle = factory(target, options, (event, filename) => {
        if (closed || active !== handle) return;
        delayMs = FILE_WATCH_RETRY_INITIAL_MS;
        lastFailure = null;
        listener(event, filename);
      });
      active = handle;
      handle.on("error", (error) => {
        if (closed || active !== handle) return;
        active = null;
        report(error);
        // Wait for asynchronous close before allocating replacement watches.
        // Leave the error listener attached to absorb late events during close.
        void release(handle).then(scheduleRetry);
      });
      handle.unref?.();
    } catch (error) {
      report(error);
      const failed = active;
      active = null;
      if (failed) void release(failed).then(scheduleRetry);
      else scheduleRetry();
    }
  };

  start();
  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      const handle = active;
      active = null;
      if (handle) void release(handle);
    },
  };
};
