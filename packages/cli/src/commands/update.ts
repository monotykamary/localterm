import { spawn } from "node:child_process";
import kleur from "kleur";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  NPM_PACKAGE_NAME,
} from "@monotykamary/localterm-server/constants";
import { UPDATE_SELF_COMMAND } from "../constants.js";
import { isAlive, readHost, readPid, readPort } from "../state.js";
import { readPackageVersion } from "../utils/read-package-version.js";
import { runRestart } from "./restart.js";

const runNpmInstallGlobalLatest = (): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", `${NPM_PACKAGE_NAME}@latest`], {
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });

// `localterm update` — the CLI analogue of `pi update`. Pulls the latest release
// from npm into the global install, then restarts the daemon if one is running
// (so a running `localterm start` picks up the new binary). `runRestart` ->
// `spawnDaemon` re-execs `node <cliEntry>`, which now resolves to the freshly
// installed dist, so the spawned daemon runs the new code.
export const runUpdate = async (): Promise<void> => {
  const before = readPackageVersion();
  console.log(kleur.dim(`current version: ${before}`));
  console.log(kleur.dim(`running ${UPDATE_SELF_COMMAND}…`));

  const exitCode = await runNpmInstallGlobalLatest();
  if (exitCode !== 0) {
    console.log(kleur.red("✗ npm install failed."));
    console.log(
      kleur.dim(`  if you run via npx, update by re-running: npx ${NPM_PACKAGE_NAME}@latest start`),
    );
    process.exit(exitCode);
    return;
  }

  // `readPackageVersion` reads package.json from disk at call time, so after the
  // global install overwrites it, this reflects the newly installed version.
  const after = readPackageVersion();
  if (after === before) {
    console.log(kleur.green(`✔ already on the latest version (${after}).`));
  } else {
    console.log(kleur.green(`✔ updated ${before} → ${after}.`));
  }

  const pid = readPid();
  if (pid === null || !isAlive(pid)) {
    console.log(kleur.dim("daemon not running — start it with `localterm start`."));
    return;
  }

  const port = readPort() ?? DEFAULT_PORT;
  const host = readHost() ?? DEFAULT_HOST;
  await runRestart({ port, host, open: false });
};
