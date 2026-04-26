import { DEFAULT_HOST, DEFAULT_PORT } from "@localterm/server";
import { Command } from "commander";
import { runKill } from "./commands/kill.js";
import { runList } from "./commands/list.js";
import { runNew } from "./commands/new.js";
import { runRestart } from "./commands/restart.js";
import { runStart } from "./commands/start.js";
import { runStatus } from "./commands/status.js";
import { runStop } from "./commands/stop.js";

const program = new Command();
program.name("localterm").description("local browser-based terminal hub").version("0.0.0");

program
  .command("start")
  .description("start the localterm server")
  .option("-p, --port <port>", "port to bind", String(DEFAULT_PORT))
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .option("--no-open", "do not open browser on start")
  .action(async (options: { port: string; host: string; open: boolean }) => {
    await runStart({
      port: Number(options.port),
      host: options.host,
      open: options.open,
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
  .option("-p, --port <port>", "port to bind", String(DEFAULT_PORT))
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .option("--no-open", "do not open browser on start")
  .action(async (options: { port: string; host: string; open: boolean }) => {
    await runRestart({
      port: Number(options.port),
      host: options.host,
      open: options.open,
    });
  });

program
  .command("list")
  .alias("ls")
  .description("list active terminal sessions")
  .action(async () => {
    await runList();
  });

program
  .command("new")
  .description("create a new terminal session")
  .option("-c, --cwd <path>", "working directory")
  .option("-s, --shell <shell>", "override shell")
  .option("--no-open", "do not open browser")
  .action(async (options: { cwd?: string; shell?: string; open: boolean }) => {
    await runNew(options);
  });

program
  .command("kill <id>")
  .description("kill a terminal session by id")
  .action(async (id: string) => {
    await runKill(id);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
