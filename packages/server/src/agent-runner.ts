import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AUTOMATION_AGENT_RUN_TIMEOUT_MS,
  AUTOMATION_SESSION_TOOL_MAX_BYTES,
  AUTOMATION_SESSION_TOOL_MAX_LINES,
  MAX_AUTOMATION_CHANGED_FILES,
  MAX_AUTOMATION_FINDINGS_LENGTH,
  MAX_AUTOMATION_LOG_ENTRIES,
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_AUTOMATION_TOOL_INPUT_LENGTH,
  MAX_AUTOMATION_TOOL_RESULT_LENGTH,
} from "./constants.js";
import type {
  AgentHarnessConfig,
  AgentLogEntry,
  AgentModelInfo,
  AgentSessionEntry,
  AutomationRunner,
} from "./types.js";

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

const FINDINGS_TRUNCATION_MARKER = "\n…[truncated]";
const LOG_TRUNCATION_MARKER = "\n…[log truncated]";

// Resolved `pi` binary + the PATH to spawn it with. The daemon process often
// has a minimal PATH (no ~/.npm-global/bin, etc.), so the first agent run
// resolves `pi` once — scanning PATH, then falling back to the user's login
// shell — and reuses it. The login PATH is also used as the spawn PATH (minus
// the shims dir) so pi and its tools find their dependencies; the daemon's own
// minimal PATH would leave pi unable to spawn node/git/etc. Only a successful
// resolution is cached (null re-resolves), so a later install is picked up.
interface PiResolution {
  binary: string | null;
  pathEnv: string;
}
let cachedPi: PiResolution | undefined;

const pathWithoutShims = (pathVar: string, shimsDir: string): string =>
  pathVar
    .split(path.delimiter)
    .filter((dir) => dir.length > 0 && path.resolve(dir) !== path.resolve(shimsDir))
    .join(path.delimiter);

const scanPathForPi = (pathVar: string, shimsDir: string): string | null => {
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.length === 0 || path.resolve(dir) === path.resolve(shimsDir)) continue;
    const candidate = path.join(dir, "pi");
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // not present or not executable in this dir
    }
  }
  return null;
};

// Fallback: the user's login interactive shell PATH, which sources the RC
// that adds pi's directory (e.g. ~/.npm-global/bin via ~/.zshrc). The localterm
// shims dir is typically first in the login PATH, so the caller scans the
// result minus the shims dir to land on the real binary, not the
// secret-injecting shim. The PATH is printed with delimiters to survive shell
// hooks like OSC-7 working-directory reports that write to stdout. stdin is
// empty so an interactive shell with `-c` runs the command and exits.
const resolveLoginPath = (): string => {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const result = spawnSync(
      shell,
      ["-l", "-i", "-c", "printf 'PIPATHBEGIN%sPIPATHEND' \"$PATH\""],
      {
        encoding: "utf8",
        input: "",
        timeout: 10_000,
      },
    );
    const stdout = result.stdout || "";
    const start = stdout.indexOf("PIPATHBEGIN");
    const end = stdout.indexOf("PIPATHEND", start === -1 ? 0 : start);
    if (start === -1 || end === -1) return "";
    return stdout.slice(start + "PIPATHBEGIN".length, end);
  } catch {
    return "";
  }
};

const resolvePiAndPath = (shimsDir: string, override?: string): PiResolution => {
  if (override) return { binary: override, pathEnv: process.env.PATH ?? "" };
  if (cachedPi) return cachedPi;
  const daemonPath = process.env.PATH ?? "";
  const fromDaemon = scanPathForPi(daemonPath, shimsDir);
  if (fromDaemon) {
    cachedPi = { binary: fromDaemon, pathEnv: pathWithoutShims(daemonPath, shimsDir) };
    return cachedPi;
  }
  const loginPath = resolveLoginPath();
  const fromLogin = scanPathForPi(loginPath, shimsDir);
  const pathEnv = pathWithoutShims(loginPath || daemonPath, shimsDir);
  if (fromLogin) cachedPi = { binary: fromLogin, pathEnv };
  return { binary: fromLogin, pathEnv };
};

