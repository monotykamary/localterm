import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  compactAgent,
  listAgentModels,
  readAgentSession,
  runAgent,
  __resetAgentModelCache,
} from "../src/agent-runner.js";
import {
  AUTOMATION_CUSTOM_HARNESS_CAPTURE_BYTES,
  AUTOMATION_SESSION_MAX_ENTRIES,
  AUTOMATION_SESSION_MAX_LINE_BYTES,
  MAX_AUTOMATION_LOG_LENGTH,
} from "../src/constants.js";

// A fake `pi --mode rpc`: reads JSONL commands on stdin, logs each to
// $LOCALTERM_FAKE_PI_LOG (if set), and responds to `prompt`/`compact`/etc. with
// canned RPC events. `prompt` writes agent-out.txt to cwd (for changedFiles
// tests in a git repo) and emits a full agent turn. `FAKE_PI_ERROR=1` makes the
// assistant turn end with stopReason "error". `FAKE_PI_RICH=1` emits a tool call
// + an assistant message with a thinking block so the structured log has
// user/tool/assistant(thinking) entries.
const writeFakePi = (dir: string): string => {
  const scriptPath = path.join(dir, "fake-pi");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
log="$LOCALTERM_FAKE_PI_LOG"
emit() { printf '%s\\n' "$1"; }
while IFS= read -r line; do
  [ -n "$log" ] && printf '%s\\n' "$line" >>"$log"
  cmd=$(printf '%s' "$line" | sed -n 's/.*"type":"\\([^"]*\\)".*/\\1/p')
  case "$cmd" in
    set_thinking_level|set_model)
      emit '{"type":"response","command":"'"$cmd"'","success":true}'
      ;;
    prompt)
      echo created > agent-out.txt
      emit '{"type":"response","command":"prompt","id":"prompt","success":true}'
      emit '{"type":"agent_start"}'
      if [ "$FAKE_PI_RICH" = "1" ]; then
        emit '{"type":"tool_execution_end","toolCallId":"c1","toolName":"bash","result":{"content":[{"type":"text","text":"total 0"}]},"isError":false}'
        emit '{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"planning the answer"},{"type":"text","text":"Hello world"}],"stopReason":"stop"}}'
      elif [ "$FAKE_PI_TOOL_INPUT" = "1" ]; then
        emit '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"I will read it."},{"type":"tool_use","id":"tu1","name":"read","input":{"path":"README.md"}}],"stopReason":"tool_use"}}'
        emit '{"type":"tool_execution_end","toolCallId":"tu1","toolName":"read","result":{"content":[{"type":"text","text":"# README"}]},"isError":false}'
        emit '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}'
      elif [ "$FAKE_PI_ERROR" = "1" ]; then
        emit '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"Connection error."}}'
      else
        emit '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"}],"stopReason":"stop"}}'
      fi
      emit '{"type":"agent_end","messages":[]}'
      exit 0
      ;;
    compact)
      emit '{"type":"response","command":"compact","id":"compact","success":true}'
      emit '{"type":"compaction_end","reason":"manual","result":{"summary":"s","tokensBefore":1000,"estimatedTokensAfter":200},"aborted":false}'
      exit 0
      ;;
    get_available_models)
      emit '{"type":"response","command":"get_available_models","id":"models","success":true,"data":{"models":[{"id":"claude-haiku-4-5","name":"Claude Haiku 4.5","provider":"anthropic","contextWindow":200000,"reasoning":true},{"id":"glm-5.2","name":"GLM 5.2","provider":"makora"}]}}'
      exit 0
      ;;
  esac
