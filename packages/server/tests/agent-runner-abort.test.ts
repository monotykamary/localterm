import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runAgent, type AgentRunRequest } from "../src/agent-runner.js";
import { computeChangedFiles, gitStatusSet } from "../src/agent-git-status.js";
import { RpcClient } from "../src/pi-rpc-client.js";
import {
  AUTOMATION_AGENT_FORCE_KILL_DELAY_MS,
  AUTOMATION_AGENT_RUN_TIMEOUT_MS,
} from "../src/constants.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../src/agent-git-status.js", () => ({
  gitStatusSet: vi.fn(() => new Set()),
  computeChangedFiles: vi.fn(() => []),
}));
vi.mock("../src/pi-binary-resolver.js", () => ({
  resolvePiAndPath: vi.fn(() => ({ binary: "fake-pi", pathEnv: "/bin" })),
}));

class FakeStream extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
  resume = vi.fn();
}

class FakeChild extends EventEmitter {
  pid: number | undefined = 4321;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  kill = vi.fn((_signal: NodeJS.Signals) => {
    this.killed = true;
    return true;
  });

  exit(code: number | null = null, signal: NodeJS.Signals | null = "SIGTERM"): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exit(code, signal);
    this.emit("close", code, signal);
  }

  event(event: Record<string, unknown>): void {
    this.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
  }
}

const requestFor = (kind: "pi" | "custom", signal?: AbortSignal): AgentRunRequest => ({
  runner: {
    kind: "agent",
    prompt: "do thing",
    sessionMode: "fresh",
    harness:
      kind === "pi"
        ? { kind: "pi", extensions: true, skills: true, contextFiles: true }
        : { kind: "custom", command: "fake-command" },
  },
  cwd: "/fake",
  env: {},
  shimsDir: "/fake/shims",
  sessionFile: null,
  signal,
});

const originalPlatform = process.platform;
let child: FakeChild;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  child = new FakeChild();
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("no group"), { code: "ESRCH" });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

const expectClean = (signal?: AbortSignal): void => {
  expect(vi.getTimerCount()).toBe(0);
  expect(child.eventNames()).toEqual([]);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
  expect(child.stdin.listenerCount("error")).toBe(0);
  if (signal) expect(getEventListeners(signal, "abort")).toHaveLength(0);
};

