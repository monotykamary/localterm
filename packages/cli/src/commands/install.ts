import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import { LAUNCHD_LABEL } from "../constants.js";
import { cliError, type CliError, exitCodeForCliError } from "../errors.js";
import { getLaunchdPlistPath, getStateDirectory } from "../paths.js";
import { cliEntry } from "../utils/cli-entry.js";
import { reportCliError } from "../utils/report-cli-error.js";

const execFileAsync = promisify(execFile);

export interface InstallOptions {
  port: number;
  host: string;
}

export const buildPlistContent = (options: InstallOptions): string => {
  const stateDirectory = getStateDirectory();
  const logPath = path.join(stateDirectory, "server.log");
  const currentPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

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
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${os.homedir()}</string>
        <key>PATH</key>
        <string>${currentPath}</string>
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

export const runInstall = async (options: InstallOptions): Promise<void> => {
  if (process.platform !== "darwin") {
    const platformError = cliError.installFailed(
      "launchd auto-start is only available on macOS. " +
        "On Linux, create a systemd user unit or use your distribution's autostart mechanism.",
    );
    reportCliError(platformError);
    process.exit(exitCodeForCliError(platformError));
    return;
  }

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

  const content = buildPlistContent(options);
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
};

export const runUninstall = async (): Promise<void> => {
  if (process.platform !== "darwin") {
    const platformError = cliError.installFailed("launchd auto-start is only available on macOS.");
    reportCliError(platformError);
    process.exit(exitCodeForCliError(platformError));
    return;
  }

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