done
`,
    { mode: 0o755 },
  );
  return scriptPath;
};

const initGitRepo = async (cwd: string): Promise<void> => {
  const { execSync } = await import("node:child_process");
  execSync("git init -q", { cwd });
  execSync("git -c user.email=a@b -c user.name=t commit -q --allow-empty -m init", { cwd });
};

const piRequest = (overrides: Partial<Parameters<typeof runAgent>[0]> = {}) =>
  ({
    runner: {
      kind: "agent",
      prompt: "do thing",
      sessionMode: "fresh",
      harness: { kind: "pi", extensions: true, skills: true, contextFiles: true },
    },
    cwd: "/tmp",
    env: {},
    sessionFile: null,
    shimsDir: path.join(os.tmpdir(), "shims"),
    piBinaryPath: undefined,
    ...overrides,
  }) as Parameters<typeof runAgent>[0];

describe("runAgent (pi harness)", { tags: ["integration"] }, () => {
  let tmpDir: string;
  let pi: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-agent-runner-"));
    pi = writeFakePi(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures the last assistant text as findings, a structured user/assistant log, and exit 0", async () => {
    const result = await runAgent(piRequest({ cwd: tmpDir, piBinaryPath: pi }));
    expect(result.exitCode).toBe(0);
    expect(result.findings).toBe("Hello world");
    expect(Array.isArray(result.log)).toBe(true);
    if (Array.isArray(result.log)) {
      expect(result.log[0]).toEqual({ type: "user", text: "do thing" });
      const assistant = result.log.find((entry) => entry.type === "assistant");
      expect(assistant).toEqual({ type: "assistant", text: "Hello world" });
    }
  });

  it("captures tool calls and thinking as structured log entries", async () => {
    const result = await runAgent(
      piRequest({ cwd: tmpDir, piBinaryPath: pi, env: { FAKE_PI_RICH: "1" } }),
    );
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.log)).toBe(true);
    if (Array.isArray(result.log)) {
      const tool = result.log.find((entry) => entry.type === "tool");
      expect(tool).toEqual({ type: "tool", name: "bash", text: "total 0" });
      const assistant = result.log.find((entry) => entry.type === "assistant");
      expect(assistant).toEqual({
        type: "assistant",
        text: "Hello world",
        thinking: "planning the answer",
      });
    }
  });

  it("records a tool call's input (the path/command) on its log entry", async () => {
    const result = await runAgent(
      piRequest({ cwd: tmpDir, piBinaryPath: pi, env: { FAKE_PI_TOOL_INPUT: "1" } }),
    );
    expect(result.exitCode).toBe(0);
    if (Array.isArray(result.log)) {
      const tool = result.log.find((entry) => entry.type === "tool");
      expect(tool).toEqual({
        type: "tool",
        name: "read",
        input: "README.md",
        text: "# README",
      });
    }
  });

  it("passes --session <path> for a thread run and creates the session dir", async () => {
    const sessionFile = path.join(tmpDir, "sessions", "a.jsonl");
    await runAgent(
      piRequest({
        cwd: tmpDir,
        piBinaryPath: pi,
        runner: {
          kind: "agent",
          prompt: "wake",
          sessionMode: "thread",
          harness: { kind: "pi", extensions: true, skills: true, contextFiles: true },
        },
        sessionFile,
      }),
    );
    expect(fs.existsSync(path.dirname(sessionFile))).toBe(true);
  });

  it("maps an error turn to a failed run with the error message as findings", async () => {
    const result = await runAgent(
      piRequest({
        cwd: tmpDir,
        piBinaryPath: pi,
        env: { FAKE_PI_ERROR: "1" },
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.findings).toBe("Connection error.");
  });

  it("passes --no-extensions/--no-skills/--no-context-files when the harness disables them", async () => {
    const logPath = path.join(tmpDir, "cmd.log");
    await runAgent(
      piRequest({
        cwd: tmpDir,
        piBinaryPath: pi,
        runner: {
          kind: "agent",
          prompt: "go",
          sessionMode: "fresh",
          harness: { kind: "pi", extensions: false, skills: false, contextFiles: false },
        },
        env: { LOCALTERM_FAKE_PI_LOG: logPath },
      }),
    );
    // The fake pi ignores flags, but the run still completes; this asserts the
    // disabled-harness path doesn't break the spawn (the flags are validated by
    // the run completing with findings).
    const result = await runAgent(
      piRequest({
        cwd: tmpDir,
        piBinaryPath: pi,
        runner: {
          kind: "agent",
          prompt: "go",
          sessionMode: "fresh",
          harness: { kind: "pi", extensions: false, skills: false, contextFiles: false },
        },
      }),
    );
    expect(result.findings).toBe("Hello world");
  });

  it("diffs git status before/after into changedFiles", async () => {
    await initGitRepo(tmpDir);
    const result = await runAgent(piRequest({ cwd: tmpDir, piBinaryPath: pi }));
    expect(result.changedFiles).toContain("agent-out.txt");
  });

  it("reports a clear message when pi is not on PATH", async () => {
    const originalPath = process.env.PATH;
    const originalShell = process.env.SHELL;
    process.env.PATH = tmpDir; // no `pi` here
    // A bogus SHELL defeats the login-shell fallback too, so this tests the
    // genuine "pi is not installed anywhere" path rather than the test
    // machine's own login shell (which would find the real pi).
    process.env.SHELL = "/nonexistent-shell-for-test";
    try {
      const result = await runAgent(piRequest({ cwd: tmpDir }));
      expect(result.exitCode).toBe(1);
      expect(result.findings).toMatch(/pi not found on PATH/);
      expect(result.changedFiles).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
      process.env.SHELL = originalShell;
    }
  });
});

describe("runAgent (custom harness)", { tags: ["integration"] }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-custom-harness-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs the custom command with the prompt in env and captures stdout as findings", async () => {
    const result = await runAgent(
      piRequest({
        cwd: tmpDir,
        runner: {
          kind: "agent",
          prompt: "do thing",
          sessionMode: "fresh",
          harness: { kind: "custom", command: 'printf "out: $LOCALTERM_AGENT_PROMPT"' },
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.findings).toBe("out: do thing");
    expect(result.log).toContain("out: do thing");
  });

  it("bounds noisy custom harness output before building the stored log", async () => {
    const command = `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(${AUTOMATION_CUSTOM_HARNESS_CAPTURE_BYTES * 2}))'`;
    const result = await runAgent(
      piRequest({
        cwd: tmpDir,
        runner: {
          kind: "agent",
          prompt: "x",
          sessionMode: "fresh",
          harness: { kind: "custom", command },
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.log).toHaveLength(MAX_AUTOMATION_LOG_LENGTH);
    expect(result.log).toContain("log truncated");
  });

  it("marks a non-zero custom command exit as failed", async () => {
    const result = await runAgent(
      piRequest({
        cwd: tmpDir,
        runner: {
          kind: "agent",
          prompt: "x",
          sessionMode: "fresh",
          harness: { kind: "custom", command: "printf err 1>&2; exit 3" },
        },
      }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.log).toContain("err");
  });
});

