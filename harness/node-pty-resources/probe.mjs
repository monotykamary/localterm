import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

if (!process.argv[2]) throw new Error("Usage: node probe.mjs <built server package directory>");
const serverRoot = path.resolve(process.argv[2]);
const { spawnPty } = await import(pathToFileURL(path.join(serverRoot, "dist/pty-backend.js")).href);
const { resolveNodePtyDirectory } = await import(
  pathToFileURL(path.join(serverRoot, "dist/utils/resolve-node-pty-directory.js")).href
);
const backend = resolveNodePtyDirectory();
if (process.platform === "darwin")
  assert.equal(path.resolve(backend), path.join(serverRoot, "vendor/node-pty"));
createRequire(import.meta.url)(backend);

const descriptors = () => {
  const lines = execFileSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fftn"], {
    encoding: "utf8",
  }).split("\n");
  return {
    total: lines.filter((line) => /^f[0-9]/.test(line)).length,
    pty: lines.filter((line) => line === "n/dev/ptmx").length,
    kqueue: lines.filter((line) => line === "tKQUEUE").length,
  };
};
const before = descriptors();
let successes = 0;
let failures = 0;
let failureMessage;
for (let iteration = 0; iteration < 100; iteration += 1) {
  let terminal;
  try {
    terminal = spawnPty("/bin/sh", ["-c", "exit 0"], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: { PATH: "/usr/bin:/bin" },
      cols: 80,
      rows: 24,
    });
  } catch (error) {
    assert.match(error.message, /posix_spawnp failed:/);
    failures += 1;
    failureMessage = error.message;
    continue;
  }
  terminal.onData(() => {});
  const exit = await new Promise((resolve) => terminal.onExit(resolve));
  assert.equal(exit.exitCode, 0);
  successes += 1;
}
const after = descriptors();
assert.equal(after.pty, before.pty);
// One native exit-callback thread may still be returning after its JS callback.
assert.ok(after.kqueue <= before.kqueue + 1);
assert.ok(after.total <= before.total + 1);
console.log(JSON.stringify({ backend, before, after, successes, failures, failureMessage }));
