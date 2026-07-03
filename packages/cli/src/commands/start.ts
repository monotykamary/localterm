import { existsSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  DEFAULT_HOST,
  DEFAULT_PORT,
  isLoopbackHost,
  isServerErrorException,
} from "@monotykamary/localterm-server";
import kleur from "kleur";
import open from "open";
import {
  DAEMON_CHILD_ENV_FLAG,
  RESTART_DAEMON_ENV_FLAG,
  DAEMON_PROBE_INTERVAL_MS,
  DAEMON_PROBE_MAX_WAIT_MS,
  DAEMON_PROCESS_TITLE,
  EXIT_FAILURE,
  EXIT_OK,
  FORCE_EXIT_TIMEOUT_MS,
  RESTART_BIND_RETRY_INTERVAL_MS,
  RESTART_BIND_RETRY_MAX_MS,
  STOP_COMMAND,
} from "../constants.js";
import { cliError, exitCodeForCliError, type CliError } from "../errors.js";
import {
  clearPid,
  ensureLogFile,
  isAlive,
  readHost,
  readPid,
  readPort,
  writePid,
} from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { isRunningUnderLaunchd } from "../utils/is-running-under-launchd.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { announceResolvedUrl, resolveDaemonUrl } from "../utils/portless.js";
import type { ResolveUrlResult } from "../utils/portless.js";
import { probeCdpAvailability } from "../utils/probe-cdp-availability.js";
import { readConfiguredCdpPort } from "../utils/read-configured-cdp-port.js";
import { runStartPreflight } from "../utils/run-start-preflight.js";
import { sleep } from "../utils/sleep.js";
import { spawnDaemon } from "../utils/spawn-daemon.js";
import { writeCommandSpec } from "../utils/command-spec.js";
import { runStop } from "./stop.js";

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
const isRunningAsRestartDaemon = (): boolean => process.env[RESTART_DAEMON_ENV_FLAG] === "1";

export const runStart = async (options: StartOptions): Promise<void> => {
  writeCommandSpec();
  if (options.foreground || isRunningAsDaemonChild()) {
    await runStartInForeground(options);
    return;
  }
  await runStartAsDaemon(options);
};

const handlePreflightError = (preflightError: CliError): void => {
  if (preflightError.kind === "already-running" && isRunningUnderLaunchd()) {
    process.exit(EXIT_OK);
  }
  reportCliError(preflightError);
  process.exit(exitCodeForCliError(preflightError));
};

const runStartAsDaemon = async (options: StartOptions): Promise<void> => {
  const preflightError = await runStartPreflight();
  if (preflightError !== null) {
    if (preflightError.kind === "stale-port-file") await runStop();
    else {
      handlePreflightError(preflightError);
      return;
    }
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
    readHost,
    readPid,
    sleep,
  });

  if (result.ok) {
    const route = await printDaemonStartedBanner(result.port);
    if (options.open) await openInBrowser(route.url);
    return;
  }

  if (result.error.kind === "daemon-ready-timeout" && isAlive(childPid)) {
    const finalPort = readPort();
    if (finalPort !== null && finalPort !== portBeforeSpawn) {
      const route = await printDaemonStartedBanner(finalPort);
      if (options.open) await openInBrowser(route.url);
      return;
    }
  }

  reportCliError(result.error);
  process.exit(exitCodeForCliError(result.error));
};

const printCdpAvailabilityLine = async (): Promise<void> => {
  const availability = await probeCdpAvailability(readConfiguredCdpPort());
  if (availability.available) {
    console.log(
      `  cdp:      ${kleur.green("background tabs")} via ${availability.browserName} (no focus steal, closeable)`,
    );
    return;
  }
  console.log(
    kleur.yellow("  cdp:      OS opener (no debug-enabled Chromium — see `localterm install`)"),
  );
};

const printDaemonStartedBanner = async (port: number): Promise<ResolveUrlResult> => {
  const resolved = await resolveDaemonUrl(port);
  console.log(`${kleur.green("✔")} running at ${kleur.cyan(resolved.url)}`);
  announceResolvedUrl(resolved.url, resolved.surface);
  for (const warning of resolved.warnings) {
    console.log(kleur.yellow(`  ⚠ ${warning}`));
  }
  await printCdpAvailabilityLine();
  console.log(`  stop with ${kleur.bold(STOP_COMMAND)}`);
  return resolved;
};

const openInBrowser = async (url: string): Promise<void> => {
  try {
    await open(url);
  } catch {
    /* headless environments (CI, ssh) have no browser to open; not fatal */
  }
};

