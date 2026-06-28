import { DEFAULT_HOST, DEFAULT_PORT } from "@monotykamary/localterm-server";
import { Command } from "commander";
import { runInstall, runUninstall } from "./commands/install.js";
import { runRestart } from "./commands/restart.js";
import { runSecretDelete, runSecretGet, runSecretList, runSecretSet } from "./commands/secret.js";
import { runStart } from "./commands/start.js";
import { runStatus } from "./commands/status.js";
import { runStop } from "./commands/stop.js";
import { parsePortOption } from "./utils/parse-port-option.js";
import { readPackageVersion } from "./utils/read-package-version.js";

const resolveInitialPort = (): number => {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  try {
    return parsePortOption(raw);
  } catch {
    console.warn(`ignoring invalid PORT environment variable: ${raw}`);
    return DEFAULT_PORT;
  }
};

const program = new Command();
program
  .name("localterm")
  .description("local browser-based terminal hub")
  .version(readPackageVersion());

program
  .command("start")
  .description("start the localterm server (daemonizes by default)")
  .option("-p, --port <port>", "port to bind", parsePortOption, resolveInitialPort())
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
  .option("-p, --port <port>", "port to bind", parsePortOption, resolveInitialPort())
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .option("--open", "open browser on restart")
  .action(async (options: { port: number; host: string; open: boolean }) => {
    await runRestart({
      port: options.port,
      host: options.host,
      open: options.open,
    });
  });

program
  .command("install")
  .description("install launchd service for auto-start at login (macOS only)")
  .option("-p, --port <port>", "port to bind", parsePortOption, resolveInitialPort())
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .action(async (options: { port: number; host: string }) => {
    await runInstall({ port: options.port, host: options.host });
  });

program
  .command("uninstall")
  .description("remove the launchd auto-start service (macOS only)")
  .action(async () => {
    await runUninstall();
  });

const secret = program
  .command("secret")
  .description("manage per-program secrets (Keychain-backed)");
secret
  .command("list")
  .description("list secrets (names + policy; never values)")
  .action(async () => {
    await runSecretList();
  });
secret
  .command("get <name>")
  .description("print a secret's value (resolved from Keychain, not the daemon)")
  .action(async (name: string) => {
    await runSecretGet(name);
  });
secret
  .command("set <name>")
  .description("create or update a secret's policy and value")
  .requiredOption("-e, --env-var <var>", "environment variable to inject")
  .option("-p, --programs <list>", "comma-separated programs to wrap with a shim")
  .option("-v, --value <value>", 'secret value (use "-" to read from stdin)')
  .action(async (name: string, options: { envVar: string; programs?: string; value?: string }) => {
    await runSecretSet({
      name,
      envVar: options.envVar,
      programs: options.programs,
      value: options.value,
    });
  });
secret
  .command("delete <name>")
  .description("delete a secret and its stored value")
  .action(async (name: string) => {
    await runSecretDelete(name);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
