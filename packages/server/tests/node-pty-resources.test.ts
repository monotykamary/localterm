import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const patch = path.join(root, "patches/node-pty@1.1.0.patch");

describe("node-pty native resource ownership", { tags: ["integration"] }, () => {
  it("releases every descriptor on success and every injected spawn failure", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "localterm-pty-resources-"));
    try {
      mkdirSync(path.join(directory, "src/unix"), { recursive: true });
      execFileSync("git", ["apply", "--include=src/unix/*.h", patch], { cwd: directory });
      const binary = path.join(directory, "resources");
      execFileSync("c++", [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        path.join(directory, "src/unix"),
        path.join(root, "harness/node-pty-resources/main.cc"),
        "-o",
        binary,
      ]);
      expect(execFileSync(binary, { encoding: "utf8" })).toContain("no leaked descriptors");
      const sourcePatch = readFileSync(patch, "utf8");
      expect(sourcePatch).toContain("+    PtyScopedFd kqueue_fd(HANDLE_EINTR(kqueue()));");
      expect(sourcePatch).toContain(
        '+    throw Napi::Error::New(napiEnv, std::string("posix_spawnp failed: ") + strerror(err));',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
