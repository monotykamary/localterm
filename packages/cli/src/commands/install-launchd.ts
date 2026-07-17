import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import { DAEMON_BASE_PATH, LAUNCHD_LABEL, PORTLESS_RESOLVE_TIMEOUT_MS } from "../constants.js";
import { cliError, type CliError, exitCodeForCliError } from "../errors.js";
import { getLaunchdPlistPath, getStateDirectory } from "../paths.js";
import { cliEntry } from "../utils/cli-entry.js";
import { removeTailscaleServe } from "../utils/tailscale.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { setupShellCompletions, teardownShellCompletions } from "../utils/shell-completions.js";
import type { InstallOptions } from "./install.js";
import { reportCdpAvailability, setupTailscaleServe } from "./install-service-setup.js";

const execFileAsync = promisify(execFile);

const escapePlistString = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const buildPlistContent = (options: InstallOptions): string => {
  const stateDirectory = getStateDirectory();
  const logPath = path.join(stateDirectory, "server.log");
  // Minimal system PATH + the daemon's own node dir + the portless dir (the
  // latter two captured at install); see DAEMON_BASE_PATH for why the full user
  // PATH must not be baked. node is needed because `portless` shebangs
  // `#!/usr/bin/env node`.
  const nodeDir = path.dirname(process.execPath);
  const pathParts = [DAEMON_BASE_PATH, nodeDir];
  if (options.portlessDir) pathParts.push(options.portlessDir);
  const pathEnv = pathParts.join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${cliEntry}</string>
        <string>start</string>
        <string>--port</string>
        <string>${options.port}</string>
        <string>--host</string>
        <string>${options.host}</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${os.homedir()}</string>
        <key>PATH</key>
        <string>${escapePlistString(pathEnv)}</string>
    </dict>
</dict>
</plist>
`;
};

const launchctl = async (...args: string[]): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync("launchctl", args, { timeout: 10_000 });
};

const validateLaunchAgentsDirectory = (): CliError | null => {
  const dir = path.dirname(getLaunchdPlistPath());
  if (!existsSync(dir)) {
    return cliError.installFailed(
      `LaunchAgents directory not found at ${dir}. Is this a valid macOS user account?`,
    );
  }
  return null;
};

export const runInstallMac = async (
  options: InstallOptions,
  setupPortlessProxy: () => Promise<void>,
): Promise<void> => {
  const plistPath = getLaunchdPlistPath();

  if (existsSync(plistPath)) {
    try {
      await launchctl("unload", plistPath);
    } catch {
      // May not be loaded; that's fine
    }
  }

  const dirValidationError = validateLaunchAgentsDirectory();
  if (dirValidationError !== null) {
    reportCliError(dirValidationError);
    process.exit(exitCodeForCliError(dirValidationError));
    return;
  }

  let portlessDir: string | undefined;
  try {
    const { stdout } = await execFileAsync("/bin/sh", ["-c", "command -v portless"], {
      timeout: PORTLESS_RESOLVE_TIMEOUT_MS,
    });
    const portlessBin = stdout.trim();
    if (portlessBin) portlessDir = path.dirname(portlessBin);
  } catch {
    // portless not installed — daemon announces the loopback surface instead
  }

  const content = buildPlistContent({ ...options, portlessDir });
  writeFileSync(plistPath, content, "utf8");

  try {
    await launchctl("load", plistPath);
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : String(loadError);
    const loadFailError = cliError.installFailed(
      `wrote ${plistPath} but launchctl load failed: ${message}`,
    );
    reportCliError(loadFailError);
    process.exit(exitCodeForCliError(loadFailError));
    return;
  }

  console.log(kleur.green(`✔ launchd service installed`));
  console.log(`  plist:  ${kleur.dim(plistPath)}`);
  console.log(`  node:   ${kleur.dim(process.execPath)}`);
  console.log(`  entry:  ${kleur.dim(cliEntry)}`);
  console.log(`  port:   ${options.port}`);
  console.log(`  host:   ${options.host}`);
  console.log();
  console.log(
    `  ${kleur.bold("RunAtLoad")} + ${kleur.bold("KeepAlive")} enabled — localterm will:`,
  );
  console.log(`    • start automatically at login`);
  console.log(`    • restart immediately if it crashes`);
  console.log();
  console.log(`  remove with ${kleur.bold("localterm uninstall")}`);

  await setupPortlessProxy();
  await setupTailscaleServe(options.port);
  await reportCdpAvailability();
  await setupShellCompletions();
};

export const runUninstallMac = async (): Promise<void> => {
  const plistPath = getLaunchdPlistPath();

  if (!existsSync(plistPath)) {
    console.log(kleur.dim("launchd service is not installed."));
    return;
  }

  try {
    await launchctl("unload", plistPath);
  } catch {
    // May not be loaded; that's fine
  }

  await removeTailscaleServe();
  await teardownShellCompletions();

  try {
    unlinkSync(plistPath);
  } catch (unlinkError) {
    const message = unlinkError instanceof Error ? unlinkError.message : String(unlinkError);
    const removeFailError = cliError.installFailed(
      `unloaded service but failed to remove ${plistPath}: ${message}`,
    );
    reportCliError(removeFailError);
    process.exit(exitCodeForCliError(removeFailError));
    return;
  }

  console.log(kleur.green("✔ launchd service uninstalled"));
  console.log(`  removed ${kleur.dim(plistPath)}`);
};
