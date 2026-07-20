import { spawn } from "node:child_process";
import {
  GIT_SPAWN_MAX_STDERR_BYTES,
  GIT_SPAWN_MAX_STDOUT_BYTES,
  GIT_SPAWN_TIMEOUT_MS,
} from "../constants.js";
import { resolveGitBinary } from "./resolve-git-binary.js";

export interface RunGitOptions {
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export interface RunGitResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

const GIT_ENV = {
  ...process.env,
  GIT_PAGER: "",
  GIT_TERMINAL_PROMPT: "0",
};

export const runGit = (
  cwd: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<RunGitResult> =>
  new Promise((resolve) => {
    const child = spawn(resolveGitBinary(), args, { cwd, env: GIT_ENV });
    const maxStdoutBytes = Math.max(
      1,
      Math.floor(options.maxStdoutBytes ?? GIT_SPAWN_MAX_STDOUT_BYTES),
    );
    const maxStderrBytes = Math.max(
      1,
      Math.floor(options.maxStderrBytes ?? GIT_SPAWN_MAX_STDERR_BYTES),
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timeout: NodeJS.Timeout;

    const finish = (exitCode: number, fallbackError?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const capturedStderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8");
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes),
        stderr: fallbackError ?? capturedStderr,
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
        ...(stderrTruncated ? { stderrTruncated: true } : {}),
      });
    };

    const stopForCaptureLimit = (): void => {
      child.kill("SIGKILL");
      const streamName = stdoutTruncated ? "stdout" : "stderr";
      finish(-1, `git ${streamName} exceeded its capture limit`);
    };

    timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(-1, "git timed out");
    }, GIT_SPAWN_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      const remainingBytes = maxStdoutBytes - stdoutBytes;
      if (remainingBytes > 0) {
        const captured = chunk.subarray(0, remainingBytes);
        stdoutChunks.push(captured);
        stdoutBytes += captured.length;
      }
      if (chunk.length > remainingBytes) {
        stdoutTruncated = true;
        stopForCaptureLimit();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      const remainingBytes = maxStderrBytes - stderrBytes;
      if (remainingBytes > 0) {
        const captured = chunk.subarray(0, remainingBytes);
        stderrChunks.push(captured);
        stderrBytes += captured.length;
      }
      if (chunk.length > remainingBytes) {
        stderrTruncated = true;
        stopForCaptureLimit();
      }
    });
    child.on("error", () => {
      finish(-1, "git not installed");
    });
    child.on("close", (code) => {
      finish(code ?? -1);
    });
  });
