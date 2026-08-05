import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MACOS_DAEMON_APP_EXECUTABLE_NAME,
  MACOS_DAEMON_APPLE_EVENTS_USAGE_DESCRIPTION,
  MACOS_DAEMON_BUNDLE_IDENTIFIER,
  MACOS_DAEMON_BUNDLE_VERSION,
  MACOS_DAEMON_CODESIGN_TIMEOUT_MS,
  MACOS_DAEMON_EXECUTABLE_MODE,
  MACOS_DAEMON_MICROPHONE_USAGE_DESCRIPTION,
} from "../constants.js";
import { getMacosDaemonAppPath, getMacosDaemonExecutablePath } from "../paths.js";

const execFileAsync = promisify(execFile);

export const buildMacosDaemonInfoPlist = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>LocalTerm</string>
    <key>CFBundleExecutable</key>
    <string>${MACOS_DAEMON_APP_EXECUTABLE_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${MACOS_DAEMON_BUNDLE_IDENTIFIER}</string>
    <key>CFBundleName</key>
    <string>LocalTerm Daemon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>${MACOS_DAEMON_BUNDLE_VERSION}</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>NSAppleEventsUsageDescription</key>
    <string>${MACOS_DAEMON_APPLE_EVENTS_USAGE_DESCRIPTION}</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>${MACOS_DAEMON_MICROPHONE_USAGE_DESCRIPTION}</string>
</dict>
</plist>
`;

export const buildMacosDaemonEntitlements = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
</dict>
</plist>
`;

export const installMacosDaemonBundle = async (): Promise<string> => {
  const appPath = getMacosDaemonAppPath();
  const stagingPath = `${appPath}.staging-${process.pid}`;
  const executablePath = getMacosDaemonExecutablePath(stagingPath);
  const contentsPath = path.join(stagingPath, "Contents");
  const entitlementsPath = `${appPath}.entitlements-${process.pid}.plist`;
  const launcherSourcePath = fileURLToPath(
    new URL("../../resources/localtermd-launcher", import.meta.url),
  );

  rmSync(stagingPath, { force: true, recursive: true });
  rmSync(entitlementsPath, { force: true });
  mkdirSync(path.dirname(executablePath), { recursive: true });
  writeFileSync(path.join(contentsPath, "Info.plist"), buildMacosDaemonInfoPlist(), "utf8");
  writeFileSync(entitlementsPath, buildMacosDaemonEntitlements(), "utf8");
  copyFileSync(launcherSourcePath, executablePath);
  chmodSync(executablePath, MACOS_DAEMON_EXECUTABLE_MODE);

  try {
    // The launcher remains the responsible parent, so macOS checks its audio
    // entitlement instead of denying microphone access to the daemon's Node children.
    await execFileAsync(
      "/usr/bin/codesign",
      [
        "--force",
        "--deep",
        "--sign",
        "-",
        "--options",
        "runtime",
        "--entitlements",
        entitlementsPath,
        stagingPath,
      ],
      { timeout: MACOS_DAEMON_CODESIGN_TIMEOUT_MS },
    );
    rmSync(entitlementsPath, { force: true });
    await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagingPath], {
      timeout: MACOS_DAEMON_CODESIGN_TIMEOUT_MS,
    });
    rmSync(appPath, { force: true, recursive: true });
    renameSync(stagingPath, appPath);
  } catch (error) {
    rmSync(stagingPath, { force: true, recursive: true });
    rmSync(entitlementsPath, { force: true });
    throw error;
  }

  return getMacosDaemonExecutablePath(appPath);
};

export const removeMacosDaemonBundle = (): void => {
  rmSync(getMacosDaemonAppPath(), { force: true, recursive: true });
};
