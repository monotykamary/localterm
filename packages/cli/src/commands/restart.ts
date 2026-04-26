import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { ensureLogFile } from "../state.js";
import { runStop } from "./stop.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(moduleDir, "../index.js");

export interface RestartOptions {
  port: number;
  host: string;
  open: boolean;
}

export const runRestart = async (options: RestartOptions): Promise<void> => {
  await runStop();
  const logPath = ensureLogFile();
  const logFd = openSync(logPath, "a");
  const args = [cliEntry, "start", "--port", String(options.port), "--host", options.host];
  if (!options.open) args.push("--no-open");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  console.log(kleur.green(`✔ restarted (logs: ${logPath})`));
};
