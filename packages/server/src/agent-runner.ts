import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { computeChangedFiles, gitStatusSet } from "./agent-git-status.js";
import {
  capLogEntries,
  extractAssistantText,
  extractAssistantThinking,
  formatToolInput,
  truncateFindings,
  truncateLog,
  truncateToolInput,
  truncateToolResult,
} from "./agent-log-utils.js";
import {
  AUTOMATION_AGENT_COMPACT_ERROR_PREVIEW_LENGTH,
  AUTOMATION_AGENT_COMPACT_STDERR_BYTES,
  AUTOMATION_AGENT_COMPACT_TIMEOUT_MS,
  AUTOMATION_AGENT_FORCE_KILL_DELAY_MS,
  AUTOMATION_AGENT_RUN_TIMEOUT_MS,
  AUTOMATION_CUSTOM_HARNESS_CAPTURE_BYTES,
  AUTOMATION_SESSION_MAX_PENDING_TOOL_CALLS,
} from "./constants.js";
import { resolvePiAndPath } from "./pi-binary-resolver.js";
import { RpcClient } from "./pi-rpc-client.js";
import { appendBoundedBufferText } from "./utils/append-bounded-buffer-text.js";
import type { AgentHarnessConfig, AgentLogEntry, AutomationRunner } from "./types.js";

export { __resetAgentModelCache, listAgentModels } from "./agent-models.js";
export { readAgentSession } from "./agent-session-reader.js";

type AgentRunner = Extract<AutomationRunner, { kind: "agent" }>;
type PiHarnessConfig = Extract<AgentHarnessConfig, { kind: "pi" }>;
type CustomHarnessConfig = Extract<AgentHarnessConfig, { kind: "custom" }>;

export interface AgentRunRequest {
  runner: AgentRunner;
  cwd: string;
  // Resolved secret env (from requestedSecrets), merged onto the subprocess env.
  env: Record<string, string>;
  // Absolute path to the thread session file (thread mode only). null for fresh.
  sessionFile: string | null;
  // localterm's secret-shims dir, stripped from PATH so `pi` resolves to the
  // real binary instead of the secret-injecting shim — the automation injects
  // its own requestedSecrets as env, so the shim would double-inject.
  shimsDir: string;
  // Test override for the `pi` binary; resolved from PATH otherwise.
  piBinaryPath?: string;
}

export interface AgentRunResult {
  // Derived from the run: 0 = completed, non-null/1 = failed. For the pi
  // harness this comes from the RPC event stream (not the process exit code,
  // which is unreliable for headless failures); for a custom harness it is the
  // subprocess exit code.
  exitCode: number | null;
  // Short preview: the last assistant text (pi) or stdout (custom), truncated.
  findings: string | null;
  // Full per-run log: the agent transcript as structured user/assistant/tool
  // entries (pi harness) or stdout+stderr as a string (custom harness).
  log: string | AgentLogEntry[] | null;
  // Working-tree paths whose status changed across the run, capped.
  changedFiles: string[];
}

export interface AgentCompactRequest {
  harness: AgentHarnessConfig;
  cwd: string;
  env: Record<string, string>;
  sessionFile: string;
  shimsDir: string;
  piBinaryPath?: string;
}

export interface AgentCompactResult {
  ok: boolean;
  message?: string;
}

export interface AgentHarness {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  compact(request: AgentCompactRequest): Promise<AgentCompactResult>;
}

const piFlagsFor = (config: PiHarnessConfig): string[] => {
  const flags: string[] = [];
  if (!config.extensions) flags.push("--no-extensions");
  if (!config.skills) flags.push("--no-skills");
  if (!config.contextFiles) flags.push("--no-context-files");
  return flags;
};