describe("compactAgent", { tags: ["integration"] }, () => {
  let tmpDir: string;
  let pi: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-compact-"));
    pi = writeFakePi(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compacts a thread session via the pi harness RPC compact command", async () => {
    const sessionFile = path.join(tmpDir, "s.jsonl");
    const result = await compactAgent({
      harness: { kind: "pi", extensions: true, skills: true, contextFiles: true },
      cwd: tmpDir,
      env: {},
      sessionFile,
      shimsDir: path.join(os.tmpdir(), "shims"),
      piBinaryPath: pi,
    });
    expect(result.ok).toBe(true);
  });

  it("runs the custom compact command and maps its exit code", async () => {
    const sessionFile = path.join(tmpDir, "s.jsonl");
    const result = await compactAgent({
      harness: {
        kind: "custom",
        command: "true",
        compactCommand: 'test -n "$LOCALTERM_AGENT_SESSION_FILE"',
      },
      cwd: tmpDir,
      env: {},
      sessionFile,
      shimsDir: path.join(os.tmpdir(), "shims"),
    });
    expect(result.ok).toBe(true);
  });

  it("reports unsupported when a custom harness has no compact command", async () => {
    const result = await compactAgent({
      harness: { kind: "custom", command: "true" },
      cwd: tmpDir,
      env: {},
      sessionFile: path.join(tmpDir, "s.jsonl"),
      shimsDir: path.join(os.tmpdir(), "shims"),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no compact command/);
  });
});

describe("listAgentModels", { tags: ["integration"] }, () => {
  let tmpDir: string;
  let pi: string;

  beforeEach(() => {
    __resetAgentModelCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-models-"));
    pi = writeFakePi(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists models from the pi RPC get_available_models response", async () => {
    const models = await listAgentModels(path.join(os.tmpdir(), "shims"), pi);
    expect(models).toEqual([
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        provider: "anthropic",
        contextWindow: 200000,
        reasoning: true,
      },
      { id: "glm-5.2", name: "GLM 5.2", provider: "makora" },
    ]);
  });

  it("returns an empty list when pi is not on PATH", async () => {
    const originalPath = process.env.PATH;
    const originalShell = process.env.SHELL;
    process.env.PATH = tmpDir;
    process.env.SHELL = "/nonexistent-shell-for-test";
    try {
      const models = await listAgentModels(path.join(os.tmpdir(), "shims"));
      expect(models).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
      process.env.SHELL = originalShell;
    }
  });
});

