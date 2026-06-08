import { existsSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, DEFAULT_HOST, DEFAULT_PORT } from "localterm-server";
import kleur from "kleur";
import open from "open";
import {
  DAEMON_CHILD_ENV_FLAG,
  DAEMON_PROBE_INTERVAL_MS,
  DAEMON_PROBE_MAX_WAIT_MS,
  DAEMON_PROCESS_TITLE,
  EXIT_FAILURE,
  EXIT_OK,
  FORCE_EXIT_TIMEOUT_MS,
  getFriendlyUrl,
  STOP_COMMAND,
} from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { clearPid, ensureLogFile, isAlive, readPort, writePid } from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { runStartPreflight } from "../utils/run-start-preflight.js";
import { sleep } from "../utils/sleep.js";
import { spawnDaemon } from "../utils/spawn-daemon.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const resolveStaticRoot = (): string | null => {
  const candidates = [
    path.resolve(moduleDir, "../../../../apps/terminal/dist"),
    path.resolve(moduleDir, "../../terminal"),
    path.resolve(moduleDir, "../terminal"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
};

export interface StartOptions {
  port: number;
  host: string;
  open: boolean;
  foreground: boolean;
}

const isRunningAsDaemonChild = (): boolean => process.env[DAEMON_CHILD_ENV_FLAG] === "1";

export const runStart = async (options: StartOptions): Promise<void> => {
  if (options.foreground || isRunningAsDaemonChild()) {
    await runStartInForeground(options);
    return;
  }
  await runStartAsDaemon(options);
};

const runStartAsDaemon = async (options: StartOptions): Promise<void> => {
  const preflightError = runStartPreflight(options.host);
  if (preflightError !== null) {
    reportCliError(preflightError);
    process.exit(exitCodeForCliError(preflightError));
  }

  const portBeforeSpawn = readPort();
  const logPath = ensureLogFile();
  const logFd = openSync(logPath, "a");
  const { pid: childPid } = spawnDaemon({
    args: buildDaemonStartArgs(options),
    logFd,
  });

  if (childPid === undefined) {
    const error = cliError.daemonSpawnFailed(process.execPath, logPath);
    reportCliError(error);
    process.exit(exitCodeForCliError(error));
  }

  const result = await pollForDaemonReady({
    childPid,
    initialPort: portBeforeSpawn,
    intervalMs: DAEMON_PROBE_INTERVAL_MS,
    maxWaitMs: DAEMON_PROBE_MAX_WAIT_MS,
    logPath,
    isAlive,
    readPort,
    sleep,
  });

  if (result.ok) {
    printDaemonStartedBanner(result.port);
    if (options.open) await openInBrowser(getFriendlyUrl(result.port));
    return;
  }

  if (result.error.kind === "daemon-ready-timeout" && isAlive(childPid)) {
    const finalPort = readPort();
    if (finalPort !== null && finalPort !== portBeforeSpawn) {
      printDaemonStartedBanner(finalPort);
      if (options.open) await openInBrowser(getFriendlyUrl(finalPort));
      return;
    }
  }

  reportCliError(result.error);
  process.exit(exitCodeForCliError(result.error));
};

const printDaemonStartedBanner = (port: number): void => {
  console.log(`${kleur.green("✔")} running at ${kleur.cyan(getFriendlyUrl(port))}`);
  console.log(`  stop with ${kleur.bold(STOP_COMMAND)}`);
};

const openInBrowser = async (url: string): Promise<void> => {
  try {
    await open(url);
  } catch {
    /* headless environments (CI, ssh) have no browser to open; not fatal */
  }
};

const runStartInForeground = async (options: StartOptions): Promise<void> => {
  const preflightError = runStartPreflight(options.host);
  if (preflightError !== null) {
    reportCliError(preflightError);
    process.exit(exitCodeForCliError(preflightError));
  }

  process.title = DAEMON_PROCESS_TITLE;

  const staticRoot = resolveStaticRoot();
  if (!staticRoot) {
    console.log(
      kleur.yellow(
        "warning: terminal bundle not found. run 'pnpm build' first or only the API will be served.",
      ),
    );
  }

  let server: Awaited<ReturnType<typeof createServer>>;
  try {
    server = await createServer({
      port: options.port,
      host: options.host,
      staticRoot,
    });
  } catch (caughtError) {
    const startError = cliError.serverStartFailed(
      caughtError instanceof Error ? caughtError : new Error(String(caughtError)),
    );
    reportCliError(startError);
    process.exit(exitCodeForCliError(startError));
  }

  writePid(process.pid, server.port);

  const namedUrl = getFriendlyUrl(server.port);
  if (isRunningAsDaemonChild()) {
    console.log(`${kleur.green("✔")} daemon listening on ${namedUrl} (pid ${process.pid})`);
  } else {
    console.log(`${kleur.green("✔")} running at ${kleur.cyan(namedUrl)}`);
    console.log(`  press ${kleur.bold("Ctrl+C")} to stop`);
  }

  if (options.open && !isRunningAsDaemonChild()) await openInBrowser(namedUrl);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      console.log(kleur.red("force exit"));
      clearPid();
      process.exit(EXIT_FAILURE);
    }
    shuttingDown = true;
    console.log(`\n${kleur.dim(`received ${signal}, shutting down…`)}`);
    const forceExit = setTimeout(() => {
      console.log(kleur.red("forcing exit (server.stop took too long)"));
      clearPid();
      process.exit(EXIT_FAILURE);
    }, FORCE_EXIT_TIMEOUT_MS);
    forceExit.unref();
    try {
      await server.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(kleur.red(`stop error: ${message}`));
    } finally {
      clearTimeout(forceExit);
      clearPid();
      process.exit(EXIT_OK);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
};

export const startDefaults: StartOptions = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  open: false,
  foreground: false,
};
