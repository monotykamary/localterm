import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import {
  DAEMON_BASE_PATH,
  LAUNCHD_LABEL,
  PORTLESS_RESOLVE_TIMEOUT_MS,
  PORTLESS_SERVICE_TIMEOUT_MS,
  TAILSCALE_HTTPS_PORT,
} from "../constants.js";
import { cliError, type CliError, exitCodeForCliError } from "../errors.js";
import { getLaunchdPlistPath, getStateDirectory } from "../paths.js";
import { cliEntry } from "../utils/cli-entry.js";
import { isPortlessProxyLive } from "../utils/portless.js";
import { configureTailscaleServe, removeTailscaleServe } from "../utils/tailscale.js";
import { reportCliError } from "../utils/report-cli-error.js";

const execFileAsync = promisify(execFile);

const escapePlistString = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface InstallOptions {
  port: number;
  host: string;
  portlessDir?: string;
}

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

const isPortlessMissing = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";

type PortlessStepResult = { ok: true } | { ok: false; missing: boolean; message: string };

const runPortlessStep = async (args: string[]): Promise<PortlessStepResult> => {
  try {
    await execFileAsync("portless", args, { timeout: PORTLESS_SERVICE_TIMEOUT_MS });
    return { ok: true };
  } catch (error) {
    if (isPortlessMissing(error)) {
      return { ok: false, missing: true, message: args.join(" ") };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, missing: false, message };
  }
};

const warnPortlessMissing = (): void => {
  console.warn(kleur.yellow("  ⚠ portless not installed"));
  console.warn(kleur.dim("    install: pnpm add -Dw portless  (workspace) or npm i -g portless"));
};

export const setupPortlessProxy = async (): Promise<void> => {
  console.log();
  console.log(kleur.cyan("portless proxy  — named .localhost URLs"));

  // The proxy serving :443 is the only thing that matters; `portless service
  // install` is just boot registration, and it fails spuriously when the proxy
  // is already installed (it shells out to BSD `install` and chokes on existing
  // state). Treat a live proxy as the source of truth: if it's already up,
  // skip the install; otherwise attempt it and re-check liveness before
  // warning, so a genuine "proxy not running" surfaces but the
  // existing-install false-failure stays silent.
  if (await isPortlessProxyLive()) {
    console.log(kleur.green("  ✔ proxy already running (HTTPS on :443)"));
  } else {
    const install = await runPortlessStep(["service", "install"]);
    if (install.ok) {
      console.log(kleur.green("  ✔ proxy service installed (HTTPS on :443, starts at boot)"));
    } else if (install.missing) {
      warnPortlessMissing();
      return;
    } else if (!(await isPortlessProxyLive())) {
      console.warn(
        kleur.yellow("  ⚠ portless proxy not running on :443 — re-run `localterm install`"),
      );
    }
  }

  const trust = await runPortlessStep(["trust"]);
  if (trust.ok) {
    console.log(kleur.green("  ✔ local CA trusted (browsers accept https://*.localhost)"));
  } else if (trust.missing) {
    warnPortlessMissing();
  } else {
    console.warn(kleur.yellow(`  ⚠ portless trust failed: ${trust.message}`));
  }
};

const setupTailscaleServe = async (port: number): Promise<void> => {
  console.log();
  console.log(kleur.cyan("tailscale  — share on your tailnet at https://<node>.ts.net"));
  const route = await configureTailscaleServe(port);
  if (route.registered && route.url) {
    console.log(kleur.green(`  ✔ tailnet URL: ${route.url}`));
    console.log(
      kleur.dim(`    exposed on tailnet at :${TAILSCALE_HTTPS_PORT} (HTTPS cert auto-managed)`),
    );
    return;
  }
  switch (route.reason) {
    case "binary-missing":
      console.warn(kleur.yellow(`  ⚠ tailscale not installed — skipped tailnet exposure`));
      console.warn(kleur.dim(`    install: ${route.hint ?? "https://tailscale.com/download"}`));
      break;
    case "https-disabled":
      console.warn(
        kleur.yellow(`  ⚠ tailscale HTTPS certificates are not enabled on your tailnet`),
      );
      console.warn(
        kleur.dim(
          `    enable: ${route.hint ?? "https://login.tailscale.com/admin/settings/features"}`,
        ),
      );
      console.warn(
        kleur.dim(`    then re-run: ${kleur.bold("localterm install")} to provision the cert`),
      );
      break;
    case "offline":
      console.warn(
        kleur.yellow(
          `  ⚠ tailscale not online — run \`tailscale up\` and re-run \`localterm install\``,
        ),
      );
      break;
    case "serve-mismatch":
    case undefined:
      console.warn(
        kleur.yellow(`  ⚠ could not configure tailscale serve (port ${port} not registered)`),
      );
      break;
  }
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

  await removeTailscaleServe();

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