const parseGitStatus = (output: string): Set<string> => {
  const set = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    let filePath = line.slice(3);
    const arrow = filePath.indexOf(" -> ");
    if (arrow !== -1) filePath = filePath.slice(arrow + 4);
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    if (filePath.length > 0) set.add(filePath);
  }
  return set;
};

const gitStatusSet = (cwd: string): Set<string> => {
  try {
    const result = spawnSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || result.status !== 0) return new Set();
    return parseGitStatus(result.stdout);
  } catch {
    return new Set();
  }
};

const computeChangedFiles = (before: Set<string>, cwd: string): string[] => {
  const after = gitStatusSet(cwd);
  const changed: string[] = [];
  for (const filePath of after) if (!before.has(filePath)) changed.push(filePath);
  for (const filePath of before) if (!after.has(filePath)) changed.push(filePath);
  changed.sort();
  return changed.slice(0, MAX_AUTOMATION_CHANGED_FILES);
};

const truncate = (raw: string, max: number, marker: string): string | null => {
  if (raw.length === 0) return null;
  // Slice below `max` by the marker length so the result (text + marker) fits
  // the schema's `.max(max)` — otherwise the stored value exceeds the cap and
  // the file fails to load next time.
  return raw.length > max ? raw.slice(0, Math.max(0, max - marker.length)) + marker : raw;
};

const truncateFindings = (raw: string): string | null =>
  truncate(raw, MAX_AUTOMATION_FINDINGS_LENGTH, FINDINGS_TRUNCATION_MARKER);

const truncateLog = (raw: string): string | null =>
  truncate(raw, MAX_AUTOMATION_LOG_LENGTH, LOG_TRUNCATION_MARKER);

const piFlagsFor = (config: PiHarnessConfig): string[] => {
  const flags: string[] = [];
  if (!config.extensions) flags.push("--no-extensions");
  if (!config.skills) flags.push("--no-skills");
  if (!config.contextFiles) flags.push("--no-context-files");
  return flags;
};

// JSONL line reader over a child's stdout. Splits on `\n` only (RPC mode uses
// LF as the record delimiter; readline is non-compliant because it also splits
// on U+2028/U+2029, which are valid inside JSON strings). Resolves each line to
// the next waiter, or null on close/timeout.
class RpcClient {
  readonly child: ChildProcess;
  private buffer = "";
  private readonly lineQueue: string[] = [];
  private readonly lineWaiters: Array<(line: string | null) => void> = [];
  closed = false;

  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.on("close", () => {
      this.closed = true;
      while (this.lineWaiters.length > 0) this.lineWaiters.shift()?.(null);
    });
    this.child.on("error", () => {
      this.closed = true;
      while (this.lineWaiters.length > 0) this.lineWaiters.shift()?.(null);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let index: number;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const waiter = this.lineWaiters.shift();
      if (waiter) waiter(line);
      else this.lineQueue.push(line);
    }
  }