// Run one agent fire through a `pi --mode rpc` subprocess. Fresh runs use
// --no-session; thread runs resume --session <file>. Auto-compaction is left to
// the harness default (pi: on). Findings come from the last assistant message;
// the log is the formatted event transcript (+ stderr tail if pi writes any).
// The run status is derived from the event stream so a headless API failure
// (stopReason "error", a crash) is "failed" even if the
// process exits 0.
const runPi = async (request: AgentRunRequest, piBinaryPath?: string): Promise<AgentRunResult> => {
  const { binary: piBinary, pathEnv } = resolvePiAndPath(request.shimsDir, piBinaryPath);
  if (!piBinary) {
    return {
      exitCode: 1,
      findings:
        "pi not found on PATH (excluding the localterm shims dir). Install pi or add it to PATH so the agent runner can spawn it.",
      log: null,
      changedFiles: [],
    };
  }
  if (request.sessionFile) {
    try {
      fs.mkdirSync(path.dirname(request.sessionFile), { recursive: true });
    } catch {
      // pi will surface the write failure itself
    }
  }

  const { runner } = request;
  const harness = runner.harness;
  const piHarness =
    harness.kind === "pi"
      ? harness
      : ({ kind: "pi", extensions: true, skills: true, contextFiles: true } as PiHarnessConfig);
  const args = ["--mode", "rpc"];
  if (runner.sessionMode === "fresh") args.push("--no-session");
  else if (request.sessionFile) args.push("--session", request.sessionFile);
  if (runner.model) args.push("--model", runner.model);
  if (runner.thinking) args.push("--thinking", runner.thinking);
  args.push(...piFlagsFor(piHarness));

  const before = gitStatusSet(request.cwd);
  // Spawn pi with the resolved full PATH (minus the shims dir) so pi and its
  // tools find their dependencies — the daemon's own minimal PATH would leave
  // pi unable to spawn node/git/etc. The shim dir is stripped so pi's tools
  // don't double-inject secrets (the automation injects its requestedSecrets
  // as env directly).
  const client = new RpcClient(piBinary, args, request.cwd, {
    ...process.env,
    PATH: pathEnv || process.env.PATH,
    ...request.env,
  });

  const logEntries: AgentLogEntry[] = [{ type: "user", text: runner.prompt }];
  let lastAssistantText = "";
  let lastErrorMessage = "";
  let errored = false;
  let agentEnded = false;
  // Tool-call inputs (the path/command), recovered from a message_end's
  // tool_use blocks by call id, then attached to the matching tool_execution_end
  // entry so the per-run log shows what a tool was invoked with.
  const toolInputById = new Map<string, string>();
  client.send({ type: "prompt", message: runner.prompt, id: "prompt" });

  const deadline = Date.now() + AUTOMATION_AGENT_RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const line = await client.nextLine(Math.min(1000, deadline - Date.now()));
    if (line === null) {
      if (client.closed) {
        if (!agentEnded) errored = true;
        break;
      }
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "response") {
      if (event.id === "prompt" && event.success === false) {
        errored = true;
        lastErrorMessage = String(event.error ?? "prompt rejected");
      }
    } else if (event.type === "message_end") {
      const message = event.message as {
        role?: string;
        stopReason?: string;
        errorMessage?: string;
        content?: unknown;
      } | null;
      if (message?.role === "assistant") {
        const text = extractAssistantText(event.message as { content?: unknown } | null);
        if (text) {
          const thinking = extractAssistantThinking(event.message as { content?: unknown } | null);
          lastAssistantText = text;
          logEntries.push(
            thinking ? { type: "assistant", text, thinking } : { type: "assistant", text },
          );
        } else if (message.errorMessage) {
          lastErrorMessage = message.errorMessage;
          logEntries.push({ type: "assistant", text: message.errorMessage });
        }
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            const block = part as {
              type?: string;
              id?: unknown;
              name?: unknown;
              arguments?: unknown;
              input?: unknown;
            };
            if (block.type === "tool_use" || block.type === "toolCall") {
              const formatted = truncateToolInput(formatToolInput(block.arguments ?? block.input));
              const toolCallId = String(block.id ?? "");
              if (formatted && toolCallId) {
                toolInputById.delete(toolCallId);
                toolInputById.set(toolCallId, formatted);
                while (toolInputById.size > AUTOMATION_SESSION_MAX_PENDING_TOOL_CALLS) {
                  const oldestToolCallId = toolInputById.keys().next().value;
                  if (oldestToolCallId === undefined) break;
                  toolInputById.delete(oldestToolCallId);
                }
              }
            }
          }
        }
        if (message.stopReason === "error" || message.errorMessage) {
          errored = true;
          lastErrorMessage = message.errorMessage ?? lastErrorMessage;
        }
      }
    } else if (event.type === "tool_execution_end") {
      const result = event.result as { content?: unknown } | null;
      const text = truncateToolResult(extractAssistantText(result as { content?: unknown } | null));
      const toolCallId = String(event.toolCallId ?? "");
      const input = toolInputById.get(toolCallId);
      toolInputById.delete(toolCallId);
      logEntries.push({
        type: "tool",
        name: String(event.toolName ?? "tool"),
        ...(input !== undefined ? { input } : {}),
        text,
      });
    } else if (event.type === "turn_end") {
      const message = event.message as { stopReason?: string } | null;
      if (message?.stopReason === "error") errored = true;
    } else if (event.type === "agent_end") {
      agentEnded = true;
      break;
    }
  }

  // If the run errored without an assistant message carrying the error (a
  // crash or a rejected prompt), surface it as a final assistant entry so the
  // log explains the failure instead of ending on the prompt.
  if (errored && lastErrorMessage) {
    const last = logEntries[logEntries.length - 1];
    if (!last || last.type !== "assistant" || last.text !== lastErrorMessage) {
      logEntries.push({ type: "assistant", text: lastErrorMessage });
    }
  }
  client.close();

  const findingsSource = lastAssistantText || (errored ? lastErrorMessage : "");
  const findings = truncateFindings(findingsSource);
  const log = capLogEntries(logEntries);
  const changedFiles = computeChangedFiles(before, request.cwd);
  const exitCode = errored || !agentEnded ? 1 : 0;
  return { exitCode, findings, log, changedFiles };
};

