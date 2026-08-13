#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.error("The LocalTerm macOS native resources must be built on macOS.");
  process.exit(1);
}

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "..");
const minimumMacosVersion = "11.0";
const resources = [
  {
    source: "packages/cli/native/localtermd-launcher.c",
    output: "packages/cli/resources/localtermd-launcher",
  },
  {
    source: "packages/cli/native/localterm-secret-helper.c",
    output: "packages/cli/resources/localterm-secret-helper",
  },
];

for (const resource of resources) {
  const sourcePath = path.join(repositoryRoot, resource.source);
  const outputPath = path.join(repositoryRoot, resource.output);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const compile = spawnSync(
    "/usr/bin/clang",
    [
      "-Os",
      "-Wall",
      "-Wextra",
      "-Werror",
      `-mmacosx-version-min=${minimumMacosVersion}`,
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      sourcePath,
      "-o",
      outputPath,
    ],
    { stdio: "inherit" },
  );
  if (compile.status !== 0) process.exit(compile.status ?? 1);

  const strip = spawnSync("/usr/bin/strip", ["-x", outputPath], { stdio: "inherit" });
  if (strip.status !== 0) process.exit(strip.status ?? 1);
  console.log(outputPath);
}
