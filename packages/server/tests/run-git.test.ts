import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveGitBinary } from "../src/utils/resolve-git-binary.js";
import { runGit } from "../src/utils/run-git.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runGit", () => {
  it("terminates a command whose stdout exceeds its capture limit", async () => {
    const repositoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-run-git-"));
    roots.push(repositoryDir);
    execFileSync(resolveGitBinary(), ["init", "-q"], { cwd: repositoryDir });
    fs.writeFileSync(path.join(repositoryDir, "untracked-output.txt"), "content");

    const result = await runGit(repositoryDir, ["status", "--short"], {
      maxStdoutBytes: 8,
    });

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toHaveLength(8);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderr).toContain("stdout exceeded its capture limit");
  });
});
