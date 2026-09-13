import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const probe = fileURLToPath(new URL("./fixtures/watch-filesystem-probe.mjs", import.meta.url));

const runProbe = (mode: "budget" | "errors"): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-watcher-probe-"));
  try {
    const args = [process.execPath, probe, mode, root];
    return mode === "budget"
      ? execFileSync("/bin/sh", ["-c", 'ulimit -n 128; exec "$@"', "watcher-probe", ...args], {
          encoding: "utf8",
          timeout: 3000,
        })
      : execFileSync(args[0], args.slice(1), { encoding: "utf8", timeout: 3000 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe("watcher backend runtime safety", { tags: ["integration"] }, () => {
  it("contains asynchronous native errors through the real Chokidar backend", () => {
    expect(JSON.parse(runProbe("errors"))).toMatchObject({ reportedErrors: 1, passed: true });
  });

  it.skipIf(process.platform !== "darwin")(
    "watches 512 files below launchd's descriptor limit using one native handle",
    () => {
      expect(JSON.parse(runProbe("budget"))).toMatchObject({ watchCount: 1, passed: true });
    },
  );
});
