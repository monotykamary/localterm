import { spawn } from "node:child_process";
import { GIT_SPAWN_TIMEOUT_MS } from "../constants.js";
import { resolveGitBinary } from "./resolve-git-binary.js";

export interface RunGitResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

// GIT_PAGER="" stops git from invoking a pager; GIT_TERMINAL_PROMPT=0 stops it
// from blocking on a credential prompt (a missing token would otherwise hang
// the spawn — and thus the daemon's event loop — for good).
const GIT_ENV = {
  ...process.env,
  GIT_PAGER: "",
  GIT_TERMINAL_PROMPT: "0",
};

// Never throws: a non-zero exit (e.g. `rev-parse --verify` on a missing ref) and
// a missing git binary both surface as { exitCode } for the caller to decide on.
// stdout is captured as a Buffer so binary-ish patch output survives intact;
// callers decode with toString("utf8") where they know it's text.
export const runGit = (cwd: string, args: string[]): Promise<RunGitResult> =>
  new Promise((resolve) => {
    const child = spawn(resolveGitBinary(), args, { cwd, env: GIT_ENV });
    const stdoutChunks: Buffer[] = [];
    let stderrText = "";
    let settled = false;

    const finish = (result: RunGitResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: -1, stdout: Buffer.concat(stdoutChunks), stderr: "git timed out" });
    }, GIT_SPAWN_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });
    child.on("error", () => {
      finish({ exitCode: -1, stdout: Buffer.concat(stdoutChunks), stderr: "git not installed" });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? -1, stdout: Buffer.concat(stdoutChunks), stderr: stderrText });
    });
  });