// Compact a thread session in place via a short-lived `pi --mode rpc` session:
// send `compact`, wait for `compaction_end`, close. The session file is
// updated on disk by pi.
const compactPi = async (
  request: AgentCompactRequest,
  piBinaryPath?: string,
): Promise<AgentCompactResult> => {
  const { binary: piBinary, pathEnv } = resolvePiAndPath(request.shimsDir, piBinaryPath);
  if (!piBinary) return { ok: false, message: "pi not found on PATH" };
  try {
    fs.mkdirSync(path.dirname(request.sessionFile), { recursive: true });
  } catch {
    // pi will surface the write failure
  }
  const piHarness =
    request.harness.kind === "pi"
      ? request.harness
      : ({ kind: "pi", extensions: true, skills: true, contextFiles: true } as PiHarnessConfig);
  const args = ["--mode", "rpc", "--session", request.sessionFile, ...piFlagsFor(piHarness)];
  const client = new RpcClient(piBinary, args, request.cwd, {
    ...process.env,
    PATH: pathEnv || process.env.PATH,
    ...request.env,
  });
  client.send({ type: "compact", id: "compact" });

  let ok = false;
  let message: string | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const line = await client.nextLine(Math.min(1000, deadline - Date.now()));
    if (line === null) {
      if (client.closed) break;
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "response" && event.id === "compact") {
      ok = Boolean(event.success);
      if (!ok) message = String(event.error ?? "compact rejected");
    } else if (event.type === "compaction_end") {
      if (event.aborted) {
        ok = false;
        message = "compaction aborted";
      } else if (event.errorMessage) {
        ok = false;
        message = String(event.errorMessage);
      } else {
        ok = true;
      }
      break;
    }
  }
  client.close();
  return { ok, message };
};

const PiHarness = (piBinaryPath?: string): AgentHarness => ({
  run: (request) => runPi(request, piBinaryPath),
  compact: (request) => compactPi(request, piBinaryPath),
});