const retryBindAfterOldDaemonExits = async (
  options: StartOptions,
  staticRoot: string | null,
): Promise<Awaited<ReturnType<typeof createServer>>> => {
  let waited = 0;
  while (waited < RESTART_BIND_RETRY_MAX_MS) {
    await sleep(RESTART_BIND_RETRY_INTERVAL_MS);
    waited += RESTART_BIND_RETRY_INTERVAL_MS;
    try {
      return await createServer({
        port: options.port,
        host: options.host,
        staticRoot,
      });
    } catch (retryCaughtError) {
      const stillInUse =
        isServerErrorException(retryCaughtError) &&
        retryCaughtError.error.kind === "listen-failed" &&
        retryCaughtError.error.cause instanceof Error &&
        (retryCaughtError.error.cause as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!stillInUse) throw retryCaughtError;
    }
  }
  throw new Error(
    `port ${options.port} still in use after ${RESTART_BIND_RETRY_MAX_MS}ms — old daemon may not have shut down`,
  );
};

const runStartInForeground = async (options: StartOptions): Promise<void> => {
  process.title = DAEMON_PROCESS_TITLE;

  const isRestart = isRunningAsRestartDaemon();

  if (!isRestart) {
    const preflightError = await runStartPreflight();
    if (preflightError !== null) {
      if (preflightError.kind === "stale-port-file") await runStop();
      else {
        handlePreflightError(preflightError);
        return;
      }
    }
  }

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
    const isEaddrInuse =
      isServerErrorException(caughtError) &&
      caughtError.error.kind === "listen-failed" &&
      caughtError.error.cause instanceof Error &&
      (caughtError.error.cause as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (isEaddrInuse && isRestart) {
      server = await retryBindAfterOldDaemonExits(options, staticRoot);
    } else if (isEaddrInuse && isRunningUnderLaunchd()) {
      process.exit(EXIT_OK);
    } else if (isEaddrInuse) {
      await runStop();
      try {
        server = await createServer({
          port: options.port,
          host: options.host,
          staticRoot,
        });
      } catch (retryError) {
        console.error(
          kleur.red(
            `port ${options.port} is still in use after stop. ` +
              `find the process with: lsof -i :${options.port} ` +
              `or: fuser ${options.port}/tcp`,
          ),
        );
        const startError = cliError.serverStartFailed(
          retryError instanceof Error ? retryError : new Error(String(retryError)),
        );
        reportCliError(startError);
        process.exit(exitCodeForCliError(startError));
      }
    } else {
      const startError = cliError.serverStartFailed(
        caughtError instanceof Error ? caughtError : new Error(String(caughtError)),
      );
      reportCliError(startError);
      process.exit(exitCodeForCliError(startError));
    }
  }

  if (!isLoopbackHost(options.host)) {
    console.warn(
      kleur.yellow(
        `⚠ binding to ${options.host} — anyone on this network can open a shell. an authentication mechanism is not yet available; see https://github.com/monotykamary/localterm/issues`,
      ),
    );
  }

  writePid(process.pid, server.port, options.host);

  const resolved = await resolveDaemonUrl(server.port);
  // Tell the daemon which surfaces to use. The CLI is the only place that
  // resolves them from the bound port: `url` is the REMOTE surface mobile/
  // remote tabs and `--open` use (and the network-policy host allowlist), while
  // `localUrl` is the daemon-local surface automation-run tabs open at — run
  // tabs open in the daemon's own browser, so they never ride a flapping
  // tailnet that would fail the tab load and the automation. Both are handed to
  // the server so run tabs land on the portless/loopback form even when the
  // daemon is tailnet-fronted for mobile access.
  server.setPublicUrl(resolved.url);
  server.setLocalUrl(resolved.localUrl);
  if (isRunningAsDaemonChild()) {
    console.log(`${kleur.green("✔")} daemon listening on ${resolved.url} (pid ${process.pid})`);
    announceResolvedUrl(resolved.url, resolved.surface);
    for (const warning of resolved.warnings) {
      console.log(kleur.yellow(`  ⚠ ${warning}`));
    }
    await printCdpAvailabilityLine();
  } else {
    console.log(`${kleur.green("✔")} running at ${kleur.cyan(resolved.url)}`);
    announceResolvedUrl(resolved.url, resolved.surface);
    for (const warning of resolved.warnings) {
      console.log(kleur.yellow(`  ⚠ ${warning}`));
    }
    await printCdpAvailabilityLine();
    console.log(`  press ${kleur.bold("Ctrl+C")} to stop`);
  }

  if (options.open && !isRunningAsDaemonChild()) await openInBrowser(resolved.url);

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