  nextLine(timeoutMs: number): Promise<string | null> {
    if (this.lineQueue.length > 0) return Promise.resolve(this.lineQueue.shift() ?? null);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const waiter = (line: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = this.lineWaiters.indexOf(waiter);
        if (idx !== -1) this.lineWaiters.splice(idx, 1);
        resolve(line);
      };
      const timer = setTimeout(() => waiter(null), Math.max(0, timeoutMs));
      this.lineWaiters.push(waiter);
    });
  }

  send(command: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(command)}\n`);
  }

  close(): void {
    try {
      this.child.stdin?.end();
    } catch {
      // already closed
    }
    setTimeout(() => {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 2000).unref?.();
  }
}

const extractAssistantText = (message: { content?: unknown } | null): string => {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "text"; text: string } => {
      const blockType = (block as { type?: string } | null)?.type;
      return blockType === "text";
    })
    .map((block) => block.text)
    .join("");
};

// The assistant's reasoning blocks, concatenated. Hidden by default in the UI
// (behind a "show thinking" toggle) since it's noisy but sometimes useful.
const extractAssistantThinking = (message: { content?: unknown } | null): string => {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type: "thinking"; thinking: string } => {
      const blockType = (block as { type?: string } | null)?.type;
      return blockType === "thinking";
    })
    .map((block) => block.thinking)
    .join("");
};

const TOOL_RESULT_TRUNCATION_MARKER = "…[truncated]";
const TOOL_INPUT_TRUNCATION_MARKER = "…";
const SESSION_TOOL_TRUNCATION_MARKER = "\n…[output truncated]";

// Format a tool call's arguments as a short header string (the path a read
// took, the command bash ran, the pattern grep searched). Mirrors pi's per-tool
// render (read shows the path, bash the command) with a generic fallback.
const formatToolInput = (args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const command = record.command;
  if (typeof command === "string") return command;
  const filePath = record.file_path ?? record.path;
  const pattern = record.pattern;
  if (typeof pattern === "string")
    return typeof filePath === "string" ? `${pattern} · ${filePath}` : pattern;
  if (typeof filePath === "string") return filePath;
  try {
    const json = JSON.stringify(args);
    return json === "{}" ? "" : json;
  } catch {
    return "";
  }
};

const truncateToolInput = (raw: string): string =>
  raw.length > MAX_AUTOMATION_TOOL_INPUT_LENGTH
    ? raw.slice(
        0,
        Math.max(0, MAX_AUTOMATION_TOOL_INPUT_LENGTH - TOOL_INPUT_TRUNCATION_MARKER.length),
      ) + TOOL_INPUT_TRUNCATION_MARKER
    : raw;

// Safety-net cap for a session-transcript tool result, matching pi core's
// tool-output truncation (2000 lines or 50 KB, head kept). The session file is
// already pi-truncated, so this rarely fires.
const capSessionToolResult = (raw: string): string => {
  const lines = raw.split("\n");
  let out = raw;
  if (lines.length > AUTOMATION_SESSION_TOOL_MAX_LINES)
    out = lines.slice(0, AUTOMATION_SESSION_TOOL_MAX_LINES).join("\n");
  if (out.length > AUTOMATION_SESSION_TOOL_MAX_BYTES)
    out = out.slice(0, AUTOMATION_SESSION_TOOL_MAX_BYTES);
  return out === raw ? raw : out + SESSION_TOOL_TRUNCATION_MARKER;
};

const truncateToolResult = (raw: string): string =>
  raw.length > MAX_AUTOMATION_TOOL_RESULT_LENGTH
    ? raw.slice(
        0,
        Math.max(0, MAX_AUTOMATION_TOOL_RESULT_LENGTH - TOOL_RESULT_TRUNCATION_MARKER.length),
      ) + TOOL_RESULT_TRUNCATION_MARKER
    : raw;

const entrySize = (entry: AgentLogEntry): number => {
  let size = entry.text.length;
  if (entry.type === "assistant" && entry.thinking) size += entry.thinking.length;
  if (entry.type === "tool") size += entry.name.length;
  return size;
};

// Bound the structured log: cap the entry count, then drop oldest entries
// until the total is under the byte cap (keeps the recent turns, which hold
// the final answer). User/assistant text is kept full per entry; only the
// total is bounded for storage.
const capLogEntries = (entries: AgentLogEntry[]): AgentLogEntry[] => {
  let trimmed =
    entries.length > MAX_AUTOMATION_LOG_ENTRIES
      ? entries.slice(entries.length - MAX_AUTOMATION_LOG_ENTRIES)
      : entries;
  let total = trimmed.reduce((sum, entry) => sum + entrySize(entry), 0);
  while (total > MAX_AUTOMATION_LOG_LENGTH && trimmed.length > 1) {
    total -= entrySize(trimmed[0]);
    trimmed = trimmed.slice(1);
  }
  return trimmed;
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
              if (formatted) toolInputById.set(String(block.id ?? ""), formatted);
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
      const input = toolInputById.get(String(event.toolCallId ?? ""));
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
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000).unref?.();
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
  const findings = truncateFindings(stdout.length > 0 ? stdout : stderr);
  const log = truncateLog(stdout + (stderr.length > 0 ? `\n--- stderr ---\n${stderr}` : ""));
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
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcess;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    timer.unref?.();
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        message:
          code === 0
            ? undefined
            : `compact command exited ${String(code)}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
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

