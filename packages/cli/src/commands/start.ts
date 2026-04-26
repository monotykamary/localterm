import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, DEFAULT_HOST, DEFAULT_PORT, isLoopbackHost } from "@localterm/server";
import kleur from "kleur";
import open from "open";
import { FORCE_EXIT_TIMEOUT_MS } from "../constants.js";
import { clearPid, isAlive, readPid, readPort, writePid } from "../state.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const resolveStaticRoot = (): string | null => {
  const candidates = [
    path.resolve(moduleDir, "../../../../apps/web/dist"),
    path.resolve(moduleDir, "../../web"),
    path.resolve(moduleDir, "../web"),
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
}

export const runStart = async (options: StartOptions): Promise<void> => {
  if (!isLoopbackHost(options.host)) {
    console.log(
      kleur.red(
        `refusing to bind '${options.host}'. localterm only accepts loopback hosts (127.0.0.1, localhost, ::1).`,
      ),
    );
    process.exit(2);
  }

  const existingPid = readPid();
  if (existingPid && isAlive(existingPid)) {
    const existingPort = readPort() ?? options.port;
    console.log(
      kleur.yellow(`localterm is already running (pid ${existingPid}, port ${existingPort}).`),
    );
    console.log(
      `Open ${kleur.cyan(`http://${options.host}:${existingPort}`)} or run ${kleur.bold("localterm stop")}.`,
    );
    return;
  }
  if (existingPid) clearPid();

  const staticRoot = resolveStaticRoot();
  if (!staticRoot) {
    console.log(
      kleur.yellow(
        "warning: web bundle not found. run 'pnpm build' first or only the API will be served.",
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`failed to start: ${message}`));
    process.exit(1);
  }
  writePid(process.pid, server.port);

  const url = `http://${server.host}:${server.port}`;
  console.log(kleur.green("✔ localterm started"));
  console.log(`  url:   ${kleur.cyan(url)}`);
  console.log(`  pid:   ${process.pid}`);
  console.log(`  press ${kleur.bold("Ctrl+C")} to stop`);

  if (options.open) {
    try {
      await open(url);
    } catch {
      /* headless environments (CI, ssh) have no browser to open; not fatal */
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      console.log(kleur.red("force exit"));
      clearPid();
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`\n${kleur.dim(`received ${signal}, shutting down…`)}`);
    const forceExit = setTimeout(() => {
      console.log(kleur.red("forcing exit (server.stop took too long)"));
      clearPid();
      process.exit(1);
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
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
};

export const startDefaults: StartOptions = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  open: true,
};