describe("automation runner shutdown", () => {
  it.each(["pi", "custom"] as const)("does not spawn a pre-aborted %s run", async (kind) => {
    const controller = new AbortController();
    controller.abort();
    expect(await runAgent(requestFor(kind, controller.signal))).toEqual({
      exitCode: null,
      findings: "Agent run aborted.",
      log: null,
      changedFiles: [],
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(gitStatusSet).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it.each(["prompt", "set_model", "set_thinking_level"])(
    "aborts Pi while awaiting %s and waits for actual exit",
    async (phase) => {
      const controller = new AbortController();
      const request = requestFor("pi", controller.signal);
      if (phase === "set_model") request.runner.model = "provider/model";
      if (phase === "set_thinking_level") request.runner.thinking = "high";
      const running = runAgent(request);
      expect(JSON.parse(child.stdin.write.mock.calls[0][0]).type).toBe(phase);
      controller.abort();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(computeChangedFiles).not.toHaveBeenCalled();
      child.event({ type: "agent_end" });
      child.exit();
      expect(await running).toMatchObject({ exitCode: null, findings: "Agent run aborted." });
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      expect(computeChangedFiles).toHaveBeenCalledTimes(1);
      expectClean(controller.signal);
    },
  );

  it.each(["pi", "custom"] as const)(
    "escalates a stubborn %s child even when killed is already true (Windows fallback)",
    async (kind) => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const controller = new AbortController();
      const running = runAgent(requestFor(kind, controller.signal));
      const options = vi.mocked(spawn).mock.calls[0].at(-1);
      expect(options).toMatchObject({ detached: false });
      controller.abort();
      expect(child.killed).toBe(true);
      await vi.advanceTimersByTimeAsync(AUTOMATION_AGENT_FORCE_KILL_DELAY_MS - 1);
      expect(child.kill).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
      expect(computeChangedFiles).not.toHaveBeenCalled();
      child.exit(null, "SIGKILL");
      expect((await running).exitCode).toBeNull();
      expect(process.kill).not.toHaveBeenCalled();
      expectClean(controller.signal);
    },
  );

  it.each(["pi", "custom"] as const)(
    "kills surviving POSIX descendants after the %s leader exits on TERM",
    async (kind) => {
      Object.defineProperty(process, "platform", { value: "linux" });
      vi.mocked(process.kill).mockReturnValue(true);
      const controller = new AbortController();
      const running = runAgent(requestFor(kind, controller.signal));
      expect(vi.mocked(spawn).mock.calls[0].at(-1)).toMatchObject({ detached: true });
      controller.abort();
      expect(process.kill).toHaveBeenCalledWith(-4321, "SIGTERM");
      child.close(null, "SIGTERM");
      await vi.advanceTimersByTimeAsync(AUTOMATION_AGENT_FORCE_KILL_DELAY_MS - 1);
      expect(computeChangedFiles).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(process.kill).toHaveBeenCalledWith(-4321, "SIGKILL");
      expect((await running).exitCode).toBeNull();
      expectClean(controller.signal);
    },
  );

  it.each(["pi", "custom"] as const)("handles %s spawn errors after abort starts", async (kind) => {
    child.pid = undefined;
    const controller = new AbortController();
    const running = runAgent(requestFor(kind, controller.signal));
    controller.abort();
    child.emit("error", new Error("spawn failed"));
    expect((await running).exitCode).toBeNull();
    expectClean(controller.signal);
  });

  it("falls back to child signaling for a fake without a PID", async () => {
    child.pid = undefined;
    const controller = new AbortController();
    const running = runAgent(requestFor("custom", controller.signal));
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.close(null, "SIGTERM");
    expect((await running).exitCode).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it("clears custom shutdown escalation after graceful exit and retains captured output", async () => {
    const controller = new AbortController();
    const running = runAgent(requestFor("custom", controller.signal));
    child.stdout.emit("data", Buffer.from("partial output"));
    controller.abort();
    child.close(null, "SIGTERM");
    expect(await running).toMatchObject({ exitCode: null, log: "partial output" });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expectClean(controller.signal);
  });

  it("uses the same bounded escalation for custom run timeout", async () => {
    const running = runAgent(requestFor("custom"));
    await vi.advanceTimersByTimeAsync(AUTOMATION_AGENT_RUN_TIMEOUT_MS);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(AUTOMATION_AGENT_FORCE_KILL_DELAY_MS);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.exit(null, "SIGKILL");
    expect((await running).exitCode).toBeNull();
    expectClean();
  });

  it.each(["pi", "custom"] as const)("cleans up %s spawn failure", async (kind) => {
    child.pid = undefined;
    const controller = new AbortController();
    const running = runAgent(requestFor(kind, controller.signal));
    child.emit("error", new Error("spawn failed"));
    expect((await running).exitCode).toBe(1);
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it("keeps a normal custom completion successful and removes abort listeners", async () => {
    const controller = new AbortController();
    const running = runAgent(requestFor("custom", controller.signal));
    child.stdout.emit("data", Buffer.from("done"));
    child.close();
    expect(await running).toMatchObject({ exitCode: 0, findings: "done" });
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it("does not report success when abort races a Pi agent_end during EOF shutdown", async () => {
    const controller = new AbortController();
    const running = runAgent(requestFor("pi", controller.signal));
    child.event({ type: "agent_end" });
    await vi.advanceTimersByTimeAsync(0);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.exit();
    expect((await running).exitCode).toBeNull();
    expectClean(controller.signal);
  });

  it("awaits teardown after a rejected Pi setup command without prompting", async () => {
    const controller = new AbortController();
    const request = requestFor("pi", controller.signal);
    request.runner.model = "provider/model";
    const running = runAgent(request);
    child.event({ type: "response", command: "set_model", success: false, error: "unavailable" });
    await vi.advanceTimersByTimeAsync(0);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(computeChangedFiles).not.toHaveBeenCalled();
    child.close();
    expect(await running).toMatchObject({
      exitCode: 1,
      findings: "Failed to select model provider/model: unavailable",
    });
    expect(child.stdin.write).toHaveBeenCalledOnce();
    expectClean(controller.signal);
  });

  it("awaits normal Pi teardown before returning success", async () => {
    const running = runAgent(requestFor("pi"));
    child.event({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
    });
    child.event({ type: "agent_end" });
    await vi.advanceTimersByTimeAsync(0);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(computeChangedFiles).not.toHaveBeenCalled();
    child.close();
    expect(await running).toMatchObject({ exitCode: 0, findings: "done" });
    expectClean();
  });
});

describe("RpcClient close lifecycle", () => {
  it("preserves buffered JSONL after natural close", async () => {
    const client = new RpcClient("fake", [], "/fake", {});
    child.stdout.emit("data", Buffer.from('first\r\n{"text":"a\u2028b\u2029c"}\n'));
    child.close();
    expect(await client.nextLine(100)).toBe("first");
    expect(await client.nextLine(100)).toBe('{"text":"a\u2028b\u2029c"}');
    expect(await client.nextLine(100)).toBeNull();
    await client.close();
    expect(child.kill).not.toHaveBeenCalled();
    expectClean();
  });

  it("wakes pending reads immediately, closes idempotently and cancels the timer on exit", async () => {
    const client = new RpcClient("fake", [], "/fake", {});
    const line = client.nextLine(10_000);
    const closing = client.close();
    expect(client.close()).toBe(closing);
    expect(await line).toBeNull();
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    child.close();
    await closing;
    expectClean();
  });

  it("forces an EOF-resistant client down and never signals it again after reaping", async () => {
    const client = new RpcClient("fake", [], "/fake", {});
    const closing = client.close();
    await vi.advanceTimersByTimeAsync(AUTOMATION_AGENT_FORCE_KILL_DELAY_MS);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.exit(null, "SIGKILL");
    await closing;
    await client.close("SIGTERM");
    expect(child.kill).toHaveBeenCalledOnce();
    expectClean();
  });

  it("releases a timed-out reader and handles asynchronous stdin errors", async () => {
    const client = new RpcClient("fake", [], "/fake", {});
    const timed = client.nextLine(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await timed).toBeNull();
    const pending = client.nextLine(10_000);
    child.stdin.emit("error", new Error("EPIPE"));
    expect(await pending).toBeNull();
    const closing = client.close();
    child.close();
    await closing;
    expectClean();
  });
});
