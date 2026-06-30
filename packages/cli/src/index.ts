import { DEFAULT_HOST, DEFAULT_PORT } from "@monotykamary/localterm-server";
import { Command } from "commander";
import { runInstall, runUninstall } from "./commands/install.js";
import { runProcessDelete, runProcessList, runProcessSet } from "./commands/process.js";
import { runRestart } from "./commands/restart.js";
import {
  parseInteger,
  runOneShotExec,
  runSessionAttach,
  runSessionCapture,
  runSessionExec,
  runSessionKill,
  runSessionList,
  runSessionNew,
  runSessionPin,
  runSessionRename,
  runSessionResize,
  runSessionSendKeys,
} from "./commands/session.js";
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
  .description("install auto-start service (launchd on macOS, systemd user unit on Linux)")
  .option("-p, --port <port>", "port to bind", parsePortOption, resolveInitialPort())
  .option("-H, --host <host>", "host to bind", DEFAULT_HOST)
  .action(async (options: { port: number; host: string }) => {
    await runInstall({ port: options.port, host: options.host });
  });

program
  .command("uninstall")
  .description("remove the auto-start service (launchd on macOS, systemd user unit on Linux)")
  .action(async () => {
    await runUninstall();
  });

const secret = program
  .command("secret")
  .description("manage secrets (Keychain-backed identities + env vars)");
secret
  .command("list")
  .description("list secrets (names + env var; never values)")
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
  .description("create or update a secret's env var and value")
  .requiredOption("-e, --env-var <var>", "environment variable to inject")
  .option("-v, --value <value>", 'secret value (use "-" to read from stdin)')
  .action(async (name: string, options: { envVar: string; value?: string }) => {
    await runSecretSet({
      name,
      envVar: options.envVar,
      value: options.value,
    });
  });
secret
  .command("delete <name>")
  .description("delete a secret and its stored value")
  .action(async (name: string) => {
    await runSecretDelete(name);
  });

const processCommand = program
  .command("process")
  .description("manage processes (binaries wrapped with a secret-injecting PATH shim)");
processCommand
  .command("list")
  .description("list processes (binary + the secrets each receives)")
  .action(async () => {
    await runProcessList();
  });
processCommand
  .command("set <name>")
  .description("set the secrets a binary receives (generates its PATH shim)")
  .option("-s, --secrets <list>", "comma-separated secret names to inject")
  .action(async (name: string, options: { secrets?: string }) => {
    await runProcessSet({ name, secrets: options.secrets });
  });
processCommand
  .command("delete <name>")
  .description("delete a process and its shim")
  .action(async (name: string) => {
    await runProcessDelete(name);
  });

program
  .command("exec")
  .description("run a one-shot command in a transient PTY and print its output")
  .argument("<command>", "shell command to run")
  .option("--cwd <path>", "working directory")
  .option("--cols <n>", "terminal columns", parseInteger)
  .option("--rows <n>", "terminal rows", parseInteger)
  .option("--timeout <seconds>", "timeout in seconds", parseInteger)
  .option("--json", "emit the result as JSON (exit code in the payload; CLI exits 0)")
  .action(
    async (
      command: string,
      options: { cwd?: string; cols?: number; rows?: number; timeout?: number; json: boolean },
    ) => {
      await runOneShotExec(command, options);
    },
  );

const session = program
  .command("session")
  .description("control PTYs like tmux (list, create, send-keys, capture, exec, kill)");
session
  .command("ls")
  .description("list live PTYs")
  .option("--json", "emit the list as JSON")
  .action(async (options: { json: boolean }) => {
    await runSessionList(options);
  });
session
  .command("new")
  .description("spawn a detached PTY (pinned by default so it survives between calls)")
  .option("--cwd <path>", "working directory")
  .option("--cmd <command>", "command to run at spawn (shell stays alive after)")
  .option("--name <title>", "session title")
  .option("--cols <n>", "terminal columns", parseInteger)
  .option("--rows <n>", "terminal rows", parseInteger)
  .option("--no-pin", "subject to the idle reap (default: pinned)")
  .option("--json", "emit the session as JSON")
  .action(
    async (options: {
      cwd?: string;
      cmd?: string;
      name?: string;
      cols?: number;
      rows?: number;
      pin: boolean;
      json: boolean;
    }) => {
      await runSessionNew(options);
    },
  );
session
  .command("attach <id>")
  .description("open a browser tab onto a live PTY by id")
  .action(async (id: string) => {
    await runSessionAttach(id);
  });
session
  .command("kill <id>")
  .description("kill a session and its shell")
  .action(async (id: string) => {
    await runSessionKill(id);
  });
session
  .command("send-keys <id> <keys>")
  .description("write raw input to a session (\\n=Enter, \\xHH=control byte)")
  .action(async (id: string, keys: string) => {
    await runSessionSendKeys(id, keys);
  });
session
  .command("capture <id>")
  .description("print the rendered screen as text (tmux capture-pane -p)")
  .option(
    "--lines <n>",
    "lines to capture (default: viewport; extends into scrollback)",
    parseInteger,
  )
  .option("--json", "emit the pane text as JSON")
  .action(async (id: string, options: { lines?: number; json: boolean }) => {
    await runSessionCapture(id, options);
  });
session
  .command("exec <id> <command>")
  .description("run a command in a persistent session; print output, exit with its code")
  .option("--timeout <seconds>", "timeout in seconds", parseInteger)
  .option("--json", "emit the result as JSON; CLI exits 0 (exit code in the payload)")
  .action(async (id: string, command: string, options: { timeout?: number; json: boolean }) => {
    await runSessionExec(id, command, options);
  });
session
  .command("resize <id>")
  .description("resize a session")
  .requiredOption("--cols <n>", "terminal columns", parseInteger)
  .requiredOption("--rows <n>", "terminal rows", parseInteger)
  .action(async (id: string, options: { cols: number; rows: number }) => {
    await runSessionResize(id, options);
  });
session
  .command("rename <id> <name>")
  .description("set a session's title (the shell may overwrite it)")
  .action(async (id: string, name: string) => {
    await runSessionRename(id, name);
  });
session
  .command("pin <id>")
  .description("exempt a session from the idle reap")
  .action(async (id: string) => {
    await runSessionPin(id, true);
  });
session
  .command("unpin <id>")
  .description("subject a session to the idle reap")
  .action(async (id: string) => {
    await runSessionPin(id, false);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