// A user-supplied harness: runs `command` as a shell command with the request
// passed as LOCALTERM_AGENT_* env vars (the prompt is in env, never argv, so a
// prompt with shell metacharacters is safe). stdout is findings, stdout+stderr
// is the log. `compactCommand` (optional) compacts a thread session in place.
const runCustom = async (
  request: AgentRunRequest,
  config: CustomHarnessConfig,
): Promise<AgentRunResult> => {
  const before = gitStatusSet(request.cwd);
  if (request.sessionFile) {
    try {
      fs.mkdirSync(path.dirname(request.sessionFile), { recursive: true });
    } catch {
      // the harness will surface the write failure
    }
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...request.env,
    LOCALTERM_AGENT_PROMPT: request.runner.prompt,
    LOCALTERM_AGENT_SESSION_MODE: request.runner.sessionMode,
    LOCALTERM_AGENT_SESSION_FILE: request.sessionFile ?? "",
    LOCALTERM_AGENT_MODEL: request.runner.model ?? "",
    LOCALTERM_AGENT_THINKING: request.runner.thinking ?? "",
  };
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  let killed = false;
  let exitCode: number | null = 0;
  let spawnFailed = false;
  await new Promise<void>((resolve) => {
    const child = spawn(config.command, {
      cwd: request.cwd,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcess;
    child.stdout?.on("data", (chunk: Buffer) => {
      const captured = appendBoundedBufferText(
        stdout,
        stdoutBytes,
        chunk,
        AUTOMATION_CUSTOM_HARNESS_CAPTURE_BYTES,
      );
      stdout = captured.text;
      stdoutBytes = captured.bytes;
      stdoutTruncated ||= captured.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const captured = appendBoundedBufferText(
        stderr,
        stderrBytes,
        chunk,
        AUTOMATION_CUSTOM_HARNESS_CAPTURE_BYTES,
      );
      stderr = captured.text;
      stderrBytes = captured.bytes;
      stderrTruncated ||= captured.truncated;
    });
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, AUTOMATION_AGENT_FORCE_KILL_DELAY_MS).unref?.();
    }, AUTOMATION_AGENT_RUN_TIMEOUT_MS);
    timer.unref?.();
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killed || signal) exitCode = null;
      else exitCode = code ?? 0;
      resolve();
    });
    child.on("error", () => {
      clearTimeout(timer);
      spawnFailed = true;
      stderr += `\nfailed to spawn harness: ${config.command}`;
      resolve();
    });
  });
  const changedFiles = computeChangedFiles(before, request.cwd);
  const stdoutCapture = stdoutTruncated ? `${stdout}\n…[capture truncated]` : stdout;
  const stderrCapture = stderrTruncated ? `${stderr}\n…[capture truncated]` : stderr;
  const findings = truncateFindings(stdoutCapture.length > 0 ? stdoutCapture : stderrCapture);
  const log = truncateLog(
    stdoutCapture + (stderrCapture.length > 0 ? `\n--- stderr ---\n${stderrCapture}` : ""),
  );
  if (spawnFailed) exitCode = 1;
  return { exitCode, findings, log, changedFiles };
};

const compactCustom = async (
  request: AgentCompactRequest,
  config: CustomHarnessConfig,
): Promise<AgentCompactResult> => {
  if (!config.compactCommand) {
    return { ok: false, message: "custom harness has no compact command" };
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...request.env,
    LOCALTERM_AGENT_SESSION_FILE: request.sessionFile,
  };
  const compactCommand = config.compactCommand;
  return new Promise((resolve) => {
    const child = spawn(compactCommand, {
      cwd: request.cwd,
      env,
      shell: true,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }) as ChildProcess;
    let stderr = "";
    let stderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      const captured = appendBoundedBufferText(
        stderr,
        stderrBytes,
        chunk,
        AUTOMATION_AGENT_COMPACT_STDERR_BYTES,
      );
      stderr = captured.text;
      stderrBytes = captured.bytes;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), AUTOMATION_AGENT_COMPACT_TIMEOUT_MS);
    timer.unref?.();
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        message:
          code === 0
            ? undefined
            : `compact command exited ${String(code)}${
                stderr ? `: ${stderr.slice(0, AUTOMATION_AGENT_COMPACT_ERROR_PREVIEW_LENGTH)}` : ""
              }`,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `failed to spawn compact command: ${error.message}` });
    });
  });
};

const CustomHarness = (config: CustomHarnessConfig): AgentHarness => ({
  run: (request) => runCustom(request, config),
  compact: (request) => compactCustom(request, config),
});

const resolveHarness = (harness: AgentHarnessConfig, piBinaryPath?: string): AgentHarness =>
  harness.kind === "pi" ? PiHarness(piBinaryPath) : CustomHarness(harness);

export const runAgent = (request: AgentRunRequest): Promise<AgentRunResult> =>
  resolveHarness(request.runner.harness, request.piBinaryPath).run(request);

export const compactAgent = (request: AgentCompactRequest): Promise<AgentCompactResult> =>
  resolveHarness(request.harness, request.piBinaryPath).compact(request);
