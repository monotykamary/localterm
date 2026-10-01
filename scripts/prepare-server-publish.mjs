#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(repoRoot, "packages/server");
const serverManifest = JSON.parse(readFileSync(path.join(serverRoot, "package.json"), "utf8"));
const nodePtyVersion = serverManifest.dependencies["node-pty"];
const architectures = ["arm64", "x64"];
const patch = path.join(repoRoot, "patches", `node-pty@${nodePtyVersion}.patch`);
const patchSha256 = createHash("sha256").update(readFileSync(patch)).digest("hex");

if (process.platform !== "darwin") {
  throw new Error("prepare-server-publish requires macOS to build both shipped macOS PTY backends");
}
if (!existsSync(path.join(serverRoot, "dist/index.js"))) {
  throw new Error("Build the server before packing it");
}

const work = mkdtempSync(path.join(os.tmpdir(), "localterm-publish-pty-"));
const vendorRoot = path.join(serverRoot, "vendor");
mkdirSync(vendorRoot, { recursive: true });
const staging = mkdtempSync(path.join(vendorRoot, ".prepare-"));
const destination = path.join(vendorRoot, "node-pty");
const previous = path.join(staging, "previous");
const prepared = path.join(staging, "node-pty");
try {
  cpSync(patch, path.join(work, "node-pty.patch"));
  writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify({
      name: "localterm-native-release-build",
      private: true,
      dependencies: { "node-pty": nodePtyVersion, "node-gyp": "11.4.2" },
      patchedDependencies: { [`node-pty@${nodePtyVersion}`]: "node-pty.patch" },
    }),
  );
  // Never rebuild an installed dependency: its dylib may be mapped by the daemon.
  execFileSync(
    "bun",
    [
      "install",
      "--ignore-scripts",
      "--linker",
      "hoisted",
      "--backend",
      "copyfile",
      "--cache-dir",
      "./package-cache",
    ],
    {
      cwd: work,
      stdio: "inherit",
    },
  );
  const requireBuild = createRequire(path.join(work, "package.json"));
  const nodeGyp = requireBuild.resolve("node-gyp/bin/node-gyp.js");
  const source = path.join(work, "node_modules/node-pty");
  mkdirSync(path.join(prepared, "lib"), { recursive: true });
  for (const file of readdirSync(path.join(source, "lib"))) {
    if (file.endsWith(".js") && !file.endsWith(".test.js")) {
      cpSync(path.join(source, "lib", file), path.join(prepared, "lib", file));
    }
  }
  cpSync(path.join(source, "LICENSE"), path.join(prepared, "LICENSE"));
  writeFileSync(
    path.join(prepared, "package.json"),
    JSON.stringify(
      {
        name: "node-pty",
        version: nodePtyVersion,
        main: "lib/index.js",
        license: "MIT",
      },
      null,
      2,
    ) + "\n",
  );
  for (const arch of architectures) {
    execFileSync(process.execPath, [nodeGyp, "rebuild", "--directory", source, `--arch=${arch}`], {
      cwd: work,
      stdio: "inherit",
    });
    const prebuild = path.join(prepared, "prebuilds", `darwin-${arch}`);
    mkdirSync(prebuild, { recursive: true });
    for (const file of ["pty.node", "spawn-helper"]) {
      const target = path.join(prebuild, file);
      cpSync(path.join(source, "build/Release", file), target);
      chmodSync(target, 0o755);
      execFileSync("codesign", ["--force", "--sign", "-", target]);
    }
  }
  writeFileSync(
    path.join(prepared, "localterm-build.json"),
    JSON.stringify(
      {
        nodePtyVersion,
        patchSha256,
        architectures,
      },
      null,
      2,
    ) + "\n",
  );
  // Rename instead of overwriting a native binary another process has loaded.
  if (existsSync(destination)) renameSync(destination, previous);
  renameSync(prepared, destination);
  console.log(
    `prepare-server-publish: shipped patched node-pty ${nodePtyVersion} for ${architectures.join(", ")}`,
  );
} catch (error) {
  if (!existsSync(destination) && existsSync(previous)) renameSync(previous, destination);
  throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
}
