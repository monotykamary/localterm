import { DEFAULT_HOST, DEFAULT_PORT } from "@monotykamary/localterm-server";
import { Command } from "commander";
import { runRestart } from "./commands/restart.js";
import { runStart } from "./commands/start.js";
import { runStatus } from "./commands/status.js";
import { runStop } from "./commands/stop.js";
import { parsePortOption } from "./utils/parse-port-option.js";
import { readPackageVersion } from "./utils/read-package-version.js";

const initialPort = parsePortOption(process.env.PORT ?? String(DEFAULT_PORT));

const program = new Command();
program
  .name("localterm")
  .description("local browser-based terminal hub")
  .version(readPackageVersion());

program
  .command("start")
  .description("start the localterm server (daemonizes by default)")
  .option("-p, --port <port>", "port to bind", parsePortOption, initialPort)
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .option("--open", "open browser on start")
  .option("-F, --foreground", "stay attached to this terminal (do not daemonize)", false)
  .action(async (options: { port: number; host: string; open: boolean; foreground: boolean }) => {
    await runStart({
      port: options.port,
      host: options.host,
      open: options.open,
      foreground: options.foreground,
    });
  });

program
  .command("stop")
  .description("stop the localterm server")
  .action(async () => {
    await runStop();
  });

program
  .command("status")
  .description("show server status")
  .action(async () => {
    await runStatus();
  });

program
  .command("restart")
  .description("restart the localterm server")
  .option("-p, --port <port>", "port to bind", parsePortOption, initialPort)
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .option("--open", "open browser on restart")
  .action(async (options: { port: number; host: string; open: boolean }) => {
    await runRestart({
      port: options.port,
      host: options.host,
      open: options.open,
    });
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