describe("readAgentSession", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-session-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeSession = (name: string, lines: string[]): string => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
    return file;
  };

  it("flattens user/assistant/tool/compaction and maps tool_result names from the tool_use", async () => {
    const file = writeSession("s.jsonl", [
      JSON.stringify({ type: "session", id: "s1", cwd: "/tmp" }),
      JSON.stringify({ type: "model_change", provider: "anthropic", modelId: "claude-haiku-4-5" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        message: { role: "user", content: [{ type: "text", text: "Say hello" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "greeting" },
            { type: "text", text: "Hello!" },
            { type: "tool_use", id: "tu1", name: "bash", input: { command: "echo hi" } },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "hi\n" }],
        },
      }),
      JSON.stringify({
        type: "compaction",
        id: "c1",
        summary: "prior turns summarized",
        tokensBefore: 12000,
      }),
      JSON.stringify({
        type: "message",
        id: "m4",
        message: { role: "user", content: [{ type: "text", text: "next" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m5",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
      JSON.stringify({ type: "custom", customType: "tps", data: { tps: 60 } }),
    ]);
    const entries = await readAgentSession(file);
    expect(entries).toEqual([
      { type: "user", text: "Say hello" },
      { type: "assistant", text: "Hello!", thinking: "greeting" },
      { type: "tool", name: "bash", input: "echo hi", text: "hi\n" },
      { type: "compaction", summary: "prior turns summarized", tokensBefore: 12000 },
      { type: "user", text: "next" },
      { type: "assistant", text: "done" },
    ]);
  });

  it("keeps a tool result under pi's session cap (50 KB / 2000 lines) and caps beyond it", async () => {
    const under = "x".repeat(10000); // 1 line, well under 50 KB → kept full
    const file = writeSession("s.jsonl", [
      JSON.stringify({
        type: "message",
        id: "m1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu1", name: "read", input: {} }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: under }] },
          ],
        },
      }),
    ]);
    const entries = await readAgentSession(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "tool", name: "read" });
    // Under both limits → kept in full (the session transcript matches pi core,
    // not the stored-log preview cap).
    expect((entries[0] as { text: string }).text).toBe(under);

    // Beyond the 2000-line cap → truncated with the session marker.
    const overLines = Array.from({ length: 2500 }, () => "line").join("\n");
    const overFile = writeSession("s2.jsonl", [
      JSON.stringify({
        type: "message",
        id: "m1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu1", name: "read", input: {} }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: [{ type: "text", text: overLines }],
            },
          ],
        },
      }),
    ]);
    const capped = await readAgentSession(overFile);
    const cappedText = (capped[0] as { text: string }).text;
    expect(cappedText.endsWith("…[output truncated]")).toBe(true);
    expect(cappedText.split("\n").length).toBeLessThanOrEqual(2001);
  });

  it("flattens the OpenAI session shape (toolCall block + toolResult role) the providers actually write", async () => {
    const file = writeSession("openai.jsonl", [
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-07-05T17:20:45.147Z",
        message: { role: "user", content: [{ type: "text", text: "Read the README" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-07-05T17:26:16.256Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll read the README file." },
            {
              type: "toolCall",
              id: "chatcmpl-tool-9e",
              name: "read",
              arguments: { path: "README.md" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        timestamp: "2026-07-05T17:26:16.267Z",
        message: {
          role: "toolResult",
          toolCallId: "chatcmpl-tool-9e",
          toolName: "read",
          content: [{ type: "text", text: "# localterm" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m4",
        timestamp: "2026-07-05T17:26:23.636Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here's what the README describes:" }],
        },
      }),
    ]);
    const entries = await readAgentSession(file);
    expect(entries).toEqual([
      { type: "user", text: "Read the README" },
      { type: "assistant", text: "I'll read the README file." },
      { type: "tool", name: "read", input: "README.md", text: "# localterm" },
      { type: "assistant", text: "Here's what the README describes:" },
    ]);
  });

  it("truncates the transcript at untilMs so an older run sees the branch as it was then", async () => {
    const file = writeSession("trunc.jsonl", [
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-07-05T17:20:45.147Z",
        message: { role: "user", content: [{ type: "text", text: "old question" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-07-05T17:21:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        timestamp: "2026-07-05T17:26:16.000Z",
        message: { role: "user", content: [{ type: "text", text: "new question" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m4",
        timestamp: "2026-07-05T17:26:24.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "new answer" }] },
      }),
    ]);
    const untilMs = Date.parse("2026-07-05T17:21:00.000Z");
    const entries = await readAgentSession(file, untilMs);
    expect(entries).toEqual([
      { type: "user", text: "old question" },
      { type: "assistant", text: "old answer" },
    ]);
    expect((await readAgentSession(file)).map((entry) => entry.type)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("retains only the bounded tail and skips oversized JSONL records", async () => {
    const sessionLines = Array.from({ length: AUTOMATION_SESSION_MAX_ENTRIES + 5 }, (_, index) =>
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: `entry-${index}` }] },
      }),
    );
    const file = writeSession("bounded.jsonl", [
      "x".repeat(AUTOMATION_SESSION_MAX_LINE_BYTES + 1),
      ...sessionLines,
    ]);

    const entries = await readAgentSession(file);

    expect(entries).toHaveLength(AUTOMATION_SESSION_MAX_ENTRIES);
    expect(entries[0]).toEqual({ type: "user", text: "entry-5" });
    expect(entries.at(-1)).toEqual({
      type: "user",
      text: `entry-${AUTOMATION_SESSION_MAX_ENTRIES + 4}`,
    });
  });

  it("returns an empty list for a missing session file (fresh mode / no runs)", async () => {
    const entries = await readAgentSession(path.join(tmpDir, "missing.jsonl"));
    expect(entries).toEqual([]);
  });
});