// Cache of the available-models list (pi's RPC get_available_models). The list
// rarely changes, so cache it for a few minutes; the first call spawns pi
// (slow, ~1-5s), later calls reuse the cache.
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedModels: { at: number; models: AgentModelInfo[] } | null = null;

const listModelsViaRpcWith = async (
  binary: string,
  pathEnv: string,
  extraFlags: string[],
): Promise<AgentModelInfo[]> => {
  const args = ["--mode", "rpc", "--no-session", ...extraFlags];
  const client = new RpcClient(binary, args, os.tmpdir(), {
    ...process.env,
    PATH: pathEnv || process.env.PATH,
  });
  client.send({ type: "get_available_models", id: "models" });
  let models: AgentModelInfo[] = [];
  const deadline = Date.now() + 15_000;
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
    if (event.type === "response" && event.id === "models" && event.success) {
      const raw = (event.data as { models?: unknown } | null)?.models;
      if (Array.isArray(raw)) {
        models = raw
          .map((model): AgentModelInfo => {
            const entry = model as {
              id?: unknown;
              name?: unknown;
              provider?: unknown;
              contextWindow?: unknown;
              reasoning?: unknown;
            };
            return {
              id: String(entry.id ?? ""),
              name: String(entry.name ?? entry.id ?? ""),
              provider: String(entry.provider ?? ""),
              ...(typeof entry.contextWindow === "number"
                ? { contextWindow: entry.contextWindow }
                : {}),
              ...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
            };
          })
          .filter((model) => model.id.length > 0);
      }
      break;
    }
  }
  client.close();
  return models;
};

const listModelsViaRpc = async (
  shimsDir: string,
  extraFlags: string[],
): Promise<AgentModelInfo[]> => {
  const { binary: realPi, pathEnv } = resolvePiAndPath(shimsDir);
  // Prefer the localterm shim for the model list: it injects the pi-process
  // secrets (so every provider with a key registers its models) then execs the
  // real pi. The bare real pi has none of those keys, so most providers don't
  // register and the list is nearly empty.
  let binary = realPi;
  const shimPi = path.join(shimsDir, "pi");
  try {
    if (fs.statSync(shimPi).isFile()) {
      fs.accessSync(shimPi, fs.constants.X_OK);
      binary = shimPi;
    }
  } catch {
    // no shim; fall back to the real pi
  }
  if (!binary) return [];
  return listModelsViaRpcWith(binary, pathEnv, extraFlags);
};

// List models available to the pi harness. Tries with extensions on (the
// default, so custom-provider models appear); if that yields nothing (e.g. the
// provider extensions crash headless), retries with --no-extensions for the
// built-in providers. Cached for a few minutes. A `piBinaryPath` override
// (tests) bypasses the shim + cache.
export const listAgentModels = async (
  shimsDir: string,
  piBinaryPath?: string,
): Promise<AgentModelInfo[]> => {
  if (piBinaryPath) return listModelsViaRpcWith(piBinaryPath, process.env.PATH ?? "", []);
  if (cachedModels && Date.now() - cachedModels.at < MODEL_CACHE_TTL_MS) return cachedModels.models;
  let models = await listModelsViaRpc(shimsDir, []);
  if (models.length === 0) models = await listModelsViaRpc(shimsDir, ["--no-extensions"]);
  cachedModels = { at: Date.now(), models };
  return models;
};

// Test-only: reset the model-list cache so a case never sees another case's
// (or another file's) cached result.
export const __resetAgentModelCache = (): void => {
  cachedModels = null;
};

// Extract the text of a tool_result content block: it's either a plain string
// or an array of content blocks (Anthropic's tool_result.content shape).
const extractToolResultText = (part: { content?: unknown }): string => {
  const content = part.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } => {
        const blockType = (block as { type?: string } | null)?.type;
        return blockType === "text";
      })
      .map((block) => block.text)
      .join("");
  }
  return "";
};

