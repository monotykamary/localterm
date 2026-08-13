#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");
const cliRoot = path.join(repoRoot, "packages/cli");
const terminalDistRoot = path.join(repoRoot, "apps/terminal/dist");
const cliTerminalDestination = path.join(cliRoot, "terminal");
const macosDaemonLauncher = path.join(cliRoot, "resources", "localtermd-launcher");
const macosSecretHelper = path.join(cliRoot, "resources", "localterm-secret-helper");
const repoReadme = path.join(repoRoot, "README.md");
const cliReadmeDestination = path.join(cliRoot, "README.md");
const repoLicense = path.join(repoRoot, "LICENSE");
const cliLicenseDestination = path.join(cliRoot, "LICENSE");

const die = (message) => {
  console.error(`prepare-cli-publish: ${message}`);
  process.exit(1);
};

if (!existsSync(macosDaemonLauncher) || !existsSync(macosSecretHelper)) {
  die(
    `macOS native resources not found. build them with 'pnpm --filter @monotykamary/localterm build:macos-launcher'.`,
  );
}

if (!existsSync(terminalDistRoot)) {
  die(
    `apps/terminal/dist not found. run 'pnpm build' before publishing so the bundled terminal UI ships with the CLI tarball.`,
  );
}

rmSync(cliTerminalDestination, { recursive: true, force: true });
cpSync(terminalDistRoot, cliTerminalDestination, { recursive: true });
console.log(
  `prepare-cli-publish: copied ${path.relative(repoRoot, terminalDistRoot)} -> ${path.relative(repoRoot, cliTerminalDestination)}`,
);

cpSync(repoReadme, cliReadmeDestination);
cpSync(repoLicense, cliLicenseDestination);
console.log(
  `prepare-cli-publish: copied README.md and LICENSE into ${path.relative(repoRoot, cliRoot)}`,
);
