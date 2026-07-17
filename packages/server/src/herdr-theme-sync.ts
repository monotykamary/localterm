import fs from "node:fs";
import path from "node:path";
import { parseHerdrThemeConfig } from "./utils/parse-herdr-theme-config.js";
import { resolveHerdrThemeId } from "./utils/resolve-herdr-theme-id.js";

interface HerdrThemeConfigFile {
  content: string;
  modifiedAtMs: number;
}

interface HerdrThemeWatchHandle {
  close: () => void;
  unref?: () => void;
}

interface ReadHerdrThemeConfigFile {
  (filePath: string): HerdrThemeConfigFile | null;
}

interface WatchHerdrThemeDirectory {
  (
    directory: string,
    listener: (filename: string | null) => void,
    errorListener: () => void,
  ): HerdrThemeWatchHandle;
}

interface HerdrThemeSyncOptions {
  configPaths: readonly string[];
  debounceMs: number;
  onThemeChange: (themeId: string) => void;
  readConfigFile?: ReadHerdrThemeConfigFile;
  watchDirectory?: WatchHerdrThemeDirectory;
}

export class HerdrThemeSync {
  private readonly configPaths: readonly string[];
  private readonly debounceMs: number;
  private readonly onThemeChange: (themeId: string) => void;
  private readonly readConfigFile: ReadHerdrThemeConfigFile;
  private readonly watchDirectory: WatchHerdrThemeDirectory;
  private readonly watchHandles = new Map<string, HerdrThemeWatchHandle>();
  private readonly watchedFilenamesByDirectory = new Map<string, ReadonlySet<string>>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private active = false;
  private disposed = false;

  constructor(options: HerdrThemeSyncOptions) {
    this.configPaths = [
      ...new Set(options.configPaths.map((configPath) => path.resolve(configPath))),
    ];
    this.debounceMs = options.debounceMs;
    this.onThemeChange = options.onThemeChange;
    this.readConfigFile =
      options.readConfigFile ??
      ((filePath) => {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          return { content, modifiedAtMs: fs.statSync(filePath).mtimeMs };
        } catch {
          return null;
        }
      });
    this.watchDirectory =
      options.watchDirectory ??
      ((directory, listener, errorListener) => {
        const handle = fs.watch(
          directory,
          { encoding: "utf8", persistent: false },
          (_event, filename) => listener(filename),
        );
        handle.on("error", errorListener);
        return handle;
      });
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.stopWatching();
      return;
    }
    this.refreshWatchDirectories();
    this.reconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.stopWatching();
  }

  private readonly handleConfigDirectoryChange = (
    directory: string,
    filename: string | null,
  ): void => {
    if (!this.active || this.disposed) return;
    if (filename !== null) {
      const changedFilename = filename.replaceAll("\\", "/").split("/")[0];
      if (!this.watchedFilenamesByDirectory.get(directory)?.has(changedFilename)) return;
    }
    this.refreshWatchDirectories();
    this.scheduleReconcile();
  };

  private readonly handleWatchError = (directory: string): void => {
    const handle = this.watchHandles.get(directory);
    if (handle) {
      this.watchHandles.delete(directory);
      this.closeWatchHandle(handle);
    }
    if (!this.active || this.disposed) return;
    this.refreshWatchDirectories();
    this.scheduleReconcile();
  };

  private refreshWatchDirectories(): void {
    const nextWatchedFilenamesByDirectory = new Map<string, Set<string>>();
    for (const configPath of this.configPaths) {
      const directory = this.findNearestExistingDirectory(path.dirname(configPath));
      if (!directory) continue;
      const watchedFilename = path.relative(directory, configPath).split(path.sep)[0];
      const watchedFilenames = nextWatchedFilenamesByDirectory.get(directory) ?? new Set<string>();
      watchedFilenames.add(watchedFilename);
      nextWatchedFilenamesByDirectory.set(directory, watchedFilenames);
    }

    for (const [directory, handle] of this.watchHandles) {
      if (nextWatchedFilenamesByDirectory.has(directory)) continue;
      this.closeWatchHandle(handle);
      this.watchHandles.delete(directory);
    }

    this.watchedFilenamesByDirectory.clear();
    for (const [directory, filenames] of nextWatchedFilenamesByDirectory) {
      this.watchedFilenamesByDirectory.set(directory, filenames);
      if (this.watchHandles.has(directory)) continue;
      try {
        const handle = this.watchDirectory(
          directory,
          (filename) => this.handleConfigDirectoryChange(directory, filename),
          () => this.handleWatchError(directory),
        );
        handle.unref?.();
        this.watchHandles.set(directory, handle);
      } catch {
        continue;
      }
    }
  }

  private findNearestExistingDirectory(initialDirectory: string): string | null {
    let directory = initialDirectory;
    while (directory !== path.dirname(directory)) {
      try {
        if (fs.statSync(directory).isDirectory()) return directory;
      } catch {
        directory = path.dirname(directory);
        continue;
      }
      directory = path.dirname(directory);
    }
    return null;
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer !== null) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      if (this.active && !this.disposed) this.reconcile();
    }, this.debounceMs);
    this.reconcileTimer.unref?.();
  }

  private reconcile(): void {
    let latestConfigFile: HerdrThemeConfigFile | null = null;
    for (const configPath of this.configPaths) {
      const configFile = this.readConfigFile(configPath);
      if (
        configFile &&
        (latestConfigFile === null || configFile.modifiedAtMs > latestConfigFile.modifiedAtMs)
      ) {
        latestConfigFile = configFile;
      }
    }
    if (latestConfigFile === null) return;

    const config = parseHerdrThemeConfig(latestConfigFile.content);
    if (config === null || config.autoSwitch) return;
    const themeId = resolveHerdrThemeId(config.themeName);
    if (themeId) this.onThemeChange(themeId);
  }

  private stopWatching(): void {
    if (this.reconcileTimer !== null) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const handle of this.watchHandles.values()) this.closeWatchHandle(handle);
    this.watchHandles.clear();
    this.watchedFilenamesByDirectory.clear();
  }

  private closeWatchHandle(handle: HerdrThemeWatchHandle): void {
    try {
      handle.close();
    } catch {
      /* already closed */
    }
  }
}