// Read a thread-mode pi session file (JSONL) and flatten it into the same
// user/assistant/tool entry shape as a run log, plus a `compaction` entry for
// each compaction the branch went through. Tool calls are tracked by id so a
// tool result's name + input (the path/command) can be recovered from the
// preceding call. Session-transcript tool results are capped at pi core's
// limits (2000 lines / 50 KB), not the stored-log preview cap. `untilMs`
// truncates the transcript at a point in time (a run's finishedAt) so an older
// run shows the branch as it was then, not the latest state. Returns [] if the
// file is missing (fresh mode, or no runs yet).
export const readAgentSession = async (
  sessionFile: string,
  untilMs?: number,
): Promise<AgentSessionEntry[]> => {
  let raw: string;
  try {
    raw = await fs.promises.readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const toolNameById = new Map<string, string>();
  const toolInputById = new Map<string, string>();
  const entries: AgentSessionEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      untilMs !== undefined &&
      typeof event.timestamp === "string" &&
      Date.parse(event.timestamp) > untilMs
    ) {
      continue;
    }
    if (event.type === "message") {
      const message = event.message as { role?: string; content?: unknown } | null;
      if (!message) continue;
      const role = message.role;
      const content = Array.isArray(message.content) ? message.content : [];
      if (role === "user") {
        for (const part of content) {
          const block = part as {
            type?: string;
            text?: unknown;
            tool_use_id?: unknown;
            content?: unknown;
          };
          if (block.type === "text" && typeof block.text === "string") {
            entries.push({ type: "user", text: block.text });
          } else if (block.type === "tool_result") {
            const id = String(block.tool_use_id ?? "");
            const name = toolNameById.get(id) ?? "tool";
            const input = toolInputById.get(id);
            entries.push({
              type: "tool",
              name,
              ...(input !== undefined ? { input } : {}),
              text: capSessionToolResult(extractToolResultText(block)),
            });
          }
        }
      } else if (role === "toolResult") {
        const message2 = event.message as {
          toolCallId?: unknown;
          toolName?: unknown;
          content?: unknown;
        } | null;
        const id = String(message2?.toolCallId ?? "");
        const name =
          (typeof message2?.toolName === "string" && message2.toolName) ||
          toolNameById.get(id) ||
          "tool";
        const input = toolInputById.get(id);
        entries.push({
          type: "tool",
          name,
          ...(input !== undefined ? { input } : {}),
          text: capSessionToolResult(extractToolResultText(message2 ?? {})),
        });
      } else if (role === "assistant") {
        let text = "";
        let thinking = "";
        for (const part of content) {
          const block = part as {
            type?: string;
            text?: unknown;
            thinking?: unknown;
            id?: unknown;
            name?: unknown;
            arguments?: unknown;
            input?: unknown;
          };
          if (block.type === "text" && typeof block.text === "string") text += block.text;
          else if (block.type === "thinking" && typeof block.thinking === "string")
            thinking += block.thinking;
          else if (block.type === "tool_use" || block.type === "toolCall") {
            const callId = String(block.id ?? "");
            const callName = String(block.name ?? "tool");
            toolNameById.set(callId, callName);
            const formatted = truncateToolInput(formatToolInput(block.arguments ?? block.input));
            if (formatted) toolInputById.set(callId, formatted);
          }
        }
        if (text.length > 0 || thinking.length > 0) {
          entries.push(
            thinking.length > 0
              ? { type: "assistant", text, thinking }
              : { type: "assistant", text },
          );
        }
      }
    } else if (event.type === "compaction") {
      const summary = String(event.summary ?? "");
      const tokensBefore = typeof event.tokensBefore === "number" ? event.tokensBefore : undefined;
      entries.push(
        tokensBefore !== undefined
          ? { type: "compaction", summary, tokensBefore }
          : { type: "compaction", summary },
      );
    }
  }
  return entries;
};
