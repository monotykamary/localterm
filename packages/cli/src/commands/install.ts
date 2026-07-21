import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import { PORTLESS_SERVICE_TIMEOUT_MS } from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { isPortlessMissing, isPortlessProxyLive } from "../utils/portless.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { writeCommandSpec } from "../utils/command-spec.js";
import { runInstallMac, runUninstallMac } from "./install-launchd.js";
import { runInstallLinux, runUninstallLinux } from "./install-systemd.js";

export { buildPlistContent } from "./install-launchd.js";
export { buildSystemdUnitContent } from "./install-systemd.js";

const execFileAsync = promisify(execFile);

export interface InstallOptions {
  port: number;
  host: string;
  portlessDir?: string;
}

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

export const runInstall = async (options: InstallOptions): Promise<void> => {
  writeCommandSpec();
  if (process.platform === "darwin") {
    await runInstallMac(options, setupPortlessProxy);
    return;
  }
  if (process.platform === "linux") {
    await runInstallLinux(options);
    return;
  }
  const platformError = cliError.installFailed(
    "auto-start is only available on macOS (launchd) and Linux (systemd user unit). " +
      "On other platforms, run `localterm start --foreground` under your init system manually.",
  );
  reportCliError(platformError);
  process.exit(exitCodeForCliError(platformError));
};

export const runUninstall = async (): Promise<void> => {
  if (process.platform === "darwin") {
    await runUninstallMac();
    return;
  }
  if (process.platform === "linux") {
    await runUninstallLinux();
    return;
  }
  const platformError = cliError.installFailed(
    "auto-start is only available on macOS (launchd) and Linux (systemd user unit).",
  );
  reportCliError(platformError);
  process.exit(exitCodeForCliError(platformError));
};
